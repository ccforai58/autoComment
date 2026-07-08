$ErrorActionPreference = "Continue"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendPidFile = Join-Path $ProjectRoot ".local-backend.pid"

Set-Location $ProjectRoot

if (Test-Path $BackendPidFile) {
  $pidText = (Get-Content $BackendPidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $backendPid = 0
  if ([int]::TryParse($pidText, [ref]$backendPid)) {
    Stop-Process -Id $backendPid -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $BackendPidFile -Force -ErrorAction SilentlyContinue
}

npm run local:db:stop

Write-Output "AutoComment local stack stopped."
