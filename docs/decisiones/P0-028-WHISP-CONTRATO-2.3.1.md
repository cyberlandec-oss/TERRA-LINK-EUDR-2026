# Contrato de la API de Whisp usado por el adaptador — referencia 2.3.1 (consultada 2026-10-23)

Nueva referencia **fechada**. La de 2.3.0 (`P0-028-WHISP-CONTRATO.md`, 2026-10-15) se conserva como histórica y no se reescribe. Copia de la especificación: `docs/sources/satelite-2026-10-23/whisp-openapi-2.3.1.json` (sha256 `29ce6009…e8f3`).

| | |
| --- | --- |
| Fuente | `https://whisp.openforis.org/api/openapi.json` — versión de la especificación **2.3.1** |
| Autenticación | cabecera `x-api-key` en `/submit/*` y `/status/*`; la clave se obtiene gratis registrándose en la cuenta de Whisp |
| Sobre de toda respuesta | `{ code, message, cause?, data? }`; los errores omiten `data` |
| Alcance autorizado en Terra Link | adaptador con llamadas reales **deshabilitadas** (`SATELLITE_LIVE_CALLS`); ningún envío real autorizado |

## Diferencias respecto de 2.3.0 que corrigió el adaptador
1. **El `token`, `statusUrl`, `featureCount`, `percent` y los mensajes de proceso viajan en `data`** (202), no en la raíz. El adaptador leía la raíz: con el servicio real habría terminado en `PROVIDER_TOKEN_MISSING` en todo trabajo asíncrono. Corregido y probado con respuestas de la forma publicada.
2. En un 202 `data` es un objeto con `token`: ya no se confunde con un resultado. **El resultado es `data` = FeatureCollection** (200).
3. **408** `analysis_timeout` → plazo vencido (antes: error genérico). 400/413 `validation_*` → geometría no soportada por el proveedor, conservando el código.
4. **Fecha y versión de análisis que el proveedor declara** en `properties.whisp_processing_metadata`: `processing_timestamp_utc` (p. ej. `2026-06-11 01:59:15+0000`) y `whisp_version`. La fecha se guarda como `analysis_date` solo si es válida; si no, nula. La fecha en que Terra Link guarda el resultado es otra y se muestra aparte («Guardado en Terra Link»).
5. Códigos nuevos en `SystemCode`: `analysis_cancelled`, `analysis_cancel_invalid`, `analysis_too_many_concurrent`, `validation_*` (geometría, CRS, metros, tamaño) — sin uso especial: cualquier código no listado como completado es un desenlace sin resultado.

## Flujo (verificado contra la especificación; sin llamada real)
`GET /api/config` (sin clave: límites `maxRequestBodySizeKb`, `maxPlotAreaHa`, `geometryLimitSync/Async`, `analysisTimeout*Seconds`, `openforisWhispVersion`) → `POST /api/submit/geojson` (`analysisOptions.async` por omisión `false`; **200** con resultado o **202** `analysis_queued` + `data.token`) → `GET /api/status/{token}` (**202** `analysis_processing` + `data.percent`; **200** `analysis_completed` + `data` FeatureCollection; **408/500/404** `analysis_timeout`/`analysis_error`/`analysis_job_not_found`) → opcional `GET /api/generate-geojson/{token}` (el proveedor conserva el resultado poco tiempo: **Terra Link guarda su propia copia** con la respuesta original y su huella).
Cabeceras opcionales `x-ee-project`, `x-ee-token`, `x-ee-service-account` (cuenta propia de Earth Engine): **no se usan**.

