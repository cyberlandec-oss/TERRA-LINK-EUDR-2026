# ADR-0006 — Móvil de campo y captura offline (P0-023)

Estado: **PROPUESTO** · 2026-10-10. No aceptado: falta el ensayo en Android real y la aprobación de la política de sesión (D-40: **decidida 2026-10-30, opción A**, la captura nueva dura lo que la sesión del servidor, 1 h; falta el ensayo Android real). Duración objetivo de RNF-04: **1 h de captura nueva**; conservar lo capturado y sincronizar al reconectar no dependen de ella.

## Contexto

S1 y ADR-0001 prevén React Native/Expo + SQLite, a fijar en P0-023. docs/11 exige entidad y cola en una transacción
local, adjuntos y GPS que sobrevivan cierre y reinicio, dataset limitado, separación por cuenta y una sesión offline
definida sin renovar credenciales sin red. La API emite JWT de 1 h sin refresh token (ADR-0005).

## Decisión propuesta

- **Stack**: Expo SDK 57 (React Native 0.86, React 19.2), proyecto `apps/mobile` fuera de los workspaces npm de la raíz
  (lockfile propio) para no alterar la API, la web ni `npm run validate`. Librerías confirmadas en docs.expo.dev el
  2026-10-10: `expo-sqlite` (`withExclusiveTransactionAsync`; SQLCipher con `useSQLCipher`, no disponible en Expo Go),
  `expo-file-system` (`Paths.document` persistente frente a `Paths.cache`), `expo-secure-store` (Android Keystore),
  `expo-location` (proveedor elegido por el sistema: no garantiza GPS; `accuracy` puede ser nula; `mocked` en Android),
  `expo-image-picker` (archivo en caché temporal), `expo-crypto` (SHA-256, UUID).
- **Almacenamiento**: una base SQLite por cuenta + organización (`tl-<hash>.db`) y carpeta de adjuntos propia. Encolar
  escribe borrador y operaciones en una transacción exclusiva; las operaciones encoladas son inmutables.
- **Ubicación**: `source = DEVICE_LOCATION_SERVICE`, hora de adquisición del proveedor, precisión informada o NULL,
  detalle del proveedor y marca de simulación. Nunca se etiqueta como GPS.
- **Cifrado**: clave aleatoria por base en almacenamiento seguro; `PRAGMA key` con SQLCipher en build de desarrollo; el
  estado real se mide (`PRAGMA cipher_version`) y se muestra. En Expo Go la base queda sin cifrar (declarado).
- **Sesión**: la captura termina al vencer la sesión del servidor; D-40 (ventana más larga) fue decidida como NO adoptada (opción A, 2026-10-30); su redacción concreta y la matriz «conservar / capturar de nuevo / sincronizar» están en `docs/11` (2026-10-30).
- **Entornos**: Expo Go = prueba sin cifrado, solo datos sintéticos (DEMO); build nativo = exige SQLCipher o no abre el almacén.
- **Fotos**: BLOB dentro de la base (mismo cifrado); copia de la cámara borrada tras importar.
- **Sincronización (P0-024)**: dispositivo registrado en servidor, push idempotente por hash, pull con cursor de servidor, adjuntos por Documentos (docs/11).

## Consecuencias

- Las pruebas del núcleo corren en Node con SQLite real (`node:sqlite`) y archivos reales: evidencia unitaria, no de
  dispositivo. El ensayo Android real con cierre, reinicio, fotos y ubicación sigue siendo obligatorio para cerrar P0-023.
- La protección criptográfica entre cuentas del mismo teléfono es lógica (claves por cuenta en el mismo almacén seguro
  de la app); no resiste a quien controle el dispositivo desbloqueado con privilegios.

## Pendiente para aceptar

Ensayo Android real reproducible; build de desarrollo con SQLCipher probado; D-40 ya decidida (opción A, 2026-10-30); contrato de dispositivo
y sincronización (P0-024).
