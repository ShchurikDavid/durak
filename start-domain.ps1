$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$tunnelConfig = Join-Path $env:USERPROFILE '.cloudflared\durak-game.yml'
if (-not (Test-Path -LiteralPath $tunnelConfig)) {
    throw 'Cloudflare setup is not finished: durak-game.yml is missing.'
}
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$cloudflareCommand = (Get-Command cloudflared -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    throw 'Run npm ci in the project folder first.'
}
$serverProcess = $null
$oldPort = $env:PORT
$oldSecure = $env:COOKIE_SECURE
try {
    $portUsed = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($portUsed) {
        throw 'Port 3000 is already in use. Stop the previous game server before starting the domain server.'
    }
    $logDirectory = Join-Path $PSScriptRoot 'artifacts'
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $env:PORT = '3000'
    $env:COOKIE_SECURE = 'true'
    $serverProcess = Start-Process -FilePath $nodeCommand -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'domain-server.log') -RedirectStandardError (Join-Path $logDirectory 'domain-server-error.log')
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($serverProcess.HasExited) { throw 'Game server stopped. Check artifacts/domain-server-error.log.' }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 2
            if ($health.app -eq 'durak' -and $health.status -eq 'ok') { $healthy = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $healthy) { throw 'Game server did not become ready.' }
    Write-Host 'Game: https://game.durakcards.uk'
    Write-Host 'Keep this window open. Ctrl+C stops the tunnel and game server.'
    & $cloudflareCommand tunnel --config $tunnelConfig run
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare Tunnel stopped with an error.' }
} finally {
    if ($serverProcess -and -not $serverProcess.HasExited) { $serverProcess.Kill(); $serverProcess.WaitForExit() }
    $env:PORT = $oldPort
    $env:COOKIE_SECURE = $oldSecure
}
