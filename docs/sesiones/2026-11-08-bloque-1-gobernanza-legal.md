# Bloque 1 — Marco legal y regulatorio

Fecha: 2026-11-08  
Rama: `main`  
Commit base: `991b546`  

## Alcance de esta entrega

Se implementó el mecanismo técnico versionado para aplicabilidad EUDR, retención, base jurídica y responsabilidades. El mecanismo no inventa contenido jurídico: una versión nueva queda en `DRAFT` y sus controles en `PENDING` hasta que una persona autorizada registre una aprobación explícita.

## Fuente oficial contrastada

- Reglamento (UE) 2023/1115, texto consolidado del 18-09-2026: <https://eur-lex.europa.eu/eli/reg/2023/1115/2026-09-18/eng/pdf>
- Artículos 3, 4, 8, 9, 10, 11 y 12: alcance, diligencia debida, información, evaluación, mitigación, responsabilidad y conservación.
- La fuente oficial establece cinco años para conservar declaraciones y documentación de diligencia debida. El sistema registra ese dato como referencia `PENDING`, no como política activada.
- La base jurídica para datos personales y los responsables concretos no se deducen del Reglamento: quedan explícitamente pendientes de aprobación local.

## Implementación

- Migración `0078_marco_gobernanza_legal`.
- `legal_governance_versions`: versión, jurisdicción, vigencia, estado, fuente, aprobación y fundamento.
- `legal_governance_controls`: controles de aplicabilidad, retención, base jurídica y responsabilidades.
- Controles iniciales documentados:
  - conservación de declaraciones/documentación EUDR;
  - aplicabilidad por operador, producto y operación;
  - base jurídica del tratamiento de datos personales;
  - responsabilidades de operador, comprador y revisores;
  - revisión periódica del sistema;
  - autoridad para registrar conclusión de riesgo.
- Permisos de plataforma separados: `legal_governance:read` y `legal_governance:manage`.
- Endpoints:
  - `GET /api/v1/platform/legal-governance/versions`
  - `POST /api/v1/platform/legal-governance/versions/:version/decision`
- Las decisiones se auditan y son bloqueadas si existen controles `PENDING`.

## Evidencia local

- `npm run typecheck`: aprobado.
- `npm run lint`: aprobado.
- `npm run db:migrate`: aplicado `0078_marco_gobernanza_legal` sobre la base existente.
- `docker compose --profile app up -d --build --wait api web worker`: aprobado.
- API, web, worker, PostgreSQL, Redis, escáner y almacenamiento local quedaron saludables.
- No se recrearon bases, no se ejecutaron seeds, no se cambiaron credenciales o roles operativos y no se eliminaron volúmenes.

## Verificación de la entrega en `main`

- La captura de debida diligencia incorpora versión, vigencia, estado y controles del marco legal vigente. Esa captura forma parte de la instantánea y de su hash; las instantáneas históricas no se reescriben.
- El evaluador agrega `LEGAL_GOVERNANCE`: sin versión vigente, con estado distinto de `APPROVED` o con controles no `ACTIVE`, el expediente queda `PENDING` y no puede avanzar a `READY`. `READY` interno sigue siendo distinto de paquete generado, envío y aceptación oficial.
- Se añadieron pruebas para crear/versionar, aprobar con autorización, rechazar controles pendientes, rechazar vigencia futura, retirar, impedir duplicados, auditar y denegar a usuarios sin permiso. Administrar el catálogo queda separado de evaluar/concluir riesgo: `legal_governance:*` no concede `risk:evaluate` ni `risk:conclude`.
- El catálogo global tiene ámbito de plataforma y autorización backend; los expedientes conservan el aislamiento por organización y permisos existentes.

## Retención y pendientes

- Los cinco años de los artículos 4(3) y 12(5) se limitan a declaraciones y documentación de debida diligencia EUDR. No se extienden automáticamente a todos los datos personales, archivos, logs ni respaldos.
- La base legal y las responsabilidades de tratamiento personal siguen `PENDING`; no se inventa un plazo general. El ciclo de vida de respaldos, sus claves y su destrucción requiere una política separada y aprobada.
- P1-005 y el bloque legal permanecen abiertos: la implementación técnica está ampliada, pero faltan aprobación jurídica/configuración vigente y evidencia integral de validación.

