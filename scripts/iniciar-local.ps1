# Levanta Terra Link en local (Windows). Solo desarrollo.
# Uso: doble clic en INICIAR-LOCAL.cmd (en la raíz del repositorio).
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Paso($t) { Write-Host "`n==> $t" -ForegroundColor Green }
function Falla($t) { Write-Host "`nERROR: $t" -ForegroundColor Red; Read-Host 'Presiona Enter para cerrar'; exit 1 }

Paso 'Verificando requisitos'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Falla 'No se encontró Node.js. Instala Node 22 o superior desde https://nodejs.org' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Falla 'No se encontró Docker. Instala y abre Docker Desktop.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Falla 'Docker no está activo. Abre Docker Desktop, espera a que diga "running" y vuelve a intentar.' }

Paso 'Preparando .env'
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$envTxt = Get-Content .env -Raw
if ($envTxt -match '(?m)^SEED_ADMIN_PASSWORD=\s*$') {
  $envTxt = $envTxt -replace '(?m)^SEED_ADMIN_PASSWORD=\s*$', 'SEED_ADMIN_PASSWORD=Admin-Local-2026!'
  Set-Content .env $envTxt -NoNewline
}
$pass = ([regex]::Match($envTxt, '(?m)^SEED_ADMIN_PASSWORD=(.*)$').Groups[1].Value).Trim()

Paso 'Instalando dependencias (npm install)'
npm.cmd install
if ($LASTEXITCODE -ne 0) { Falla 'npm install falló.' }

Paso 'Levantando PostGIS, Redis y S3 local (Docker)'
npm.cmd run infra:up
if ($LASTEXITCODE -ne 0) { Falla 'docker compose no pudo levantar los servicios.' }

Paso 'Aplicando migraciones'
npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { Falla 'Las migraciones fallaron.' }

Paso 'Creando usuario administrador de desarrollo'
npm.cmd run seed:dev -w apps/api
if ($LASTEXITCODE -ne 0) { Falla 'El seed falló.' }

Paso 'Iniciando API (puerto 4000) y Web (puerto 3000) en ventanas nuevas'
$root = (Get-Location).Path
Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-Command',"Set-Location '$root'; npm.cmd run dev:api"
Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-Command',"Set-Location '$root'; npm.cmd run dev:web; if (`$LASTEXITCODE -ne 0) { npm.cmd run dev:web }"

Paso 'Esperando a que la web responda'
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 2 *> $null; break } catch { Start-Sleep 2 }
}
Start-Process 'http://localhost:3000'

Write-Host "`nListo." -ForegroundColor Green
Write-Host '  Web:     http://localhost:3000'
Write-Host '  Swagger: http://localhost:4000/api/docs'
Write-Host "  Usuario: admin@terralink.local   Contraseña: $pass"
Write-Host '  Para detener: cierra las dos ventanas y ejecuta  npm.cmd run infra:down'
Read-Host "`nPresiona Enter para cerrar esta ventana"
