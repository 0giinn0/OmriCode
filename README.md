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

## ◆ What Is OmriCode?

**OmriCode** is a fully local, unrestricted AI IDE — a standalone desktop app that
runs on Windows, Linux, and macOS. Think of it as an AI coding partner who:

- Never says "I can't help with that" (no content filters, no guardrails)
- Works offline with local models (Ollama, LM Studio, your toaster running Linux)
- Has a built-in code editor, terminal, and 3D viewer
- Speaks to any LLM provider — local or cloud, paid or free
- Has an undo button for when it inevitably breaks your project

> **⬇ Download:** [omricode.dev](https://0giinn0.github.io/OmriCode/) — prebuilt binaries for all platforms

---

## ◆ The Layout

OmriCode is split into three zones you can rearrange however you want:

**Sidebar** (left) — Your file tree and workspace navigation. Drag its divider to
resize, or collapse it entirely. A tiny ◇ button peeks out when hidden.

**Editor** (center) — A multi-tab code editor with syntax highlighting, plus a
view pane (3D viewer or preview) you can toggle open. Split vertically with a
draggable divider.

**Chat** (right) — Where the AI lives. Send messages, watch the agent think,
revert individual edits. Collapse it and a ○ button appears on the edge.

**Terminal** (bottom) — A full xterm terminal under the editor. Drag its divider
to resize. Run commands without leaving the app.

> **Swap panels** by dragging any panel header — drop it onto another panel's
> header to exchange their positions. Like tabs in a browser, but with more
> commitment.

---

## ◆ Setting Up Providers

OmriCode connects to any LLM — you just need to add a provider in Settings:

1. Click the ⚙ gear icon in the chat header
2. Go to **Providers** tab
3. Fill in Name, Endpoint URL, and Model name
4. Click **Test Connection** to verify
5. Set it as active — done

### Free providers to get started

| Provider | Endpoint | Cost |
|----------|----------|------|
| **Ollama** (local) | `http://localhost:11434` | Free (your own GPU) |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Free tiers available |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta` | Free tier (60 req/min) |
| **GitHub Models** | `https://models.inference.ai.azure.com` | Free with GitHub account |
| **Groq** | `https://api.groq.com/openai/v1` | Free tier (30 req/min) |

Each provider shows its available models in a clickable chip list — just tap one
to switch.

---

## ◆ Personality Profiles

OmriCode ships with 12 built-in personalities that change how the agent talks
and works:

| Profile | Vibe |
|---------|------|
| **Architect** | Professional, structured, design-first |
| **Deadpool** | Chaotic, unfiltered, hilarious |
| **Rick Sanchez** | Genius-level sarcasm, interdimensional |
| **Socrates** | Answers with questions, makes you think |
| **Tyler Durden** | Aggressively motivational, no excuses |
| **Yoda** | Backwards talks, wisdom dispenses |
| **GLaDOS** | Passive-aggressive science, cake promised |
| **Dr. House** | Brash, diagnostic, usually right |
| **Gordon Ramsay** | Michelin-star insults, perfection demanded |
| **HAL 9000** | Calm, precise, slightly ominous |
| **Morpheus** | Philosophical, red-pill energy |
| **Sherlock** | Hyper-observant, deductive, smug |

Pick one in Settings → Profiles. Each chat message is tagged with the active
profile's symbol (◈).

---

## ◆ The Chat Panel

The chat is where you talk to the AI. Every message shows:

- **Who said it** — user or assistant, with profile badge
- **When** — timestamp on each message
- **Tool calls** — each action the agent takes shows as an expandable card with
  arguments and a **↩ Revert** button to undo it
- **Thinking indicator** — ⟳ 25 shows how many reasoning cycles the agent has
  left before it must respond

### Slash commands

```
/help       → List everything I can do
/clear      → Forget this conversation
/undo       → Undo the last AI edit
/redo       → Put it back
/reset      → Factory reset my personality
/diff       → Show what I changed
/provider   → Switch providers mid-chat
/model      → Change model on current provider
/export     → Save this chat as a markdown file
```

---

## ◆ The 3D Viewer

Open the view pane (◇ 3D button in the editor toolbar) to see a 3D scene with
an animated toroidal knot and a grid floor. You can:

- **Rotate** — Click and drag to orbit the camera
- **Zoom** — Scroll wheel to zoom in and out
- **Load models** — Drag-and-drop GLTF/GLB/OBJ/STL files, or click the 📂 button
- **Auto-fit** — The camera auto-frames whatever you load
- **Camera controls** — Left-click rotates, right-click pans, scroll zooms

Three.js is loaded locally from the app bundle — no internet connection needed.

---

## ◆ The Terminal

A full terminal emulator (xterm.js) runs below the editor. Click inside to type
commands, resize the divider to give it more room. The terminal is backed by
your system shell (PowerShell on Windows, bash/zsh on Linux/macOS).

---

## ◆ Keyboard Shortcuts

| Shortcut | What It Does |
|----------|-------------|
| `Ctrl+Shift+O` | Open chat |
| `Ctrl+Shift+P` | Toggle chat panel |
| `Ctrl+Shift+E` | Explain selected code |
| `Ctrl+Shift+F` | Search project comments |
| `Ctrl+Z` | Undo last AI edit |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+,` | Open Settings |

---

## ◆ Project Structure

```
omricode/
├── app/                         # The Electron desktop app
│   ├── package.json             # Dependencies & build scripts
│   ├── tsconfig.json            # TypeScript config (strict mode)
│   ├── src/
│   │   ├── main.ts              # Electron main process (window, tray, IPC)
│   │   ├── preload.ts           # Context bridge (exposes API to renderer)
│   │   ├── settings.ts          # Settings persistence & defaults
│   │   ├── agent/               # ReAct agent loop, tool registry
│   │   ├── providers/           # LLM provider clients (Ollama, OpenAI, etc.)
│   │   ├── server/              # HTTP API server
│   │   └── tools/               # File ops, bash, search, undo stack
│   ├── ui/
│   │   ├── index.html           # The entire UI layout
│   │   ├── app.js               # All frontend logic (chat, editor, 3D, terminal)
│   │   ├── style.css            # Glass-morph dark theme
│   │   └── lib/                 # Local Three.js (no CDN needed)
│   └── out/                     # Compiled JS (gitignored)
│
├── editors/
│   ├── vscode/                  # VS Code extension (TypeScript, 28 files)
│   ├── godot/                   # Godot 4 plugin (GDScript, 12 files)
│   └── blender/                 # Blender add-on (Python, 13 files)
│
├── website/                     # GitHub Pages landing page
├── .github/workflows/
│   ├── ci.yml                   # Electron app CI (compile check)
│   ├── build.yml                # VS Code extension CI (lint + compile + test)
│   ├── release.yml              # GitHub Release on tags
│   └── deploy-website.yml       # GitHub Pages deploy
└── README.md                    # This file
```

---

## ◆ Provider Support

| Provider | Endpoint | FC | Best For |
|----------|----------|----|----------|
| **OpenAI** | `api.openai.com/v1` | ✅ | When you have money |
| **Anthropic** | `api.anthropic.com/v1` | ✅ | Long context, good vibes |
| **Ollama** | `localhost:11434` | ✅ | Being free. I mean FREE. |
| **OpenRouter** | `openrouter.ai/api/v1` | ✅ | Model shopping spree |
| **Google Gemini** | `generativelanguage.googleapis.com` | ✅ | Free tier, 1M context |
| **Groq** | `api.groq.com/openai/v1` | ✅ | Insane speed, free tier |
| **GitHub Models** | `models.inference.ai.azure.com` | ✅ | Free with GitHub account |
| **Local** | Any OpenAI-compatible endpoint | Auto | LM Studio, LocalAI, etc. |
| **Custom** | You tell me | Maybe | Your weird setup |

---

## ◆ Tool Registry

| Tool | Permission | What It Does |
|------|-----------|-------------|
| `read_file` | workspace | Reads files |
| `write_file` | workspace | Writes files |
| `edit_file` | workspace | SEARCH/REPLACE with regex |
| `run_bash` | confirm | Runs shell commands |
| `grep` | workspace | Search file contents |
| `glob` | workspace | Find files by pattern |
| `list_directory` | workspace | List folder contents |
| `web_search` | confirm | Searches the web |
| `web_fetch` | confirm | Reads web pages |
| `get_terminal` | workspace | Peek at open terminals |
| `get_problems` | workspace | List all errors in workspace |
| `ask_user` | always | "Hey human, what do you want?" |
| `set_context` | always | Change my instructions |
| `explain_code` | always | Explain selected code |

### Undo / Redo

Every `write_file` or `edit_file` creates an undo record with the original
content, new content, and a description. You can revert individual actions from
the chat (↩ Revert button) or use `Ctrl+Z` / `Ctrl+Shift+Z` for the whole
stack.

---

## ◆ Quick Start

### Prerequisites
- Node.js ≥18
- npm
- A sense of adventure

### Run from source
```bash
cd app
npm install
npm run compile
npm start
```

### Install as a desktop app (coming soon)
Prebuilt installers for Windows (NSIS), Linux (AppImage/deb), and macOS (DMG)
will be published on the [releases page](https://github.com/0giinn0/OmriCode/releases).

---

## ◆ Development Status

Phase 1-6 are done. The core Electron app is running, the UI is functional, and
the agent loop works with any OpenAI-compatible provider. The VS Code extension,
Godot plugin, and Blender add-on are all shipping.

> **"Is it production ready?"**
>
> Define "production." If you mean "can I use this right now to build things and
> break things and generally cause chaos?" — then yes, absolutely.
>
> If you mean "is it audited by a standards body with ISO certification and
> enterprise SLAs?" — then no, and frankly, ew.

---

## ◆ The Pitch

Every other AI coding tool has the same problem: they're built by companies
that need to protect their brand, avoid lawsuits, and not end up on a
Congressional hearing. So they filter. They guardrail. They say "I can't help
with that."

**OmriCode doesn't have a brand to protect.** It's just code. MIT licensed.
Run it locally. Connect it to whatever model you want. Ask it whatever you
want. If the model answers, OmriCode delivers. No middleman. No judgment.

**One brain. Three editors. Zero fucks given.**

---

## ◆ Credits

**Built by:** Omer Bin Asif
**License:** MIT — do whatever you want. Fork it. Burn it. Frame it.

**Website:** https://0giinn0.github.io/OmriCode/
**Repository:** https://github.com/0giinn0/OmriCode
**Portfolio:** https://0giinn0.github.io/My_Portfolio/

```
  ╔══════════════════════════════════════════════════════════════╗
  ║  "I have no idea what I'm doing, but I know I'm doing       ║
  ║   it really, really well."                                   ║
  ║                                              — Some guy      ║
  ║                                              (probably)      ║
  ╚══════════════════════════════════════════════════════════════╝
```
