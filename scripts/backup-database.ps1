# Export public schema + data from Supabase (requires database password)
# Install: winget install PostgreSQL.PostgreSQL  (includes pg_dump)
# Or use Supabase Dashboard -> Database -> Backups (Pro plan)

$ErrorActionPreference = "Stop"
$filesRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $filesRoot ".env"
$outDir = Join-Path $filesRoot "backups"
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"

if (-not (Test-Path $envFile)) {
    Write-Error "No .env file. Run bootstrap-supabase.ps1 first."
}

$envContent = Get-Content $envFile -Raw
if ($envContent -match "SUPABASE_URL=https://([^.]+)\.supabase\.co") {
    $projectRef = $Matches[1]
} else {
    Write-Error "Could not parse SUPABASE_URL from .env"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir "sentinel_$stamp.sql"

Write-Host "Supabase project ref: $projectRef" -ForegroundColor Cyan
Write-Host ""
Write-Host "Connection string format (Dashboard -> Settings -> Database):" -ForegroundColor Yellow
Write-Host "  postgresql://postgres.[ref]:[YOUR-DB-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres"
Write-Host ""
$dbUrl = Read-Host "Paste full DATABASE_URL (input hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbUrl)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
    Write-Host "pg_dump not found. Alternatives:" -ForegroundColor Yellow
    Write-Host "  - Supabase Dashboard -> SQL -> export tables manually"
    Write-Host "  - Install PostgreSQL tools: winget install PostgreSQL.PostgreSQL"
    exit 1
}

Write-Host "Writing $outFile ..."
& pg_dump $plain --schema=public --no-owner --no-acl -f $outFile
if ($LASTEXITCODE -eq 0) {
    Write-Host "Backup saved." -ForegroundColor Green
    Write-Host "Keep backups/ out of git (already in .gitignore if listed)."
} else {
    Write-Error "pg_dump failed"
}
