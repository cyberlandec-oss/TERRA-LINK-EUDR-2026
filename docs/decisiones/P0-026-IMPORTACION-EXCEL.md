# P0-026 — Importación Excel: decisiones de implementación (2026-10-11)

Estado: **implementado para la plantilla de productores**; historia **ABIERTA** (ver «Pendiente»). Fuentes: S1 §§61–63,
S3 §§15–16, RF-26, QA-03, docs/09 «Importación», docs/UX_UI §20.3. Estas decisiones son de diseño local; no son
validación de campo ni conformidad EUDR.

## Alcance implementado

- **Plantilla `PRODUCTORES_V1`** (S1 §62 «producers.xlsx»): solo los campos que ya existen en la entidad productor
  (P0-004). Ningún campo inventado. Descargable (`.xlsx` con hoja de instrucciones) y con reglas en JSON para la UI.
- **No implementadas** (S1 §62): parcelas, entregas, productos y lotes. Motivos: parcelas exigen geometría (P0-009 ya
  cubre GeoJSON; un Excel sin geometría no debe inventarla) y perfil D-05; entregas mueven recepción e inventario
  (P0-012/P0-017) y sus estados y pendientes deben conservarse; productos y lotes tienen casos de uso propios que aún no
  se han expuesto a importación. Importar un registro **no** confirmaría recepción, calidad, inventario ni debida diligencia.

## Flujo y reglas

| Paso | Regla |
| --- | --- |
| Carga | `.xlsx` ≤ 2 MB, ≤ 5000 filas, ≤ 50 columnas. ZIP comprobado sobre bytes reales descomprimidos (entrada ≤ 16 MB, total ≤ 40 MB, razón ≤ 200). Sin ZIP64 ni cifrado. Macros (`vbaProject.bin`, macroEnabled) → rechazo. DOCTYPE/ENTITY → rechazo. No se guarda el original: SHA-256, tamaño y nombre. Celdas cifradas por fila (AAD organización/lote/fila). `operation_id` idempotente. |
| Mapeo | Explícito, columna → campo. Las sugerencias por nombre de encabezado se muestran pero solo se aplican si la persona las acepta y guarda. Cada campo una vez; `codigo_productor` obligatorio. Campos de identidad solo con `producer:read_identity`. |
| Vista previa | Solo lectura, calculada en vivo con datos y permisos actuales. No crea ni modifica entidades. Devuelve `plan_hash`. |
| Confirmación | Atómica. Revalida permiso `import:manage`, permisos y alcance de productor, versiones (filas bloqueadas `FOR UPDATE`) y exige el mismo `plan_hash`. Idempotente por `operation_id`. |
| Resultado | Creados / actualizados / sin cambios / fallidos; informe `.xlsx` por fila sin valores de identidad. |

**Clave de reimportación**: `producer_code` dentro de la organización (único por tenant, P0-005). Código inexistente → alta;
existente → actualización de los campos mapeados; si nada difiere → «sin cambios» (sin versión, evento ni auditoría de
entidad). Reimportar el mismo archivo no duplica entidades ni efectos.

**Columna ausente / celda vacía / petición explícita**:
- Campo sin mapear → `NOT_MAPPED` (calidad `UNKNOWN`): no cambia.
- Celda vacía → `MISSING`: no cambia (no borra por omisión).
- `#BORRAR` → `CLEAR`: vacía el campo, sujeto a las mismas reglas (nombre o razón social, par de documento).
- Celda con valor → `PROVIDED` (calidad `LEGACY`, `validation_status NOT_VALIDATED`). Importar nunca produce `VERIFIED`.

**Atomicidad (decidida en backend, mostrada antes de confirmar)**: todo el lote o nada. Una sola fila con error impide
confirmar; se corrige el archivo y se vuelve a cargar. Si algo cambió desde la vista previa (`PREVIEW_STALE`) o hubo un
cambio concurrente (`IMPORT_CONCURRENT_CHANGE`), la transacción se revierte entera y el lote sigue «mapeado».

