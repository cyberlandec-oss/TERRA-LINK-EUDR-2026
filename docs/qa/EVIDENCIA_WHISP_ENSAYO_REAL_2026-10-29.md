# Evidencia: Whisp, servicio real con geometría artificial (2026-10-29)

**Resultado:** «servicio real con geometría artificial». Terra Link llamó al servicio real de Whisp desde la plataforma y guardó el resultado con su procedencia. **No** es un análisis de una parcela real, **no** es una conclusión regulatoria y **no** acredita conformidad EUDR.

## Autorización
El propietario confirmó en el chat (2026-10-29) que aceptó él mismo los términos de servicio de Whisp y autorizó enviar **únicamente** la geometría artificial del ensayo, usando la organización DEMO · Exportadora Pacífico. No hay autorización para parcelas reales. La clave del propietario estaba en `WHISP_API_KEY` del `.env` activo; se leyó sin imprimirla y **no aparece** en logs, resultados ni este documento (comprobado por búsqueda).

## Qué se envió
Un polígono artificial de ≈100 m (≈1 ha) en una zona cacaotera del Guayas, sin relación con ninguna parcela ni persona: coordenadas `[-79.4000,-1.0000]…[-79.3991,-0.9991]`, `properties` vacío. En la plataforma existe como parcela rotulada `ENSAYO-WHISP-ART-A` (productor `ENSAYO-WHISP-ART`, «artificial, no es un productor») de la organización DEMO · Exportadora Pacífico; versión geométrica 1 creada por importación GeoJSON confirmada. Hash de geometría `a248c775…f27a`.

## Recorrido (una sola vez, un solo intento)
1. Credencial cifrada de la organización registrada con `PUT …/satellite/credentials/WHISP` (`e2e/review/whisp-registrar-credencial.mjs`): `configured: true`, sin devolver el valor.
2. Configuración **temporal**: `WHISP` a `SELECTED` con responsable (la cuenta de plataforma) y referencia de decisión «ENSAYO-TEMPORAL»; `SATELLITE_LIVE_CALLS=enabled` en API **y** worker (reinicio de ambos sin reconstruir).
3. Web/API: `POST …/plots/{parcela}/satellite/analyses` (`FOREST_COVER`, `operation_id` propio) → `REQUESTED` → el worker lo tomó (`attempts: 1`) → Whisp (`async`) → `COMPLETED / RESULT_AVAILABLE` en ≈9 s (`requested_at 01:49:35`, `finished_at 01:49:45`). No hubo reenvío.
4. Consulta: `GET …/satellite/analyses/{job}` y `GET …/plots/{parcela}/satellite` → 200. Descarga: `GET …/analyses/{job}/original` → 200, `application/json`, 5674 bytes, **SHA-256 `34edb8c7616724fe15f6e1125bdae7a5e9dbb1604a02842f18317a9829f25939`, idéntico al guardado** (`raw_evidence.sha256`).

## Qué se conservó
- **Identificador remoto:** guardado en `satellite_jobs.provider_job_ref` (36 caracteres; la API no lo expone, por diseño).
- **Respuesta original:** guardada y descargable (huella arriba); copia local en `validation-results/` (no versionada).
- **Huella de la petición:** `request_fingerprint 36c04d49…edd7`.
- **Procedencia:** Whisp API 2.3.1, `openforis-whisp 3.0.0a22`, análisis 2026-10-30T01:49:42Z; sin dataset, versión de dataset ni resolución declarados.
- **Cobertura:** `UNKNOWN` — el proveedor no la declara y no se presume completa. **Confianza:** no definida por el proveedor; no se infiere.
- **Indicadores** (sin interpretar; qué significa cada uno es D-07): se conservan tal cual los devolvió, incluidos `risk_pcrop: low` y `risk_acrop: low`. `conclusion: NOT_EVALUATED`: el resultado de un proveedor no se convierte en conclusión regulatoria. Un riesgo «low» de Whisp no prueba cumplimiento.
- **Límites declarados:** resultado de un proveedor externo, sin certificación; para cacao la columna relevante es `risk_pcrop`; `more_info_needed` no es resultado favorable.

## Restauración
`WHISP` volvió a `SELECTED_FOR_DEVELOPMENT` con su referencia original y sin responsable; `SATELLITE_LIVE_CALLS=disabled` en API y worker (verificado con `printenv`). **Control negativo:** un encargo nuevo se rechaza con `409 SATELLITE_REQUESTS_NOT_AUTHORIZED` y no crea trabajo. Se **conserva** la credencial cifrada de la organización (no activa llamadas) y la parcela de ensayo rotulada (los registros son *append-only*); ambas pueden retirarse (`--quitar`, baja de la parcela).

## Límites y pendientes
- Un único análisis, una geometría artificial; no mide cobertura, latencia ni coste en uso real.
- Sigue pendiente, de otras personas: catálogo de riesgo y conclusión humana (D-07), `LEGAL_PROFILE`, dato real de CAD-1027213440 y configuración geográfica revisada. Ninguno se tocó. El ensayo **no** cambia datos de DD-2026-00002 ni aprueba perfiles.
- No se rehízo el adaptador; no cambió código, por lo que no se repiten validaciones funcionales.
