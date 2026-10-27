# Sesión 2026-10-11 — Escáner en contenedor, D-41, Expo Go y entorno Android

Rama `feat/tech-001-ci-p0-002`.

- `SCANNER_HOST: scanner` confirmado en `docker-compose.yml` (commit `761d07f`); `api` recreado conservando volúmenes.
- Evidencia del escáner real por la API en contenedor: disponible, caído (nunca limpio) y reintento
  (`e2e/review/escaner-contenedor.mjs`, `docs/qa/evidencia-escaner-contenedor.json`).
- D-41 adoptada para el MVP local: «Fotografía de campo», dato personal, sin valor probatorio automático; metadatos
  embebidos eliminados (móvil) y rechazados (servidor); título y nombre de archivo neutros.
- Expo Go: solo fixtures sintéticos; documentación corregida (DEMO no vuelve sintética una captura real).
- Copias temporales de subida: limpieza al terminar y al abrir la app.
- Android: sin SDK/JDK/adb; **no se instaló** por falta de espacio (6,3 GB libres en el único disco). Build nativo,
  SQLCipher real, emulador y dispositivo: no ejecutados.

## Validación

- Web/API: `npm run validate` APROBADA (`validation-results/2026-10-11T05-58-21-233Z`): unitarias + integración (API y web) 289/289, E2E 55/55, OpenAPI 146 rutas.
- Móvil: `validation-results/2026-10-11T05-56-44-934Z-movil (typecheck, 17 pruebas de núcleo, recorrido contra la API en contenedor, bundle Android, expo-doctor)`.

## Estado

P0-023 ABIERTA (garantías nativas sin demostrar). P0-024 ABIERTA (operaciones móviles no soportadas; sin dispositivo).
D-41 adoptada (MVP local). D-40 sigue propuesta.
