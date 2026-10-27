# Terra Link — instrucciones del proyecto

## Proyecto
Terra Link, iniciativa AG TECH EC, conecta cacao de Ecuador con trazabilidad, evidencia, riesgo y debida diligencia. El producto es B2B/B2B2B, web y móvil offline.
Este paquete define el producto objetivo; no acredita implementación, conformidad EUDR ni preparación para producción.

## Antes de cambiar código
1. Lee `docs/00_INDICE.md` y `docs/01_ESTADO_Y_FUENTES.md`.
2. Si hay repositorio, verifica rama, cambios locales, manifiestos, migraciones, pruebas y documentación vigente. Conserva el trabajo existente.
3. Ejecuta `/tl-auditar` al instalar este paquete. Registra evidencia y comandos reales en `docs/20_COMANDOS_Y_ENTORNO.md` antes de usarlos.
4. El stack NestJS/Next.js de la fuente es una propuesta inicial. Hay un antecedente de FastAPI/React no verificado aquí. Conserva el stack probado del repositorio; usa ADR-0001 para resolver diferencias.
5. Si el repositorio está vacío, completa TECH-001 antes de crear módulos; registra stack, estructura y contratos como decisiones propuestas y luego aceptadas.

## Estructura de este paquete
- `.claude/rules/`: reglas globales y por rutas; ajusta sus globs tras auditar el repositorio.
- `.claude/commands/`: flujos invocables para auditoría, implementación, revisión y continuidad.
- `docs/`: especificaciones consultadas según la tarea; `docs/24_TRAZABILIDAD_REQUISITOS.md` conecta fuentes, historias y pruebas.
- `docs/adr/`: decisiones y alternativas; `docs/templates/`: plantillas de tarea, sesión y validación.
- `docs/sources/`: copias literales de las cuatro fuentes, como referencia histórica.

## Reglas fundamentales
- Autoriza en backend por usuario, organización, acción y recurso. Los filtros de UI no dan seguridad.
- Toda referencia entre entidades operativas debe conservar el tenant; acceso entre organizaciones requiere concesión explícita y revocable.
- Conserva eventos, geometrías, evidencias, reglas y expedientes versionados. Corrige mediante un nuevo registro relacionado al original.
- Peso y dinero usan decimales y unidades explícitas. Bloquea doble consumo y saldo negativo; corrige con ajustes auditados.
- Origen desconocido y datos faltantes siguen siendo desconocidos. Un score bajo o un certificado no prueban cumplimiento legal.
- `READY` indica preparación interna; `EXPORTED` indica descarga del paquete. Ninguno significa presentación oficial de DDS.
- La IA y el satélite apoyan análisis; la decisión regulatoria requiere evidencia, reglas vigentes y revisión autorizada.
- Diseño en español, acciones por rol, lote como centro de navegación y errores con recuperación.
- Offline requiere persistencia, idempotencia, resolución visible de conflictos y validación del servidor.

## Cómo trabajar
1. Elige una historia de `docs/18_BACKLOG.md`; revisa dependencias y criterios, no toda la documentación en cada sesión.
2. Inspecciona su implementación actual y reutiliza patrones. Anota qué existe, qué falta y qué propones.
3. Implementa una sección completa: dominio, persistencia, API, autorización, auditoría y UI/offline cuando corresponda.
4. Ejecuta las verificaciones pertinentes de `docs/16_PLAN_QA.md` y los comandos comprobados del repositorio.
5. Actualiza estado, decisiones y reporte de evidencia. No cierres una historia solo porque el código compila.
6. Entrega cambios, pruebas ejecutadas, limitaciones y siguiente paso; distingue «no ejecutado» de «aprobado».

## Organización por entregas funcionales completas (2026-10-17)
Agrupa decisiones, implementación y pruebas de **un mismo resultado funcional verificable**; no conviertas cada
ajuste en una entrega con validación y despliegue propios, ni acumules funcionalidades independientes. Límite
natural: mismo caso de uso, contrato y dependencias.
1. Antes de programar, identifica resultado esperado, criterios originales cubiertos, decisiones ya adoptadas,
   decisiones pendientes que **realmente** bloquean y comprobaciones de aceptación. No pidas de nuevo
   aprobación de lo ya adoptado; cuando falten decisiones, preséntalas **juntas** con opciones, recomendación y
   consecuencia, y sigue mientras tanto con el trabajo independiente ya autorizado.
2. Durante la implementación ejecuta **pruebas dirigidas** —casos nuevos y regresiones afectadas— con typecheck
   y lint según lo cambiado. Reutiliza arneses y utilidades existentes; no construyas sistemas paralelos.