## Pruebas y evidencia de esta continuación

- `npm run typecheck`: aprobado.
- `npm run lint`: aprobado.
- La prueba unitaria nueva está en `apps/api/src/dd/requirements.spec.ts`.
- La prueba de integración está en `apps/api/test/legal-governance.int-spec.ts`; queda pendiente por el resolver de `ts-jest` del entorno Windows hoisted, sin declararla aprobada.
- Falta ejecutar el respaldo y su verificación aislada posterior a `0078` conforme a `docs/20_COMANDOS_Y_ENTORNO.md`, sin repetir respaldos ya acreditados.
- Se generó el respaldo de base, objetos, claves restringidas, estado y huellas en una carpeta temporal externa al repositorio porque `D:` devolvió “dispositivo no está listo”. La restauración aislada se intentó y falló por terminación abrupta del PostgreSQL de ensayo durante `pg_restore`; el ensayo fue retirado y no se declara verificado.
- El candidato `65c099671897a7c0727091e604e66604e312c2ea` fue reconstruido y desplegado localmente con `APP_COMMIT=65c0996`: `/health/ready` respondió 200 y `/version` confirmó commit `65c0996` y esquema `0078_marco_gobernanza_legal`. Los servicios quedaron saludables.

## Reproducibilidad y recuperación completadas

- El diagnóstico de Jest registró Node `v26.13.0`, npm `11.20.0`, Jest `30.5.2` y ts-jest `29.4.14`. Node resolvía ts-jest, pero el resolver de Jest del workspace Windows no lo encontraba desde `rootDir=apps/api`. Las junctions manuales fueron retiradas; `jest.config.js` quedó sin rutas absolutas ni enlaces requeridos.
- La prueba existente ejecutada en contenedor desechable pasó: `src/dd/requirements.spec.ts`, 52/52. La ejecución conjunta final pasó: 2 suites, 54/54 (`requirements.spec.ts` + `legal-governance.int-spec.ts`). La suite de integración usó `terra_link_test`/Redis de pruebas y no la base operativa.
- La integración detectó y corrigió que `audit_logs.entity_id` es UUID: las versiones semánticas se auditan con `entity_id=NULL` y `after.version`, conservando su identidad y evitando conversión inválida. La vigencia se compara con `CURRENT_DATE` en PostgreSQL.
- El respaldo `0078` fue comprobado por hash y legibilidad, conservando el intento fallido. La restauración fallida se explicó por los logs: `pg_isready` había respondido durante la inicialización temporal del entrypoint; no fue OOM (`OOM=false`). El segundo intento esperó el arranque definitivo y terminó `pg_restore` con código 0.
- Verificación aislada aprobada: 163 tablas, 2.731 restricciones, 299 triggers, migración `0078_marco_gobernanza_legal`, versión `1.0.0` DRAFT con 6 controles; 2 documentos y 2 objetos restaurados con SHA-256/tamaños coincidentes. La copia duradera está fuera del repositorio en `Documents/TerraLink-Backups/2026-11-09-p1005-migracion-0078`; `claves.env` quedó con ACL del usuario actual y sus valores nunca se imprimieron.
- Se limpiaron únicamente los recursos aislados con nombres únicos. No se modificaron volúmenes operativos ni se recreó la base de desarrollo.
- `npm run validate -- --skip-e2e` sobre el árbol congelado pasó servicios, typecheck, lint, build y OpenAPI; su paso normal de Jest en Windows falló antes de ejecutar por el resolver de `ts-jest`. La misma orden normal (`npm test --workspace apps/api`) ejecutada en `node:24-bookworm-slim`, con dependencias de desarrollo y base de pruebas, pasó 54/54; web pasó 27/27 en la validación oficial.
- SHA funcional validado y servido: `56994ebbc0b13b87bb45d22851cfb14cd9765e91`; `/health/ready` 200 y `/version` confirmó `56994eb`, esquema `0078_marco_gobernanza_legal`. El HEAD documental posterior se mantendrá separado y no requiere reconstrucción si solo cambia esta continuidad.

## Bloqueos honestos

## Continuacion manual de la validacion 494f864

