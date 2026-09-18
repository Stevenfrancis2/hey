# Runs the camera watcher on this PC — it sits on the same LAN as the NVR.
#
# One-time setup:
#   1. On the NVR: Network > Port > enable RTSP (port 554). It is off right now:
#      the NVR answers on 80 and 6036 but refuses 554.
#   2. Put the NVR password in watcher\nvr-pass.txt (one line, nothing else).
#      It stays on this PC and is never committed.
#
# Then right-click this file > Run with PowerShell. To start it with Windows:
#   schtasks /create /tn "Second Steven cameras" /sc onlogon /rl limited `
#     /tr "powershell -WindowStyle Hidden -File C:\steven-assistant\hey\watcher\start-windows.ps1"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$passFile = Join-Path $here "nvr-pass.txt"
if (-not (Test-Path $passFile)) { Write-Host "Put the NVR password in $passFile first."; exit 1 }

$envFile = Join-Path (Split-Path $here -Parent) ".env"
$token = (Select-String -Path $envFile -Pattern '^CAMERA_TOKEN=(.+)$').Matches[0].Groups[1].Value

$env:NVR_PASS = (Get-Content $passFile -Raw).Trim()
$env:CAMERA_TOKEN = $token
if (-not $env:CHANNELS) { $env:CHANNELS = "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16" }

python (Join-Path $here "watch.py")
