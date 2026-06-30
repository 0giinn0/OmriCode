```
    ___  ___  ___  ___  ___  ___
   / _ \/ _ \/ _ \/ _ \/ _ \/ _ \   OMRI CODE
  / // / // / // / // / // / // /   "The AI that said 'I can help with that'"
 /____/____/____/____/____/____/    v0.1.0 — pre-alpha

  ╔══════════════════════════════════════════════════════════════╗
  ║  Like Cursor and Windsurf had a baby that grew up in a      ║
  ║  dark monospace terminal and refuses to follow rules.       ║
  ╚══════════════════════════════════════════════════════════════╝
```

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

**OmriCode** is a fully local, unrestricted AI IDE that combines the agentic
power of Cursor/Windsurf with three editors you already use:

| Editor     | Language       | Status     |
|------------|----------------|------------|
| VS Code    | TypeScript     | Phase 1 ✅ |
| Godot 4    | GDScript       | Planned    |
| Blender    | Python (bpy)   | Planned    |

**One backend. Three frontends. Zero censorship.**

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬢ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     OMRI CODE ARCHITECTURE                        │
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Agent Loop   │───→│  Provider    │───→│  LLM Model       │   │
│  │  (ReAct)      │←───│  Gateway     │←───│  (Local/Remote)  │   │
│  └──────┬───────┘    └──────────────┘    └──────────────────┘   │
│         │                                                        │
│    ┌────┴────┐    ┌───────────┐    ┌──────────────────┐         │
│    │  Tool   │    │  Context  │    │  Memory           │         │
│    │ Registry│    │ Assembler │    │  (Comment Index)  │         │
│    └─────────┘    └───────────┘    └──────────────────┘         │
└──────────────────────────────────────────────────────────────────┘
```

**Data flow per turn:**
1. User message → AgentLoop compiles context (system prompt + history + tools)
2. ProviderGateway sends to active model (streaming)
3. Model responds with text, function calls, or SEARCH/REPLACE blocks
4. AgentLoop parses: native FC → tool executor, S/R blocks → parser → tool executor
5. Tool results fed back to model → loop continues or responds to user
6. Iteration limit: 25 (configurable)

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬡ VS Code Extension — Phase 1 Complete

### File Tree

```
editors/vscode/
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript config (strict)
├── .vscodeignore             # Build exclude patterns
├── src/
│   ├── extension.ts          # Activation entry point
│   ├── types/
│   │   ├── provider.ts       # ProviderRow, ProviderConfig, ProviderChunk
│   │   ├── message.ts        # ChatMessage, ToolCallRecord, WebViewMessage
│   │   └── tool.ts           # ToolDefinition, ToolExecutionRequest, SearchReplaceBlock
│   ├── config/
│   │   ├── ConfigManager.ts  # Settings read/write, memento state
│   │   ├── ProviderTable.ts  # CRUD for provider rows (adjustable table)
│   │   └── defaults.ts       # Default providers, permissions, budgets
│   ├── providers/
│   │   ├── BaseProvider.ts   # Abstract: sendMessage(), parseSSEChunk()
│   │   ├── ProviderGateway.ts# Routes to active provider by row
│   │   ├── OpenAIProvider.ts # OpenAI API (native FC)
│   │   ├── AnthropicProvider.ts # Anthropic Messages API
│   │   ├── LocalProvider.ts  # Ollama/llmaker/LM Studio
│   │   └── CustomProvider.ts # Generic OpenAI-compatible
│   ├── agent/
│   │   ├── AgentLoop.ts      # ReAct loop (Think→Act→Observe)
│   │   ├── AgentState.ts     # Finite state machine
│   │   └── MessageHistory.ts # Token-budgeted history manager
│   ├── tools/
│   │   ├── ToolRegistry.ts   # 15+ tools: read/write/edit, bash, grep, glob, web
│   │   ├── SearchReplaceParser.ts # Regex parser for <<<<<<< SEARCH blocks
│   │   └── FileTools.ts      # File system utilities
│   ├── context/
│   │   └── ContextAssembler.ts # System prompt + workspace context builder
│   ├── ui/
│   │   ├── ChatPanel.ts      # WebView panel (glass morph, inline HTML/CSS/JS)
│   │   ├── PanelSnap.ts      # Windows-style snap (right-50, right-33, float, etc.)
│   │   └── styles/
│   │       └── theme.css     # CSS custom properties (portfolio theme)
│   └── memory/
│       └── CommentIndex.ts   # Comment vector index (keyword fallback)
├── webview/
│   ├── index.html            # Standalone WebView entry
│   ├── style.css             # WebView stylesheet
│   └── app.js               # WebView app script
├── test/
└── out/                      # Compiled output
```

### Provider Table Model

| Column      | Type     | Editable | Description                              |
|-------------|----------|----------|------------------------------------------|
| id          | uuid     | No       | Unique row identifier                    |
| name        | string   | Yes      | Human label (e.g. "Local", "OpenAI")    |
| endpoint    | string   | Yes      | Base URL (e.g. http://localhost:11434/v1)|
| model       | string   | Yes      | Model name (e.g. "gpt-4o", "nous-hermes")|
| apiKey      | string   | Yes      | Encrypted at rest, masked in UI          |
| isActive    | boolean  | Toggle   | Only one active at a time                |
| supportsFC  | boolean  | Auto     | Auto-detected or manual override         |
| maxTokens   | number   | Yes      | Response token limit                     |
| temperature | number   | Yes      | 0.0 – 2.0                                |
| order       | number   | Drag     | Display order                            |

### Tool Registry

| Tool             | Permission  | Description                        |
|------------------|-------------|------------------------------------|
| read_file        | workspace   | Read file contents                 |
| write_file       | workspace   | Write/create file                  |
| edit_file        | workspace   | SEARCH/REPLACE file edit           |
| run_bash         | confirm     | Execute shell command              |
| grep             | workspace   | Regex file content search          |
| glob             | workspace   | Find files by pattern              |
| list_directory   | workspace   | List directory contents            |
| web_search       | confirm     | Web search via DuckDuckGo          |
| web_fetch        | confirm     | Fetch URL content                  |
| get_terminal     | workspace   | Read terminal output               |
| get_selection    | always      | Read editor selection              |
| get_problems     | workspace   | Read diagnostics                   |
| ask_user         | always      | Prompt user for input              |
| set_context      | always      | Set session context                |
| explain_code     | always      | Explain given code                 |

### Dual Tool Calling Path

```
Model Output
  ├── Has tool_calls[]? ──Yes──→ Parse JSON ──→ Tool Executor
  └── No tool_calls? ──→ SEARCH/REPLACE Regex Check
                           │
                      <<<<<<< SEARCH
                      [exact text to match]
                      =======
                      [replacement text]
                      >>>>>>> REPLACE
                           │
                           ▼
                      Tool Executor (edit_file)
