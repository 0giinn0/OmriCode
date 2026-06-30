# Build All OmriCode Editors
# ---------------------------------------------------------------
# Builds VS Code extension, Godot plugin, and Blender add-on.

[CmdletBinding()]
param(
    [switch]$SkipNpm,
    [switch]$Package
)

$ErrorActionPreference = "Continue"
$ROOT = Split-Path -Parent $PSScriptRoot

Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor DarkGray
Write-Host "║        ⬢ OMRI CODE — Build All                ║" -ForegroundColor DarkGray
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor DarkGray
Write-Host ""

# ── VS Code Extension ──
Write-Host "◆ Building VS Code extension..." -ForegroundColor Cyan
Push-Location "$ROOT\editors\vscode"
if (-not $SkipNpm) {
    npm install 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "  ✕ npm install failed" -ForegroundColor Red }
}
npm run compile 2>&1
$vsExitCode = $LASTEXITCODE
if ($Package -and $vsExitCode -eq 0) {
    npm run package 2>&1
}
Pop-Location
Write-Host "  $(if($vsExitCode -eq 0){'✓'}else{'✕'}) VS Code: $(if($vsExitCode -eq 0){'compiled'}else{'failed'})" -ForegroundColor $(if($vsExitCode -eq 0){'Green'}else{'Red'})

# ── Godot Plugin ──
Write-Host "◆ Packaging Godot plugin..." -ForegroundColor Cyan
Push-Location "$ROOT\editors\godot"
if (Test-Path "addons\omricode") {
    Compress-Archive -Path "addons\omricode\*" -DestinationPath "omricode-godot.zip" -Force
    Write-Host "  ✓ Godot: packaged" -ForegroundColor Green
} else {
    Write-Host "  ○ Godot: no source found" -ForegroundColor Yellow
}
Pop-Location

# ── Blender Add-on ──
Write-Host "◆ Packaging Blender add-on..." -ForegroundColor Cyan
Push-Location "$ROOT\editors\blender"
if (Test-Path "__init__.py") {
    Compress-Archive -Path "*" -DestinationPath "omricode-blender.zip" -Force
    Write-Host "  ✓ Blender: packaged" -ForegroundColor Green
} else {
    Write-Host "  ○ Blender: no source found" -ForegroundColor Yellow
}
Pop-Location

Write-Host ""
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor DarkGray
Write-Host ""
if ($vsExitCode -eq 0) {
    Write-Host "  All builds complete." -ForegroundColor Green
} else {
    Write-Host "  Some builds failed. Check output above." -ForegroundColor Yellow
}
