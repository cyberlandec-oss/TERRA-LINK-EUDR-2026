# Contrato de la API de Whisp usado por el adaptador (consultado 2026-10-15)

Referencia **fechada** del contrato con el que se implementó el adaptador. Si el proveedor publica otra versión, se
registra otra referencia y se revisa el adaptador; no se «ajusta» este documento para que encaje.

| | |
| --- | --- |
| Fuente | `https://whisp.openforis.org/api/openapi.json` (especificación OpenAPI publicada por el proveedor) |
| Versión de la especificación | **2.3.0** |
| Consultado | **2026-10-15** |
| Documentación de apoyo | `https://github.com/forestdatapartnership/whisp` · `https://www.openforis.org/whisp-faqs/` |
| Alcance autorizado | **D-09 parte A**: adaptador de desarrollo. **No** autoriza llamadas al servicio real, envío de geometrías, registro de claves reales, contratación ni aceptación de términos |

## Endpoints usados por el adaptador

| Método y ruta | Para qué | Autenticación |
| --- | --- | --- |
| `GET /api/config` | Límites declarados por el proveedor **antes** de enviar nada | — |
| `POST /api/submit/geojson` | Envío de la geometría y las opciones de análisis | cabecera `x-api-key` |
| `GET /api/status/{token}` | Consulta del estado de un trabajo asíncrono | cabecera `x-api-key` |
| `GET /api/generate-geojson/{token}` | Descarga del resultado cuando no viene en la respuesta de estado | — (documentado sin autenticación) |

Endpoints publicados que el adaptador **no** usa: `/api/submit/wkt`, `/api/submit/geo-ids` (exige además
`x-geoid-token`), `/api/status/{token}/cancel`, `/api/status/{token}/stream`, `/api/download-csv/{token}`,
`/api/health`.

## Campos del contrato (nombres exactos de la especificación)

**`GET /api/config` → `PublicConfigResponse`**: `maxRequestBodySizeKb` (entero o nulo), `maxPlotAreaHa` (entero o
nulo), `geometryLimitSync` (entero), `geometryLimitAsync` (entero), `analysisTimeoutSyncSeconds` (entero),
`analysisTimeoutAsyncSeconds` (entero), `openforisWhispVersion` (texto), `geoidBaseUrl` (texto o nulo).

**`POST /api/submit/geojson` → `SubmitGeoJsonRequest`**: el GeoJSON más `analysisOptions`
(`externalIdColumn`, `unitType`, `nationalCodes`, `async` —por omisión `false`—, `geometryAuditTrail`).
Respuesta **200** con el análisis en `data.features[]`; respuesta **202** con `token`, `statusUrl`, `featureCount` y
`processStatusMessages`.

**`GET /api/status/{token}`**: `token`, `percent` (con 202), `processStatusMessage`, y `data` cuando termina.
Valores de `code` (enumeración `SystemCode`): `analysis_queued`, `analysis_processing`, `analysis_completed`,
`analysis_error`, `analysis_timeout`, `analysis_job_not_found`.

## Lo que el proveedor declara sobre datos ausentes

Citas literales del repositorio oficial (consultado 2026-10-15):

> «Occasionally a dataset can't be read from Earth Engine (an asset has moved or gone empty). Rather than failing the
> whole run, Whisp skips it and records its name in the `whisp_processing_metadata` column, under
> `unavailable_datasets`.»

> «If a skipped dataset is one the risk assessment uses, `whisp_risk` warns and also lists it under
> `risk_inputs_unavailable` in the same column, meaning the risk columns were worked out without that dataset.»

**Consecuencia directa para el adaptador** (y la razón por la que esto está escrito aquí): un trabajo terminado y un
`200` **no significan análisis completo**. El adaptador conserva `whisp_processing_metadata` tal cual y, si
`unavailable_datasets` o `risk_inputs_unavailable` traen algo, el resultado se guarda como **cobertura parcial** con
la lista de lo que faltó.

## Lo que el contrato NO declara (y por tanto el adaptador no inventa)

- **No hay campo de cobertura.** Que no se informen datasets ausentes **no** equivale a cobertura completa: por eso el
  caso sin incidencias se guarda como `UNKNOWN`, nunca como `COVERED`.
- **No hay fecha de análisis** en la respuesta: `analysis_date` queda **nulo**. La fecha en que Terra Link guardó el
  resultado es otra cosa y vive en `recorded_at`.
- **No hay resolución ni confianza** en la respuesta: ambos quedan **nulos**. Que la documentación de apoyo mencione
  un muestreo a 10 m no autoriza a escribirlo como si lo hubiera dicho la respuesta.
- **No hay versión de dataset**: `dataset` y `dataset_version` quedan nulos. La versión del software del proveedor
  (`openforisWhispVersion`) sí se conserva, como parte del método, porque el proveedor sí la declara.
- Whisp **no certifica nada**: «You can use Whisp to support due diligence reports, but there is no certification
  involved» (FAQ oficial). Su salida «More info needed» significa evidencia insuficiente, no resultado favorable.
