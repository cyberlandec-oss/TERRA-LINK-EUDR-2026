# P0-017 Inventario y balance de masa — Efecto de cada operación en el ledger (2026-10-10)

Estado: **contrato de implementación**. Las reglas con fuente se implementan; las marcadas **PROPUESTA** son políticas
nuevas sin aprobación (se implementan solo donde la historia lo exige y se señalan como provisionales).

Fuentes: backlog P0-017 («ledger, merma, traslado, reserva/despacho y ajuste con motivo; 800→750+50 válido, exceso
rechazado; prueba concurrente impide doble consumo/saldo negativo»), docs/05 («saldos derivados del ledger y
asignaciones; doble consumo bloqueado»; ERD LOT/LOCATION → STOCK_ENTRY), docs/06 (`stock_entries` append-only con lote,
ubicación, tipo, cantidad firmada, unidad, evento, fechas, `correction_of`; `reservations` con **shipment_id R**;
`shipments` «reservar → liberar → despachar; no debitar dos veces»), docs/08 (STORAGE → STOCK_MOVEMENT /
StockMovementRecorded; KDE: lote, ubicación, cantidad, dirección IN/OUT, responsable), docs/16 QA-06 y ejemplo de
conservación, contrato P0-016/017 y reglas D-39 adoptadas para desarrollo local.

## Principio: una sola fuente de disponibilidad

El ledger (`stock_movements` + `stock_entries`) es la **única** fuente de existencia física, reserva y disponible, para
recepciones, asignaciones, procesos y movimientos. Las tablas de dominio de P0-012/P0-016 (recepciones, asignaciones,
entradas de proceso) siguen siendo el registro del hecho; su efecto cuantitativo vive solo en el ledger. Los triggers de
cantidad de P0-016 se reemplazan por la red de seguridad del ledger (no hay dos sistemas paralelos).

- **Tenedor** de cantidad: la recepción (material recibido aún sin lote) o el lote; siempre con una ubicación de la misma
  organización, o **pendiente de asignación** (NULL explícito) si no se conoce.
- **Cubetas**: `PHYSICAL` (existencia física) y `RESERVED`. Disponible = físico − reservado. Reservar no reduce la existencia.
- Invariantes por tenedor y ubicación (trigger diferido + bloqueo de filas): físico ≥ 0, reservado ≥ 0, reservado ≤ físico.

## Efecto por operación

| Operación | Líneas | Existencia de la organización | Disponible | Fuente / estado |
| --- | --- | --- | --- | --- |
| Recepción física confirmada | `RECEPTION_IN`: +q físico, recepción @ centro de recepción | +q | +q | docs/05 (entrada física única) |
| Corrección de peso de recepción | `RECEPTION_CORRECTION`: ±Δ físico de la recepción | ±Δ | ±Δ | P0-012 + D-39.2: solo sin asignación activa ni consumo |
| Formar lote / asignar recepción | `LOT_ASSIGN`: −q recepción @ L, +q lote @ L | **0** (no es entrada nueva) | 0 | docs/05 |
| Liberar asignación | `LOT_RELEASE`: inverso | 0 | 0 | P0-016 (solo sin reservas ni consumo) |
| Iniciar proceso | `PROCESS_RESERVE`: +q reservado del lote @ L | 0 | −q | contrato P0-016 |
| Cancelar proceso | `PROCESS_RESERVE_RELEASE`: −q reservado | 0 | +q | contrato P0-016 |
| Cerrar proceso | `PROCESS_CLOSE`: por entrada −q reservado y −q físico (consumo); por salida +q físico del lote nuevo | **−pérdida, una sola vez** | — | docs/16 QA-06: 800 consumidos, 750 producidos, 50 de merma registrados en el movimiento (no se descuentan otra vez) |
| Merma fuera de proceso | `STOCK_LOSS`: −q físico del lote @ L, motivo | −q | −q | backlog «merma»; no puede tocar lo reservado |
| Traslado | `TRANSFER`: −q lote @ A, +q lote @ B (misma organización) | **0** | 0 en total | backlog «traslado»; KDE STORAGE (salida y entrada) |
| Asignar ubicación pendiente | `LOCATION_ASSIGN`: −q lote @ pendiente, +q lote @ L | 0 | 0 | instrucción 2026-10-10 («identifícala como pendiente») |
| Ajuste con motivo | `ADJUSTMENT`: ±q físico del lote @ L, motivo obligatorio | ±q | ±q | backlog «ajuste con motivo»; nunca sobre recepciones (su peso se corrige en P0-012), nunca por debajo de lo reservado |
| Reserva / despacho para embarque | — | — | — | **NO IMPLEMENTADO**: docs/06 exige `shipment_id`; embarques llegan con P0-029 |