3. Cierre del candidato: genera artefactos versionados (incluida OpenAPI), revisa el diff excluyendo secretos,
   credenciales, respaldos, APK y archivos ajenos, confirma, y ejecuta **`npm run validate` completa una sola
   vez sobre ese SHA**, con el código congelado. Si falla, conserva registros, diagnostica y corrige: la
   corrección es un candidato nuevo. No repitas hasta obtener verde ni subas timeouts.
4. Tras aprobar: reconstruye **una vez** los servicios afectados, comprueba el comportamiento cambiado (un 200
   no sustituye esa comprobación), aplica el respaldo cuando haya migración, cambio criptográfico o
   intervención sobre datos, y consolida evidencia, trazabilidad, estado y continuidad en **un commit de
   resultados**.
5. El cierre indica qué cambió, SHA validado y resultado, comportamiento comprobado en despliegue, criterios
   demostrados y pendientes, y la siguiente entrega recomendada. Los cambios solo documentales posteriores no
   repiten la validación funcional.

Esto **no** reduce alcance ni controles: el backlog y los criterios originales siguen igual, y se mantiene la
distinción entre implementación, demostración local, aceptación externa y preparación para producción.

## Criterio de aceptación de esta etapa: desarrollo y validación local
- Terra Link se desarrolla, levanta y verifica en el equipo local. GitHub Actions **no es obligatorio** en esta etapa; no hay que resolver facturación ni cambiar de cuenta.
- Git/GitHub siguen siendo versionado y respaldo (commits y push a la rama de trabajo).
- Una historia es **DONE_LOCAL** cuando cumple sus criterios funcionales y de seguridad con evidencia de pruebas locales pertinentes: `npm run validate` aprobado sobre el commit, más las pruebas específicas de la historia.
- DONE_LOCAL **no** acredita producción, despliegue, Android real ni conformidad EUDR; esos gates se registran aparte.
- El workflow de Actions está inactivo en `infra/ci/github-actions-ci.yml` (referencia). No pidas relanzarlo.

## Comandos
Monorepo npm (`apps/api` NestJS + Kysely, `apps/web` Next.js). Comandos verificados en `docs/20_COMANDOS_Y_ENTORNO.md`; no inventes otros.
- `npm run infra:up` (PostGIS en host:5440, Redis, S3 local) · `npm run db:migrate` · `npm run seed:dev -w apps/api`
- **`npm run validate`**: validación local completa (servicios, typecheck, lint, build, OpenAPI validado, unitarias + integración, E2E). Resultados en `validation-results/<fecha>/`. Opciones: `-- --skip-e2e`, `-- --docker`
- `npm run typecheck` · `npm run lint` · `npm test` (la integración recrea el esquema de la base `*_test`) · `npm run build`
- `npm run dev:api` (4000, Swagger `/api/docs`) · `npm run dev:web` (3000)
- `docker compose --profile app up -d --build --wait` (API y web en contenedores; `rm -sf api web migrate` para detenerlos)
- Datos DEMO para revisión: `npm run seed:demo -w apps/api` (credenciales en `CREDENCIALES.csv`, ignorado por git) · revisión por rol: `node e2e/review/revision-por-rol.mjs`
- Acceso federado de ensayo (deshabilitado por defecto): `docker compose --profile sso up -d keycloak` + variables `SSO_*` en `.env` · demostración: `node e2e/review/p1015-demostracion.mjs` (docs/20)
- Worker del outbox: `npm run worker -w apps/api` (o servicio `worker` del perfil `app`)
- `npm run test:e2e` (Playwright; requiere `npm run build -w apps/api` e `infra:up`; usa base `terra_link_e2e` y puertos 4100/3100)
No ejecutes migraciones sobre producción, reinicios destructivos, borrado de volúmenes ni envíos regulatorios como parte de una tarea local.
Trabaja en una rama de tarea; conserva cambios ajenos y solicita el dato o autorización faltante solo si bloquea una acción concreta.

## Documentación por tarea
Dominio/datos: documentos 04–06. Autorización: 07. Eventos/API: 08–09.
GIS/offline: 10–11. Evidencia/riesgo/DD: 12–13. UI: **`docs/UX_UI.md`** (identidad visual, tokens, componentes, estados, experiencia por rol; consultar antes de modificar cada pantalla) y 14 (workflows por rol). Integraciones: 15.
QA/operación: 16–17. Plan: 18–19. Inicio en Claude: 21. Decisiones abiertas: 22.
