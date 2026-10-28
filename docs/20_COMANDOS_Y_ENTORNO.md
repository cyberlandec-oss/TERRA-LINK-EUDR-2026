# Comandos y entorno comprobables

Actualizado: 2026-10-12. Repositorio `cyberlandec-oss/TERRA-LINK-2025` (https://github.com/cyberlandec-oss/TERRA-LINK-2025.git), rama de trabajo `feat/tech-001-ci-p0-002`, en `D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025` (trasladado desde `C:\Users\mario\TERRA LINK 2025`, que ya no existe).

> Corrección: la versión anterior de este documento registraba comandos de otro proyecto (`cyberlandec-oss/cacao`, `refactor/...`). Eran ajenos a Terra Link 2025 y se eliminaron.

## Requisitos del equipo

Comprobados en Windows 11: git 2.53, Node 24.12 (mínimo 22.9 por `--env-file-if-exists`) / npm 11.6, Docker Desktop 29.8 (contexto `desktop-linux`, `npipe:////./pipe/dockerDesktopLinuxEngine`).

Nota del equipo: hay un **PostgreSQL nativo de Windows escuchando en `0.0.0.0:5432`**, así que el PostgreSQL de Docker se publica en **5440**. No se tocó el servicio nativo.

## Preparación (una vez)

```bash
cp .env.example .env      # luego cambia las contraseñas locales y define SEED_ADMIN_PASSWORD (≥12)
npm install               # desde la raíz; instala apps/api y apps/web
```

No imprimir ni versionar `.env` (está en `.gitignore`).

## Comandos verificados (raíz del repo salvo indicación)

| Acción | Comando | Precondición / efecto | Resultado 2026-10-09 |
| --- | --- | --- | --- |
| Servicios locales | `npm run infra:up` (`docker compose up -d --wait`) | Levanta `postgres` (PostGIS 16-3.4, host:5440, crea `terra_link` y `terra_link_test`), `redis` (6379) y `object-storage` (VersityGW, 9000). Volúmenes `postgres-data` y `object-data` | 3 servicios healthy. La API usa `object-storage` como almacenamiento privado (P0-009): `S3_ACCESS_KEY`/`S3_SECRET_KEY` obligatorias; buckets `terra-link-private` (desarrollo), `terra-link-test` (integración) y `terra-link-e2e` (E2E), creados por la API si faltan |
| Detener servicios | `npm run infra:down` | No borra volúmenes | — |
| Migrar dev | `npm run db:migrate` | Compila la API y aplica migraciones a `DATABASE_URL` | `0001`–`0007_producer_match_reviews` aplicadas (dev: productores y usuarios conservados) |
| Seed dev | `npm run seed:dev -w apps/api` | Crea el SUPER_ADMIN desde `SEED_ADMIN_*`; idempotente | Creado |
| API: typecheck | `npm run typecheck -w apps/api` | — | 0 errores |
| API: lint | `npm run lint -w apps/api` | — | 0 problemas |
| API: pruebas | `npm test -w apps/api` | Requiere `infra:up`, `TEST_DATABASE_URL` (debe terminar en `_test`; **recrea el esquema `public` de esa base**) y `REDIS_URL` (prefijo de claves único por corrida). Sin ellas, la integración queda *skipped* | 12 suites, **90/90** (16 unitarias + 74 integración PostgreSQL/Redis reales) |
| API: arrancar | `npm run dev:api` (compila + `node dist/main.js`, puerto 4000) | Swagger en `/api/docs`. `/health/ready` devuelve `checks` por dependencia (database, schema, redis) y 503 si alguna falla | live/ready 200; login OK |
| OpenAPI | `npm run openapi -w apps/api` → `apps/api/openapi.json` | Generado desde los controladores y validado con `@apidevtools/swagger-parser` (falla si hay referencias o esquemas inválidos) | OpenAPI 3.0.0, 32 rutas, válido |
| Web: typecheck / lint / test | `npm run typecheck -w apps/web`, `npm run lint -w apps/web`, `npm test -w apps/web` | — | OK; vitest 3/3 |
| Web: build | `npm run build -w apps/web` | — | 5 rutas compiladas |
| Worker del outbox | `npm run worker -w apps/api` | Procesa `event_deliveries`; variables `OUTBOX_POLL_MS`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_LEASE_SECONDS` | Arranca y procesa (ver contenedores) |
| Todo (raíz) | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | API + web | OK |
| Navegadores E2E (una vez) | `npm run install-browsers -w e2e` | Descarga Chromium (~120 MB) | OK |
| E2E en navegador | `npm run build -w apps/api && npm run test:e2e` | Crea o recrea `terra_link_e2e`, migra, siembra un SUPER_ADMIN con contraseña aleatoria, levanta API :4100 y web :3100 (compila la web con esa URL) | **14/14** en Chromium (~38 s + build). Fallo intermitente previo (un `reload` sin respuesta en una corrida de 4,2 min): **causa no determinada**; su evidencia se perdió porque Playwright sobrescribe `test-results`. Ahora `validate` conserva trazas si vuelve a ocurrir |
| Web: arrancar | `npm run dev:web` (dev) o `npm run start -w apps/web` (tras build), puerto 3000 | API en `NEXT_PUBLIC_API_URL` | Páginas 200; CORS solo `WEB_ORIGIN` |

## Contenedores de la aplicación (opcional)

| Acción | Comando | Efecto | Resultado 2026-10-10 |
| --- | --- | --- | --- |
| Construir y arrancar | `docker compose --profile app up -d --build --wait` | Imágenes `terra-link-api:local` (431 MB) y `terra-link-web:local` (412 MB), multietapa sobre `node:24-bookworm-slim`, `npm ci` desde el lockfile, usuario `node`, `HEALTHCHECK`. Orden: `migrate` (una vez, sobre `terra_link`) → `api` (:4000) → `web` (:3000, compilada con `NEXT_PUBLIC_API_URL`). Reutiliza los volúmenes y el PostgreSQL en 5440 | migrate aplicó solo `0003` (datos previos conservados); api y web healthy; ready 200; web 200; login OK; sin secretos en `docker history` |
| Con dos workers | `docker compose --profile app up -d --build --wait --scale worker=2` | Añade el servicio `worker` (sin healthcheck HTTP, `restart: unless-stopped`) | 3 productores creados vía API → 6 entregas `DONE` (2 consumidores), proyección `ACTIVE: 3`, sin duplicados |
| Detener solo la app | `docker compose --profile app rm -sf api web migrate worker` | Conserva infraestructura y volúmenes | — |

Las variables (`JWT_SECRET`, credenciales de PostgreSQL) se leen de `.env` al ejecutar; `.dockerignore` excluye `.env*` y nunca se copian a las imágenes. Puertos configurables con `API_HOST_PORT` y `WEB_HOST_PORT`. No arrancar a la vez que `dev:api`/`dev:web` en los mismos puertos.

## Datos DEMO y revisión por rol (solo desarrollo local)

| Acción | Comando | Efecto | Resultado 2026-10-10 |
| --- | --- | --- | --- |
| Seed DEMO/QA | `npm run seed:demo -w apps/api` | Crea (si faltan) 4 organizaciones «DEMO ·», 17 cuentas (los 12 roles; un ORG_ADMIN por empresa; 1 SUPER_ADMIN de revisión; 1 usuario con roles en dos organizaciones) y 9 productores sintéticos con un caso de posible duplicado. Usa los flujos reales de la API (invitación, aceptación, cifrado, eventos, auditoría). Idempotente; conserva datos existentes; se niega a correr contra bases `*_test`/`*_e2e` | 17/17 logins verificados; segunda ejecución sin cambios |
| Credenciales locales | `CREDENCIALES.csv` (raíz) | UTF-8 con BOM, una fila por usuario + organización + rol. **Ignorado por git.** Contraseñas solo ahí (hash argon2id en la base); se reutilizan entre ejecuciones y nunca se resetean cuentas existentes | 18 filas |
| Aplicación para revisión | `docker compose --profile app up -d --build --wait` | Web :3000 y API :4000 sobre la base de desarrollo `terra_link` | api, web, worker activos |
| Revisión visual por rol | `node e2e/review/revision-por-rol.mjs http://localhost:3000` | Sesión aislada por fila del CSV; rutas, tarea real, denegación, datos ajenos, teclado y móvil; capturas en `docs/qa/capturas/`, resultados en `docs/qa/revision-resultados.json` | 21 entradas, 0 incidencias (informe `docs/qa/REVISION_VISUAL_POR_ROL.md`) |

## Validación local (criterio de esta etapa)

```bash
npm run validate                 # completa
npm run validate -- --skip-e2e   # sin navegador
npm run validate -- --docker     # añade build de imágenes
```

- **Requisitos:** Docker Desktop en marcha, `.env` completo (incluidas `TEST_DATABASE_URL` → `*_test` y las claves `PII_*`), `npm install` hecho y Chromium instalado (`npm run install-browsers -w e2e`).
- **Pasos** (se detiene en el primer fallo): servicios (`docker compose up -d --wait postgres redis object-storage`, sin borrar nada) → typecheck → lint → build → OpenAPI generado **y validado** → unitarias + integración (`terra_link_test`, esquema recreado) → E2E Chromium (`terra_link_e2e`).
- **Salvaguardas:** se niega a ejecutar si `TEST_DATABASE_URL` no termina en `_test` o coincide con la base de desarrollo (código 2). No toca `terra_link`, no borra volúmenes.
- **Resultados:** `validation-results/<fecha>/resumen.md`, `resumen.json` (commit, archivos sin commit, pasos, códigos, tiempos) y un `.log` por paso. Si falla E2E, se copian trazas y reporte de Playwright a esa carpeta. Código de salida: 0 aprobada, 1 fallida, 2 configuración insegura o incompleta.
- **Comprobado el 2026-10-10:** corrida aprobada (6 pasos); configuración insegura → código 2 sin ejecutar nada; Redis inaccesible → integración FALLA y código 1.

- **Limitación conocida (2026-10-19):** `jest --runInBand` serializa las suites de UNA corrida, pero no impide dos corridas simultáneas: ambas recrearían el esquema de `terra_link_test` y vaciarían el bucket `terra-link-test`. Antes de lanzar `validate`, comprobar que no hay otra (`Get-CimInstance Win32_Process | ? CommandLine -match validate-local`). No se añadió un cerrojo.
- **Limpieza del bucket de pruebas:** `setupHarness` lo vacía al empezar cada suite, y solo si el bucket es exactamente `terra-link-test` y `TEST_DATABASE_URL` termina en `_test`; si no, aborta antes de borrar. No toca `terra-link-private` ni `terra-link-e2e`.
- **Registro 2026-10-19:** `2026-10-19T12-34-15` quedó **INTERRUMPIDA** (el sistema detuvo los procesos por memoria; sin `resumen`; no es fallo ni aprobación). Candidato `5845414` (solo `apps/api/test/helpers.ts`): `validate` **APROBADA** en `2026-10-19T23-31-51-458Z` (typecheck, lint, build, OpenAPI, pruebas 1383,8 s, E2E 184,9 s). Cambio de herramientas: sin despliegue de producción. El cierre funcional de P1-008 sigue sobre `fb46321`.
- **Contrato móvil (2026-10-20):** `npm run check --prefix apps/mobile -- --api` → typecheck, núcleo y **recorrido contra la API actual OK**, bundle Android OK; **el comando completo NO se da por aprobado** (repetido el 2026-10-20 contra la API desplegada `4f7e635`: mismo desglose; typecheck, núcleo, recorrido contra la API y bundle OK, `expo-doctor` FALLA; registro `validation-results/2026-10-20T03-50-55-065Z-movil/`; reparto de pasos del ensayo físico en `apps/mobile/README.md`): `expo-doctor` **FALLA** (20/21) por desfase de versiones de parche de seis paquetes Expo SDK 57 (`@expo/metro-runtime`, `expo`, `expo-constants`, `expo-crypto`, `expo-location`, `jest-expo`); no es un fallo del contrato. No se actualizaron para no alterar el código del APK registrado. Registro: `validation-results/2026-10-20T00-01-34-059Z-movil/`.

## Acceso federado de ensayo (Keycloak) y demostración de P1-015 (2026-10-20)

SSO está **deshabilitado por defecto**. Para el ensayo local (proveedor autoalojado; **no** conecta con ningún cliente):

```
# .env: KEYCLOAK_ADMIN_PASSWORD, SSO_ENABLED=true, SSO_OIDC_ISSUER=http://localhost:8180/realms/terra-link-dev,
#       SSO_OIDC_DISCOVERY_URL=http://keycloak:8080/realms/terra-link-dev, SSO_OIDC_CLIENT_ID=terra-link-web,
#       SSO_REDIRECT_URIS=http://localhost:3000/acceso/sso      (ver .env.example)
docker compose --profile sso up -d keycloak        # realm importado de infra/sso/; sin volumen (H2 efímera)
docker compose --profile app up -d api             # recrea la API con las variables SSO_*
node e2e/review/p1015-demostracion.mjs             # 21 comprobaciones: coste, SSO con Keycloak real, límites e idiomas
# al terminar: quitar las variables de .env, `docker compose --profile app up -d api`, `docker compose --profile sso rm -sf keycloak`
```

El guion usa una organización propia «ENSAYO P1-015 (sintético)» y usuarios sintéticos; no toca cuentas DEMO. Cada
ejecución deja una organización de ensayo más (las tarifas y estimaciones son append-only). El servidor E2E fija
`SSO_ENABLED=false` para ser hermético. Respaldo de 0056: `_respaldos/2026-10-20-p1015-migracion-0056/`.

## Demostración de A-01 (captura de campo web, 2026-10-20)

```
node e2e/review/a01-demostracion.mjs --fase base        # alcance, documentos, geometría inválida, recorridos web, recarga
# satélite de ENSAYO: añadir SATELLITE_FIXTURE_ENABLED=true a .env y recrear api y worker (sin reconstruir):
#   APP_COMMIT=<sha> docker compose --profile app up -d --no-build --wait api worker
node e2e/review/a01-demostracion.mjs --fase satelite
# al terminar: quitar la variable de .env, recrear api y worker, comprobar printenv en AMBOS y:
node e2e/review/a01-demostracion.mjs --fase cierre      # la API debe declarar ensayo_mode=false
```

El estado entre fases (correos y contraseñas de ensayo) vive en la carpeta temporal, fuera del repositorio; las capturas, en
`validation-results/a01-demostracion-2026-10-20/`. `SATELLITE_FIXTURE_ENABLED` está en el compose para api y worker con valor por omisión `false`;
cambiar solo el archivo no basta: hay que recrear los contenedores y comprobarlo dentro de ellos. Respaldo de 0057:
`_respaldos/2026-10-20-a01-migracion-0057/` (restauración aislada verificada).

## GitHub Actions (inactivo; registro histórico)

El workflow se movió a `infra/ci/github-actions-ci.yml` y **no se ejecuta**: en esta etapa no es requisito y no hay que resolver facturación. Corridas anteriores, solo como historia (ninguna llegó a ejecutar pasos por la facturación de la cuenta):

| Fecha | Commit | Run | Resultado |
| --- | --- | --- | --- |
| 2026-10-10 03:09 UTC | `f2d395d` (PR #1) | [38019557517](https://github.com/cyberlandec-oss/TERRA-LINK-2025/actions/runs/38019557517) | **SIN VEREDICTO**: GitHub no inició el job (0 pasos). Anotación: «The job was not started because recent account payments have failed or your spending limit needs to be increased.» Se resuelve en *Billing & plans* de `cyberlandec-oss` |
| 2026-10-10 | `63b18c7` (PR #1, P0-003) | [38021874080](https://github.com/cyberlandec-oss/TERRA-LINK-2025/actions/runs/38021874080) | **SIN VEREDICTO**: misma anotación de facturación; 0 pasos |
| 2026-10-10 | `c8362ff` (PR #1, eventos + P0-004) | [38024418581](https://github.com/cyberlandec-oss/TERRA-LINK-2025/actions/runs/38024418581) | **SIN VEREDICTO**: misma anotación de facturación; 0 pasos |

## Pendiente (no ejecutado / no existe aún)

Móvil/Android y despliegue. Ningún comando de producción está definido. **Backup/restauración ya no está aquí**: el
procedimiento está verificado y documentado abajo (QA-16); lo que sigue pendiente de QA-16 es ejecutar un **recorrido
operativo sobre la copia restaurada** y medir RPO/RTO con volumen de piloto.

## Respaldo y restauración verificada (QA-16)

Verificado el 2026-10-13 (37 migraciones) y repetido el **2026-10-15 sobre el estado actual (39 migraciones)**:
`docs/qa/EVIDENCIA_QA16_RESTAURACION_2026-10-15.md`. Los respaldos viven **fuera del repositorio**, en
`D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\_respaldos\<fecha>-<motivo>\`, y **no se sobrescriben entre sí**.

**1. Pausar las escrituras** (la base y los objetos deben corresponder al mismo instante; el worker es el único que
escribe objetos fuera de una petición):

```
docker compose stop api web worker
```

**2. Volcar base y objetos** (desde la carpeta del respaldo nuevo):

```
docker exec terra-link-postgres-1 pg_dump -U terra_link -d terra_link -Fc -f /tmp/terra_link.dump
docker cp terra-link-postgres-1:/tmp/terra_link.dump ./terra_link.dump
docker exec terra-link-postgres-1 rm -f /tmp/terra_link.dump
docker run --rm -v terra-link_object-data:/data -v "<carpeta del respaldo>":/out alpine \
  sh -c "tar czf /out/object-data.tar.gz -C /data ."
```

En Git Bash, anteponer `MSYS_NO_PATHCONV=1` a los `docker exec/cp/run` con rutas `/tmp` o `/data`: si no, las
convierte a rutas de Windows y `pg_dump` falla con «could not open output file».

**3. Claves necesarias para poder descifrar después**: copiar de `.env` solo `POSTGRES_*`, `S3_*`, `JWT_SECRET`,
`PII_KEYS`, `PII_ACTIVE_KEY_ID`, `PII_INDEX_KEY` a `claves.env` dentro del respaldo, y restringir el acceso
(`icacls claves.env /inheritance:r /grant:r "%USERNAME%:(R,W)"`). **Nunca se versiona ni se imprime.** Sin estas
claves la copia es ilegible: un respaldo sin ellas no es un respaldo.

**4. Estado capturado y huellas**: guardar conteos por tabla, migraciones e inventario de objetos
(`estado-actual.txt`) y `sha256sum * > SHA256SUMS.txt`. El cotejo posterior se hace **contra ese archivo**, no contra
la base de desarrollo, que sigue cambiando.

**5. Reanudar la aplicación**: `docker compose --profile app up -d --wait`.

**Restaurar para verificar, en un entorno totalmente aislado** (contenedor y volumen propios; **sin seed y sin
migraciones** sobre la copia):

```
docker run -d --name tl-restore --rm=false -e POSTGRES_USER=restore -e POSTGRES_PASSWORD=<local> \
  -e POSTGRES_DB=restore_check -v tl-restore-data:/var/lib/postgresql/data postgis/postgis:16-3.4
docker cp ./terra_link.dump tl-restore:/tmp/terra_link.dump
docker exec tl-restore psql -U restore -d postgres -c "CREATE DATABASE terra_link_restaurada OWNER restore;"
docker exec tl-restore pg_restore -U restore -d terra_link_restaurada --no-owner --no-privileges /tmp/terra_link.dump
```

Comprobar: migraciones y sus marcas, conteos por tabla contra `estado-actual.txt`, restricciones (FK/CHECK/UNIQUE),
descifrado de identidad con las claves del respaldo (**sin imprimir valores**) y objetos por clave, tamaño y sha256.
Al terminar: `docker rm -f tl-restore && docker volume rm tl-restore-data`.

**Levantar la aplicación contra la copia** (segunda mitad de QA-16): `infra/qa16/docker-compose.ensayo.yml`,
proyecto `tl-ensayo-qa16`, puertos 5450/6390/9010/4010/3010, **sin `migrate` ni `worker`**.

```
# 1) archivo de variables en una carpeta temporal, a partir del claves.env del respaldo (nunca en el repositorio)
# 2) infraestructura aislada
docker compose -p tl-ensayo-qa16 -f infra/qa16/docker-compose.ensayo.yml --env-file <tmp>/ensayo.env   up -d postgres redis object-storage --wait
# 3) objetos: desplegar el tar en el volumen del ensayo con el servicio detenido
# 4) base: pg_restore dentro del postgres del ensayo
# 5) aplicación
docker compose -p tl-ensayo-qa16 -f infra/qa16/docker-compose.ensayo.yml --env-file <tmp>/ensayo.env up -d api web --wait
# 6) al terminar
docker compose -p tl-ensayo-qa16 -f infra/qa16/docker-compose.ensayo.yml --env-file <tmp>/ensayo.env down -v
```

Antes de arrancar, comprobar la configuración resuelta (`... config`) y que **no** aparecen `localhost:5440`,
`/terra_link` ni los volúmenes de desarrollo. Evidencia completa:
`docs/qa/EVIDENCIA_QA16_RESTAURACION_2026-10-15.md`.

**Nunca** restaurar sobre `terra_link` ni sobre los volúmenes de desarrollo.

## Observabilidad: qué se publica y a quién (RNF-10 y RNF-13, 2026-10-17)

S1 §77 pide *structured logs*, *metrics*, *tracing*, *error monitoring* y *health checks*, más `/health`,
`/ready` y `/version`. Lo que hay, y **quién puede verlo**:

| Ruta | Quién | Qué sirve |
| --- | --- | --- |
| `GET /health/live` · `GET /health/ready` | **Público** | Vivo; y estado por dependencia con degradación declarada |
| **`GET /version`** | **Público** | Servicio, versión, **revisión del código desplegado** (inyectada al construir) y migración |
| `GET /operations/alerts` | **Público** | **Solo salud de infraestructura**: tres avisos. Ni recuentos de recursos, ni identificadores, ni organización |
| `GET /api/v1/organizations/:orgId/operations/alerts` | Miembro, **permiso a permiso y por alcance** | Lo anterior **más** documentos sin análisis limpio (`document:read`, **acotado al alcance real del titular**) y entregas DEAD (`events:reprocess`) **de esa organización**. Sin el permiso: `RESTRICTED`, sin valor |
| `GET /metrics` | **Plataforma** (`observability:read`) | Exposición Prometheus: peticiones por método/ruta-patrón/clase, duración observada, consultas por operación, dependencias y cola del outbox |
| `GET /api/v1/observability/traces[/:id]` | **Plataforma** | Trazas recientes y el recorrido completo de una, por su `request_id` |
| `GET /api/v1/observability/build` | **Plataforma** | Commit desplegado, versión y migración del código |

### Por qué la respuesta pública se redujo

Hasta el 2026-10-17 `GET /operations/alerts` publicaba, **sin autenticar**, el recuento de versiones de
documento sin análisis limpio y el de entregas DEAD **de todas las organizaciones a la vez**. No había nombres,
pero un agregado de un recurso protegido **sigue siendo información de ese recurso**, y su evolución es
observable por un tercero. Ahora la respuesta anónima no consulta ninguna tabla de negocio.

### El alcance de los documentos no es el permiso

`document:read` **no** significa «todos los documentos de la organización». El alcance real lo pone el
**titular** del documento, y `DocumentsService.list()` lo aplica fila a fila. Un **técnico de campo** tiene
`document:read` pero solo `producer:read_assigned` y `plot:read_assigned`: ve los documentos de **sus**
productores asignados.

El aviso usa **el mismo predicado**, de modo que el recuento de un técnico es el de su alcance y lo dice
(«… dentro de tu alcance»). **Administrador y auditor conservan el total** porque sus permisos sí son de
organización. Publicar el total a quien solo lee lo asignado sería una vía lateral para contar lo que la lista
le niega.

### Desplegar con la revisión inyectada

```
node scripts/desplegar.mjs              # construye con APP_COMMIT=<git rev-parse> y comprueba /version
```

**Por qué no se escribe a mano.** Una etiqueta en `.env` o en el compose se queda desactualizada en cuanto
alguien reconstruye sin tocarla, y entonces `/version` miente. El script la calcula con `git rev-parse` **al
construir** y la pasa como `ARG APP_COMMIT`; después comprueba que `/version` declara esa misma revisión. Si el
árbol tiene cambios sin confirmar, la marca con `+sucio`: lo desplegado **no es** ese commit exacto. Construir
con `docker compose` a mano deja `commit: null` y `commit_source: NOT_INJECTED`, declarado, nunca inventado.

### Cómo se recorre un caso real

1. Toma el `request_id`: viene en la cabecera `X-Request-Id` de cualquier respuesta, en el cuerpo de los
   errores normalizados y en la columna `request_id` de la bitácora.
2. `GET /api/v1/observability/traces/<request_id>` con una sesión de plataforma: devuelve el tramo raíz —
   método, ruta en patrón, estado y duración— y debajo los tramos de base de datos, nombrados **verbo y
   tabla**.
3. Para medir en agregado, `GET /metrics`.

**Límites, declarados.** Las trazas viven en un **anillo acotado en memoria del proceso** (200): se pierden al
reiniciar y el worker tiene el suyo, que no se consulta por HTTP. **No es un backend de trazas** y **nada se
exporta a ningún servicio externo**. La revisión del código **sí** se inyecta ahora en el artefacto
(`scripts/desplegar.mjs`), y `/version` la publica: una revisión no es un secreto y sin ella `/version` no
identificaría lo que está corriendo.

### Lo que la instrumentación NO registra, por diseño

Contraseñas, tokens y cabeceras de autorización; cuerpos de petición o respuesta; correos, cédulas y nombres;
coordenadas y geometrías; **valores de SQL**; e identificadores de persona o recurso **como etiqueta de
métrica**. Todo lo que se etiqueta o se guarda pasa por `apps/api/src/observability/sanitize.ts`, que usa
**lista blanca** de atributos: lo que no está nombrado ahí no sale. Las rutas se reducen al **patrón**
(`/api/v1/organizations/:orgId/producers`) y el SQL a **verbo y tabla** (`SELECT producers`).

**No hay objetivos p95, SLO ni disponibilidad comprometida**: el histograma publica la **distribución
observada**. Medir **no cierra RNF-05 ni RNF-06**, que siguen esperando los *budgets* de TECH-001.

### Comprobar el despliegue

```
node e2e/review/observabilidad.mjs            # avisos separados, métricas y trazas, sobre el despliegue
```

## Retorno y recuperación (RNF-12)

**Tres cosas distintas**, y confundirlas es el error que el requisito quiere evitar:

| | Qué es | Cómo se hace | Qué NO resuelve |
| --- | --- | --- | --- |
| **1. Retorno de la aplicación** | Volver a una versión anterior del código | Desplegar ese SHA. **Nunca uno vetado**: `docs/qa/RETORNO_CANDIDATOS_VETADOS.txt` | No cambia el esquema ni los datos |
| **2. Compatibilidad con el esquema** | Si esa versión entiende el esquema que hay en la base | Comparar la migración aplicada con la que el código conoce. El aviso **`SCHEMA_CODE_MISMATCH`** lo detecta **en los dos sentidos** | No repara nada: avisa |
| **3. Restauración de datos y objetos** | Traer de vuelta el contenido | `pg_restore` del respaldo + despliegue del `object-data.tar.gz`, con su `claves.env` | No revierte código |

**`down`/`up` NO es recuperación de datos.** Reconstruye el esquema y nada más; en particular, las
**referencias públicas** se regenerarían con **otros valores** y cualquier enlace ya emitido dejaría de
resolver. Para conservarlas hay que **restaurar un respaldo que ya las contenga**.

**Tras un retorno de la aplicación el esquema queda POR DELANTE del código.** Es la situación normal, y está
señalada: el aviso lo marca y dice qué hacer. Volver a una versión más antigua **exige** comprobar antes si
entiende el esquema, o restaurar datos coherentes con esa versión.

### Ensayo del procedimiento

```
node scripts/ensayo-retorno.mjs --respaldo "D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\_respaldos\<carpeta>"
```

Corre en una **base de ensayo propia** que crea y elimina (`tl_ensayo_retorno`): **no toca la base de
desarrollo, sus volúmenes ni ningún recurso del otro proyecto Compose**. Comprueba las tres partes por
separado, que las **referencias públicas vuelven exactas** (huella del conjunto, no solo el recuento), que la
identidad sigue cifrada con la clave activa, que el historial conserva su protección append-only, que el
respaldo trae sus claves, y que **un fallo a mitad del procedimiento deja una situación identificable y
recuperable** al reintentarlo.

### Candidatos vetados como destino de retorno

`docs/qa/RETORNO_CANDIDATOS_VETADOS.txt` lista los commits que **no** deben usarse como destino aunque su
validación esté aprobada, con el motivo. Una validación verde no acredita el contrato: el primer vetado es
`8f54b71`, que aprobó sus pruebas con un defecto de vinculación de sesión.

## Ejecución segura

`infra:down -v` borra datos locales: no usarlo para «arreglar» un arranque. Las migraciones solo corren contra la base de dev o de test locales.

### Interruptor de llamadas satelitales reales (P0-028, 2026-10-15)

`SATELLITE_LIVE_CALLS=enabled` es lo **único** que habilita llamar a un proveedor satelital real. Seleccionar un
proveedor, tener su adaptador implementado o encontrar una credencial guardada **no** lo activan. Sin él, el adaptador
de Whisp termina el trabajo con `LIVE_CALLS_DISABLED` **sin abrir ninguna conexión**, y la API rechaza el encargo con
`409 SATELLITE_REQUESTS_NOT_AUTHORIZED`.

Hoy está **apagado** y debe seguir así hasta que se apruebe **D-09 parte B**. Encenderlo sin esa aprobación enviaría
geometrías de productores a un tercero.

### Interruptor de la fixture satelital (P0-028, 2026-10-14)

`SATELLITE_FIXTURE_ENABLED=true` habilita el proveedor **sintético** de desarrollo y prueba: sin él no hay ningún
adapter registrado y encargar un análisis responde `409 SATELLITE_PROVIDER_NOT_SELECTED` (D-09). La fixture no sale a
la red, no analiza nada y todos sus resultados quedan marcados `is_synthetic`, que ningún requisito acepta. **Nunca
debe estar activo fuera de desarrollo o pruebas.** El corredor de trabajos vive en el proceso worker
(`npm run worker -w apps/api`); si no hay adapters, no se levanta y lo dice en el arranque.

### Credenciales de cuentas DEMO nuevas (2026-10-10)

`npm run seed:demo -w apps/api` crea una cuenta nueva solo si podrá guardar su contraseña: escribe el archivo completo en `CREDENCIALES.csv` o, si está abierto en otro programa, en `CREDENCIALES.pendiente.csv` (ambos ignorados por git). Volver a ejecutar el seed no regenera contraseñas existentes: las lee de esos archivos. Para recuperar la credencial de una cuenta nueva (p. ej. `eudr.cooperativa`, segunda persona del recorrido de mitigación), abrir localmente el archivo más reciente de los dos; nunca se imprime en consola, informes ni capturas. La revisión por rol usa el más reciente.

### Móvil (P0-023, `apps/mobile`, proyecto independiente de los workspaces)

Comandos ejecutados el 2026-10-10 en este equipo (Windows, Node 24): `npm ci`, `npm run typecheck`, `npm test`
(núcleo en Node con `node:sqlite`), `TL_API_SMOKE=1 npm test` (cliente en Node contra la API local), `npx expo export
--platform android --output-dir <tmp>` (bundle Hermes) y `npx expo-doctor` (21/21). No hay Android SDK, JDK ni adb: no se
ejecutó emulador, build nativo ni dispositivo. Ensayos en Android: `apps/mobile/README.md`. **Expo Go** solo sirve para una prueba limitada, sin cifrado y con fixtures sintéticos; **SQLCipher y el ensayo con ubicación/fotos reales requieren el build nativo** (APK `APTO-ensayo-fisico-9996a9b4`, README §B). Expo Go no comprueba SQLCipher.

### Comprobaciones del móvil (2026-10-11)

`npm run check --prefix apps/mobile` (añadir `-- --api` con la app levantada y DEMO sembrado) ejecuta typecheck, pruebas
del núcleo (Node + SQLite real), recorrido opcional contra la API local, bundle Android y expo-doctor. Resultados en
`validation-results/<fecha>-movil/`. **Separado de `npm run validate`**; no cubre emulador, build nativo ni dispositivo.

Nota de entorno (2026-10-11): el servicio `api` de `docker-compose.yml` no recibía `SCANNER_HOST`, por lo que los
documentos subidos a la API en contenedor quedaban «análisis pendiente» (`SCANNER_UNAVAILABLE`). Se añadió
`SCANNER_HOST: scanner` **localmente**; el cambio de ese archivo raíz no está confirmado en git (pendiente de autorización).

### Entorno Android inspeccionado (2026-10-11)

- Herramientas: sin Android SDK, sin JDK, sin `adb`; Chocolatey presente; winget no disponible en la sesión; 23,7 GB de RAM;
  hipervisor presente (Docker/WSL2).
- **Bloqueo**: C: es el único disco y tenía **6,3 GB libres**. Requisitos oficiales (docs.expo.dev, build local Android):
  Microsoft OpenJDK 17 (`choco install -y microsoft-openjdk17`), Android SDK Platform 36, Build-Tools, Platform-Tools,
  Emulator, `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk` y `platform-tools` en PATH; además NDK/CMake que Gradle descarga
  para módulos nativos (SQLCipher). Estimación: ≥ 15 GB libres recomendados. No se liberó espacio sin autorización.
- Pasos cuando haya espacio: ver `apps/mobile/README.md` § B.

### Evidencia del escáner en contenedor

`node e2e/review/escaner-contenedor.mjs disponible|caido|reintento` (el operador detiene y arranca el escáner con
`docker compose stop scanner` / `docker compose start scanner`; los volúmenes se conservan). Resultado acumulado en
`docs/qa/evidencia-escaner-contenedor.json`.

### Android local (2026-10-11)

Entorno en el perfil de usuario: `JAVA_HOME=%LOCALAPPDATA%\Programs\Microsoft\jdk-17.0.20.1+1`,
`ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk` (definidas en las sesiones de trabajo; no persistidas). Comandos ejecutados:
`npx expo prebuild --platform android --no-install`; en `apps/mobile/android`:
`gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64`; emulador
`emulator -avd tl-api30 -no-window -no-snapshot -wipe-data -partition-size 1000`; `adb install -r app-release.apk`;
autoprueba `adb shell am start -a android.intent.action.VIEW -d "terralinkcampo://autoprueba" ec.agtech.terralink.campo`
y `adb logcat -s ReactNativeJS:V` (línea `TL_SELFTEST`). Evidencia: `docs/qa/EVIDENCIA_LIMPIEZA_Y_ANDROID_2026-10-11.md`.

### Recorrido en emulador y prueba negativa (2026-10-11)

- Recorrido: `node e2e/movil/proxy.mjs <log>` (proxy 4001 → 4000; control 4002), `adb reverse tcp:4000 tcp:4001`,
  `node e2e/movil/recorrido-emulador.mjs <paso>...` (preparar, login, descargar, capturar, foto, guardarOffline,
  cierreForzado, cortarTrasCommit, fotoAnalisis, conflicto, cambioCuenta, vencimiento, almacenamientoLleno, revocacion).
- Prueba negativa: `TL_VARIANT=negativa npx expo prebuild --platform android --no-install --clean` y
  `gradlew assembleRelease -PreactNativeArchitectures=x86_64` (identificador `ec.agtech.terralink.campo.pruebanegativa`).
- Orientación: `node e2e/review/orientacion-visual.mjs` (requiere `npm run build -w apps/api`).
- Bloqueo 2026-10-11: 2,73 GB libres en C:; reiniciar Windows y medir antes de compilar (guardia de 4 GB).

### Vista previa web de la app móvil (2026-10-11)

- `npm run web:preview --prefix apps/mobile` → `http://localhost:3001` (Metro en modo web; con `CI=1` no recarga en
  caliente: reiniciar tras cambios). Servidor SIMULADO en el navegador; no contacta la API; datos sintéticos.
- Revisión: `node e2e/review/movil-web-preview.mjs` (Playwright; 390 px y escritorio) → `docs/qa/movil-web/revision.json`.
- La web principal sigue en 3000 y la API en 4000.
- Build Android desde Git Bash: definir `JAVA_HOME` (JDK 17 del perfil) y ejecutar `'.\gradlew.bat'` directamente bajo
  la guardia (no `cmd /c`, que Git Bash reescribe).
- Relleno de almacenamiento en emulador: solo con el paso `almacenamientoLleno` (exige ≥ 12 GB libres en C:, tramos de
  ≤ 1 GB, aborta bajo 10 GB).

### Importación Excel (P0-026) y comprobación del seed (2026-10-11)

- `npx jest --runInBand test/imports.int-spec.ts src/imports` (desde `apps/api`): integración con PostgreSQL real y lector XLSX.
- `npm run build -w apps/api && node e2e/review/importaciones.mjs`: revisión en navegador (admin, MANAGER, técnico denegado, teclado, 390 px) contra la app de desarrollo; crea productores DEMO-IMP-* en BORRADOR. Evidencia en `docs/qa/importacion/`.
- `node e2e/seed/comprobar-seed-demo.mjs`: seed DEMO en base desechable `terra_link_seedcheck` — idempotencia, membresías, contraseñas y **rotación**, incluido el caso del archivo principal **bloqueado** (16 comprobaciones). No toca `terra_link` ni `CREDENCIALES.csv`. **No forma parte de `npm run validate`**: se ejecuta aparte tras tocar el seed.
- Entorno Android en variables de usuario (2026-10-11): `ANDROID_HOME`/`ANDROID_SDK_ROOT` = `C:\Users\mario\AppData\Local\Android\Sdk`, `JAVA_HOME` = JDK 17.0.20.1, `Path` con `platform-tools`, `emulator` y `%JAVA_HOME%\bin`. Abrir una terminal nueva para que apliquen.
- El repositorio vigente está en `D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025` (la ruta `C:\Users\mario\TERRA LINK 2025` ya no existe).

### Importación de productos (P0-026) y traslado a D: (2026-10-12)

- `npx jest --runInBand test/imports.int-spec.ts test/imports-products.int-spec.ts test/imports-authz-fixtures.int-spec.ts src/imports` (desde `apps/api`).
- `npm run build -w apps/api && node e2e/review/importaciones-productos.mjs`: revisión en navegador de la plantilla de productos (archivos sintéticos; crea productos `DEMO-IMP-*` activos en el catálogo DEMO).
- Imagen de la API: la construye el servicio `migrate` (`docker compose --profile app build migrate`); `build api` no la reconstruye. Después: `docker compose --profile app up -d --wait`.
- El proyecto Compose sigue siendo `terra-link` (mismos volúmenes); `docker compose ls` lista ambos archivos de configuración (C: y D:) porque los contenedores se crearon desde C: y se recrearon desde D:.
- Cachés nativas Android (`apps/mobile/android/app/.cxx`, `apps/mobile/android/app/build`, `apps/mobile/android/build`, no versionadas) conservan rutas de C:; la próxima compilación nativa desde D: probablemente necesitará regenerarlas (no se borraron sin autorización).

### Importación de parcelas (P0-026, 2026-10-12)

- `npx jest --runInBand test/imports-plots.int-spec.ts` (desde `apps/api`): integración con PostGIS real y fixtures de autorización.
- `npm run build -w apps/api && node e2e/review/importaciones-parcelas.mjs`: revisión en navegador (archivos sintéticos; crea `DEMO-IMP-PAR-001/002` del productor `DEMO-RV-008`, sin geometría).
- Cachés Android con rutas de C: identificadas y **no** borradas en esta tarea (no hubo que recompilar): `apps/mobile/android/app/.cxx`, `apps/mobile/android/app/build`, `apps/mobile/android/build`. Están ignoradas (`apps/mobile/.gitignore`: `/android`, salida del prebuild) y son regenerables. Autorizado regenerarlas cuando haya que recompilar; conservar `apps/mobile/dist-apk/`, claves de firma, SDK/JDK y cachés globales.

### Superficie declarada e importación de entregas (2026-10-12)

- `npx jest --runInBand test/plot-declared-area.int-spec.ts test/imports-deliveries.int-spec.ts` (desde `apps/api`).
- `npm run build -w apps/api && node e2e/review/importaciones-entregas.mjs`: revisión en navegador (archivos sintéticos; crea borradores DEMO del productor `DEMO-RV-008` y comprueba en la base que no hay efectos físicos).
- Anomalía observada (no reproducida): la primera ejecución de `imports-deliveries.int-spec.ts` duró 690 s; según `test-results/harness-timings.jsonl`, el reinicio del esquema, las migraciones y las pruebas tardaron ~6 s, así que el tiempo se fue antes del arnés (carga/transpilación de jest). La repetición tardó 9,6 s. Causa no determinada.

### Importación de lotes, referencias y rotación DEMO (2026-10-12)

- `npx jest --runInBand test/imports-lots.int-spec.ts test/imports-deliveries.int-spec.ts test/dd.int-spec.ts` (desde `apps/api`).
- `npm run build -w apps/api && node e2e/review/importaciones-lotes.mjs` y `importaciones-entregas.mjs`: revisiones en navegador (archivos sintéticos; usan la recepción DEMO de ENT-2026-00001 y referencias DEMO-REF-*/DEMO-IMP-LOTE-*).
- Rotación de cuentas DEMO: `npm run seed:demo -w apps/api -- --rotar=<cuenta>`, **una cuenta por invocación**. Esa rama **retorna antes** de cualquier alta: no repuebla nada. Si `CREDENCIALES.csv` está abierto en otro programa, la rotación **se completa igualmente** escribiendo en `CREDENCIALES.pendiente.csv`, lo declara como **vigente** y **avisa** de que el bloqueado conserva una credencial que ya no sirve; solo aborta si no puede escribir **ninguno** de los dos. Verifica login nuevo, rechazo de **todas** las contraseñas anteriores conocidas e invalidación de sesiones (`token_version + 1`).

### Recodificar los datos personales y el índice ciego (D-43)

`npm run rekey:pii -w apps/api` es un **ENSAYO** que no escribe; con `-- --aplicar` ejecuta. Todo en **una
transacción**: descifra con la clave del token, vuelve a cifrar con la activa, recalcula `document_number_bidx`
y comprueba, antes de confirmar, que no queda ningún token con otra clave y que el trigger append-only está
activo. Si algo falla, revierte. No imprime valores personales ni hashes de ellos.

**Orden obligatorio** (si no, el sistema atiende con claves e índices incompatibles):

```
docker compose stop api web worker          # 1. detener escrituras
#   2. respaldo verificado del estado ACTUAL (§Respaldo y restauración verificada)
node infra/d43/ensayo-copia-aislada.mjs <respaldo> <claves-nuevas>   # 3. ensayo en copia aislada
#   4. .env: añadir la clave nueva al llavero SIN quitar la anterior, activarla, clave de índice nueva
npm run rekey:pii -w apps/api -- --aplicar  # 5. recodificar
docker compose --profile app up -d --wait api web worker            # 6. arrancar
#   7. comprobar lectura, búsqueda e historial; solo entonces retirar la clave anterior del llavero
```

**Nunca se retira una clave del llavero mientras exista un token con su identificador**, aquí o en un respaldo
restaurable. La clave anterior se conserva en el `claves.env` de cada respaldo, con ACL restringida y un
`LEEME-CLAVES.md` que dice cuál hace falta **por su identificador**, nunca por su valor.

### Consultar la API con una cuenta DEMO: `consulta-api.mjs`

**No se lee `CREDENCIALES.csv` para copiar una contraseña a un `curl`.** Ese procedimiento manual provocó dos
exposiciones de contraseñas en consola (2026-10-14 y 2026-10-16). Para consultar la API se usa:

```
node e2e/review/consulta-api.mjs --listar-consultas
node e2e/review/consulta-api.mjs <cuenta> <consulta> ["Organización"] [--base http://localhost:4000]
```

Lee la credencial del archivo vigente —el **más reciente** de `CREDENCIALES.csv` y `CREDENCIALES.pendiente.csv`—,
autentica y consulta. **Ni la contraseña ni el token salen por consola.** La salida se limita a cuenta,
organización, rol y el resultado proyectado de una consulta de la lista cerrada, con un saneado que quita claves
sensibles a cualquier profundidad. Añadir una consulta es añadir una entrada a `CONSULTAS` con su proyección
explícita, nunca volcar la respuesta entera.

**Rotación del SUPER_ADMIN de desarrollo**: `npm run seed:dev -w apps/api -- --rotar-admin`. Rota la cuenta de
`SEED_ADMIN_EMAIL`, sustituye **solo** la línea `SEED_ADMIN_PASSWORD` de `.env`, invalida las sesiones y verifica
contra la API si responde. **No crea cuentas** —si no existe, falla— y no toca las DEMO, que se rotan con
`seed:demo -- --rotar=<cuenta>`.

**Reconciliar `CREDENCIALES.csv` y `CREDENCIALES.pendiente.csv`**: manda el **más reciente**, y las herramientas
ya lo resuelven solas. Cuando el principal deje de estar bloqueado, el pendiente lo **sustituye** (es el archivo
completo, no un parche); el procedimiento paso a paso, con su vuelta atrás, está en
`docs/qa/ROTACION_CREDENCIALES_DEMO_2026-10-16.md` §3. No se fusionan filas sueltas ni se abre el archivo «para
comparar».

**Secretos: qué no se imprime nunca.** Ni la columna `contrasena` de `CREDENCIALES.csv` —ni filtrada, ni «para
comprobar que existe»: para eso está `estado_acceso`— ni **el contenido de `.env`**, entero o filtrado. Para saber
si una variable está puesta se mira su **efecto** (por ejemplo `live_calls_enabled` en la respuesta de la API) o su
**nombre** en el contenedor, nunca su valor.
- El episodio de 690 s de la primera ejecución de `imports-deliveries.int-spec.ts` sigue con **causa no determinada**; no se cambiaron timeouts.

### Web por rol y Lot Hub (P0-027, 2026-10-12)

- `npx jest --runInBand test/my-work.int-spec.ts` (desde `apps/api`).
- `node e2e/review/limites.mjs`: recorrido de P1-015 sobre el despliegue — cada límite con su procedencia y
  su efecto, comprobado **superando uno de verdad**; consumo medido que no se presenta como coste; español
  declarado sin claves de traducción; acceso local sin insinuar SSO; solo lectura; aislamiento; **y las tres
  regresiones de P1-013** (PDF ajeno no interpretable, redacción de OCR corregida, multipágina y
  codificaciones). **Cambia datos DEMO**: sube documentos de ensayo identificados en su título.
- `node e2e/review/extraccion.mjs`: recorrido de P1-013 sobre el despliegue — extracción correcta de un PDF
  con capa de texto, información ausente, resultado ambiguo con sus candidatos, documento sustituido,
  formato no soportado sin salir a ningún OCR, acceso denegado por permiso de extracción y por contenido
  personal, recorrido sugerir → revisar → confirmar/descartar, teclado y 390 px. **Cambia datos DEMO**:
  crea **documentos de ensayo** identificados en su título y extrae sobre ellos (tablas append-only).
- `node e2e/review/indicadores.mjs`: recorrido de P1-014 sobre el despliegue — que los cálculos **responden**
  (no una pantalla que siempre diga «sin datos»), exclusiones contadas con su razón, ausencia que no es cero,
  cada indicador autodescrito, las tres ausencias distinguidas (sin datos / no calculable / restringido),
  riesgo aparte, lo no implementado con su condición, permisos sobre agregados y descargas, teclado y 390 px.
  **Cambia datos DEMO**: crea **entregas de ensayo** identificadas en su nota, con precios en dos monedas y
  dos unidades para poder discriminar.
- `node e2e/review/economia.mjs`: recorrido de P1-012 sobre el despliegue — nada precargado, ausencia que no es
  cero, prima que no se deduce sin fundamento, sin conversiones de unidad ni moneda, precio que no es pago,
  corrección con motivo e historial, concurrencia, privacidad frente a la entrega y al expediente DD,
  permisos, teclado y 390 px. **Cambia datos DEMO**: crea **entregas de ensayo** identificadas en su nota y
  registra sobre ellas precio, prima y pagos (tablas append-only propias del módulo).
- `node e2e/review/historico.mjs`: recorrido de P1-011 sobre el despliegue — la línea temporal reutiliza el
  registro de cambios ya existente sin duplicarlo, las tres fechas separadas con la ausente declarada, los
  años sin registros rotulados, comparar con sus limitaciones delante, alertas con problema, impacto, causa
  y acción —y de solo lectura—, alcance por parcela, teclado y 390 px. **No cambia ningún dato**: todo el
  histórico es derivado y de lectura.
- `node e2e/review/presupuesto.mjs`: recorrido de P1-010 sobre el despliegue — nada precargado, ausencia que
  no es cero, decimal exacto, denominadores con su origen y fecha, reproducibilidad al cambiar una tarifa,
  permisos, teclado y 390 px. **Cambia datos DEMO**: registra parámetros y guarda una estimación (registros
  append-only propios del módulo; no toca expedientes, inventario ni riesgo).
- `node e2e/review/simulacion.mjs`: recorrido de P1-009 sobre el despliegue — veredicto y causas, el
  porcentaje con su advertencia, entradas y fecha, el escenario hipotético y lo que seguiría bloqueado,
  permisos, teclado y 390 px. **No cambia ningún dato**: la simulación es de lectura.
- `node e2e/review/intercambio.mjs`: recorrido de P1-006 sobre el despliegue — formato no oficial, canal
  cerrado, verificación de plataforma, exportar, conciliar, decidir una diferencia, permisos, teclado y
  390 px. **Repetible**: retira el acuerdo al terminar, dejando el canal cerrado como estaba.
- `node e2e/review/puesta-en-marcha.mjs`: recorrido de P1-004 sobre el despliegue — nivel con su fundamento,
  evidencia por señal, las tres clases de bloqueo, enlaces del asistente, teclado, 390 px y el recorrido
  completo (identificar lo pendiente → completarlo → ver el resultado). **Repetible**: crea un registro en
  DEMO y lo desactiva al terminar, dejando el estado operativo como estaba.
- `node e2e/review/mi-trabajo.mjs`: recorrido de P1-003 sobre el despliegue — dos colas, filtros reales,
  fila completa, vuelta conservando filtros, estados vacíos, teclado, 390 px y la acción que resuelve el
  dominio. **Cambia datos DEMO en un punto**: captura una ubicación simulada para demostrar que la fila sale.
- `node e2e/review/web-por-rol.mjs`: matriz de todas las combinaciones cuenta–organización–rol de `CREDENCIALES.csv` (menú, contexto, Mi trabajo, Lot Hub, denegaciones), filtros, teclado, 390 px, zoom 200 % y una acción real de Mi trabajo. Evidencia en `docs/qa/web-por-rol/`.
- `node e2e/review/estados-web.mjs`: carga, error con reintento, vacío y sin permiso (intercepta la red solo en el navegador de prueba).
- `node e2e/review/revision-por-rol.mjs` (heredada): sus comprobaciones de parcelas y productos ya no exigen conteos fijos del seed (la DEMO incluye registros importados y capturas del emulador).

### Embarques (P0-029, 2026-10-12)

- `npx jest --runInBand test/shipments.int-spec.ts` (desde `apps/api`): autorización, reservas concurrentes e idempotentes, preflight real bloqueado y mecánica de despacho con preflight sintético.
- `node e2e/review/embarques-web.mjs`: flujo en navegador con datos DEMO (comprador, embarque, reserva, preflight bloqueado, cancelación), roles sin permiso, auditor y 390 px. Cancela al empezar los embarques de revisión que quedaran en preparación. Evidencia en `docs/qa/embarques/`.

## Cartografía local y prueba manual de A-01 (2026-10-20)

```
node infra/maps/preparar-mapa.mjs [--fecha AAMMDD]     # descarga (MD5 verificado), genera teselas (Planetiler 0.10.2) y escribe metadata.json en el volumen terra-link_map-data
docker compose --profile app up -d maps                 # servicio local de mapas (puerto MAPS_HOST_PORT, 8090 por omisión)
node e2e/review/a01-preparar-prueba-manual.mjs          # organización de ensayo para probar a mano; escribe CREDENCIALES_A01.csv (ignorado por git)
```

`NEXT_PUBLIC_MAPS_URL` se incrusta al compilar la web (compose: `http://localhost:${MAPS_HOST_PORT:-8090}`). El worker de MapLibre se copia a `apps/web/public/maplibre/` en
`prebuild`/`predev` (ignorado por git; la imagen lo copia al runtime). El volumen del mapa es **derivado y regenerable**: no entra en el respaldo de la base (cada respaldo guarda su
`metadata-mapa.json`). Respaldo vigente: `_respaldos/2026-10-20-a01-mapa-fotos-0057/`. Guía de prueba personal: `docs/qa/GUIA_PRUEBA_A01_WEB.md`. Volúmenes Docker: 27 (los 26 anteriores intactos + `map-data`).

## Demostración de A-02 (concesiones web, 2026-10-21)
```
node e2e/review/a02-demostracion.mjs     # propietario admin.cooperativa → destinatario comprador.importador (DEMO, sintético); capturas en validation-results/a02-demostracion-2026-10-21/
```
Revoca antes las concesiones ACTIVAS de ensayo de ese destinatario. Respaldo vigente: `_respaldos/2026-10-21-a02-concesiones-0057/` (cubre también la organización de prueba manual de A-01 y los registros `CAD-*`).

## Demostraciones de I1–I4 y de la corrección del Gerente (2026-10-21)
```
node e2e/review/i14-demostracion.mjs                # panel «Evaluación geográfica técnica actual»: SOLO LECTURA sobre el DEMO
node e2e/review/gerente-vinculo-demostracion.mjs    # el Gerente recibe 403 al vincular; la administración conserva la operación; no modifica vínculos
```
Ambas dejan capturas y `resultado.json` en `validation-results/`. No hay respaldo nuevo: sin migración ni estado persistente.

## Demostración y respaldo de A-03 (traspaso de custodia, 2026-10-21)
```
node scripts/desplegar.mjs                    # construir el árbol LIMPIO (no redirigir registros dentro del repositorio: marcaría +sucio)
node e2e/review/a03-demostracion.mjs          # emisora Río Verde → receptora Exportadora Pacífico (DEMO, sintético); capturas en validation-results/a03-demostracion-2026-10-21/
cd apps/api && npx jest --runInBand test/custody-transfers.int-spec.ts   # recorrido aislado completo (compuerta sustituida SOLO con jest.spyOn)
cd e2e && npx playwright test tests/traspasos.spec.ts                    # E2E aislado (terra_link_e2e); el tránsito se prepara con un FIXTURE SQL rotulado
```
La demostración desplegada llega hasta la **salida bloqueada** y la cancelación; no hay forma operativa de pasar a `IN_TRANSIT`. Deja traspasos de ensayo `CANCELLED` (los tres de la entrega) y un vínculo activo entre ambas organizaciones DEMO.
Respaldo vigente: `_respaldos/2026-10-21-a03-traspaso-0058/` (58 migraciones, 142 tablas; incluye los datos de la demostración). Volúmenes Docker: 27, sin cambio.
Para una validación larga, mantener el equipo despierto: una corrida de `validate` de `d99f40a` falló con timeouts de preparación y duraciones de miles de segundos; la causa no está identificada (`docs/qa/EVIDENCIA_A03_TRASPASO_2026-10-21.md` §1).

Guarda de `RISK_CATALOG_APPROVED` y `0.2.0` (migraciones 0059–0060): respaldo `_respaldos/2026-10-21-guarda-catalogo-0059-0060/` (restauración aislada verificada); demostración `node e2e/review/guarda-catalogo-demostracion.mjs` (9/9, no aprueba perfiles).

Vinculación del catálogo con un perfil (migración 0061): respaldo `_respaldos/2026-10-21-vinculo-catalogo-0061/` (restauración aislada verificada); demostración `node e2e/review/vinculo-catalogo-demostracion.mjs` (12/12).

Acto de revisión del perfil (migración 0062): respaldo `_respaldos/2026-10-22-revision-perfil-0062/` (restauración aislada verificada); demostración `node e2e/review/revision-perfil-demostracion.mjs` (10/10, sin registrar revisiones).

Configuración de geolocalización (migración 0063): respaldo `_respaldos/2026-10-22-geo-config-0063/` (restauración aislada verificada); demostración `node e2e/review/geo-config-demostracion.mjs` (14/14). Arnés: las conexiones de la base `*_test` usan `synchronous_commit = off` (junto a `client_min_messages=warning`); la URL manda sobre las opciones del Pool.

## Demostración y respaldo de D-07.6 (2026-10-22)

- `node e2e/review/conclusion-humana-demostracion.mjs` (no registra conclusiones sobre datos operativos; 11/11).
- Respaldo de `0064`–`0065`: `_respaldos/2026-10-22-conclusion-humana-0064-0065/` (restauración aislada verificada).
- Nota de entorno: el CLI de Next.js < 16.4.2 podía abortar `next build` con `SecurityFatalError` (aviso de vulnerabilidad); resuelto con 16.4.2.
- Tras crear `tl-restore`, esperar a que el log muestre dos «ready to accept connections» antes de restaurar (el servidor se reinicia tras `initdb`).

- Desde 2026-10-22 PostgreSQL, Redis y el almacenamiento S3 se publican **solo en 127.0.0.1** (prueba `apps/api/src/infra-exposicion.spec.ts`). Para usar la API desde un teléfono: `adb reverse`, no la red local. Evidencia: `qa/EVIDENCIA_QA_SEGURIDAD_LOCAL_2026-10-22.md`.

## Entorno lento (2026-10-25): validar desde el SSD con una base temporal
El proyecto y el disco de Docker están en un disco USB mecánico (`D:`) con latencias de escritura sincronizada de decenas de ms: `npm run validate` agota tiempos (arranque de la base de pruebas, escáner, mapa). Alternativa **verificada** (APROBADA sobre `210d8f5`) que no cambia el código ni los timeouts: (1) `git worktree add --detach C:/tlv <SHA>` + copiar `.env` + `npm ci`; (2) una base temporal en memoria solo para pruebas: `docker run -d --name tl-fast-pg --tmpfs /var/lib/postgresql/data:rw,size=5g -e POSTGRES_USER=fast -e POSTGRES_PASSWORD=<local> -e POSTGRES_DB=terra_link_test -p 5455:5432 postgis/postgis:16-3.4 postgres -c fsync=off -c full_page_writes=off -c max_connections=200 -c max_wal_size=256MB -c wal_keep_size=0` (**no** `synchronous_commit=off`: una prueba de durabilidad lo exige en `on`); (3) `DATABASE_URL` y `TEST_DATABASE_URL` apuntando a ella solo en esa sesión; (4) `npm run validate` desde `C:/tlv`. Los datos desplegados no se tocan. Desventaja: no valida el rendimiento real del disco. Retirar `tl-fast-pg` y el worktree al terminar.

### Android y mapa móvil en este equipo (2026-10-28)
- Entorno **sin alterar otros**: JDK 17.0.20.1 y SDK (platform-tools, emulator, platforms;android-36, build-tools;36.0.0, ndk;27.1.12297006, system-images;android-35;google_apis;x86_64) en `C:\Users\mario\Android\{jdk,sdk,avd}`; variables solo por sesión (`JAVA_HOME`, `ANDROID_HOME`, `ANDROID_AVD_HOME`). `apps/mobile/android/local.properties` con `sdk.dir=C:/Users/mario/Android/sdk` (barras normales).
- AVD `TL_Pixel_35`: `emulator -avd TL_Pixel_35 -no-window -no-snapshot -no-audio -gpu swiftshader_indirect -partition-size 2000` (máximo 2047 MB).
- Compilar: `cd apps/mobile && npx expo prebuild --platform android --no-install`; `cd android && ./gradlew.bat assembleRelease -PreactNativeArchitectures=x86_64` (primera vez ~16 min). Instalar `adb install -r`; `adb reverse tcp:4000 tcp:4001` (proxy de `e2e/movil/proxy.mjs`) y `tcp:8090 tcp:8090` (mapas).
- `npm run map:embed` (apps/mobile) genera `src/ui/mapa-embebido.generated.ts` (no versionado; corre solo en postinstall/typecheck/test).
- Recorrido: `node e2e/movil/recorrido-emulador.mjs <pasos>`; nuevos: relogin, altasPreparar, altasSinParcelas, altasCaptura, altasReaperturaYSync, mapaPreparar, mapaOffline, ubicacionDenegada, adjuntoInterrumpido. La sesión del servidor dura 1 h: repetir `relogin` en tandas largas. Revisión visual de Altas: `node e2e/review/movil-altas-web.mjs` (con `web:preview` en 3001).
- Cartografía local generada el 2026-10-28 con `node infra/maps/preparar-mapa.mjs` (volumen `map-data` estaba vacío): `ecuador.pmtiles` 150 MB.