**Altas en BORRADOR**: dato heredado no validado; activarlo es `producer:archive` (decisión de gestión ya existente).
Responsable por defecto: el mismo criterio que el alta manual.

**Casos de uso reutilizados**: `ProducersService.createInTx` / `updateInTx` (extraídos de `create`/`update` sin cambiar su
comportamiento): alcance, estado, versión esperada, permiso de identidad, cifrado, `producer_versions` (`IMPORT_CREATE` /
`IMPORT_UPDATE` con motivo que cita lote y fila), eventos `ProducerRegistered` / `ProducerUpdated` con `source`
(`EXCEL_IMPORT`, lote, fila), auditoría y detección de posibles duplicados (P0-005, nunca fusiona).

**Referencias**: un código existente fuera del alcance de lectura → `CODE_NOT_AVAILABLE` sin id, datos ni estado (la
unicidad del código por organización ya revela que el código está ocupado, igual que el alta manual). Productor dado de
baja → error de fila; no se reactiva por importación. Lotes de otra organización → 404.

**Permiso nuevo** `import:manage` (catálogo `2026-10-11.20`): ORG_ADMIN y MANAGER. No concede nada sobre entidades.

## Plantilla de productos `PRODUCTOS_V1` (2026-10-12)

Mismo pipeline (carga, mapeo explícito, vista previa, errores por fila, confirmación atómica, informe). Diferencias:

- **Campos**: solo los de la entidad producto (P0-011): `codigo_producto` (clave), `nombre`, `estado_presentacion`,
  `unidad`, `nombre_cientifico`, `variedad`. El estado ACTIVO/INACTIVO no se importa (activar/desactivar es un caso de uso
  con motivo).
- **Catálogos reales**: estado/presentación ∈ `product_states` y unidad ∈ `measurement_units` (hoy solo `KG`), por
  **código exacto**. «kg» o «LB» son errores de fila: no hay equivalencias ni conversiones (D-32).
- **Inmutables**: código, estado/presentación y unidad no cambian después del alta. En una reimportación, un valor distinto
  es `PRODUCT_FIELD_IMMUTABLE` en esa fila y el lote entero no se puede confirmar (sin escritura parcial). Un valor igual se acepta.
- **Obligatorios de alta**: nombre, estado/presentación y unidad (`REQUIRED_FOR_CREATE`); en una actualización, la celda
  vacía no cambia nada.
- **#BORRAR** solo en opcionales editables (nombre científico, variedad); en nombre, estado o unidad → `CANNOT_CLEAR`.
- **Desactivados**: `PRODUCT_INACTIVE`; ni se reactivan ni se editan.
- **Altas ACTIVAS**, igual que el alta manual de P0-011.
- **Procedencia** conforme al modelo existente: `product_versions.change_type` sigue siendo `CREATED`/`UPDATED` (su CHECK
  no admite otros valores y no se cambió); la procedencia va en `product_versions.reason` («Importación Excel <lote> · fila
  <n>») y en `source` del evento `ProductCreated`/`ProductUpdated` y de la auditoría. Sin cambios → sin versión ni evento.
- **Autorización**: la plantilla exige `product:manage` además de `import:manage` para plantilla, carga, mapeo, vista
  previa, informe, confirmación y para ver sus lotes; cada fila vuelve a comprobarlo. MANAGER (tiene `import:manage`, no
  `product:manage`) recibe 403 y la UI le muestra «Productos» deshabilitado con el motivo.
- **Casos de uso reutilizados**: `ProductsService.createInTx` / `updateInTx`, extraídos de `create`/`update` sin cambiar su
  comportamiento (catálogo, inmutables, inactivo, versión esperada, versión, evento, auditoría).
- **Migración 0031** (amplía 0030 sin reescribirla): plantilla `PRODUCTOS_V1` e `import_rows.product_id` (FK compuesta
  mismo tenant; una fila apunta a un productor o a un producto, nunca a ambos).

## Protecciones de productores revisadas (2026-10-12)

