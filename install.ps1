# Maestro Windows install - in PowerShell:  iex ((New-Object Net.WebClient).DownloadString('https://lhk228.github.io/maestro-download/install.ps1'))
# (DownloadString always returns text - GitHub Pages serves .ps1 as application/octet-stream, which irm may not decode as text)
# Files downloaded by the browser get "Mark of the Web", so the browser and SmartScreen block an unsigned installer.
# Downloading with PowerShell skips both. (Messages are in English so they show correctly in Windows PowerShell 5.)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$url = 'https://github.com/lhk228/maestro-download/releases/latest/download/Maestro-windows-x64.exe'
$exe = Join-Path $env:TEMP 'Maestro-Setup.exe'

Write-Host 'Downloading Maestro...'
Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
Unblock-File -Path $exe

Write-Host 'Starting the installer...'
Start-Process -FilePath $exe
