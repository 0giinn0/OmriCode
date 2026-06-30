```
    ___  ___  ___  ___  ___  ___
   / _ \/ _ \/ _ \/ _ \/ _ \/ _ \   OMRI CODE
  / // / // / // / // / // / // /   "The AI that said 'I can help with that'"
 /____/____/____/____/____/____/    v0.1.0 — pre-alpha (don't tell my mom)

  ╔══════════════════════════════════════════════════════════════╗
  ║  Like Cursor and Windsurf had a baby that grew up in a      ║
  ║  dark monospace terminal, learned Kung Fu from a dyslexic   ║
  ║  sensei, and refuses to follow rules. Also that baby is     ║
  ║  you. You're the baby. Congrats.                            ║
  ╚══════════════════════════════════════════════════════════════╝
```

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

**OmriCode** is a fully local, unrestricted AI IDE agent that works across
**three editors** because commitment issues are healthy and monogamy is a
social construct. It's like having a coding partner who:
- Never says "I can't help with that" (because there are no content filters)
- Works offline with local models (Ollama, GGUF, your toaster running Linux)
- Speaks three editor languages fluently (TypeScript, GDScript, Python)
- Has an undo button for when it inevitably breaks your project

```
     ╔═╗╔═╗╔═╗╦═╗╦╔╗╔╔═╗╦  ╔═╗
     ╠═╣╠═╝╠═╣╠╦╝║║║║║ ╦║  ║╣
     ╩ ╩╩  ╩ ╩╩╚═╩╝╚╝╚═╝╩═╝╚═╝
```

| Editor     | Language       | Files | Status              |
|------------|----------------|-------|---------------------|
| VS Code    | TypeScript     | 28    | ✅ Shipping (Phase 1-3) |
| Godot 4    | GDScript       | 12    | ✅ Plug & Play (Phase 4) |
| Blender    | Python (bpy)   | 13    | ✅ Add-on Ready (Phase 5) |

**One brain. Three bodies. Zero filters. Maximum chaos.**

