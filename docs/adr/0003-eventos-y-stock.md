# ADR-0003 — Eventos, stock y correcciones

Estado: PROPUESTO · fecha 2026-10-09.

## Contexto

S1 requiere eventos inmutables y balance de masa, pero menciona excepción de saldo negativo. S4 aporta ejemplo de balance ilustrativo con cifras ambiguas. Permitir consumo sin material verificable rompe custodia.

## Decisión propuesta

Tablas de estado + eventos/auditoría inmutables y ledger append-only, sin exigir event sourcing total. Mutación, ledger y outbox en transacción. Stock y reservas con constraint/bloqueo que impida doble consumo bajo concurrencia. Bloquear negativo; corregir error con ajuste justificado y sus impactos, no bypass administrativo de consumo. Traslado debita/credita ubicaciones; reserva no consume hasta despacho.

## Alternativas y consecuencias

Campo current_quantity editable es simple pero pierde causalidad y tiene carreras. Event sourcing completo aumenta complejidad innecesaria inicial. Tablas + ledger requieren reconciliación y mapping cuidadoso con modelo ya existente; no duplicar el balance implementado. Tolerancias/redondeo/rendimiento se fijan por producto y prueba, sin borrar discrepancias.

## Validación

QA-05/06/07: 800 entrada, 750 salida, 50 merma; doble cierre/retry; dos consumos simultáneos; reserva y despacho; corrección con descendientes; fallos intermedios revierten toda la transacción. Aceptación por operaciones/tech lead antes de cambiar una excepción ya implementada.

## Estado de implementación (2026-10-10)

Implementada la parte de **eventos inmutables + outbox transaccional** (doc 08 «Implementación vigente»). **No implementados:** ledger de inventario, reservas, bloqueo de saldo negativo y correcciones con impacto (P0-016/017/029). Este ADR sigue PROPUESTO.
