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

## Bloqueos honestos

- La versión `1.0.0` permanece `DRAFT`.
- La base jurídica personal permanece `PENDING`.
- Las responsabilidades concretas permanecen `PENDING`.
- Esta entrega no declara conformidad EUDR, no emite conclusiones regulatorias y no habilita `READY`.
- La aprobación jurídica y la validación posterior en piloto/servidores reales permanecen como fases separadas.
