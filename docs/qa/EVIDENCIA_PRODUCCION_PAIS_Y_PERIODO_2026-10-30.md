# Evidencia: período y país de producción en la instantánea (2026-10-30)

Instrucciones del propietario: reutilizar el período de cosecha de las entregas, añadir solo el país de producción como declaración explícita por origen, sin duplicar declaraciones. Cuentas DEMO vigentes; sin cuentas nuevas, claves, seed ni respaldos.

## SHA
| Qué | SHA | Resultado |
| --- | --- | --- |
| Candidato (migración `0075`, API, pantallas, pruebas) | `0f2bdf5` | `npm run validate` **APROBADA** (`validation-results/2026-10-30T23-08-41-297Z`); **desplegado** (`/version` = `0f2bdf5`, esquema `0075`) |

## Qué se hizo
- **Período (reutilizado):** la instantánea fija, por entrega de origen, la cosecha EFECTIVA —`harvest.precision` (día, mes o desconocida), límites y `correction_number`—. Una entrega sin declaración **no lleva la clave**: queda «sin declarar» y no se funde en un intervalo general. No se usa fecha de entrega, recepción ni análisis.
- **Hallazgo y corrección:** en una entrega corregida, las columnas de la entrega conservan la declaración ORIGINAL y la efectiva es la de su última corrección (`delivery_corrections`). La consulta de la vista compartida del LOTE tomaba la original; ahora ambas usan la efectiva. Prueba: `produccion-instantanea.int-spec` (vista del lote con cosecha corregida).
- **País (único dato nuevo):** tabla `plot_production_declarations` (migración `0075`), por parcela de origen, de solo añadir (el disparador rechaza UPDATE/DELETE), con `declaration_number`, responsable, fecha, `operation_id` y aclaración. `country` NULL = «declarado como desconocido»; sin filas = «sin declarar». No se deduce de la organización, del comprador ni del destino. Ruta `GET/POST /organizations/{orgId}/plots/{plotId}/production-country` con el alcance de editar la parcela (técnico asignado, productor propio, administración).
- **Sin declaración duplicada:** el expediente no tiene un período propio editable; la instantánea fija las versiones de lo que ya declaran las entregas y las parcelas. Una corrección posterior cambia el contenido, desactualiza la instantánea vigente por el mecanismo existente y deja intactas las anteriores.
- **Pantallas:** ficha de la parcela (declarar/corregir, historial), expediente (período por entrega y país por parcela con tres estados) y vista del comprador («Período y país de producción» con recuentos sin códigos; con concesión de geometrías, el país de cada parcela).

## Pruebas
- `produccion-instantanea.int-spec.ts` (6): declarar con idempotencia, versión y solo añadir; alcance (otro técnico 404, comprador 403/404, parcela inexistente 404); cuatro orígenes (día, mes, desconocida, sin declarar) con países EC, PE, desconocido y sin declarar; recuentos y cobertura honesta («Solo 2 de 4 entregas»); comprador con y sin concesión, sin códigos ni nombre del productor; corrección posterior (instantánea anterior idéntica, vigente desactualizada en `deliveries` y `plots`, nueva con corrección 1 y declaración 2).
- e2e `concesiones.spec.ts` 8/8: declarar en la ficha, persistencia, corrección con historial, 390 px; sección de producción del comprador.

## Demostración sobre el despliegue (`e2e/review/produccion-demostracion.mjs`, 7/7)
Parcela y expediente sintéticos QA-1030. (1) sin país al inicio, sin asumir Ecuador; (2) técnico asignado declara EC, otro técnico 404, auditor 403; (3) la instantánea A fija EC y el comprador la ve solo con concesión (sin ella, 404); (4) la entrega sin cosecha declarada figura «sin declarar» (precisión NONE); (5) la corrección a «desconocido» añade la declaración 2 y conserva la 1, y la instantánea A no cambia; (6) A queda desactualizada (`plots`), B fija «desconocido» y el comprador no ve Ecuador; (7) revocar impide nuevas consultas.

## Efectos y límites
- **Instantáneas existentes:** 4 de las 10 del DEMO tienen entregas con cosecha declarada; al incluirla en el contenido, su hash ya no coincide y se muestran **desactualizadas** (no se modificaron). Capturar una nueva las actualiza. Las otras 6 no cambian.
- **Registros del DEMO añadidos por la demostración:** declaraciones 1 (EC) y 2 (desconocido) de la parcela QA-1030-PAR, dos instantáneas más del expediente QA-1030 y dos concesiones, ya revocadas.
- Terra Link no verifica el país ni la cosecha; son declaraciones de la organización. No es una presentación de DDS ni acredita conformidad EUDR.
