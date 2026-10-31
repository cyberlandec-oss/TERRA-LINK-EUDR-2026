# Evidencia A-03 — Traspaso de custodia entre organizaciones (2026-10-21)

**Qué es este documento.** Evidencia del **desarrollo técnico demostrado** del núcleo operativo de A-03 (RF-50) sobre el SHA **`d99f40a`**. **No** acredita que el traspaso esté habilitado para operaciones
reales: la **salida real permanece bloqueada** (D4 no adoptada, D-34) y **D2 sigue pendiente de revisión competente**. Fuera del conteo 42/60 y 30/44. Contrato y decisiones:
`docs/decisiones/A03-TRASPASO-ENTRE-ORGANIZACIONES.md` (§0, §12, §13).

| | |
| --- | --- |
| Rama / SHA validado y desplegado | `feat/tech-001-ci-p0-002` · **`d99f40a`** (migración `0058_a03_traspaso_custodia`); `/version` → `commit=d99f40a`, `schema.applied = known_by_code = 0058_a03_traspaso_custodia` |
| Validación **APROBADA** (2.ª ejecución) | `validation-results/2026-10-21T15-35-07-183Z` — **90 suites / 990 pruebas**, E2E **104**; registro `validate-intento2-APROBADA.log` |
| Validación **FALLIDA** (1.ª ejecución, conservada) | `validation-results/2026-10-21T04-40-04-033Z` — ver §1; registro `validate-intento1-FALLIDO.log` |
| Despliegue | `node scripts/desplegar.mjs` (sin `+sucio`), migración 0058 aplicada, servicios `healthy` |
| Demostración en el despliegue | `validation-results/a03-demostracion-2026-10-21/` — **7/7** (3.ª ejecución del guion, ver §3) |
| Recorrido técnico aislado | `validation-results/a03-recorrido-aislado-2026-10-21/integracion-custody-transfers.log` (15/15) + E2E aislado (10/10) |
| Respaldo y restauración aislada | `_respaldos/2026-10-21-a03-traspaso-0058/` (`VERIFICACION-2026-10-21.md`) |

## 1. Las dos ejecuciones de `npm run validate` sobre `d99f40a`
**1.ª ejecución — FALLIDA.** Servicios, typecheck, lint, build y OpenAPI pasaron. En unitarias e integración: **88 de 90 suites, 976 de 990 pruebas**; fallaron `test/shipments.int-spec.ts` y
`test/event-corrections.int-spec.ts` (14 pruebas entre ambas), todas por *«Exceeded timeout of 60000 ms for a hook»* (la preparación de la suite). Las duraciones registradas de esas dos suites fueron
**4505 s y 32896 s**; la fase tardó 39091 s. El E2E no llegó a ejecutarse.
- **Lo comprobado**: los timeouts de preparación y esas duraciones. Las dos suites pasan **aisladas** sobre el mismo SHA con el árbol limpio (`event-corrections` 42 s, `shipments` 24 s; 14/14). Esas pasadas
  acreditan **esas ejecuciones**: no convierten la corrida completa en aprobada ni prueban que el fallo fuera exclusivamente ambiental.
- **Hipótesis pendientes (no demostradas)**: suspensión del equipo, cambio de hora o contención del entorno. Lectura de solo lectura del registro del sistema, para contrastar con las marcas del log: entradas y salidas de *modern
  standby* durante la ventana (p. ej. 23:33, 23:54, 00:00–01:14), una suspensión/reanudación a las 01:15:02–01:15:04 y un cambio de la hora del sistema a las 10:23:12 (de `06:15:04Z` a `15:23:12Z`). **Coincidencia temporal
  no es causa**: no se descarta un defecto del código ni del arnés, y la causa de los timeouts **no está identificada**. Línea de seguimiento: si vuelve a ocurrir sin suspensión, investigar la preparación de esas suites.
- No se modificó código ni expectativas entre ambas ejecuciones.

