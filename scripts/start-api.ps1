param([string]$Origin = 'http://localhost:3000')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$config = @{}
Get-Content -LiteralPath '.env' | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { $config[$matches[1]] = $matches[2].Trim('"').Trim("'") }
}
$env:DATABASE_URL = 'postgresql://tutor:' + [uri]::EscapeDataString($config.POSTGRES_PASSWORD) + '@localhost:5432/tutor?schema=public'
$env:JWT_ACCESS_SECRET = $config.JWT_ACCESS_SECRET
$env:JWT_REFRESH_SECRET = $config.JWT_REFRESH_SECRET
$env:PUBLIC_ORIGIN = $Origin
$env:CORS_ORIGINS = $Origin
$env:S3_ENDPOINT = 'http://localhost:9000'
$env:S3_PUBLIC_ENDPOINT = 'http://localhost:9000'
$env:S3_ACCESS_KEY = $config.MINIO_ROOT_USER
$env:S3_SECRET_KEY = $config.MINIO_ROOT_PASSWORD
$env:COOKIE_SECURE = 'false'
$env:TRUST_PROXY = 'false'
$env:S3_BUCKET = 'tutor-private'
$env:S3_REGION = 'us-east-1'
$env:NODE_ENV = 'development'
$env:PORT = '4000'
go -C apps/api-go run ./cmd/server
exit $LASTEXITCODE
