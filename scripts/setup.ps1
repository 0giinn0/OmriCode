# OmriCode First-Run Setup (Windows PowerShell)
# ---------------------------------------------------------------
# This script detects available providers, installs dependencies,
# and launches a first-run wizard to configure OmriCode.

param(
    [switch]$SkipProviderCheck,
    [switch]$DevMode
)

$ErrorActionPreference = "Stop"
$OMRI_DIR = "$env:USERPROFILE\.omricode"
$VSCODE_EXT_DIR = "$env:USERPROFILE\.vscode\extensions"

Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor DarkGray
Write-Host "║        ⬢ OMRI CODE — First-Run Setup          ║" -ForegroundColor DarkGray
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor DarkGray
Write-Host ""

# ── Step 1: Check prerequisites ──
Write-Host "◆ Checking prerequisites..." -ForegroundColor Cyan

$hasNode = $null -ne (Get-Command "node" -ErrorAction SilentlyContinue)
$hasVSCode = $null -ne (Get-Command "code" -ErrorAction SilentlyContinue)
$hasOllama = $null -ne (Get-Command "ollama" -ErrorAction SilentlyContinue)
$hasDocker = $null -ne (Get-Command "docker" -ErrorAction SilentlyContinue)
$hasGit = $null -ne (Get-Command "git" -ErrorAction SilentlyContinue)

Write-Host "  Node.js:   $(if($hasNode){'✓'}else{'✕'})" -ForegroundColor $(if($hasNode){'Green'}else{'Red'})
Write-Host "  VS Code:   $(if($hasVSCode){'✓'}else{'✕'})" -ForegroundColor $(if($hasVSCode){'Green'}else{'Red'})
Write-Host "  Ollama:    $(if($hasOllama){'✓'}else{'✕'})" -ForegroundColor $(if($hasOllama){'Green'}else{'DarkGray'})
Write-Host "  Docker:    $(if($hasDocker){'✓'}else{'✕'})" -ForegroundColor $(if($hasDocker){'Green'}else{'DarkGray'})
Write-Host "  Git:       $(if($hasGit){'✓'}else{'✕'})" -ForegroundColor $(if($hasGit){'Green'}else{'Red'})

# ── Step 2: Check local providers ──
if (-not $SkipProviderCheck) {
    Write-Host ""
    Write-Host "◆ Detecting local providers..." -ForegroundColor Cyan

    # Ollama
    if ($hasOllama) {
        try {
            $ollamaResp = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
            if ($ollamaResp.models -and $ollamaResp.models.Count -gt 0) {
                Write-Host "  ✓ Ollama running — $($ollamaResp.models.Count) model(s) available" -ForegroundColor Green
                foreach ($m in $ollamaResp.models) {
                    Write-Host "      • $($m.name)" -ForegroundColor DarkGray
                }
            } else {
                Write-Host "  ○ Ollama running — no models pulled" -ForegroundColor Yellow
                Write-Host "    Run: ollama pull nous-hermes-gguf" -ForegroundColor DarkGray
            }
        } catch {
            Write-Host "  ○ Ollama installed but not running" -ForegroundColor Yellow
            Write-Host "    Start with: ollama serve" -ForegroundColor DarkGray
        }
    }

    # LM Studio (check default port)
    try {
        $lmResp = Invoke-WebRequest -Uri "http://localhost:1234/v1/models" -TimeoutSec 2 -ErrorAction Stop
        Write-Host "  ✓ LM Studio running at localhost:1234" -ForegroundColor Green
    } catch {
        Write-Host "  ○ LM Studio not detected" -ForegroundColor DarkGray
    }
}

# ── Step 3: Install VS Code extension ──
Write-Host ""
Write-Host "◆ Installing VS Code extension..." -ForegroundColor Cyan

$vsixPath = Join-Path $PSScriptRoot "..\editors\vscode\omricode-0.1.0.vsix"
if (Test-Path $vsixPath) {
    if ($hasVSCode) {
        & code --install-extension $vsixPath --force 2>&1 | Out-Null
        Write-Host "  ✓ Installed" -ForegroundColor Green
    } else {
        Write-Host "  ✕ VS Code CLI not found. Install manually:" -ForegroundColor Red
        Write-Host "    code --install-extension $vsixPath" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  ○ Package not built. Run build first:" -ForegroundColor Yellow
    Write-Host "    cd editors/vscode && npm install && npm run package" -ForegroundColor DarkGray
}

# ── Step 4: Create .omricode config dir ──
Write-Host ""
Write-Host "◆ Creating config directory..." -ForegroundColor Cyan
if (-not (Test-Path $OMRI_DIR)) {
    New-Item -ItemType Directory -Path $OMRI_DIR -Force | Out-Null
}
Write-Host "  ✓ $OMRI_DIR" -ForegroundColor Green

# ── Step 5: First-run wizard ──
Write-Host ""
Write-Host "◆ First-Run Wizard" -ForegroundColor Cyan
Write-Host ""
Write-Host "  OmriCode works with any LLM provider. Let's configure yours."
Write-Host ""

$providerChoice = Read-Host "  Choose provider [1] Local (Ollama) [2] OpenAI [3] Anthropic [4] Skip (default: 1)"

switch ($providerChoice) {
    "2" {
        $apiKey = Read-Host "  Enter your OpenAI API key (sk-...)"
        $model = Read-Host "  Model [gpt-4o]"
        if ([string]::IsNullOrWhiteSpace($model)) { $model = "gpt-4o" }
        $config = @{
            id = "openai-setup"
            name = "OpenAI"
            endpoint = "https://api.openai.com/v1"
            model = $model
            apiKey = $apiKey
            isActive = $true
            supportsFC = $true
            maxTokens = 4096
            temperature = 0.7
            order = 0
        }
    }
    "3" {
        $apiKey = Read-Host "  Enter your Anthropic API key (sk-ant-...)"
        $model = Read-Host "  Model [claude-sonnet-4-20250514]"
        if ([string]::IsNullOrWhiteSpace($model)) { $model = "claude-sonnet-4-20250514" }
        $config = @{
            id = "anthropic-setup"
            name = "Anthropic"
            endpoint = "https://api.anthropic.com/v1"
            model = $model
            apiKey = $apiKey
            isActive = $true
            supportsFC = $true
            maxTokens = 4096
            temperature = 0.7
            order = 0
        }
    }
    default {
        $config = @{
            id = "local-setup"
            name = "Local"
            endpoint = "http://localhost:11434/v1"
            model = "nous-hermes-gguf"
            apiKey = ""
            isActive = $true
            supportsFC = "auto"
            maxTokens = 4096
            temperature = 0.7
            order = 0
        }
    }
}

$configPath = "$OMRI_DIR\providers.json"
$config | ConvertTo-Json | Set-Content $configPath
Write-Host "  ✓ Provider saved to $configPath" -ForegroundColor Green

# ── Step 6: Done ──
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor DarkGray
Write-Host "║        ⬢ OMRI CODE — Setup Complete            ║" -ForegroundColor DarkGray
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Open VS Code and press Ctrl+Shift+O to start."
Write-Host "  Need help? Visit https://github.com/0giinn0/OmriCode"
Write-Host ""