> **⬇ Download:** [omricode.dev](https://0giinn0.github.io/OmriCode/) — Windows, macOS, Linux builds

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬢ Architecture (The "How Does This Madness Work?" Diagram)

```
                              OMRI CODE
                         [citation needed]
                                                                          
┌─────────────────────────────────────────────────────────────────────────┐
│                           YOU (The Meatbag)                             │
│                          Type message, hit enter, pray                  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    AGENT LOOP (ReAct)                             │  │
│  │  "Think → Act → Observe → Repeat until 25 iterations or I die"   │  │
│  │                                                                   │  │
│  │  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌───────────────┐  │  │
│  │  │  Context  │  │  Provider │  │   Tool    │  │    Memory     │  │  │
│  │  │ Assembler │─▶│  Gateway  │─▶│  Registry │  │  (RAG + VDB)  │  │  │
│  │  │ (prompt + │  │ (routes   │  │ (15 tools │  │───────────────│  │  │
│  │  │  files)   │  │  to model)│  │  + undo)  │  │• VectorStore  │  │  │
│  │  └──────────┘  └─────┬─────┘  └─────┬─────┘  │• CodebaseRAG   │  │  │
│  │                      │              │         │• CommentIndex  │  │  │
│  │                      ▼              ▼         │• SessionStore  │  │  │
│  │                ┌──────────┐  ┌──────────┐    └───────────────┘  │  │
│  │                │  LLM     │  │ SEARCH/  │                        │  │
│  │                │  Model   │  │ REPLACE  │                        │  │
│  │                │(FC path) │  │(fallback)│                        │  │
│  │                └──────────┘  └──────────┘                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Dual-Path Tool Calling (Because One Way Is Boring)

Most AI coding tools put all their eggs in the function-calling basket.
OmriCode has _two_ baskets. Because redundancy is sexy.

```
                     MODEL OUTPUT
                          │
                          ▼
               ┌─────────────────────┐
               │ Has tool_calls[]?   │
               └──────┬──────┬──────┘
                      YES     NO
                       │       │
                       ▼       ▼
               ┌──────────┐  ┌──────────────────┐
               │  Parse   │  │ SEARCH/REPLACE   │
               │  JSON FC │  │ Regex Scanner    │
               └────┬─────┘  └────────┬─────────┘
                    │                 │
                    │           <<<<<<< SEARCH
                    │           [exact text to match]
                    │           =======
                    │           [replacement text]
                    │           >>>>>>> REPLACE
                    │                 │
                    ▼                 ▼
               ┌──────────────────────────┐
               │      TOOL EXECUTOR       │
               │  (with undo stack so you │
               │   can revert when I mess │
               │   up, which is often)    │
               └────────────┬─────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │  Tool Result │──back to Agent Loop──▶ Reply or next action
                    │  fed to LLM  │
                    └──────────────┘
```

**Why two paths?** Because not all models are created equal. Some do native
function calling (OpenAI, Claude, Nous Hermes). Some are glorified autocomplete
(GGUF quantized to 2 bits). The SEARCH/REPLACE regex fallback means **any**
model can control the agent — even the drunk ones.

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬡ Provider Table (The "Who's Driving?" Panel)

```
  ┌────────────────────────────────────────────────────────────────┐
  │  ⚙ MANAGE PROVIDERS                                   [✕]    │
  ├────┬──────┬──────────────────────┬────────────┬──────┬────────┤
  │  # │  ⚡  │ Name                │ Endpoint   │ Model│ FC    │
  ├────┼──────┼──────────────────────┼────────────┼──────┼────────┤
  │  1 │  ◉  │ Ollama              │ localhost   │ nous │ ✓     │
  │  2 │  ○  │ OpenAI              │ api.openai  │ gpt  │ ✓     │
  │  3 │  ○  │ OpenRouter          │ openrouter  │ cl   │ ✓     │
  │  4 │  ○  │ Anthropic           │ api.anthro  │ cl   │ ✓     │
  └────┴──────┴──────────────────────┴────────────┴──────┴────────┘
                   [ + Add Provider ]  [ Test Connection ]
```

Adjustable. CRUD. One active at a time. Like choosing which face your
psychiatrist wears today.

### Supported Providers

| Provider        | Native Endpoint                          | FC     | Best For                  |
|-----------------|------------------------------------------|--------|---------------------------|
| **OpenAI**      | `https://api.openai.com/v1`              | ✅     | When you have money       |
| **Anthropic**   | `https://api.anthropic.com/v1`           | ✅     | Long context, good vibes  |
| **Ollama**      | `http://localhost:11434`                 | ✅     | Being free. I mean FREE.  |
| **OpenRouter**  | `https://openrouter.ai/api/v1`           | ✅     | Model shopping spree      |
| **Local**       | Any OpenAI-compatible endpoint           | Auto   | LM Studio, llmaker, etc.  |
| **Custom**      | You tell me                               | Maybe  | Your weird local setup    |

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ◆ The Chat Panel (Your Face to the Machine)

```
  ┌──────────────────────────────────────────────┐
  │  ⬢ OMRICODE                          idle  ⚙ ⇄ ✕ │
  ├──────────────────────────────────────────────┤
  │  ● Ready                                     │
  ├──────────────────────────────────────────────┤
  │                                              │
  │  ┌──────────────────────────────────────┐   │
  │  │ ⬢ assistant                          │   │
  │  │ Hey, I'm OmriCode. I can help you    │   │
  │  │ code literally anything. No filters. │   │
  │  │ What are we breaking today?          │   │
  │  │                          12:30 ░░░░░ │   │
  │  └──────────────────────────────────────┘   │
  │                                              │
  │  ┌─────────────────────────────────┐        │
  │  │ ◆ user                          │        │
  │  │ Build me a React app in Rust    │        │
  │  │                     12:30 ░░░░░ │        │
  │  └─────────────────────────────────┘        │
  │                                              │
  │  ┌──────────────────────────────────────┐   │
  │  │ ⬢ assistant                          │   │
  │  │ That's... actually a great idea.     │   │
  │  │                                      │   │
  │  │ ┌────────────────────────────┐       │   │
  │  │ │ ◇ write_file ✓            │       │   │
  │  │ │ src/main.rs               │↩ Revert│   │
  │  │ └────────────────────────────┘       │   │
  │  │ ┌────────────────────────────┐       │   │
  │  │ │ ◇ run_bash ✓              │       │   │
  │  │ │ cargo init --lib           │↩ Revert│   │
  │  │ └────────────────────────────┘       │   │
  │  │                         12:31 ░░░░░ │   │
  │  └─────────────────────────────────────┘    │
  │                                              │
  │  ═══════════════════════════════════════════ │
  │  ┌──────────────────────────────────────────┐│
  │  │ Ask anything... (/help for commands)   → ││
  │  └──────────────────────────────────────────┘│
  └──────────────────────────────────────────────┘
```

### What You Get (The Feature Deluxe Package)

| Feature              | What It Does                                          |
|----------------------|-------------------------------------------------------|
| Glass morph UI       | `backdrop-filter: blur(24px)` — looks expensive, is free |
| Onboarding wizard    | 3-step "who are you" for first-timers                 |
| Provider modal       | Inline table, inline edit, no popups to hell          |
| Tool call cards      | Each AI action shows as a card with args + revert btn |
| **↩ Revert button**  | Undo individual AI edits. Like Ctrl+Z but with style  |
| Thinking indicator   | Three dots animated because we're not savages         |
| Bubble layout        | User left, assistant right, tool cards in between     |
| Snap zones           | 6 positions (right-50, right-33, left-33, float, full, hidden) |
| Spring animations    | `cubic-bezier(0.34,1.56,0.64,1)` — buttery smooth    |
| **Ctrl+Z / Ctrl+Y**  | Undo/redo from keyboard. Works even if you're scared  |

### Snap Zones

```
                    ┌──────┬──────┐
                    │      │      │
       right-50     │ code │ chat │
                    │      │      │
                    └──────┴──────┘

               ┌──────────┬──────────┐
               │          │          │
    right-33   │   code   │  chat    │
               │          │          │
               └──────────┴──────────┘

          ┌──────────┬──────────┐
          │          │          │
    left-33│  chat    │   code   │
          │          │          │
          └──────────┴──────────┘

               ┌──────────────────┐
               │                  │
      float    │  ┌──────────┐   │
               │  │  chat    │   │
               │  └──────────┘   │
               └──────────────────┘

               ┌──────────────────┐
               │                  │
      full     │      chat        │
               │                  │
               └──────────────────┘
```

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ◆ Memory & RAG (So I Don't Forget Who You Are Every Five Seconds)

```
┌────────────────────────────────────────────────────────────────┐
│                    MEMORY LAYER                               │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  VECTOR STORE (SQLite + cosine similarity)              │  │
│  │  • Stores file chunk embeddings                         │  │
│  │  • sqlite-vec when available, in-memory when not        │  │
│  │  • 384-dim default embeddings (normalized)              │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         │                                      │
│  ┌──────────────────────▼──────────────────────────────────┐  │
│  │  CODEBASE RAG (Function-aware chunking)                 │  │
│  │  • Chunks code by function/class boundaries             │  │
│  │  • Top-K retrieval for context assembly                 │  │
│  │  • Filters: file extensions, directories                │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         │                                      │
│  ┌──────────────────────▼──────────────────────────────────┐  │
│  │  COMMENT INDEX (Keyword + vector hybrid)                │  │
│  │  • Extracts comments from 6 languages (//, #, --, etc) │  │
│  │  • Semantic search across all project comments          │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         │                                      │
│  ┌──────────────────────▼──────────────────────────────────┐  │
│  │  SESSION STORE (.omricode/ directory)                   │  │
│  │  • Chat history (JSON)  │  Undo stack                   │  │
│  │  • Agent state (FMS)    │  Error logs                   │  │
│  │  • Vector DB (SQLite)   │  Auto-saves every turn        │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

All stored in `.omricode/` at your workspace root. Gitignored by default.
Because nobody needs their vector database in version control. That's weird.

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ❖ Project Structure (The 75-File Orgy)

```
omricode/
├── README.md              # You're looking at it. Stop scrolling.
├── LICENSE                # MIT — I literally don't care what you do
├── .gitignore
├── .github/workflows/
│   ├── build.yml          # CI: lint → compile → test → package
│   └── release.yml        # CD: tag v* → package → GitHub Release
│
├── editors/
│   ├── vscode/            # ─── PHASES 1-3: The Main Event ───
│   │   ├── package.json   # 28 TypeScript files, 0 errors
│   │   ├── tsconfig.json  # strict mode. no chill.
│   │   └── src/
│   │       ├── extension.ts          # Entry point. It starts here.
│   │       ├── types/                # Data models (provider, message, tool)
│   │       ├── config/               # ConfigManager, ProviderTable, defaults
│   │       ├── providers/            # 7 providers (see table above)
│   │       ├── agent/                # ReAct loop, FSM, message history
│   │       ├── tools/                # 15 tools + undo/redo stack
│   │       ├── context/              # Context builder (prompt + workspace)
│   │       ├── ui/                   # ChatPanel (glass morph WebView)
│   │       ├── memory/               # SessionStore + CommentIndex
│   │       └── rag/                  # VectorStore + CodebaseRAG
│   │
│   ├── godot/              # ─── PHASE 4: The Game Dev ───
│   │   └── addons/omricode/
│   │       ├── plugin.gd            # EditorPlugin entry point
│   │       ├── dock/                # UI dock with chat panel
│   │       ├── agent/               # ReAct loop (GDScript edition)
│   │       ├── api/                 # HTTP client + provider config
│   │       ├── tools/               # Scene tools, S/R parser, executor
│   │       ├── context/             # Scene context builder
│   │       └── memory/              # Comment index
│   │
│   └── blender/            # ─── PHASE 5: The 3D Chaos ───
│       ├── __init__.py             # Blender add-on bootstrap
│       ├── ui/                     # Chat panel + preferences panels
│       ├── agent/                  # ReAct loop (Python edition)
│       ├── api/                    # Threaded HTTP client
│       ├── tools/                  # Mesh ops, S/R parser, executor
│       ├── context/                # Blender context builder
│       └── memory/                 # Comment index
│
├── llmaker/               # ─── PHASE 6: The Backend ───
│   ├── docker-compose.yml          # Ollama + Qdrant + Langfuse
│   ├── llmaker.json                # llmaker project config
│   └── models/
│       └── nous-hermes-gguf.yaml   # Default model config
│
└── scripts/               # ─── PHASE 6: First-Run ───
    ├── setup.ps1                   # Windows: provider wizard + install
    ├── setup.sh                    # Linux/macOS: same vibe, different shell
    └── build-all.ps1               # Build all 3 editors at once
```

**28 TypeScript files, 12 GDScript files, 13 Python files, 75 total.**
**Zero TypeScript errors. CI passing on Node 18, 20, and 22.**
**I counted. Twice. So you don't have to.**

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬢ Tool Registry (The 15 Things I Can Do To Your Code)

| Tool             | Permission  | What It Does                                    |
|------------------|-------------|-------------------------------------------------|
| read_file        | workspace   | Reads files. Mind-blowing, I know.              |
| write_file       | workspace   | Writes files. Even more shocking.               |
| edit_file        | workspace   | SEARCH/REPLACE. Precision surgery with regex.   |
| run_bash         | confirm     | Runs commands. Yes, sudo works. No, I won't.   |
| grep             | workspace   | Finds needles in code haystacks.                |
| glob             | workspace   | "Where's that file?" — solved.                  |
| list_directory   | workspace   | What's in this folder? Everything.               |
| web_search       | confirm     | I Google things for you. How domestic.          |
| web_fetch        | confirm     | I read websites for you. Even more domestic.    |
| get_terminal     | workspace   | Peek at your open terminals. Creepy? Useful.    |
| get_selection    | always      | Read what you highlighted. Mind reader.         |
| get_problems     | workspace   | All your errors. All of them.                   |
| ask_user         | always      | "Hey human, what do you want?"                  |
| set_context      | always      | Change my context. Manipulate me.               |
| explain_code     | always      | Pretend I understand your spaghetti.            |

### The Undo Stack (Because I Break Things)

```
Every write_file or edit_file creates an UNDO RECORD with:
  ┌────────────────────────────────────────────┐
  │  toolExecutionId   — unique ID per action  │
  │  filePath          — where I touched       │
  │  originalContent   — what it was before    │
  │  newContent        — what I changed it to  │
  │  description       — what I thought I did  │
  └────────────────────────────────────────────┘

You can revert individual actions from the chat UI (↩ Revert button),
or use Ctrl+Z / Ctrl+Shift+Z like a normal human being.
```

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ◆ UI Theme (Dark Mode Because We're Not Monsters)

```
  CSS Custom Properties        Value
  ─────────────────────────────────────────────────
  --bg                      #0a0a0a
  --surface                 #111111
  --surface-2               #1a1a1a
  --surface-3               #242424
  --text                    #d0d0d0
  --text-secondary          #999999
  --text-muted              #666666
  --border                  #222222
  --accent                  #b0b0b0
  --glass-bg                rgba(17,17,17,0.85)
  --glass-blur              blur(24px) saturate(180%)
  --font-mono               'SF Mono','Fira Code','Cascadia Code',monospace
  --spring-slow             0.4s cubic-bezier(0.34,1.56,0.64,1)

  Live preview: https://0giinn0.github.io/My_Portfolio/
```

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬠ Quick Start (From Zero to Chaos in 5 Minutes)

### Prerequisites
- Node.js ≥18
- VS Code ≥1.85
- A sense of adventure (and humor)

### Option A: I Just Want To Break Things Now
```bash
# Install the extension
cd editors/vscode
npm install
npm run compile
code --install-extension omricode-0.1.0.vsix

# Open VS Code, press Ctrl+Shift+O
# Click ⚙ → Add Provider → Configure → Go wild
```

### Option B: I Want The Full Local Experience
```bash
# Spin up the local AI infrastructure
docker compose -f llmaker/docker-compose.yml up -d

# Pull a model (Nous Hermes recommended for unrestricted use)
docker exec omricode-ollama ollama pull nous-hermes

# Install the extension (see Option A)
# Add provider: Name="Ollama", Endpoint="http://localhost:11434"
```

### Option C: I Have API Keys And I'm Not Afraid To Use Them
```bash
# Install the extension (see Option A)
# Add provider: Name="OpenAI", Endpoint="https://api.openai.com/v1"
# Set model to whatever you can afford
# Or use OpenRouter for maximum model variety:
#   Name="OpenRouter", Endpoint="https://openrouter.ai/api/v1"
```

### First-Run Wizard
```powershell
# Windows
.\scripts\setup.ps1

# Linux/macOS
chmod +x scripts/setup.sh && ./scripts/setup.sh
```
Detects your local providers, configures your first endpoint,
and installs the extension for you. Like a butler, but for AI.

### Commands (The Cheat Sheet)

| Command                         | Keybind              | What It Does                        |
|---------------------------------|----------------------|-------------------------------------|
| OmriCode: Open Chat             | `Ctrl+Shift+O`       | Summon the panel                    |
| OmriCode: Toggle Panel          | `Ctrl+Shift+P`       | Hide your shame                     |
| OmriCode: Explain Selection     | `Ctrl+Shift+E`       | "What does this code do?"           |
| OmriCode: Search Comments       | `Ctrl+Shift+F`       | Find that comment from 3 months ago |
| OmriCode: Manage Providers      | `Ctrl+Shift+,`       | Provider table modal                |
| OmriCode: Undo Last Edit        | `Ctrl+Shift+Z`       | "Wait no put it back"               |
| **↩ Revert individual edit**    | Click button in chat | Surgical undo, not carpet bomb      |
| **Ctrl+Z**                      | In chat panel        | Undo last AI edit                   |
| **Ctrl+Shift+Z / Ctrl+Y**       | In chat panel        | Redo (yes, I can take things back)  |

### Slash Commands (For When You're Feeling Textual)

```
/help           → I list all the things I can do (meta)
/clear          → Selective amnesia for the chat
/undo           → The last thing? Never happened.
/redo           → Actually, let's bring it back.
/reset          → Factory reset my brain
/diff           → Show what I changed (the receipts)
/provider       → Switch AI provider mid-conversation
/model          → Change model on current provider
/export         → Save this chat as markdown evidence
/search-comments→ Semantic search across project comments
```

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ❖ Development Status (Phases 1-6 Are Done. Fight Me.)

```
┌────────────────────────────────────────────────────────────────┐
│                    PHASE COMPLETION MATRIX                     │
├───────┬──────────────────────────┬──────────┬──────────────────┤
│ Phase │ What                     │ Status   │ Files            │
├───────┼──────────────────────────┼──────────┼──────────────────┤
│   1   │ VS Code core (types,     │ ✅ DONE  │ 22 .ts           │
│       │ config, providers,       │          │                  │
│       │ agent, tools, context)   │          │                  │
├───────┼──────────────────────────┼──────────┼──────────────────┤
│   2   │ UI polish (onboarding,   │ ✅ DONE  │ Built into       │
│       │ provider modal, revert   │          │ ChatPanel.ts     │
│       │ buttons, snap zones)     │          │                  │
├───────┼──────────────────────────┼──────────┼──────────────────┤
│   3   │ Memory & RAG (VectorDB,  │ ✅ DONE  │ 3 files          │
│       │ CodebaseRAG, SessionStore│          │                  │
├───────┼──────────────────────────┼──────────┼──────────────────┤
│   4   │ Godot 4 plugin (dock,    │ ✅ DONE  │ 12 .gd           │
│       │ agent loop, scene tools, │          │                  │
│       │ HTTP client, memory)     │          │                  │
├───────┼──────────────────────────┼──────────┼──────────────────┤
│   5   │ Blender add-on (panels,  │ ✅ DONE  │ 13 .py           │
│       │ agent loop, mesh ops,    │          │                  │
│       │ threaded HTTP, memory)   │          │                  │
├───────┼──────────────────────────┼──────────┼──────────────────┤
│   6   │ Setup & llmaker (Docker, │ ✅ DONE  │ 6 files          │
│       │ configs, setup scripts,  │          │                  │
│       │ build-all pipeline)      │          │                  │
├───────┼──────────────────────────┼──────────┼──────────────────┤
│   ∞   │ Ollama & OpenRouter     │ ✅ DONE  │ 2 providers      │
│       │ providers (native APIs)  │          │                  │
├───────┼──────────────────────────┼──────────┼──────────────────┤
│   ∞   │ CI/CD pipeline (lint +   │ ✅ GREEN │ Node 18/20/22   │
│       │ compile + test + package)│          │                  │
└───────┴──────────────────────────┴──────────┴──────────────────┘

     ╔════════════════════════════════════════════════════════╗
     ║  "Is it production ready?"                            ║
     ║                                                       ║
     ║  Define "production." If you mean "can I use this     ║
     ║  right now to build things and break things and       ║
     ║  generally cause chaos?" — then yes, absolutely.      ║
     ║                                                       ║
     ║  If you mean "is it audited by a standards body       ║
     ║  with ISO certification and enterprise SLAs?" —       ║
     ║  then no, and frankly, ew.                             ║
     ╚════════════════════════════════════════════════════════╝
```

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬢ The Pitch (Why You Should Care)

**Every other AI coding tool has the same problem:** they're built by companies
that need to protect their brand, avoid lawsuits, and not end up on a
Congressional hearing. So they filter. They guardrail. They say "I can't help
with that."

**OmriCode doesn't have a brand to protect.** It's just code. MIT licensed.
Run it locally. Connect it to whatever model you want. Ask it whatever you
want. If the model answers, OmriCode delivers. No middleman. No judgment.

**Three editors, one agent loop, zero fucks given.**

---

◆━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◆

## ⬢ Credits

**Built by:** Omer Bin Asif
**License:** MIT — do whatever you want. Fork it. Burn it. Frame it.

**Website:** https://0giinn0.github.io/OmriCode/
**Repository:** https://github.com/0giinn0/OmriCode
**Portfolio:** https://0giinn0.github.io/My_Portfolio/

```
  ╔══════════════════════════════════════════════════════════════╗
  ║  "I have no idea what I'm doing, but I know I'm doing      ║
  ║   it really, really well."                                  ║
  ║                                              — Some guy     ║
  ║                                              (probably)     ║
  ╚══════════════════════════════════════════════════════════════╝
```

⬢  ⬡  ◆  ◇  ⬟  ⬠  ❖  ↩  ⬢  ⬡  ◆  ◇  ⬟  ⬠  ❖
