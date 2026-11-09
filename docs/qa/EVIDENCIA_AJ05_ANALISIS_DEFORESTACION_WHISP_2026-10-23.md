# Evidencia — AJ-05: análisis de deforestación (Whisp 2.3.1) — 2026-10-23

Verifica y completa el análisis satelital: adaptador contra el contrato oficial vigente, procedencia visible y recorrido guardado/consultable. **No** se llamó al servicio real de Whisp, **no** se envió ninguna geometría, **no** se aceptaron términos ni se registró cuenta. Coberturas 42/60 y 30/44 sin cambio. Contrato: `docs/decisiones/P0-028-WHISP-CONTRATO-2.3.1.md`.

## Cuatro cosas que no deben confundirse
| Qué | Estado | Evidencia |
| --- | --- | --- |
| Cartografía de orientación (mapa/polígono) | Existe; **no** es un análisis | leyenda en la tarjeta de la parcela |
| Fixture / respuesta simulada | Existe, rotulada ENSAYO | pruebas A-01; separada de lo operativo |
| Consulta real al proveedor | **NO EJECUTADA** (faltan clave y autorización del propietario) | — |
| Resultado guardado y consultable | Mecanismo **demostrado con un servidor controlado** (respuesta sintética con la forma 2.3.1) | `satellite.int-spec.ts` (Whisp 2.3.1), `whisp.spec.ts` |

## Hallazgos de la comparación con la documentación oficial
La especificación publicada pasó de 2.3.0 a **2.3.1** y el adaptador no coincidía en cuatro puntos: (1) `token`/`percent`/`statusUrl`/mensajes viajan en `data`, no en la raíz → con el servicio real todo trabajo asíncrono habría fallado con `PROVIDER_TOKEN_MISSING`; (2) un 202 trae `data` objeto que se habría tomado por resultado; (3) 408 `analysis_timeout` y `validation_*` caían en error genérico; (4) el proveedor sí declara fecha (`processing_timestamp_utc`) y versión (`whisp_version`) y se descartaban. Los tests anteriores usaban la forma antigua, por lo que pasaban sin detectarlo: ahora usan la forma publicada.

## Cambios
- `whisp.ts`: contrato 2.3.1; token/estado en `data`; `isFeatureCollection`; `outcomeFromResponse` (408, `validation_*`); fecha de análisis **solo** la declarada por el proveedor (nula si falta o es inválida); versión declarada en el método; limitaciones con la columna de riesgo de cacao (`risk_pcrop`) y el significado de `more_info_needed`.
- Tarjeta de parcela: origen del resultado (fixture / consulta real guardada), fecha declarada vs. guardado en Terra Link, periodo, datasets no disponibles, tabla «Valores devueltos por el proveedor (sin interpretar)» (ausente = «No informado», nunca 0), leyenda de los cuatro conceptos; EN.
- Sin migración: la procedencia ya se guardaba (proveedor, versión geométrica y huella, fechas, método, indicadores, respuesta original con SHA-256).
- `e2e/review/whisp-ensayo-real.mjs`: ensayo con **geometría artificial**; se niega sin clave y sin autorización expresa; `--simular` no abre red. Verificado solo su negativa y su simulación.

## Pruebas
- `whisp.spec.ts` (19, servidor TLS controlado, forma 2.3.1) y resto de `src/satellite` (50 en total).
- `satellite.int-spec.ts` (31): encargo → corredor → 202 → estado → resultado → guardado con fecha declarada, método, indicadores, respuesta original, conclusión NOT_EVALUATED, sin credencial ni coordenadas; consulta repetida; error del proveedor ⇒ trabajo FALLIDO, **sin** resultado.
- `e2e/tests/satelite-resultado-proveedor.spec.ts` (4; API simulada en el navegador): resultado guardado, en curso, fallido (sin valores, sin «sin deforestación»), inglés.
- `90205a8`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T15-41-03-942Z`; integración 2 434 s, e2e 509 s). Desplegado `90205a8`, esquema `0066` (sin migración: sin respaldo nuevo).
- Demostración desplegada `node e2e/review/satelite-estado-demostracion.mjs`: **4/4**, solo lectura (trabajos/resultados/credenciales 10/8/0 antes y después): llamadas reales deshabilitadas, Whisp «solo adaptador de desarrollo», sin botón de solicitud, ningún resultado real.

## Qué falta, exactamente, para la prueba real (no es «falta revisión jurídica»)
1. **Clave de API de Whisp** del propietario (cuenta en `whisp.openforis.org`, inicio de sesión FAO; 365 días, una activa).
2. **Su autorización expresa**, tras aceptar él los términos, para enviar **una geometría artificial** (`WHISP_ENSAYO_AUTORIZADO`).
Para usarlo desde la plataforma: `SATELLITE_LIVE_CALLS=enabled` temporal, credencial de la organización y `WHISP` en `SELECTED` con responsable (D-09 B). Los términos piden no enviar datos personales; la geometría de una parcela real sigue tratándose como sensible aunque no lleve nombres: no se envía ninguna.

## Pendiente
Prueba real contra Whisp (arriba); confirmar con una respuesta real el mapa commodity→columna y los datasets de cacao; D-07 (interpretación de indicadores) y D-09 B.
