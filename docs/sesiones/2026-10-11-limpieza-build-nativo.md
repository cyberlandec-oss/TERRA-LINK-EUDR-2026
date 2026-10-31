# Sesión 2026-10-11 — Limpieza autorizada, salud del escáner, orientación y build nativo Android

- Limpieza: caché de npm y caché de compilación de Docker (mediciones en `docs/qa/EVIDENCIA_LIMPIEZA_Y_ANDROID_2026-10-11.md`).
- `/health/ready` informa el escáner (`degraded` sin ocultarlo; 503 solo por dependencias núcleo).
- Foto procesada por la app: SHA-256 de los bytes sin metadatos; orientación EXIF conservada (fixtures).
- Entorno Android (JDK 17, SDK 36, NDK, emulador) y APK release con SQLCipher; autoprueba 8/8 en emulador API 30.
- Validación: `validation-results/2026-10-11T07-46-54-839Z` (290/290, 55/55) y `validation-results/2026-10-11T07-58-10-356Z-movil`.
- Pendiente: teléfono físico; build nativo sin SQLCipher para el fallo cerrado real. P0-023 y P0-024 ABIERTAS.
