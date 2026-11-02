# P0-029 — Movimientos y embarque: contrato, implementación y contraste de criterios (2026-10-12)

Fuentes: backlog P0-029 («ubicaciones/contraparte/ítems, reserva y saldo concurrentes, preflight/calidad/evidencia/DD,
despacho idempotente y grafo destino; sin saltar bloqueos»; RF-29; QA-06/12), docs/05 (Embarque: «liberación con
preflight»), docs/06 (`reservations` con `shipment_id` R; `shipments/items` «reservar → liberar → despachar; no debitar dos
veces»; `dd_package_id` y `dispatch_at` condicionales), docs/07 (EXPORT_MANAGER «reservar, preparar, liberar despacho si
gates pasan»), docs/08 (SHIPMENT → `ShipmentDispatched`; «SHIPMENT_DISPATCH con condiciones no definidas queda bloqueado
hasta D-34»), docs/09 (`POST /shipments`, `/reserve`, `GET /preflight`, `POST /dispatch`), docs/14 (EXPORT_MANAGER:
seleccionar lote → reservar → revisar → despachar), `docs/decisiones/P0-017-EFECTOS-LEDGER.md`. Validación local; no
acredita producción ni conformidad EUDR.

## Qué existía y qué faltaba

| Aspecto | Antes | Brecha |
| --- | --- | --- |
| Ledger (P0-017) | única fuente de existencia, reservado y disponible; reservas de proceso | sin reserva/despacho para embarques (`reservations_for_shipments: NOT_IMPLEMENTED`) |
| Embarques, compradores | inexistentes (KDE `buyer`/`shipment` «no verificables hasta P0-029») | todo |
| CTE SHIPMENT | vínculo `SHIPMENT_DISPATCH` PENDING | sin operación |
| Expediente DD (P0-022) | requisito `SHIPMENT_LINK` NO EVALUABLE; READY inalcanzable (catálogo, D-05, perfil jurídico, satélite) | — (se conserva) |
| Lot Hub | «Hacia adelante» solo con procesos | sin destino a embarques |

## Decisiones (propuestas, adoptadas para desarrollo local)

1. **Contraparte = comprador declarado** (`buyers`: código, nombre, país ISO). Sin verificación externa: D-33 sigue abierta;
   la UI y la API lo marcan `verification: DECLARED`. El destino (país ISO + lugar) también es declarado.
2. **Reserva por ítem completo en el centro de salida del embarque** (regla provisional 2 de P0-017: un solo centro; si el
   lote está en otro, se traslada antes). Movimiento `SHIPMENT_RESERVE` (+q reservado) con el lote bloqueado; el invariante
   diferido del ledger (reservado ≤ físico por tenedor y centro) es el respaldo ante carreras. `shipment_reservations`
   registra el vínculo y el estado (ACTIVE → RELEASED | CONSUMED), inmutable salvo esa transición (trigger).
3. **Liberar** (`SHIPMENT_RESERVE_RELEASE`, motivo obligatorio) y **cancelar** (libera todas las activas; definitivo).
4. **Despacho** = caso de uso con guard, idempotente por `operation_id`: por reserva activa, `SHIPMENT_DISPATCH` con −q
   reservado y −q físico (una sola vez); embarque `DISPATCHED` definitivo (trigger); evento `ShipmentDispatched`.
5. **Preflight** (todas bloqueantes; ninguna se rebaja): estado en preparación, al menos un ítem, reserva completa en el
   centro de salida, **calidad** liberada por decisión humana, **origen** completo (D-39), **paquete DD** aprobado + READY +
   vigente + `DD_PACKAGE` exportado, **evidencia** (se acredita dentro del paquete DD) y la **compuerta KDE
   SHIPMENT_DISPATCH**: BLOCKING para comprador, destino, lotes y cantidad; `BLOCKED_PENDING_DECISION` para
   `SHIPMENT_PACKAGE` y `SHIPMENT_DISPATCH_AT` (D-34). Consecuencia: **hoy ningún embarque puede despacharse**.
