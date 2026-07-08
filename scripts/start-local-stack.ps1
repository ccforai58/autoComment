$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendPidFile = Join-Path $ProjectRoot ".local-backend.pid"
$DockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"

function Test-PortOpen {
  param([int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-DockerReady {
  docker version --format "{{.Server.Version}}" *> $null
  return $LASTEXITCODE -eq 0
}

Set-Location $ProjectRoot

if (-not (Test-DockerReady)) {
  if (Test-Path $DockerDesktop) {
    Start-Process -FilePath $DockerDesktop -WindowStyle Hidden
  }

  $deadline = (Get-Date).AddSeconds(120)
  while (-not (Test-DockerReady)) {
    if ((Get-Date) -gt $deadline) {
      throw "Docker Desktop did not become ready within 120 seconds."
    }
    Start-Sleep -Seconds 3
  }
}

npm run local:db:start
npm run local:db:setup

if (-not (Test-PortOpen -Port 3000)) {
  $process = Start-Process -FilePath "node" `
    -ArgumentList "server.js" `
    -WorkingDirectory $ProjectRoot `
    -PassThru `
    -WindowStyle Hidden

  Set-Content -Path $BackendPidFile -Value $process.Id -Encoding ascii
  Start-Sleep -Seconds 2
}

if (-not (Test-PortOpen -Port 3000)) {
  throw "Local backend did not start on 127.0.0.1:3000."
}

Write-Output "AutoComment local stack is ready."
