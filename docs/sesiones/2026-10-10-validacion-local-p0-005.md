# Sesión — 2026-10-10 · Criterio local, cifrado de identidad y P0-005

## Contexto vigente
Rama `feat/tech-001-ci-p0-002` @ `45d3cb1`, limpia. El usuario cambió el criterio de la etapa: validación local; Actions no es obligatorio.

## Trabajo realizado
- Criterio local: workflow movido a `infra/ci/github-actions-ci.yml` (inactivo); `scripts/validate-local.mjs` y `npm run validate`; CLAUDE.md, rules 70, comandos `/tl-*`, backlog, plan QA, doc 17, ADR-0001 y docs/20/22/23 actualizados.
- OpenAPI: el export ahora valida el documento (`@apidevtools/swagger-parser`) y es un paso de `validate`.
- P0-004 (brecha de doc 06): `crypto/pii.ts` (AES-256-GCM con AAD, llavero versionado, índice ciego) y migración `0006_producer_identity_encryption`; servicio de productores cifra y descifra; claves en `.env` (no versionado).
- P0-005: migración `0007_producer_match_reviews`, `producers/matching.ts` (detección por identidad, revisión, permiso `producer:review_duplicates`), página web de coincidencias y aviso al registrar.
- Docs 06 (esquema implementado) y 07 (permiso de revisión); D-21 y D-22 nuevas; tabla de efecto de cada decisión.

## Verificación
- `npm run validate` APROBADA sobre el commit `85a941a` sin cambios locales (2026-10-10T05:05Z): servicios, typecheck, lint, build, OpenAPI validado (32 rutas), API 90/90 (16 unitarias + 74 integración), web 3/3, E2E 14/14.
- `validate` con base de desarrollo como base de pruebas: código 2 sin ejecutar. Con Redis inaccesible: integración falla, código 1.
- Mutante (comparación de tipo de documento) detectado. Validador OpenAPI rechaza referencias rotas.
- Migraciones 0006–0007 aplicadas a la base de desarrollo: productores y usuarios conservados.

## Pendientes
P0-003 (grants, D-04). Custodia y rotación de claves PII. D-19, D-21, D-22. Fallo intermitente E2E sin causa determinada.

## Siguiente acción
P0-006 Parcela (docs/10, 05/06, 18 §P0-006).