## Políticas nuevas (PROPUESTA, sin aprobación)

1. **Ubicación de la salida de un proceso**: si todas las entradas consumidas están en el mismo centro, la salida queda allí; si no, queda **pendiente de asignación** (no se elige un almacén).
2. **Ubicación de la reserva al iniciar**: se usa el centro donde el lote tiene disponible suficiente; si está repartido entre varios centros, el inicio pide trasladar primero (no se reparte automáticamente).
3. **Ajuste positivo** permitido con motivo y permiso específico (`stock:adjust`, solo ORG_ADMIN): es corrección de conteo, no entrada física; queda visible y auditado.
4. **Permisos**: `stock:read` (roles con `lot:read`), `stock:move` (merma, traslado, asignar ubicación: ORG_ADMIN, TRACEABILITY_MANAGER — docs/07 «movimientos»), `stock:adjust` (ORG_ADMIN), `stock:incorporate` (ORG_ADMIN). Reserva/despacho (`stock:reserve`/`dispatch`, EXPORT_MANAGER en la matriz) no se asignan hasta P0-029.

## Datos existentes

Incorporación idempotente (`incorporate`) desde los registros de P0-012/P0-016: cada recepción, corrección, asignación,
liberación, inicio y cierre genera **un** movimiento con su referencia original (`source_type`, `source_id`; único por
tipo y fuente). Repetirla no duplica nada. La conciliación compara ledger y dominio y reporta diferencias; **nunca** crea
ajustes para cuadrar totales.

## Correcciones

- Corregir una recepción sigue bloqueado con asignación activa (D-39.2) y además si alguna asignación suya, aunque
  liberada, terminó en un lote con consumo cerrado.
- No hay corrección de efectos posteriores: los movimientos históricos nunca se borran ni se reescriben; un ajuste no puede
  dejar físico < reservado ni operar sobre recepciones, así que no sirve de atajo al control de cantidades.

## Revisión enfocada (2026-10-10) y estado de las políticas

Procedencia: este documento (contrato de implementación redactado en la sesión). **Ninguna política nueva tiene aprobación del usuario.**

| Política | Estado |
| --- | --- |
| Ubicación de la salida: centro común de las entradas o pendiente | **Implementada para desarrollo** (provisional) |
| Reserva en un único centro; si está repartido, trasladar antes | **Implementada para desarrollo** (provisional) |
| Ajuste positivo con motivo y `stock:adjust` | **Implementada para desarrollo, restringida tras la revisión**: solo en lotes «Origen incompleto»; en un lote de origen declarado se rechaza (`ADJUSTMENT_WOULD_ATTRIBUTE_ORIGIN`) porque atribuiría origen, evidencia o calidad a una cantidad sin trazabilidad y eludiría el bloqueo de mezcla (D-39.1). La cantidad añadida queda identificada (`adjustments.added`, `added_traceability = PENDING`) con motivo, actor e historia; no se atribuye a ninguna recepción |
| Permisos `stock:*` | **Implementados para desarrollo** (provisional; matriz docs/07) |
| Reserva/despacho para embarques | **No implementada** (P0-029) |

Revisión de alcance: saldos, totales y movimientos solo cuentan lo visible (las recepciones sin lote y sus movimientos se omiten para quien no lee entregas y no entran en los totales); la conciliación y la incorporación exigen además lectura de organización completa (`delivery:read`, `lot:read`, `stock:read`) aunque se tenga `stock:incorporate`.

Revisión de STORAGE: la operación real (merma, traslado, asignación de ubicación, ajuste) evalúa la compuerta `STOCK_MOVEMENT` sobre los KDE STORAGE obligatorios (BLOCKING, ninguno opcional), guarda el resultado por línea en `gate_evaluations` (`stock_movement`) y emite `StockMovementRecorded`. Prueba: la compuerta guardada en un traslado (entrada y salida) y un bloqueo real con ubicación ausente y dirección inválida. Se mantiene INTEGRATED con esa evidencia.
