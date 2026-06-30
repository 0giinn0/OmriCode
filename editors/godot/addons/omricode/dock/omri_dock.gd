extends Control

const APP_URL := "http://127.0.0.1:18427"
const BG_COLOR := Color("#0a0a0a")
const SURFACE_COLOR := Color("#111111")
const ACCENT_COLOR := Color("#b0b0b0")
const TEXT_COLOR := Color("#e0e0e0")

var chat_history: RichTextLabel
var input_field: LineEdit
var send_button: Button
var status_label: Label
var http: HTTPRequest
var client_id: String = ""
var _buffer: String = ""

func _init() -> void:
	custom_minimum_size = Vector2(320, 480)

func _ready() -> void:
	_setup_theme()
	_build_ui()
	_connect_signals()

	http = HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(_on_http_completed)

	_register_with_app()

func _setup_theme() -> void:
	theme = Theme.new()
	var stylebox := StyleBoxFlat.new()
	stylebox.bg_color = SURFACE_COLOR
	stylebox.set_corner_radius_all(4)
	theme.set_stylebox("panel", "Panel", stylebox)

	var input_style := StyleBoxFlat.new()
	input_style.bg_color = Color("#1a1a1a")
	input_style.border_color = ACCENT_COLOR
	input_style.border_width_left = 1
	input_style.border_width_right = 1
	input_style.border_width_top = 1
	input_style.border_width_bottom = 1
	input_style.set_corner_radius_all(4)
	theme.set_stylebox("normal", "LineEdit", input_style)
	theme.set_stylebox("focus", "LineEdit", input_style)

	theme.set_color("default_color", "RichTextLabel", TEXT_COLOR)
	theme.set_color("font_color", "LineEdit", TEXT_COLOR)
	theme.set_color("font_color", "Button", ACCENT_COLOR)

func _build_ui() -> void:
	var main_vbox := VBoxContainer.new()
	main_vbox.anchor_left = 0.0
	main_vbox.anchor_top = 0.0
	main_vbox.anchor_right = 1.0
	main_vbox.anchor_bottom = 1.0
	main_vbox.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main_vbox.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(main_vbox)

	var header := HBoxContainer.new()
	header.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main_vbox.add_child(header)

	var title_label := Label.new()
	title_label.text = "OmriCode"
	title_label.add_theme_color_override("font_color", ACCENT_COLOR)
	title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(title_label)

	status_label = Label.new()
	status_label.text = "connecting..."
	status_label.add_theme_color_override("font_color", Color("#888888"))
	status_label.add_theme_font_size_override("font_size", 10)
	header.add_child(status_label)

	var separator := HSeparator.new()
	main_vbox.add_child(separator)

	chat_history = RichTextLabel.new()
	chat_history.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	chat_history.size_flags_vertical = Control.SIZE_EXPAND_FILL
	chat_history.bbcode_enabled = true
	chat_history.scroll_active = true
	chat_history.fit_content = true
	chat_history.selection_enabled = true
	chat_history.add_theme_color_override("default_color", TEXT_COLOR)
	chat_history.add_theme_color_override("background_color", BG_COLOR)
	main_vbox.add_child(chat_history)

	var input_area := HBoxContainer.new()
	input_area.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main_vbox.add_child(input_area)

	input_field = LineEdit.new()
	input_field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	input_field.placeholder_text = "Ask OmriCode..."
	input_field.add_theme_color_override("font_color", TEXT_COLOR)
	input_field.add_theme_color_override("placeholder_color", ACCENT_COLOR)
	input_area.add_child(input_field)

	send_button = Button.new()
	send_button.text = "Send"
	send_button.add_theme_color_override("font_color", ACCENT_COLOR)
	input_area.add_child(send_button)

func _connect_signals() -> void:
	send_button.pressed.connect(_on_send)
	input_field.text_submitted.connect(_on_send)

func _on_send(_text := "") -> void:
	var text := input_field.text.strip_edges()
	if text.is_empty(): return
	input_field.clear()
	_display_message("user", text)
	_send_to_app(text)

func _display_message(role: String, content: String) -> void:
	var tag := role
	if role == "error": tag = "error"
	elif role == "thinking": tag = "thinking"
	elif role == "assistant": tag = "assistant"
	else: tag = "user"

	var display := "[b]" + tag.capitalize() + ":[/b]\n" + content + "\n\n"

	match tag:
		"error":
			chat_history.push_color(Color("#ff5555"))
			chat_history.append_text(display)
			chat_history.pop()
		"thinking":
			chat_history.push_color(Color("#888888"))
			chat_history.append_text(display)
			chat_history.pop()
		"assistant":
			chat_history.push_color(Color("#50fa7b"))
			chat_history.append_text(display)
			chat_history.pop()
		_:
			chat_history.append_text(display)

	chat_history.scroll_to_line(chat_history.get_line_count() - 1)

func _register_with_app() -> void:
	var headers := ["Content-Type: application/json"]
	var body := JSON.stringify({
		"name": "Godot",
		"type": "godot",
		"capabilities": ["scene:create", "scene:edit", "scene:delete", "scene:run", "scene:stop"]
	})
	var error := http.request(APP_URL + "/register", headers, HTTPClient.METHOD_POST, body)
	if error != OK:
		_display_message("error", "Failed to connect to OmriCode app at " + APP_URL)
		status_label.text = "disconnected"

func _send_to_app(text: String) -> void:
	if client_id.is_empty():
		_display_message("thinking", "Connecting to OmriCode app...")
		_register_with_app()
		await get_tree().create_timer(1.0).timeout

	var headers := ["Content-Type: application/json"]
	var body := JSON.stringify({
		"message": text,
		"clientId": client_id
	})

	_display_message("thinking", "Waiting for response...")

	var error := http.request(APP_URL + "/chat/sync", headers, HTTPClient.METHOD_POST, body)
	if error != OK:
		_display_message("error", "Request failed")
		status_label.text = "error"

func _on_http_completed(result: int, response_code: int, headers: PackedStringArray, body: PackedByteArray) -> void:
	var body_str := body.get_string_from_utf8()
	var json := JSON.new()
	var parse := json.parse(body_str)
	if parse != OK: return
	var data := json.data as Dictionary
	if data == null: return

	# Registration response
	if data.has("clientId"):
		client_id = data["clientId"]
		status_label.text = "connected"
		_display_message("system", "Connected to OmriCode app")
		return

	# Chat sync response
	if data.has("response"):
		_display_message("assistant", data["response"])
		status_label.text = "connected"
		return

	if data.has("error"):
		_display_message("error", data["error"])
		status_label.text = "error"

	if response_code == 0 and result == HTTPRequest.RESULT_CONNECTION_ERROR:
		_display_message("error", "Cannot reach OmriCode app. Is it running?")
		status_label.text = "disconnected"
