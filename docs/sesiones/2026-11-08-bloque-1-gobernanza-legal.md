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

## Bloqueos honestos

- La versión `1.0.0` permanece `DRAFT`.
- La base jurídica personal permanece `PENDING`.
- Las responsabilidades concretas permanecen `PENDING`.
- Esta entrega no declara conformidad EUDR, no emite conclusiones regulatorias y no habilita `READY`.
- La aprobación jurídica y la validación posterior en piloto/servidores reales permanecen como fases separadas.