- La ejecucion se inicio sobre `main` en `494f864`, en `validation-results/2026-11-09T17-48-35-507Z`, con el contenedor `tender_poitras` (`node:24-bookworm-slim`, memoria 6 GiB, `NODE_OPTIONS=--max-old-space-size=4096`).
- El proceso padre `validate-local` termino antes que el contenedor. Se verifico progreso mediante `harness-timings.jsonl`; el contenedor continuo y termino con codigo `0`. El capturador persistente registro por separado la espera y el codigo del contenedor en `captura-terminal-contenedor.json`.
- `AutoRemove=true` elimino el contenedor antes de recuperar sus logs Docker completos. El archivo `pruebas-unitarias-integracion.log` conservo salida parcial y no se genero `resumen.json`; por ello esta corrida no se declara como validacion integral aprobada ni acredita omisiones, E2E o continuacion automatica. El codigo `0` se conserva como evidencia del comando del contenedor, no como sustituto del resumen Jest.
- Se corrigio el procedimiento en `75b4d5f`: el contenedor de pruebas queda nombrado y retenido (`AutoRemove=false`) hasta capturar logs completos, `docker wait` y codigo del proceso; luego se elimina junto con su volumen de dependencias. La sintaxis se comprobo en `node:24-bookworm-slim`.

- La versión `1.0.0` permanece `DRAFT`.
- La base jurídica personal permanece `PENDING`.
- Las responsabilidades concretas permanecen `PENDING`.
- Esta entrega no declara conformidad EUDR, no emite conclusiones regulatorias y no habilita `READY`.
- La aprobación jurídica y la validación posterior en piloto/servidores reales permanecen como fases separadas.
## Corte técnico posterior — 2026-11-09

### Validación y despliegue

La corrida original `validation-results/2026-11-09T18-53-10-760Z` se conserva intacta. Sus totales reales son:

- API: **114 suites aprobadas de 116**, **1.197 pruebas aprobadas de 1.252**; 2 suites y 55 pruebas quedaron omitidas por las exclusiones configuradas en el arnés. Evidencia detallada: `pruebas-unitarias-integracion.log` y `api-test-timings/`.
- Web/build/OpenAPI: pasos `typecheck`, `lint`, `build` y `openapi-validado` con código 0; artefactos `typecheck.log`, `lint.log`, `build.log` y `openapi-validado.log`.
- E2E original: **29 pasaron, 23 fallaron y 126 no se ejecutaron** por ausencia del Chromium de Playwright; no fue un fallo funcional acreditado. Evidencia original: `e2e-navegador.log`.
- E2E de continuación sobre el mismo código funcional `0996464`: código 0 y estado Playwright `passed`. La continuación está separada en `validation-results/2026-11-09T18-53-10-760Z/e2e-reparacion-2026-11-09.md`; no sustituye el resumen original fallido.

La clasificación exacta de las omisiones API es ambiental y está localizada en el transporte TLS controlado: las suites `apps/api/src/satellite/egress-transporte.spec.ts` (7 pruebas) y `apps/api/src/satellite/whisp.spec.ts` (34 pruebas) fueron `skipped`, junto con el bloque `Whisp 2.3.1 · servidor controlado` de `apps/api/test/satellite.int-spec.ts` (14 pruebas). Total: **2 suites y 55 pruebas**, porque `tlsAvailable` es falso cuando `openssl version` no devuelve código 0; no son fallos ni pruebas aprobadas. Son obligatorias para acreditar el transporte TLS controlado del adaptador, pero no acreditan proveedor real ni deben maquillarse como integración externa.

El intento dirigido posterior `npm run test -w apps/api -- --runInBand test/dd.int-spec.ts test/d07-mecanismos.int-spec.ts` terminó con código 1 antes de ejecutar pruebas: Jest no pudo resolver `ts-jest` desde el resolver Windows (`Module ts-jest in the transform option was not found`). Se conserva como intento fallido separado; no altera la evidencia API reproducible previa ni se presenta como aprobado.

### Bloque satelital: TLS controlado

Se añadió [`infra/qa/Dockerfile.tests`](../../infra/qa/Dockerfile.tests) como entorno versionado de pruebas. Instala `openssl` y `ca-certificates`, y la validación `--tests-container` comprueba `openssl version` antes de iniciar Jest. No se desactiva la verificación TLS ni se modifican las listas de destinos: solo se habilitan los fixtures efímeros controlados del repositorio.

Ejecución dirigida en Linux sobre la base `*_test`, con el script del workspace API:

