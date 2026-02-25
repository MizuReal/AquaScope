$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
    git config core.hooksPath .githooks
    Write-Output "Configured git hooks path to .githooks"
    Write-Output "Pre-commit hook will now sync backend -> hugging-face before each commit."
}
finally {
    Pop-Location
}