- Código inexistente que el rol no puede crear y código ocupado fuera del alcance de lectura devuelven **la misma**
  respuesta (`CODE_NOT_AVAILABLE`, mismo mensaje, columna y campo), sin id, datos ni estado del productor. Antes, el primer
  caso respondía `PERMISSION_DENIED_CREATE` y era distinguible. Si el rol sí puede crear, un código ocupado sigue siendo
  distinguible de uno libre, exactamente como en el alta manual (la unicidad por organización es del contrato P0-005).
- Probado con **fixtures de autorización** (`test/imports-authz-fixtures.int-spec.ts`): permisos sintéticos sustituidos en
  memoria en `AuthorizationService.tenantContext` para dos usuarios de prueba. No se cambió ningún rol de producción ni la
  base de datos de roles.

## Plantilla de parcelas `PARCELAS_V1` (2026-10-12)

- **Campos**: los de la entidad parcela (P0-006): `codigo_parcela` (clave), `codigo_productor`, `nombre`, `cultivo`,
  `variedad`, `uso_suelo`, `provincia`, `canton`, `parroquia`, y la superficie **declarada** `superficie_declarada_ha`.
- **Geometría: no se importa.** La plantilla no tiene columnas de coordenadas ni de geometría; la geometría se registra
  con sus flujos existentes (coordenadas manuales, GPS, polígono, GeoJSON de P0-009), que ya validan tipo, ejes y CRS sin
  reproyectar ni reparar. La geometría existente nunca se modifica ni se sustituye.
- **Superficie declarada**: hectáreas, > 0, punto decimal, hasta 4 decimales; «2,5» es error de formato (no se interpreta).
  Usa el caso de uso `updateDeclaredAreaInTx` (el mismo del formulario; ver `SUPERFICIE-DECLARADA-CONSERVA-GEOMETRIA.md`):
  versión nueva `NOT_VALIDATED` que **conserva la geometría vigente** si existe (no es una captura nueva) y no hereda
  evaluaciones GIS. Las versiones anteriores no cambian. Superficie declarada y calculada siguen separadas. Una parcela
  nueva sin superficie queda sin versión (no se inventa). Importar no valida ni cumple D-05. (Hasta el 2026-10-12 la
  importación rechazaba la superficie en parcelas con geometría con `DECLARED_AREA_WITH_GEOMETRY`; ya no.)
- **Productor**: por su código exacto en la organización (único por tenant, P0-005), nunca por parecido; no se crean
  productores. Inexistente, fuera del alcance de alta o de otra organización → misma respuesta `PRODUCER_NOT_AVAILABLE`.
  Productor dado de baja → `PRODUCER_INACTIVE` (solo dentro del alcance, como en el alta manual). En una parcela existente
  el código debe coincidir: la importación no reasigna (`PLOT_PRODUCER_CHANGE_NOT_ALLOWED`).
- **Parcela**: código existente fuera del alcance de lectura y código inexistente con un rol sin alta → misma respuesta
  `CODE_NOT_AVAILABLE`. Parcela dada de baja: ni se reactiva ni se edita.
- **#BORRAR**: nombre, variedad, uso del suelo, provincia, cantón y parroquia. No en cultivo, productor ni superficie.
- **Autorización**: `import:manage` más permiso de parcela (`plot:create`/`plot:create_assigned`/`plot:update`/
  `plot:update_assigned`), con su alcance por asignación del productor, revalidado al confirmar (bloqueo de filas). Las
  muestras de columnas no mapeadas exigen `plot:read_geometry` y `producer:read_identity` (una columna suelta puede traer
  coordenadas o datos personales). Ni la vista previa, ni el informe, ni eventos, ni auditoría llevan coordenadas.
- **Casos de uso reutilizados**: `PlotsService.createInTx`, `updateInTx` (extraídos de `create`/`update` sin cambiar su
  comportamiento) y `updateDeclaredAreaInTx` (superficie declarada que conserva la geometría). Procedencia en el motivo del historial, `notes` de la versión, `source` del evento y auditoría.
- **Migración 0032** (amplía 0030/0031): plantilla `PARCELAS_V1` e `import_rows.plot_id` (FK compuesta mismo tenant).

## Plantilla de entregas `ENTREGAS_V1` (2026-10-12)

