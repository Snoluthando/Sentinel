# Sentinel — bootstrap a NEW Supabase project (fresh DB, ~10 minutes)
# Run: pwsh -File scripts/bootstrap-supabase.ps1

$ErrorActionPreference = "Stop"
$filesRoot = Split-Path $PSScriptRoot -Parent
$envExample = Join-Path $filesRoot ".env.example"
$envFile = Join-Path $filesRoot ".env"
$schemaFile = Join-Path $filesRoot "schema.sql"

Write-Host ""
Write-Host "=== Sentinel Supabase bootstrap ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $schemaFile)) {
    Write-Error "schema.sql not found at $schemaFile"
}

Write-Host "1. Create project at https://supabase.com/dashboard" -ForegroundColor Yellow
Write-Host "   - Personal account (not school org)"
Write-Host "   - Name: sentinel-prod"
Write-Host "   - Save DB password in a password manager"
Write-Host ""
Write-Host "2. SQL Editor -> paste and RUN:" -ForegroundColor Yellow
Write-Host "   $schemaFile"
Write-Host ""
Read-Host "Press Enter when schema.sql finished successfully"

Write-Host ""
Write-Host "3. Settings -> API — paste values:" -ForegroundColor Yellow
$supabaseUrl = Read-Host "Project URL"
$anonKey = Read-Host "anon public key"
$serviceKey = Read-Host "service_role key"

if (-not $supabaseUrl -or -not $anonKey -or -not $serviceKey) {
    Write-Error "All three values are required."
}

if (-not (Test-Path $envFile)) {
    Copy-Item $envExample $envFile
    Write-Host "Created .env from .env.example" -ForegroundColor Green
} else {
    $merge = Read-Host ".env exists. Update Supabase keys only? (y/n)"
    if ($merge -ne "y") {
        Write-Host "Skipped .env update."
        exit 0
    }
}

$content = Get-Content $envFile -Raw

function Set-EnvLine([string]$Name, [string]$Value) {
    $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
    if ($script:content -match $pattern) {
        $script:content = $script:content -replace $pattern, "$Name=$Value"
    } else {
        $script:content = $script:content.TrimEnd() + "`r`n$Name=$Value`r`n"
    }
}

Set-EnvLine "SUPABASE_URL" $supabaseUrl
Set-EnvLine "SUPABASE_ANON_KEY" $anonKey
Set-EnvLine "SUPABASE_SERVICE_ROLE_KEY" $serviceKey
Set-EnvLine "NEXT_PUBLIC_SUPABASE_URL" $supabaseUrl
Set-EnvLine "NEXT_PUBLIC_SUPABASE_ANON_KEY" $anonKey

if ($content -notmatch "(?m)^JWT_SECRET=\S+") {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwt = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    Set-EnvLine "JWT_SECRET" $jwt
    Write-Host "Generated JWT_SECRET" -ForegroundColor Green
}

Set-Content -Path $envFile -Value $content.TrimEnd() -NoNewline
Write-Host "Updated .env" -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "  - Deploy API; copy .env secrets to Fly/Render"
Write-Host "  - Flutter: hello_flutter\lib\config\api_config.dart"
Write-Host "  - Monthly: scripts\backup-database.ps1"
Write-Host ""
Write-Host "Test areas:" -ForegroundColor Cyan
Write-Host "  curl `"$supabaseUrl/rest/v1/areas?select=name`" -H `"apikey: $anonKey`""
Write-Host ""
