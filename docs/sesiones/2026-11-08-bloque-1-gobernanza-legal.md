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

## Bloqueos honestos

- La versión `1.0.0` permanece `DRAFT`.
- La base jurídica personal permanece `PENDING`.
- Las responsabilidades concretas permanecen `PENDING`.
- Esta entrega no declara conformidad EUDR, no emite conclusiones regulatorias y no habilita `READY`.
- La aprobación jurídica y la validación posterior en piloto/servidores reales permanecen como fases separadas.
