# Planche installer for Windows (PowerShell 5.1+).
#
#   irm https://github.com/elisalien/planche/releases/latest/download/install.ps1 | iex
#   .\install.ps1 [-Version v0.1.0] [-InstallDir C:\Apps\Planche] [-NoShortcut]
#
# Downloads the release, installs production dependencies and creates
# Desktop / Start Menu shortcuts. Re-running updates the app and keeps boards (data\).

param(
  [string]$Repo = 'elisalien/planche',
  [string]$Version = 'latest',
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Planche'),
  [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Info ($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

function Get-NodeMajor {
  try { return [int]((& node -v) -replace '^v(\d+).*$', '$1') } catch { return 0 }
}

# ---------------------------------------------------------------- Node.js
if ((Get-NodeMajor) -lt 22) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $answer = Read-Host 'Node.js 22+ est requis. L''installer maintenant avec winget ? [O/n]'
    if ($answer -match '^(n|no|non)$') { throw 'Installation annulée : Node.js 22+ requis (https://nodejs.org).' }
    Info 'Installation de Node.js LTS'
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if ((Get-NodeMajor) -lt 22) { throw 'Node.js installé : ouvrez un nouveau terminal puis relancez ce script.' }
  } else {
    throw 'Node.js 22+ est requis : installez-le depuis https://nodejs.org puis relancez ce script.'
  }
}
Info "Node.js $(& node -v)"

# ---------------------------------------------------------------- download
$tmp = Join-Path $env:TEMP ("planche-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
$zip = Join-Path $tmp 'planche.zip'

try {
  Info "Téléchargement de Planche ($Version) depuis $Repo"
  $downloaded = $false
  # gh handles private repositories with the user's own login.
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $tagArgs = @()
    if ($Version -ne 'latest') { $tagArgs = @($Version) }
    & gh release download @tagArgs --repo $Repo --pattern 'planche.zip' --dir $tmp --clobber 2>$null
    $downloaded = ($LASTEXITCODE -eq 0) -and (Test-Path $zip)
  }
  if (-not $downloaded) {
    if ($Version -eq 'latest') { $url = "https://github.com/$Repo/releases/latest/download/planche.zip" }
    else { $url = "https://github.com/$Repo/releases/download/$Version/planche.zip" }
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  }

  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $src = Join-Path $tmp 'planche'
  if (-not (Test-Path (Join-Path $src 'server\server.mjs'))) { throw 'Archive de release invalide.' }

  # -------------------------------------------------------------- install
  Info "Installation dans $InstallDir"
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  # Replace application files, keep the boards stored in data\.
  Get-ChildItem -Path $InstallDir -Force | Where-Object { $_.Name -ne 'data' } | Remove-Item -Recurse -Force
  Copy-Item -Path (Join-Path $src '*') -Destination $InstallDir -Recurse -Force

  Info 'Installation des dépendances (npm ci)'
  Push-Location $InstallDir
  try {
    & npm.cmd ci --omit=dev --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { throw 'npm ci a échoué.' }
  } finally { Pop-Location }
} finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- shortcuts
if (-not $NoShortcut) {
  $shell = New-Object -ComObject WScript.Shell
  $targets = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Planche.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Planche.lnk')
  )
  foreach ($path in $targets) {
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = Join-Path $InstallDir 'planche.cmd'
    $lnk.WorkingDirectory = $InstallDir
    $lnk.WindowStyle = 7
    $lnk.IconLocation = (Get-Command node).Source + ',0'
    $lnk.Description = 'Planche - tableau blanc collaboratif'
    $lnk.Save()
  }
  Info 'Raccourcis créés (Bureau et menu Démarrer)'
}

$version = Get-Content (Join-Path $InstallDir 'VERSION') -ErrorAction SilentlyContinue
Write-Host ''
Write-Host "Planche $version installé." -ForegroundColor Green
Write-Host "  Lancer : raccourci « Planche » ou $InstallDir\planche.cmd"
Write-Host '  Adresse : http://localhost:8787 (partage réseau local : http://<ip-du-pc>:8787)'
Write-Host '  Mettre à jour : relancer ce script (les tableaux dans data\ sont conservés)'
