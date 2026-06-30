#!/usr/bin/env bash
# OmriCode First-Run Setup (Linux/macOS)
# ---------------------------------------------------------------
set -e

OMRI_DIR="$HOME/.omricode"
VSCODE_EXT_DIR="$HOME/.vscode/extensions"

echo "╔══════════════════════════════════════════════════╗"
echo "║        ⬢ OMRI CODE — First-Run Setup          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Check prerequisites ──
echo "◆ Checking prerequisites..."

has_node=$(command -v node &>/dev/null && echo "yes" || echo "no")
has_code=$(command -v code &>/dev/null && echo "yes" || echo "no")
has_ollama=$(command -v ollama &>/dev/null && echo "yes" || echo "no")
has_docker=$(command -v docker &>/dev/null && echo "yes" || echo "no")
has_git=$(command -v git &>/dev/null && echo "yes" || echo "no")

echo "  Node.js:   $has_node"
echo "  VS Code:   $has_code"
echo "  Ollama:    $has_ollama"
echo "  Docker:    $has_docker"
echo "  Git:       $has_git"

# ── Step 2: Detect local providers ──
echo ""
echo "◆ Detecting local providers..."

if curl -sf http://localhost:11434/api/tags &>/dev/null; then
    models=$(curl -sf http://localhost:11434/api/tags | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'      • {m[\"name\"]}') for m in d.get('models',[])]" 2>/dev/null || echo "      (models listed above)")
    echo "  ✓ Ollama running"
    echo "$models"
else
    echo "  ○ Ollama not detected"
fi

if curl -sf http://localhost:1234/v1/models &>/dev/null; then
    echo "  ✓ LM Studio running at localhost:1234"
else
    echo "  ○ LM Studio not detected"
fi

# ── Step 3: Install VS Code extension ──
echo ""
echo "◆ Installing VS Code extension..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VSIX_PATH="$SCRIPT_DIR/../editors/vscode/omricode-0.1.0.vsix"

if [ -f "$VSIX_PATH" ]; then
    if [ "$has_code" = "yes" ]; then
        code --install-extension "$VSIX_PATH" --force
        echo "  ✓ Installed"
    else
        echo "  ✕ VS Code CLI not found"
    fi
else
    echo "  ○ Package not built. Run: cd editors/vscode && npm install && npm run package"
fi

# ── Step 4: Create config dir ──
echo ""
echo "◆ Creating config directory..."
mkdir -p "$OMRI_DIR"
echo "  ✓ $OMRI_DIR"

# ── Step 5: Wizard ──
echo ""
echo "◆ First-Run Wizard"
echo ""
echo "  1) Local (Ollama)"
echo "  2) OpenAI"
echo "  3) Anthropic"
echo ""
read -p "  Choose provider [1-3, default 1]: " choice

case "$choice" in
    2)
        read -p "  OpenAI API key (sk-...): " api_key
        read -p "  Model [gpt-4o]: " model
        model=${model:-gpt-4o}
        cat > "$OMRI_DIR/providers.json" << EOF
[{
  "id": "openai-setup",
  "name": "OpenAI",
  "endpoint": "https://api.openai.com/v1",
  "model": "$model",
  "apiKey": "$api_key",
  "isActive": true,
  "supportsFC": true,
  "maxTokens": 4096,
  "temperature": 0.7,
  "order": 0
}]
EOF
        ;;
    3)
        read -p "  Anthropic API key (sk-ant-...): " api_key
        read -p "  Model [claude-sonnet-4-20250514]: " model
        model=${model:-claude-sonnet-4-20250514}
        cat > "$OMRI_DIR/providers.json" << EOF
[{
  "id": "anthropic-setup",
  "name": "Anthropic",
  "endpoint": "https://api.anthropic.com/v1",
  "model": "$model",
  "apiKey": "$api_key",
  "isActive": true,
  "supportsFC": true,
  "maxTokens": 4096,
  "temperature": 0.7,
  "order": 0
}]
EOF
        ;;
    *)
        cat > "$OMRI_DIR/providers.json" << EOF
[{
  "id": "local-setup",
  "name": "Local",
  "endpoint": "http://localhost:11434/v1",
  "model": "nous-hermes-gguf",
  "apiKey": "",
  "isActive": true,
  "supportsFC": "auto",
  "maxTokens": 4096,
  "temperature": 0.7,
  "order": 0
}]
EOF
        ;;
esac

echo "  ✓ Provider saved to $OMRI_DIR/providers.json"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║        ⬢ OMRI CODE — Setup Complete            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Open VS Code and press Ctrl+Shift+O to start."
echo ""