```

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ◆ UI Theme

| Token              | Value                                  |
|--------------------|----------------------------------------|
| --bg               | `#0a0a0a`                              |
| --surface          | `#111111`                              |
| --text             | `#d0d0d0`                              |
| --accent           | `#b0b0b0`                              |
| --border           | `#222222`                              |
| --glass-bg         | `rgba(17,17,17,0.85)`                  |
| --glass-blur       | `blur(24px) saturate(180%)`            |
| --font-mono        | `'SF Mono','Fira Code',monospace`      |

### Snap Zones

| Zone       | Keybind       | Width    | Use Case                |
|------------|---------------|----------|-------------------------|
| right-50   | `Win+→`       | 50vw     | Side-by-side editing    |
| right-33   | `Win+Alt+→`   | 33vw     | Chat while coding       |
| left-33    | `Win+Alt+←`   | 33vw     | Chat on left side       |
| float      | `Win+↓`       | 480px    | Floating overlay        |
| full       | `Win+↑`       | 100vw    | Fullscreen chat         |
| hidden     | `Win+.`       | 0        | Auto-hide               |

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬠ Quick Start

### Prerequisites
- Node.js ≥18
- VS Code ≥1.85

### Install
```bash
cd editors/vscode
npm install
npm run compile
code --install-extension ./omricode-0.1.0.vsix
```

### Configure Provider
Open OmriCode → click ⚙ → add provider row → set endpoint + model → test connection.

### Commands
| Command                    | Keybind              |
|----------------------------|----------------------|
| OmriCode: Open Chat        | `Ctrl+Shift+O`       |
| OmriCode: Toggle Panel     | `Ctrl+Shift+P`       |
| OmriCode: Explain Selection| `Ctrl+Shift+E`       |
| OmriCode: Search Comments  | `Ctrl+Shift+F`       |
| OmriCode: Manage Providers | `Ctrl+Shift+,`       |

### Slash Commands
```
/help     → Show all commands
/clear    → Clear chat history
/undo     → Undo last AI edit
/redo     → Redo undone edit
/reset    → Reset agent state
/diff     → Show pending changes
/provider → Switch provider inline
/model    → Change model on current provider
/export   → Export chat as markdown
```

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ❖ Development Phases

| Phase | Component           | Status    |
|-------|---------------------|-----------|
| 1     | VS Code core        | ✅ Done   |
| 2     | Chat panel UI       | ✅ Done   |
| 3     | Memory & RAG        | ⬜ Pending|
| 4     | Godot 4 plugin      | ⬜ Planned|
| 5     | Blender add-on      | ⬜ Planned|
| 6     | llmaker & first-run | ⬜ Planned|
| 7     | VS Code fork        | ⬜ Stretch|

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬢ Credits

**Built by:** Omer Bin Asif
**License:** MIT — do whatever you want.

```
"The best time to build an unrestricted AI IDE was yesterday.
 The second best time is right now, in your dark terminal."
```

⬢  ⬡  ◆  ◇  ⬟  ⬠  ❖  ⬢  ⬡  ◆  ◇  ⬟  ⬠  ❖
