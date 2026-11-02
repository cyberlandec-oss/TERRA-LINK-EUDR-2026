# Sesión — 2026-10-10 · Redis 503, eventos/outbox y P0-004

## Contexto vigente
Rama `feat/tech-001-ci-p0-002` @ `b20ebd8` (PR #1), limpia. CI bloqueado por facturación; no se tocaron gastos ni se fusionó.

## Trabajo realizado
- Login con Redis caído: 503 `LOGIN_TEMPORARILY_UNAVAILABLE` + `Retry-After` (fail-closed); `commandTimeout` en ioredis; readiness con `checks` por dependencia.
- TECH-001: `0004_domain_events_outbox`, `src/events/` (EventStore, OutboxWorker, consumidores), `worker-main.ts`, servicio `worker` en compose, script `npm run worker`.
- P0-004: `0005_producers` (producers, producer_versions, producer_status_counts), `src/producers/producers.ts`, permisos `producer:*` (catálogo `2026-10-10.2`), páginas web de listado y detalle.
- Docs: doc 07 (matriz de productores), doc 08 (implementación vigente de eventos), ADR-0003 (estado), ADR-0005 (Redis), docs/20, docs/23, CLAUDE.md.

## Verificación
API 75/75 (redis-outage 3, events 9, producers 11, más las suites previas). Web 3/3. E2E 13/13 (dos corridas verdes; una corrida previa intermitente por `reload` lento). Mutantes detectados: consumo sin recibo y filtro de tenant de productores. Contenedores con 2 workers: 3 productores → 6 entregas DONE y proyección correcta.
CI: no ejecutado (facturación).

## Pendientes
CI. D-04, D-18, D-19, D-20, matriz `producer:*` provisional, cifrado de identidad en reposo. TECH-001: CTE/KDE, ledger, reglas, reproceso de DEAD.

## Siguiente acción
P0-005 (docs/18 §P0-005, doc 06 productores): unicidad concurrente y revisión de coincidencias sin fusión silenciosa.