6. Reservar cambia la cantidad del lote, que forma parte del contenido del expediente: una instantánea aprobada antes de
   reservar queda STALE (orden coherente: reservar → instantánea → aprobar → exportar → despachar).
7. **Permisos** (catálogo `2026-10-12.21`): `shipment:read` (ORG_ADMIN, EXPORT_MANAGER, TRACEABILITY_MANAGER,
   EUDR_MANAGER, AUDITOR), `shipment:manage` y `stock:reserve` y `shipment:dispatch` (ORG_ADMIN, EXPORT_MANAGER).
   EXPORT_MANAGER recibe además `location:read`. Lectura de lote/stock sin cambios. Sin acceso entre organizaciones.
8. Catálogos: CTE 1.4.0 (SHIPMENT integrada con su vínculo), KDE 1.5.0 (SHIPMENT republicada + compuerta). Las entidades
   KDE `buyer` y `shipment` pasan a verificables (tenant + `shipment:read`).
9. Guards existentes extendidos: liberar una asignación de recepción se bloquea también con reservas de embarque activas o
   consumidas; la conciliación ledger ↔ dominio incluye reservas activas y despachos.

## API

`GET|POST /organizations/{orgId}/buyers` · `GET /shipments/options` · `GET|POST /shipments` · `GET /shipments/{id}` ·
`POST /shipments/{id}/items` · `POST /shipments/{id}/items/{itemId}/remove` (sin historial de reservas) ·
`POST /shipments/{id}/reserve` · `POST /shipments/{id}/reservations/{rid}/release` · `GET /shipments/{id}/preflight` ·
`POST /shipments/{id}/dispatch` · `POST /shipments/{id}/cancel`. Lot Hub: `GET /lots/{id}` añade `shipments` (null sin
`shipment:read`) y `quantities.dispatched`.

## Contraste con los criterios originales

| Criterio | Estado | Evidencia |
| --- | --- | --- |
| Ubicaciones / contraparte / ítems | Cumplido (contraparte **declarada**, D-33) | centro de salida obligatorio y activo; comprador del tenant; ítems lote+KG; referencias ajenas 422 (`test/shipments.int-spec.ts`) |
| Reserva y saldo concurrentes | Cumplido | idempotencia, exceso 409, dos reservas simultáneas → una (sin saldo negativo), conciliación consistente |
| Preflight / calidad / evidencia / DD | Cumplido (bloquea) | preflight real: calidad pendiente, sin expediente, compuerta D-34 → `DISPATCH_BLOCKED` sin efectos en el ledger |
| Despacho idempotente | **Mecánica probada solo con preflight SINTÉTICO** (spy) | consume una vez, reintento concurrente con el mismo id → `replayed`, otro id → 409, cancelación tardía → 409 |
| Grafo destino | Cumplido | Lot Hub «Embarques» (reservado/despachado); null sin permiso |
| Sin saltar bloqueos | Cumplido | ningún requisito se rebajó; despacho bloqueado por D-34 y por READY inalcanzable |

**Estado: ABIERTA.** Reserva, preflight, cancelación y bloqueo están demostrados localmente; el **despacho no está
demostrado** con datos reales y no puede estarlo mientras sigan bloqueados sus requisitos: condición escrita de
`dd_package_id`/`dispatch_at` (D-34), una instantánea DD READY (catálogo de riesgo aprobado, D-05, perfil jurídico P1-005,
satélite P0-028) y calidad liberada en los lotes DEMO.

## Limitaciones

1. Comprador sin verificación ni concesiones (D-33; portal comprador P1-001).
2. Un embarque con varios lotes registra los paquetes DD en el evento; `shipments.dd_package_export_id` queda vacío hasta
   D-34.
3. Reserva solo en el centro de salida; sin reparto automático entre centros.
4. La revisión en navegador dejó en la DEMO el comprador `DEMO-REV-COMPRADOR` y embarques **cancelados** (sin reservas
   activas); ver `docs/qa/EVIDENCIA_P0-029_2026-10-12.md`.