**2.ª ejecución — APROBADA** (`15:35Z`; antes se pidió mantener el equipo despierto). Avance comprobado con el log de pruebas (17 → 45 → 90 suites), no solo con la actividad del proceso.
Unitarias e integración **OK 1575,6 s** (90/90 suites, 990/990 pruebas); E2E **OK 314,7 s** (104/104). Este resultado se atribuye **solo** a esta ejecución; la 1.ª sigue siendo FALLIDA.

## 2. Recorrido técnico aislado (parte 2 de la demostración)
No se añadió ningún bypass operativo. Se reutilizan las pruebas existentes y se distingue **qué es real y qué está sustituido o preparado**:

| Elemento | Qué es | Dónde |
| --- | --- | --- |
| **Compuerta sustituida únicamente en el arnés** | `jest.spyOn(app.get(TRANSFER_DISPATCH_GATE), 'evaluate')` con `allowed:true`, restaurado en `afterEach`. Es lo único simulado; no existe equivalente en la API operativa | `apps/api/test/custody-transfers.int-spec.ts` (`allowGate()`) |
| **Servicio y ledger reales bajo esa condición** | La salida se ejecuta por `POST …/dispatch` del servicio real: movimiento `CUSTODY_OUT` (RESERVED −q y PHYSICAL −q en el centro de origen), paso `DISPATCH`, estado `IN_TRANSIT`; luego recepciones por `CUSTODY_IN` en el libro de la receptora, etc. | prueba «salida y recepción total…» y siguientes |
| **Estado preparado mediante fixture SQL** | Solo el E2E: el paso «FIXTURE SQL del tránsito» inserta los asientos de una salida en `terra_link_e2e` para alcanzar `IN_TRANSIT`. **No demuestra** que la salida genere correctamente sus movimientos | `e2e/tests/traspasos.spec.ts` (10 pruebas) |

**La transición de salida se acredita con la prueba de integración, no con el fixture.** «salida y recepción total» comprueba, con PostgreSQL real y dos organizaciones: (a) antes de la salida, `reservado 60 / físico 100`;
(b) tras `dispatch`, estado `IN_TRANSIT`, `dispatched 60`, `in_transit 60`, **un** `CUSTODY_OUT`, lote del emisor `físico 40 · reservado 0 · disponible 40`, **ningún lote** aún en la receptora; (c) el reintento con la misma operación
devuelve `replayed` sin un segundo movimiento; (d) tras la recepción, receptora `físico 60`, emisor `40`, **100 = 40 + 60**, conciliación del ledger **consistente en ambas** organizaciones; (e) lote de la receptora con
`source=CUSTODY_TRANSFER`, origen INCOMPLETO, cerrado a entradas, sin `lot_inputs` y sin expediente; (f) linaje en ambos sentidos sin exponer el lote de la otra parte.

Cobertura del resto del recorrido (15 pruebas, `integracion-custody-transfers.log`): vínculo (código de un solo uso, no se autoconfirma, un activo por pareja); oferta (reserva sin mover existencia, idempotencia, saldo insuficiente,
permisos, referencias ajenas); **concurrencia** (de dos ofertas que no caben una prospera; tres envíos de la misma operación → un solo traspaso); aceptación/rechazo/cancelación por estado con liberación de reserva; **salida
bloqueada sin bypass**; recepción parcial; **faltante** (motivo obligatorio, pendiente sin restar, la pérdida la confirma la contraparte, reapertura); **sobrante** (no crea existencias; confirmado entra a la receptora, retirado
no); **rechazo en tránsito** (vuelve al lote y centro de origen con `CUSTODY_RETURN`); **devolución vinculada** (otro traspaso, limitada a lo recibido, original intacto); permisos y filtraciones (tercera organización 404, lado
comprobado antes que la versión, sin centros ni productos de la otra parte); integridad en la base (pasos y linaje append-only, tránsito nunca negativo, organizaciones/lote/cantidad inmutables, lote de custodia no puede
declararse COMPLETO); eventos y auditoría en ambas organizaciones; convivencia del lote recibido con lotes, saldos, movimientos, riesgo y expediente.