## Qué metodología aplica al cacao y qué se devuelve
- Documentación oficial (README del repositorio `forestdatapartnership/whisp`): los cultivos **perennes** —café, **cacao**, caucho, palma— usan la columna de riesgo **`Risk_PCrop`** («Perennial crop deforestation risk»); la soja usa `Risk_ACrop`. En la respuesta de la API 2.3.1 la columna aparece como **`risk_pcrop`**. Los umbrales por defecto son el 10 % del área de la parcela (50 % para commodities en 2020 y perturbaciones anteriores a 2020) y se pueden cambiar en `whisp_risk`. Corte: 2020-12-31.
- Columnas de ejemplo que publica la especificación: `Area`, `Country`, `Unit`, `In_waterbody`, `GFC_TC_2020`, `Forest_FDaP`, **`Cocoa_FDaP`**, `Ind_01_treecover`, `Ind_02_commodities`, `Ind_03_disturbance_before_2020`, `Ind_04_disturbance_after_2020`, `risk_pcrop`, `whisp_processing_metadata`. Qué columnas llegan realmente depende del servicio en ese momento: **Terra Link guarda y muestra solo las que el proveedor devolvió**.
- **No declarados** (quedan nulos, no se inventan): versión de cada dataset, resolución, cobertura, confianza. La documentación de apoyo no los define por resultado.
- `more_info_needed` = evidencia insuficiente, **no** un resultado favorable. Whisp no certifica nada.
- **Pendiente de comprobar con una respuesta real**: el mapa exacto commodity→columna del servicio desplegado y qué datasets de cacao intervienen (`layers_description.md` los describe; el nombre `Cocoa_FDaP` aparece en el ejemplo de la API pero no está definido en el README). Hasta una respuesta real, Terra Link no afirma qué mide cada columna.

## Credenciales y términos (qué falta, exactamente)
Los términos de Whisp piden «refrain from submitting any personally identifiable information including sensitive personal data» y dicen que FAO no conserva la geometría y envía a Earth Engine solo información aproximada. Terra Link envía **solo la geometría** (`properties` vacío: sin nombre, código ni identificador). Eso **no** convierte en no sensible una geometría de una parcela real: sigue clasificada como dato sensible (`plot:read_geometry`) y su envío real sigue siendo una decisión del propietario (D-09 parte B). Para demostrar la integración **no hace falta** enviar ninguna parcela real: basta una geometría artificial (`e2e/review/whisp-ensayo-real.mjs`).
Para ejecutar ese ensayo faltan **exactamente dos cosas, ambas del propietario**: (1) una **clave de API de Whisp** (cuenta en `https://whisp.openforis.org` con inicio de sesión FAO; valida 365 días, una activa) y (2) su **autorización expresa**, habiendo aceptado él los términos, para enviar esa geometría artificial (`WHISP_ENSAYO_AUTORIZADO`). Para usarlo desde la plataforma además: `SATELLITE_LIVE_CALLS=enabled` temporal, registrar la clave como credencial de la organización y marcar `WHISP` como `SELECTED` con responsable (D-09 B). Nada de esto es una revisión jurídica pendiente que impida terminar el código: el código y los contratos están completos y probados con un servidor controlado.

## AJ-06 — Trabajo asíncrono completo y credencial por organización (2026-10-23)
- **Se pide trabajo asíncrono** (`analysisOptions.async: true`): es el único con avance consultable, identificador reanudable y cancelación. El adaptador conserva el identificador (`satellite_jobs.provider_job_ref`, migración `0067`; no se expone por la API), el último avance declarado (`percent` solo si el proveedor lo informó, mensaje y hora) y renueva el arrendamiento del corredor mientras avanza.
- **Reintento**: si el trabajo ya tenía identificador, se retoma `GET /api/status/{token}` **sin volver a enviar la geometría**; si el proveedor ya no lo reconoce (resultados temporales), se envía de nuevo y se guarda el identificador nuevo.
- **Cancelación**: sobre un trabajo pendiente cancela en Terra Link; sobre uno **en curso** registra la petición (quién, cuándo, motivo) y el corredor, en su siguiente consulta, llama `POST /api/status/{token}/cancel`. `200`/`404` ⇒ `CANCELLED` sin resultado; `409 analysis_cancel_invalid` ⇒ el trabajo ya había terminado y se recoge su resultado.
- **Credencial por organización** (la que usa el worker): `PUT /api/v1/organizations/{org}/satellite/credentials/WHISP` con `{ "secret": "…" }` (permiso `integration:manage`; `GET` y `DELETE` en la misma ruta). Se cifra con el contexto `satellite_credentials:{org}:WHISP`, no se devuelve, no se registra y se audita sin su valor. Atajo: `TL_EMAIL=… TL_PASSWORD=… node e2e/review/whisp-registrar-credencial.mjs --org <uuid>` lee `WHISP_API_KEY` de `.env`. Registrarla **no** activa llamadas reales.
- Para el recorrido completo desde la plataforma hacen falta además, y solo durante el ensayo: `SATELLITE_LIVE_CALLS=enabled` y `WHISP` en `SELECTED` con responsable (D-09 B), que **no** se han tocado.
