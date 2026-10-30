$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCommand) {
    $dockerDirectory = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
    if (Test-Path -LiteralPath (Join-Path $dockerDirectory 'docker.exe')) {
        $env:PATH = "$dockerDirectory;$env:PATH"
        $dockerCommand = Get-Command docker
    } else {
        throw 'Docker не найден. Установите и откройте Docker Desktop.'
    }
}
if (-not (Test-Path -LiteralPath '.env')) {
    throw 'Нет .env. Выполните первоначальную настройку по README.md.'
}
& $dockerCommand.Source info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Откройте Docker Desktop и дождитесь запуска движка.' }
& $dockerCommand.Source compose up -d --build --wait
if ($LASTEXITCODE -ne 0) { throw 'Запуск не завершён. Проверьте docker compose logs --tail 80.' }
$ready = Invoke-WebRequest -Uri 'http://localhost:8080/health/ready' -UseBasicParsing
if ($ready.StatusCode -ne 200) { throw 'Сервер ещё не готов.' }
Write-Host 'TeachEm: http://localhost:8080/login'
Write-Host 'Сервер: Go; интерфейс: Next.js. Данные сохраняются между запусками.'
Write-Host 'Панель пользователей: http://localhost:8080/admin/users'
Write-Host 'Мой профиль: нажмите на блок аккаунта в меню кабинета (доступно и на телефоне).'
Write-Host 'Создать курс: http://localhost:8080/tutor/courses/new'
Write-Host 'Все курсы для суперадмина: http://localhost:8080/admin/courses'
Start-Process 'http://localhost:8080/login' -WindowStyle Hidden
