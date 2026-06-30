# ---------------------------------------------------------------
# api/provider_config.gd
# OmriCode Godot Plugin — LLM provider configuration manager
# ---------------------------------------------------------------
extends RefCounted

class ProviderRow:
	var id: String
	var name: String
	var endpoint: String
	var model: String
	var api_key: String
	var is_active: bool
	var supports_fc: bool
	var max_tokens: int
	var temperature: float

	func _init(
		p_id: String = "",
		p_name: String = "",
		p_endpoint: String = "",
		p_model: String = "",
		p_api_key: String = "",
		p_is_active: bool = false,
		p_supports_fc: bool = false,
		p_max_tokens: int = 4096,
		p_temperature: float = 0.7
	) -> void:
		id = p_id
		name = p_name
		endpoint = p_endpoint
		model = p_model
		api_key = p_api_key
		is_active = p_is_active
		supports_fc = p_supports_fc
		max_tokens = p_max_tokens
		temperature = p_temperature

	func to_dict() -> Dictionary:
		return {
			"id": id,
			"name": name,
			"endpoint": endpoint,
			"model": model,
			"api_key": api_key,
			"is_active": is_active,
			"supports_fc": supports_fc,
			"max_tokens": max_tokens,
			"temperature": temperature
		}

	func from_dict(data: Dictionary) -> void:
		id = data.get("id", "")
		name = data.get("name", "")
		endpoint = data.get("endpoint", "")
		model = data.get("model", "")
		api_key = data.get("api_key", "")
		is_active = data.get("is_active", false)
		supports_fc = data.get("supports_fc", false)
		max_tokens = data.get("max_tokens", 4096)
		temperature = data.get("temperature", 0.7)


const CONFIG_PATH := "user://omricode_providers.cfg"

var providers: Array[ProviderRow] = []
var _current_id: String = ""


func _init() -> void:
	_setup_defaults()
	load_config()


func _setup_defaults() -> void:
	if not providers.is_empty():
		return
	providers.append(ProviderRow.new(
		"openai", "OpenAI",
		"https://api.openai.com/v1/chat/completions",
		"gpt-4o", "", true, true, 8192, 0.7
	))
	providers.append(ProviderRow.new(
		"anthropic", "Anthropic",
		"https://api.anthropic.com/v1/messages",
		"claude-sonnet-4-20250514", "", false, true, 8192, 0.7
	))
	providers.append(ProviderRow.new(
		"ollama", "Ollama (Local)",
		"http://localhost:11434/api/chat",
		"llama3", "", false, false, 4096, 0.7
	))
	_current_id = "openai"


func get_current() -> ProviderRow:
	for p in providers:
		if p.id == _current_id:
			return p
	if providers.size() > 0:
		return providers[0]
	return null


func set_current(id: String) -> void:
	_current_id = id


func get_provider(id: String) -> ProviderRow:
	for p in providers:
		if p.id == id:
			return p
	return null


func add_provider(row: ProviderRow) -> void:
	providers.append(row)


func remove_provider(id: String) -> void:
	for i in range(providers.size()):
		if providers[i].id == id:
			providers.remove_at(i)
			return


func save_config() -> void:
	var config: ConfigFile = ConfigFile.new()
	config.set_value("meta", "current_id", _current_id)
	config.set_value("meta", "count", providers.size())
	for i in range(providers.size()):
		var section: String = "provider_%d" % i
		var d: Dictionary = providers[i].to_dict()
		for key in d:
			config.set_value(section, key, d[key])
	var err: int = config.save(CONFIG_PATH)
	if err != OK:
		push_error("OmriCode: failed to save provider config: ", err)


func load_config() -> void:
	var config: ConfigFile = ConfigFile.new()
	var err: int = config.load(CONFIG_PATH)
	if err != OK:
		return
	_current_id = config.get_value("meta", "current_id", "openai")
	var count: int = config.get_value("meta", "count", 0)
	if count == 0:
		return
	providers.clear()
	for i in range(count):
		var section: String = "provider_%d" % i
		var d: Dictionary = {}
		for key in config.get_section_keys(section):
			d[key] = config.get_value(section, key)
		var row: ProviderRow = ProviderRow.new()
		row.from_dict(d)
		providers.append(row)


func get_api_key(id: String) -> String:
	var p: ProviderRow = get_provider(id)
	if p:
		return p.api_key
	return ""


func set_api_key(id: String, key: String) -> void:
	var p: ProviderRow = get_provider(id)
	if p:
		p.api_key = key
		save_config()
