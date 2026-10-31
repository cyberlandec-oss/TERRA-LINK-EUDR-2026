# Sesión 2026-10-10 — Revisión P0-021/P0-022 y P0-023 Captura offline

Rama `feat/tech-001-ci-p0-002`.

## P0-021 (revisión)

- Migración 0028: `mitigation_decisions.criterion_met` (NULL en decisiones históricas), `mitigation_corrections`
  (append-only, separación de funciones por trigger) y estado `REOPENED` (solo con corrección registrada).
- API `POST /mitigations/{id}/corrections`; vista con soporte / acción / causa y aviso si la causa persiste.
- Reevaluación con procedencia: desencadenada por, ejecutada por (worker), revisada por.
- DEMO corregido por la interfaz con la segunda persona; evaluación 3 creada por el worker.

## P0-022 (revisión)

Paquete final bloqueado si exigiría redactar por alcance (`EXPORT_SCOPE_INSUFFICIENT`); artefactos separados y
pendientes declarados (archivos no incluidos, campos del perfil destino). Requisitos sin cambios. Sigue ABIERTA.

## P0-023

`apps/mobile` (Expo SDK 57, ADR-0006 PROPUESTO): almacén local por cuenta+organización, transacción de cola, fotos
persistentes con SHA-256, muestras de ubicación con procedencia real, recuperación al abrir, política de sesión D-40
(propuesta), device_id sin valor de autorización, pantallas de campo. Sin sincronización.

## Validación

- Web/API: `npm run validate` APROBADA (`validation-results/2026-10-11T04-45-29-062Z`): unitarias + integración (API y web) 283/283, E2E 55/55, OpenAPI 141 rutas; revisión por rol 40 entradas, 0 incidencias.
- Móvil (Node): typecheck; 9/9 núcleo; 1/1 cliente contra API local; bundle Android; expo-doctor 21/21.
- Android real: **no ejecutado** (sin SDK/JDK/adb en este equipo). Emulador: no ejecutado.

## Estado

P0-021 DONE_LOCAL (revisado). P0-022 ABIERTA. P0-023 ABIERTA (ensayo Android real y cifrado pendientes). Abiertas:
P0-012, P0-016, P0-017. D-40 nueva (propuesta). Sin cambios: D-05, D-32, partes pendientes de D-33/34/35, D-36, D-37, D-38.
