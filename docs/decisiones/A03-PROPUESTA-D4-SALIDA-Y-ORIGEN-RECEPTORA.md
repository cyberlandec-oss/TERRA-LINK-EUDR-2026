# A-03 — Propuesta mínima para la salida de custodia (D4) y el origen en la receptora (D3 c)

Fecha: 2026-10-30. **Propuesta revisable: no se aplica ni cambia D2/D3/D4.** La salida real del traspaso sigue bloqueada (`BlockingTransferDispatchGate` devuelve siempre `allowed: false`, `TRANSFER_DISPATCH_GATE_BLOCKED`) y no existe bypass. Fuentes: `docs/decisiones/A03-TRASPASO-ENTRE-ORGANIZACIONES.md` §0, §9 (D3, D4), §13; `docs/decisiones/D-34-PROPUESTA.md` (rev. 4); `docs/22` (D-34, D-39); `apps/api/src/custody/custody-transfers.ts`.

## 1. Qué sigue pendiente exactamente
| Transición | Estado | Causa |
| --- | --- | --- |
| proponer vínculo, ofrecer (reserva), aceptar, rechazar, cancelar | **Operativas** | — |
| `ACCEPTED → IN_TRANSIT` (salida real) | **Bloqueada** | D4 no adoptada; la compuerta propia `TRANSFER_DISPATCH` no está definida (condición y KDE) |
| recepción parcial/total, faltante, sobrante, conciliación, devolución | Operativas **solo sobre un estado de tránsito construido en pruebas** | dependen de la salida |
| completar el origen del lote receptor | **No existe camino** | D3 (c) no adoptada: el lote nace `INCOMPLETE` y la base impide marcarlo `COMPLETE` |

## 2. Relación con D-34 (no se reabre)
D-34 opción A (vigente) exige el paquete final de diligencia para **despachar un embarque** (exportación). Un traspaso de custodia **no es** un embarque ni se equipara a él (A-03 §0 D1 b y D4). Por eso la salida del traspaso necesita su propia condición; no hereda la de D-34 ni la sustituye. Si una revisión competente concluyera que el traspaso equivale a poner el producto en el mercado, D4 (c) aplicaría la condición de D-34 y bloquearía hoy todo traspaso, porque `DD_PACKAGE` es inalcanzable (RISK_NO_BLOCKING_FINDINGS depende de D-09.B y D-05.B).

## 3. Propuesta para la condición de salida (D4)
Opciones ya enumeradas en A-03 §9: (a) calidad no rechazada + datos mínimos; (b) además origen COMPLETO; (c) además DD aprobado.
- **Recomendación: (a) como condición mínima**, implementada como la compuerta propia `TRANSFER_DISPATCH`: lote de la emisora con calidad no rechazada (decisión humana registrada), reserva activa de la misma organización, centro y cantidad/unidad consistentes, y los datos mínimos del traspaso (cantidad, unidad, centro de recepción, fecha, responsable). Sin DD, sin conclusión de riesgo.
- **Origen desconocido no se oculta:** si el lote de la emisora es de origen incompleto, la salida sigue permitida solo si se adopta (a); el traspaso lo declara `INCOMPLETE` en ambas organizaciones y no se vuelve completo por moverse. Con (b) quedaría bloqueado.
- **Decide:** propietario del producto para (a)/(b); responsable regulatorio para (c) (y para si el traspaso es «puesta en el mercado», D-05.B).
- **Cómo se implementa si se adopta (a):** sustituir el proveedor por defecto de `TRANSFER_DISPATCH_GATE` por uno que evalúe esa lista y devuelva cada condición no cumplida con su causa; sin banderas de omisión en el cuerpo. Pruebas aisladas (ya existentes para el bloqueo): positivo con condiciones cumplidas, negativo por cada condición, idempotencia de la salida, y regresión de que ningún cuerpo con banderas la salta.

## 4. Propuesta para reconocer el origen autorizado en la receptora (D3 c)
Principio: **transferir antecedentes trazables, no conclusiones.**
- La receptora conserva un **vínculo al origen autorizado**: la instantánea técnica inmutable ya existente (huella, versiones de parcela, soportes y geometrías solo si la emisora los concedió con `include_documents` / `include_geometries`). Se reutiliza la concesión de instantánea (A-08); no hay un mecanismo paralelo.
- El lote receptor **sigue `INCOMPLETE` para su propio expediente** hasta que se adopte D3 (c). Con (c) adoptada, podría marcarse `COMPLETE` **solo** si la emisora consintió la instantánea del origen y la receptora la referencia por huella; revocar la concesión corta consultas nuevas, no retira lo ya descargado.
- **No se hereda** expediente, severidad, conclusión, calidad liberada ni aprobación de la emisora (D2 sigue pendiente de revisión competente). La receptora evalúa, decide y concluye con **sus** datos y **su** responsable.
- Una concesión de análisis satelital no resuelve el linaje del lote: el linaje es `custody_lot_links` (append-only) y el origen autorizado es la instantánea; son cosas distintas.
- Lo desconocido permanece desconocido: sin consentimiento o con concesión vencida/revocada, el origen de la receptora se muestra como incompleto.

## 5. Decisiones que el propietario debe tomar (agrupadas)
1. **D4**: ¿(a), (b) o esperar a (c)? **Recomendación: (a).** Consecuencia: con (a) se habilita la salida con datos mínimos, con origen declarado incompleto cuando corresponda; con (b) se bloquean los lotes de origen incompleto; con (c) queda bloqueado todo traspaso.
2. **D3 (c)**: ¿se reconoce el origen autorizado de la emisora como origen de la receptora cuando hay consentimiento? **Recomendación: sí, con consentimiento explícito y por huella, tras adoptar (a).** Consecuencia: sin ella la receptora seguirá con lotes `INCOMPLETE` por construcción.
3. **D2**: revisión competente de qué obligaciones pasan a quien recibe. No se resuelve aquí; mientras tanto, la salvaguarda técnica (no heredar) sigue vigente.

Mientras no haya respuesta, no se habilita la salida, no se cambia la compuerta y el módulo **no se presenta como operativo de punta a punta**.
