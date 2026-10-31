# Procedencia de los registros DEMO creados por las revisiones de P0-026

Base de **desarrollo local** `terra_link`, organización «DEMO · Cooperativa Río Verde». Se conservan a propósito: son la
huella real de las revisiones en navegador y no se borran para ocultar el ensayo. Datos sintéticos, rotulados «(demo)».
No son datos de ninguna asociación real.

## Productores (revisión del 2026-10-11, `e2e/review/importaciones.mjs`)

| Código | Estado | Creado (UTC) | Lote de importación | Fila | Archivo (SHA-256) |
| --- | --- | --- | --- | --- | --- |
| `DEMO-IMP-001` | BORRADOR | 2026-10-12 01:37 | `40baaf7a-dbc1-4c6d-9882-d1e1b2050ce1` | 2 | `demo-importacion-productores.xlsx` (`d6eeb1d3d832532867c8d055467c7c458e01904b8ab8480e866f09f9e947b607`) |
| `DEMO-IMP-002` | BORRADOR | 2026-10-12 01:37 | `40baaf7a-dbc1-4c6d-9882-d1e1b2050ce1` | 3 | idem |

Confirmación hecha **con teclado** por la cuenta DEMO de administración de la cooperativa (captura
`docs/qa/capturas/importacion/04-admin-resultado.png`). Cada uno tiene versión `IMPORT_CREATE` con el lote y la fila en el
motivo, evento `ProducerRegistered` con `source.kind = EXCEL_IMPORT` y auditoría. Siguen en BORRADOR: nadie los activó.

## Productos (revisión del 2026-10-12, `e2e/review/importaciones-productos.mjs`)

| Código | Estado | Unidad | Lote de importación | Fila | Archivo (SHA-256) |
| --- | --- | --- | --- | --- | --- |
| `DEMO-IMP-CACAO-SECO` | ACTIVO | KG | `c822af85-19ab-4364-893e-035b3c7b1735` | 2 | `demo-importacion-productos.xlsx` (`95e520cbe366e0907782ae83d1966940e676b17f316a0dbec2d31d8d4f428e12`) |
| `DEMO-IMP-CACAO-BABA` | ACTIVO | KG | `c822af85-19ab-4364-893e-035b3c7b1735` | 3 | idem |

Confirmación hecha **con teclado** (captura `p04-admin-resultado-productos.png`). Versión `CREATED` con el lote y la fila en
el motivo, evento `ProductCreated` con `source.kind = EXCEL_IMPORT` y auditoría. Quedan en el catálogo DEMO de la cooperativa.

## Parcelas (revisión del 2026-10-12, `e2e/review/importaciones-parcelas.mjs`)

| Código | Estado | Productor | Lote de importación | Fila | Versiones | Archivo (SHA-256) |
| --- | --- | --- | --- | --- | --- | --- |
| `DEMO-IMP-PAR-001` | ACTIVA | `DEMO-RV-008` | `54b85f91-b002-41cb-a3ca-4c7322766b37` | 2 | 1 · DECLARED, sin geometría, 1.7500 ha declaradas, NOT_VALIDATED | `demo-importacion-parcelas.xlsx` (`33a2f69e3f56bf4211c870fc66c165cba3fef2ca848b9ed1f3336ca0ac74614c`) |
| `DEMO-IMP-PAR-002` | ACTIVA | `DEMO-RV-008` | idem | 3 | ninguna al importar (sin superficie: no se inventa); el 2026-10-12 recibió una versión DECLARED de 1.2 ha desde «Mi trabajo» en la revisión de P0-027 | idem |

Confirmación hecha **con teclado** (captura `pa04-admin-resultado-parcelas.png`). La columna sintética «coordenadas_campo»
del archivo no se mapeó ni se importó. Historial con el lote y la fila en el motivo; eventos `PlotRegistered` y
`PlotGeometryVersionCreated` con `source`.

## Entregas (revisión del 2026-10-12, `e2e/review/importaciones-entregas.mjs`)

| Código | Estado | Productor | Notas | Archivo |
| --- | --- | --- | --- | --- |
| `ENT-2026-00004` | BORRADOR | `DEMO-RV-008` | «Entrega importada (demo) A»: CACAO_SECO, centro DEMO-CA-01, 180.5 KG declarados, periodo MONTH 2026-09, orígenes DEMO-IMP-PAR-001 (100 KG) y DEMO-IMP-PAR-002 | `demo-importacion-entregas.xlsx` (sintético) |
| `ENT-2026-00005` | BORRADOR | `DEMO-RV-008` | «Entrega importada (demo) B»: periodo UNKNOWN, sin cantidad | idem |

Confirmación hecha **con teclado** (captura `en04-admin-resultado-entregas.png`). No se registraron: sin recepción, pesaje,
muestra, movimiento de inventario, compuerta de registro ni evento de entrega (comprobado en la base por la revisión).

Tras la migración 0035 ambos conservan su procedencia como referencias `LEGACY_CONTENT_FINGERPRINT` (`HUELLA-…`, filas 2 y 3).

### Entregas con referencia (revisión del 2026-10-12, segunda ejecución)

`ENT-2026-00006` y `ENT-2026-00007` (BORRADORES, productor `DEMO-RV-008`, notas «Entrega importada (demo) C»), referencias
`DEMO-REF-C` y `DEMO-REF-D`. Dos filas con las mismas notas y distinta referencia: dos entregas. Sin efectos físicos.

## Lotes (revisión del 2026-10-12, `e2e/review/importaciones-lotes.mjs`)

`LOT-2026-00004` (ABIERTO, origen conocido), referencia `DEMO-IMP-LOTE-1`: 20 kg de la recepción ya confirmada de
`ENT-2026-00001` (la recepción pasó de 50 a 30 kg sin lote, movimiento `LOT_ASSIGN` del ledger). No se crearon recepciones ni
stock. Confirmación hecha con teclado (captura `lo04-admin-resultado-lotes.png`).

## Cómo comprobarlo

```sql
-- productores y productos importados, con su lote y fila de origen
SELECT coalesce(p.producer_code, pr.code, pl.plot_code, d.delivery_code) AS codigo, r.batch_id, r.row_number, r.result_action, b.template, b.sha256
FROM import_rows r JOIN import_batches b ON b.id = r.batch_id
LEFT JOIN producers p ON p.id = r.producer_id LEFT JOIN products pr ON pr.id = r.product_id LEFT JOIN plots pl ON pl.id = r.plot_id LEFT JOIN deliveries d ON d.id = r.delivery_id
WHERE r.result_action = 'CREATED' ORDER BY b.created_at, r.row_number;
```