`npm run test -w apps/api -- --runInBand src/satellite/egress-transporte.spec.ts src/satellite/whisp.spec.ts test/satellite.int-spec.ts`

Resultado de Jest: **3 suites, 84 pruebas aprobadas, 0 fallidas, 0 omitidas**. Las 55 omisiones previas quedan resueltas en el entorno reproducible. El código del proceso de pruebas fue 0; un wrapper PowerShell posterior devolvió 1 por tratar un warning de `docker logs` durante la limpieza como error, por lo que ese código del wrapper no se usa como resultado de Jest.

La validación completa histórica queda clasificada como **FALLIDA por el entorno E2E original**, con la E2E posteriormente repetida y aprobada de forma independiente. No se convierten los 126 casos no ejecutados originales en una aprobación retroactiva.

El artefacto funcional se reconstruyó con `APP_COMMIT=0996464` mediante el mecanismo existente en `scripts/desplegar.mjs`/`docker-compose.yml`. `/version` ahora devuelve `commit: 0996464`, `commit_source: BUILD_ARG` y esquema aplicado `0078_marco_gobernanza_legal`; API live/ready y web responden 200. El commit documental `6d6f04b` no se atribuye al artefacto funcional.

### Bloque legal y comienzo del bloque DD

El recorrido DD ya demuestra localmente: captura de instantánea append-only, hash y manifiesto, generación de paquete `INTERNAL_REVIEW`, separación de `DD_PACKAGE`, revisión autorizada, auditoría, aislamiento de tenant, redacción por permiso y transición a `STALE` ante cambios relevantes sin reescribir instantáneas históricas. La gobernanza ausente, no vigente o pendiente mantiene `READY` y la aprobación bloqueados; una gobernanza válida no satisface evidencia, riesgo, geolocalización ni demás requisitos.

Se mantiene pendiente la aprobación jurídica de `P1-005`, `D-05.B`, `D-07.5/D-07.6` y la activación de proveedores/canales externos. `READY` sigue siendo interno y no equivale a DDS presentado o aceptado.
## Movimientos y despacho — verificación 2026-11-09

Se ejecutaron en Linux, sobre la base aislada `*_test`, `test/shipments.int-spec.ts` y `test/d34a-despacho.int-spec.ts`: **2 suites, 15 pruebas, 0 fallidas, código del contenedor 0**. El contenedor quedó `AutoRemove=false`, terminó `EXIT=0`, sus logs se recuperaron y se eliminó únicamente el contenedor/volumen exclusivos de esta ejecución. La prueba cubre reservas, liberación, cancelación, preflight, ledger, saldo insuficiente, concurrencia, idempotencia, tenant y revalidación en despacho.

El resultado no cierra P0-029 operativo: el positivo de despacho depende de la fixture READY sintética ya rotulada en la suite; la vía normal sigue bloqueada por las compuertas DD/legalidad/calidad. Se conserva el recorrido negativo y no se fabrican datos favorables.

## Control cuantitativo de cierre — 2026-11-09

La matriz consolidada de [`docs/23_ESTADO_DESARROLLO.md`](../23_ESTADO_DESARROLLO.md) fija 30 criterios técnicos deduplicados, cinco por bloque: **21 demostrados, 7 parciales y 2 pendientes; acumulado 21/30 = 70,0 %**. Esta entrega aporta **+0 criterios y +0,0 puntos porcentuales**: conserva el cierre de mecánica de despacho de `65b835b` y formaliza el denominador, sin atribuir el HEAD documental a la imagen funcional.

La fixture de despacho toma una instantánea real capturada por API, pero escribe directamente en la base de pruebas el estado `READY` y la aprobación para aislar la mecánica. Por eso MOV-01..04 son demostrados y MOV-05 queda parcial: no se acredita el recorrido integrado de evidencia, riesgo, mitigación, DD, paquete, reserva y despacho mediante los casos de uso autorizados. `READY` interno no equivale a presentación o aceptación oficial.

El SHA funcional servido continúa siendo `0996464` (`/version`, `BUILD_ARG`); los documentos posteriores se publican como HEAD documental separado. PILOTO, VALIDACIÓN DE CAMPO, OPERACIÓN REAL y aprobaciones jurídicas permanecen fuera del porcentaje técnico y explícitamente pendientes cuando aplican.