## 3. Demostración en el entorno desplegado (parte 1) — 7/7
Sobre el DEMO sintético: emisora Río Verde, receptora Exportadora Pacífico, cuenta ajena `comprador.importador` (BUYER), técnico sin permisos. `node e2e/review/a03-demostracion.mjs`
(capturas y `resultado.json` en `validation-results/a03-demostracion-2026-10-21/`). Resultado de la ejecución registrada (TRP-2026-00003):
1. **Vínculo** activo entre ambas; el código de un solo uso no se vuelve a mostrar.
2. **Oferta** de 10 kg: revisar no reserva; confirmar reserva (`reservado 0→10`) y el **físico queda en 120**.
3. **Aceptación** por la receptora: ve la instantánea técnica con huella; el centro de la emisora no aparece; aceptar no recibe nada (`Recibida 0 kg`, 0 lotes de custodia).
4. **Salida bloqueada**: la pantalla lo explica; la API responde **409 `TRANSFER_DISPATCH_BLOCKED`**; con una bandera de omisión → 400; físico 120→120 y reservado 10→10.
5. **Rechazos**: técnico sin menú y 403; cuenta de otra organización sin permiso → 403 en la suya y 404 por la ruta de la emisora; lado equivocado → 403; controles autorizados 200/200; sin fuga de centro ni producto.
6. **Cancelación** antes de la salida: `CANCELLED`, reserva liberada (`10→0`), historia completa y conciliación del ledger de la emisora consistente.
7. **Inglés, teclado y 390 px**: sin desborde ni códigos internos; foco por teclado.

Historia honesta de esa demostración: el guion se ejecutó **tres veces**. La 1.ª dio 6/7 porque mi expectativa del caso 5 era errónea (un BUYER no tiene `transfer:read` ni en su propia organización: 403, no 404); la 2.ª dio 5/7
por un filtro del guion (la unidad del producto es un objeto); la 3.ª dio 7/7. Ningún cambio de código del producto entre ellas. Las dos primeras dejaron traspasos de ensayo (los tres quedaron `CANCELLED`, 0 reservas activas).
**Límite**: el 404 de un *administrador* de una tercera organización no se puede demostrar con las cuentas DEMO (no hay una); lo acreditan la integración y el E2E aislado.
Datos persistentes tras la demostración: 1 vínculo activo, 3 traspasos `CANCELLED`, 8 pasos, 6 movimientos `CUSTODY_*` (3 reservas y 3 liberaciones); ninguna salida, recepción ni lote de custodia.

## 4. Respaldo y restauración aislada
Hubo cambio persistente (migración 0058, 5 tablas, restricciones nuevas y movimientos reales): ver `_respaldos/2026-10-21-a03-traspaso-0058/VERIFICACION-2026-10-21.md`. Resumen: **58 migraciones**, **142 tablas sin diferencia de conteo**, restricciones
idénticas (`c=482 · f=383 · p=142 · t=5 · u=173`), las 5 tablas nuevas, sus 5 disparadores, el índice único del vínculo y los CHECK ampliados presentes; el UPDATE sobre `custody_transfer_steps` en la copia se rechaza (append-only);
descifrado con las claves del respaldo 56 productores / 18 campos / 0 fallos; objetos 1210 con la misma huella conjunta. Los 27 volúmenes y los respaldos anteriores quedaron intactos.

## 5. Qué NO queda demostrado
- **Ninguna salida real** en el entorno desplegado: está bloqueada. El tránsito, la recepción, las diferencias, la devolución y el cierre se demostraron **solo en aislado** (compuerta sustituida en el arnés) y en el E2E con fixture.
- D2 (obligaciones de diligencia de quien recibe) **pendiente de revisión competente**; D4 **no adoptada**. El lote recibido tiene origen INCOMPLETO y no hereda expediente, severidad, conclusión ni aprobación.
- La causa de los timeouts de la 1.ª ejecución no está identificada (§1).
- Android real, producción y conformidad EUDR siguen en sus gates propios.
