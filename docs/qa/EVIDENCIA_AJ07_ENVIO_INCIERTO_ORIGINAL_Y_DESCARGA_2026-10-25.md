# Evidencia — AJ-07: envío incierto, reserva, original inmutable y descarga autorizada (Whisp) — 2026-10-25

Entrega 1 del plan `TERRA_LINK_REVISION_REPO_Y_PLAN_WHISP_2026-10-23.md` (H1–H6) sobre lo ya hecho en AJ-05/AJ-06. **No** se llamó a Whisp real, **no** se activaron llamadas externas, **no** se registró ninguna clave, **no** se enviaron parcelas. Cobertura 42/60 y 30/44 sin cambio. La entrega 2 (riesgo y expediente, H7–H8) **no** está iniciada.

## Estado de H1–H8 tras esta entrega
| Hallazgo | Estado |
| --- | --- |
| H1 credencial por organización | Resuelto en AJ-06 (`PUT/GET/DELETE …/satellite/credentials/{proveedor}`, cifrada, auditada sin valor) |
| H2 reserva y recuperación | Identificador remoto, reanudación sin reenvío y renovación de reserva: AJ-06. **AJ-07:** reserva de **a un trabajo** (el que espera detrás de otro ya no pierde su reserva); **envío incierto** sin reenvío automático |
| H3 original y huella | **AJ-07:** el objeto lleva el arrendamiento de quien cierra (`satellite/{org}/{trabajo}-{arrendamiento}.json`); un corredor atrasado escribe otro objeto y no altera los bytes de un resultado confirmado (los objetos huérfanos de un corredor atrasado quedan sin referencia) |
| H4 script de ensayo | **AJ-07:** se detiene antes de enviar si la configuración no es utilizable, reconoce estados terminales (`analysis_cancelled`, error, plazo…), descarga alternativa, valida la FeatureCollection; verificado con 5 escenarios locales (`whisp-ensayo-real-simulado.mjs`) |
| H5 progreso y cancelación remota | AJ-06; **AJ-07:** mensaje de envío incierto y operaciones ofrecidas según el proveedor |
| H6 periodo | **AJ-07:** Whisp no recibe fechas ⇒ pedir un periodo se **rechaza** (422 `PERIOD_NOT_SUPPORTED_BY_PROVIDER`); la pantalla solo ofrece las operaciones que el proveedor declara (Whisp: cobertura forestal) |
| H7 riesgo / H8 expediente | **Pendiente** (entrega 2) |
| Consulta/descarga autorizada del resultado | **AJ-07:** `GET …/satellite/analyses/{id}/original` exige `satellite:read`, alcance de la parcela y `plot:read_geometry` (el original contiene la geometría), verifica la huella antes de entregar (si no coincide, 500 `ORIGINAL_INTEGRITY_FAILED`), `no-store`, auditado |

## Cambios
Migración `0068_satellite_envio_incierto` (`provider_submit_started_at`); gancho `onSubmitting`/`onSubmitAnswered`; el envío que pierde su respuesta termina con `PROVIDER_SUBMIT_UNCERTAIN` y **no se reintenta**; un reintento que encuentra ese instante sin identificador tampoco reenvía. Un HTTP de error al enviar **sí** es una respuesta y no deja incertidumbre. No se promete «exactamente una vez» frente al proveedor. OpenAPI: 291 rutas.

## Pruebas
- `whisp.spec.ts`, `periodo.spec.ts`: 100 pruebas de satélite con `satellite.int-spec.ts` (envío incierto con corte de conexión, reintento tras error conocido, reserva de a uno, corredor atrasado con dos corredores y almacén en memoria, descarga autorizada/otra organización/sin permiso/huella alterada).
- `satelite-resultado-proveedor.spec.ts` (7, API simulada en el navegador): descarga, envío incierto, operaciones soportadas.
- **Validación `210d8f5`: APROBADA** (`validation-results/2026-10-25T03-08-19-345Z`; integración 645 s, e2e 270 s), ejecutada desde una **copia limpia del commit en el SSD interno** (`git worktree` en `C:\tlv`).
- **Cuatro ejecuciones previas FALLIDAS (conservadas):** `…01-09-01` (durabilidad: mi Postgres temporal tenía `synchronous_commit=off`; extracción de PDF por tiempo, pasa aislada), `…01-36-11` (el Postgres temporal agotó su disco en memoria de 1 GB), `…01-50-10` (una prueba de mitigaciones: un documento no estuvo disponible a tiempo; pasa aislada), `…02-04-47` (unidad e integración APROBADAS; 4 pruebas del mapa fallaron por tiempo en E2E y pasan aisladas 16/16). Causa común: el proyecto y el disco de Docker están en un **disco USB mecánico** con latencias de escritura sincronizada de 30–140 ms (normal: ~1 ms). No se subió ningún timeout.
- Condición de la validación aprobada: Postgres **temporal en memoria** (`fsync=off`, `synchronous_commit=on`) para la base de pruebas y E2E, y copia de código en SSD; el servicio y los datos desplegados no se tocaron. La misma suite no llegó a verde en el disco USB.

## Despliegue, respaldo y demostración
- Desplegado `210d8f5` (marca `+sucio` por capturas de `docs/qa/capturas` regeneradas; `git diff` de código vacío), esquema `0068`, 68 migraciones.
- **Respaldo** `_respaldos/2026-10-25-satelite-0068/` (volcado `-Fc`, objetos, `claves.env` restringido, `SHA256SUMS` verificado). **Restauración aislada** (base en memoria, sin seed ni migraciones): conteos idénticos a `estado-actual.txt` (68 migraciones; 10/8 trabajos/resultados; 97 documentos; 40 parcelas; 56 productores) y la columna 0068 presente. El primer intento sobre un volumen del disco USB falló al iniciar el contenedor por lentitud; se repitió en memoria. Contenedor retirado.
- Demostración desplegada `node e2e/review/satelite-estado-demostracion.mjs`: **7/7**, solo lectura (10/8/0 antes y después).

## Observación sobre volúmenes de Docker
Antes del respaldo el recuento de volúmenes era **27**; al terminar es **8** (`terra-link_postgres-data`, `object-data`, `map-data`, `scanner-db`, `terra-link-dev_terra-link-postgres`, `terra-link-dev_terra-link-objects-v2` y 2 anónimos). Los volúmenes con datos del proyecto están presentes y la base conserva sus datos; no se ejecutó ningún `prune` ni borrado de volúmenes, y la causa de la diferencia **no está determinada** (los 19 ausentes eran, probablemente, anónimos de contenedores de prueba). Queda a la vista del propietario.

## Pendiente
Entrega 2 (H7 resultado en la instantánea de riesgo y su frescura; H8 expediente con proveedor/resultado/método de cobertura); demostración web completa con Whisp real (clave y autorización del propietario); estabilizar el almacenamiento (mover Docker y el proyecto al SSD).