- **Alcance**: solo **borradores** (P0-012), con los casos de uso `DeliveriesService.createDraftInTx` / `updateDraftInTx`
  (extraídos de `create`/`update` sin cambiar su comportamiento: referencias, cantidad positiva con unidad explícita,
  periodo, compuerta `DELIVERY_DRAFT_SAVE`, auditoría). **No** registra la entrega ni confirma recepción, pesaje, calidad,
  inventario, cierre ni debida diligencia; no emite eventos de entrega. Registrar sigue siendo una acción explícita desde
  la entrega, con sus compuertas. Las decisiones D-33/D-34/D-35 no cambian.
- **Campos** (los del borrador): código de entrega, productor, producto, centro (por código exacto), fecha de entrega
  (texto AAAA-MM-DD), cantidad **declarada** con unidad (solo `KG`, sin conversiones; el peso recibido no se importa),
  periodo de cosecha (`DAY`/`MONTH`/`UNKNOWN`, inicio y fin, guardado **como se declara**: día, intervalo de días, mes,
  intervalo de meses o desconocido; validado con `harvestColumns` del contrato), parcelas de origen del productor con
  cantidad opcional, notas. El periodo **nunca** se deduce de la fecha de entrega.
- **Soportes**: no se importan (exigen la versión exacta de un documento y permiso de documentos); se vinculan desde la
  entrega. Vincular no implica revisión ni aprobación.
- **Clave**: el código asignado por el sistema (`ENT-AAAA-NNNNN`, único por organización) para actualizar un borrador.
  Una fila sin código crea una entrega nueva cuyo `operation_id` (idempotencia del contrato) es una **huella** del
  contenido mapeado de la fila: reimportar la misma fila no vuelve a crearla (`ALREADY_IMPORTED`). Dos filas sin código
  idénticas en un archivo son ambiguas → error en ambas. Cambiar una fila sin código crea otra entrega: para actualizar,
  usa el código que devuelve el informe.
- **Entregas registradas**: una fila igual a lo registrado → «sin cambios»; distinta → error `DELIVERY_REGISTERED` que
  remite a la corrección de la entrega (nunca se elude).
- **Reimportación**: celda vacía o columna no asociada no cambian; `#BORRAR` solo en campos opcionales del borrador
  (producto, centro, fecha, cantidad, unidad, periodo, orígenes, notas); el productor no se cambia.
- **Autorización**: `import:manage` + `delivery:create` o `delivery:create_assigned` (alcance por asignación del
  productor), revalidados al confirmar con bloqueo de filas. Productor inexistente o fuera de alcance, y entrega
  inexistente o fuera de alcance, responden igual. Recepción (tiene `delivery:create`, no `import:manage`) → 403.
- **Migración 0034**: plantilla `ENTREGAS_V1` e `import_rows.delivery_id` (FK compuesta mismo tenant).

## Identidad de entregas importadas (corrección 2026-10-12)

La huella de contenido de 0034 **no** demuestra que dos filas sean la misma entrega (dos entregas legítimas pueden tener
datos idénticos). Desde la migración 0035 las altas sin código exigen una **referencia de importación**
(`referencia_importacion`, tabla `import_references`, append-only, única por organización y plantilla), separada de los datos
de negocio: misma referencia → misma entrega (reimportar no duplica; puede actualizar el borrador); referencias distintas con
contenido idéntico → entregas distintas. Sin código ni referencia, la vista previa pide resolverlo (`REFERENCE_REQUIRED`);
nunca se fusiona por parecido o igualdad de contenido. Los borradores importados antes conservan su procedencia como
referencia `LEGACY_CONTENT_FINGERPRINT` (`HUELLA-<operation_id>`, con lote y fila de origen). La edición exige el alcance de
escritura (`delivery:create` o `_assigned` sobre el productor): leer todas las entregas no concede editarlas.

## Plantilla de lotes `LOTES_V1` (2026-10-12)

