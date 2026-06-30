# ---------------------------------------------------------------
# dock/omri_dock.gd
# OmriCode Godot Plugin — Dock panel with chat UI
# ---------------------------------------------------------------
extends Control

signal message_sent(text: String)
signal provider_changed(id: String)

const BG_COLOR := Color("#0a0a0a")
const SURFACE_COLOR := Color("#111111")
const ACCENT_COLOR := Color("#b0b0b0")
const TEXT_COLOR := Color("#e0e0e0")
const MONO_FONT := "res://addons/omricode/assets/FiraCode-Regular.ttf"

var chat_history: RichTextLabel
var input_field: LineEdit
var send_button: Button
var provider_dropdown: OptionButton

var _history_entries: Array[Dictionary] = []


func _init() -> void:
	custom_minimum_size = Vector2(320, 480)


func _ready() -> void:
	_setup_theme()
	_build_ui()
	_connect_signals()


func _setup_theme() -> void:
	theme = Theme.new()

	var stylebox: StyleBoxFlat = StyleBoxFlat.new()
	stylebox.bg_color = SURFACE_COLOR
	stylebox.set_corner_radius_all(4)

	var panel_style: StyleBoxFlat = StyleBoxFlat.new()
	panel_style.bg_color = SURFACE_COLOR
	panel_style.set_corner_radius_all(4)

	var input_style: StyleBoxFlat = StyleBoxFlat.new()
	input_style.bg_color = Color("#1a1a1a")
	input_style.border_color = ACCENT_COLOR
	input_style.border_width_left = 1
	input_style.border_width_right = 1
	input_style.border_width_top = 1
	input_style.border_width_bottom = 1
	input_style.set_corner_radius_all(4)

	theme.set_stylebox("panel", "Panel", panel_style)
	theme.set_stylebox("normal", "LineEdit", input_style)
	theme.set_stylebox("focus", "LineEdit", input_style)
	theme.set_stylebox("normal", "Button", stylebox)

	var default_font: Font
	if ResourceLoader.exists(MONO_FONT):
		default_font = load(MONO_FONT) as Font
	else:
		var font_data: FontFile = FontFile.new()
		font_data.font_data = null
		default_font = font_data

	if default_font:
		theme.set_font("font", "RichTextLabel", default_font)
		theme.set_font("font", "LineEdit", default_font)
		theme.set_font("font", "Button", default_font)

	theme.set_color("default_color", "RichTextLabel", TEXT_COLOR)
	theme.set_color("font_color", "LineEdit", TEXT_COLOR)
	theme.set_color("font_color", "Button", ACCENT_COLOR)

	theme.set_constant("separation", "VBoxContainer", 6)


func _build_ui() -> void:
	var main_vbox: VBoxContainer = VBoxContainer.new()
	main_vbox.anchor_left = 0.0
	main_vbox.anchor_top = 0.0
	main_vbox.anchor_right = 1.0
	main_vbox.anchor_bottom = 1.0
	main_vbox.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main_vbox.size_flags_vertical = Control.SIZE_EXPAND_FILL

	add_child(main_vbox)

	var header: HBoxContainer = HBoxContainer.new()
	header.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main_vbox.add_child(header)

	var title_label: Label = Label.new()
	title_label.text = "OmriCode"
	title_label.add_theme_color_override("font_color", ACCENT_COLOR)
	title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(title_label)

	provider_dropdown = OptionButton.new()
	provider_dropdown.add_item("OpenAI", 0)
	provider_dropdown.add_item("Anthropic", 1)
	provider_dropdown.add_item("Ollama (Local)", 2)
	provider_dropdown.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	header.add_child(provider_dropdown)

	var separator: HSeparator = HSeparator.new()
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

	var input_area: HBoxContainer = HBoxContainer.new()
	input_area.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main_vbox.add_child(input_area)

	input_field = LineEdit.new()
	input_field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	input_field.placeholder_text = "Give me a task..."
	input_field.add_theme_color_override("font_color", TEXT_COLOR)
	input_field.add_theme_color_override("placeholder_color", ACCENT_COLOR)
	input_area.add_child(input_field)

	send_button = Button.new()
	send_button.text = "Send"
	send_button.add_theme_color_override("font_color", ACCENT_COLOR)
	input_area.add_child(send_button)


func _connect_signals() -> void:
	send_button.pressed.connect(_on_send_pressed)
	input_field.text_submitted.connect(_on_text_submitted)
	provider_dropdown.item_selected.connect(_on_provider_selected)


func _on_send_pressed() -> void:
	_send_message()


func _on_text_submitted(_text: String) -> void:
	_send_message()


func _send_message() -> void:
	var text: String = input_field.text.strip_edges()
	if text.is_empty():
		return

	input_field.clear()
	_display_message("user", text)
	message_sent.emit(text)


func _display_message(role: String, content: String) -> void:
	var tag: String = "user"
	if role == "assistant" or role == "agent":
		tag = "assistant"
	elif role == "system":
		tag = "system"
	elif role == "error":
		tag = "error"
	elif role == "thinking":
		tag = "thinking"

	var display_text: String = "[b]" + tag.capitalize() + ":[/b]\n" + content + "\n\n"

	if tag == "error":
		chat_history.push_color(Color("#ff5555"))
		chat_history.append_text(display_text)
		chat_history.pop()
	elif tag == "thinking":
		chat_history.push_color(Color("#888888"))
		chat_history.append_text(display_text)
		chat_history.pop()
	elif tag == "assistant":
		chat_history.push_color(Color("#50fa7b"))
		chat_history.append_text(display_text)
		chat_history.pop()
	else:
		chat_history.append_text(display_text)

	chat_history.scroll_to_line(chat_history.get_line_count() - 1)


func append_message(role: String, content: String) -> void:
	_display_message(role, content)


func clear_chat() -> void:
	chat_history.clear()
	_history_entries.clear()


func _on_provider_selected(index: int) -> void:
	var id_map: Array[String] = ["openai", "anthropic", "ollama"]
	if index >= 0 and index < id_map.size():
		provider_changed.emit(id_map[index])


func set_provider(id: String) -> void:
	var id_map: Dictionary = {
		"openai": 0,
		"anthropic": 1,
		"ollama": 2
	}
	if id_map.has(id):
		provider_dropdown.select(id_map[id])