- **Operaciones del contrato** (P0-016/P0-017): crear un lote con recepciones **confirmadas** y asignar recepciones a un
  lote **abierto**, con `LotsService.createLotInTx` / `assignInTx` (el endpoint de alta usa el mismo caso de uso):
  disponibilidad recalculada en el ledger con la recepción bloqueada, límites, mezcla de producto u origen bloqueada,
  movimientos `LOT_ASSIGN`, eventos `LotCreated`/`LotInputAssigned` y auditoría. No crea recepciones, stock ni origen.
- **Fila** = una asignación: código del lote existente o referencia de importación de un lote nuevo (varias filas con la
  misma referencia = un lote), id exacto de la recepción (la plantilla trae la hoja `recepciones_disponibles` con lo que el
  rol puede ver), cantidad en KG (sin conversiones ni tolerancias) y, opcionales, código de entrega y de producto como
  verificación cruzada.
- **Vista previa**: explica cada movimiento («Mueve X kg de la recepción de ENT-… al lote …») y comprueba la demanda
  acumulada por recepción en todo el archivo contra la existencia sin lote del ledger.
- **Reimportación**: una asignación activa igual → «sin cambios»; con otra cantidad → error (no se modifica ni libera por
  importación); una asignación liberada no se vuelve a crear sin decisión explícita. Lotes cerrados o resultado de un proceso
  no admiten entradas ni se reabren. No procesa, convierte, libera calidad ni cierra.
- **Identidad**: `operation_id` deterministas por lote/referencia y recepción (dos confirmaciones concurrentes no asignan dos
  veces); referencias en `import_references` (migración 0036, una entidad por referencia).
- **Lote histórico sin recepción**: no se importa; la fila muestra el faltante (`RECEPTION_REQUIRED`). No se inventan
  operaciones físicas.
- **Autorización**: `import:manage` + `lot:create`; las recepciones solo se ven con alcance de entregas (sin él: misma
  respuesta que una inexistente). Revalidado al confirmar (bloqueo de lotes y recepciones; plan_hash).

## Contraste con los criterios originales (backlog P0-026, RF-26, QA-03, S1 §§61–63)

| Criterio | Estado | Evidencia |
| --- | --- | --- |
| Plantilla (S1 §62: productores, parcelas, entregas, productos, lotes) | Cumplido (5/5) | `templates/*` y `.xlsx`; pruebas por plantilla |
| Mapeo explícito | Cumplido | sugerencias solo aplicadas al guardar; campos únicos; identidad protegida |
| Preview sin escrituras | Cumplido | conteos sin cambio en todas las suites; `persisted: false` |
| Errores por fila | Cumplido | códigos por fila y columna; informe `.xlsx` sin identidad ni coordenadas |
| Commit controlado | Cumplido | atómico; `plan_hash`; revalidación de permisos, alcance, versiones y disponibilidad; rollback forzado probado |
| IDs no cruzan tenant | Cumplido | lotes de importación 404; referencias de otra organización = no disponibles (todas las plantillas) |
| Reimport no duplica ni borra campos fuera de mapping | Cumplido | reimportaciones «sin cambios» sin versiones ni eventos; vacío/sin mapear no cambian; `#BORRAR` explícito |
| Legacy/missing explícitos (S1 §63) | Cumplido | estados LEGACY / MISSING / UNKNOWN por campo y `NOT_VALIDATED`; nunca VERIFIED |
| QA-03 (nuevo/existente, mismo código en dos tenants, Excel válido/erróneo/repetido) | Cumplido | `imports*.int-spec.ts` |

Con `npm run validate` aprobada sobre el commit, P0-026 queda **DONE_LOCAL**. No acredita uso con un Excel real de una
asociación, producción ni conformidad EUDR.

## Limitaciones (no son criterios pendientes; se registran)

1. Solo archivos **sintéticos** y datos DEMO: no se ha importado un Excel real de una asociación (formatos de celda,
   encabezados, codificación y volumen reales sin observar).
2. Los soportes documentales de entregas no se importan (se vinculan por versión exacta desde la entrega).
3. Las entregas solo se importan como borradores; registrar es una acción explícita.
4. Un lote histórico sin recepciones registradas no se puede importar (por diseño: no se inventan operaciones físicas).
