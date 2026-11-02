# Evidencia — D-34.A condición de despacho (2026-10-16)

Contrato: `docs/decisiones/D-34-PROPUESTA.md` rev. 4. Condición escrita: `docs/06_DICCIONARIO_DATOS.md`
§«Las dos condiciones del despacho». Historias: **P0-029** y **P0-017**, que **siguen abiertas**.

| | |
| --- | --- |
| Commit del código | **`72e4367`** |
| Validación | `2026-10-17T03-55-31-909Z` sobre `72e4367` — **APROBADA** |
| Pruebas | **65 suites, 607** unitarias e integración · **72** E2E · 0 fallos |
| Fases | servicios 1 s · typecheck 28,4 s · lint 10,6 s · build 64,4 s · openapi 19,6 s · pruebas 715,2 s · e2e 132,8 s |
| Respecto de `d8bb9c9` | 64→**65** suites y 598→**607** pruebas: la suite de D-34.A y sus 9 casos |
| Migraciones | **45** (`0045_d34a_compuerta_despacho`) · catálogo KDE **1.7.0** |

## 1. Qué se adoptó

**Opción A**: para despachar se exige el paquete final de diligencia, **sin** excepción por declarar «no sujeto».
Es una **política operativa de producto**, no la afirmación de que todo movimiento esté jurídicamente sujeto a lo
mismo. Con dos decisiones que A dejaba abiertas y que se resolvieron **antes** de implementar:

- **D-34.A.1 = A** — `SHIPMENT_LINK` se satisface con un **vínculo previo**: un ítem de embarque con reserva
  activa de la misma organización. **No exige que la mercancía haya salido.**
- **D-34.A.2 = A** — la acreditación se registra **por ítem**; la columna única de `shipments` **queda retirada**.

## 2. Los dos contrastes previos, y lo que encontraron

**a) La dependencia circular era real, y la fuente deja el punto indefinido.** Despachar exige el paquete → el
paquete exige `readiness = READY` → `readinessOf` exige **todos** los requisitos `MET` → incluye
`SHIPMENT_LINK`. Si `SHIPMENT_LINK` hubiera exigido el despacho, el bloqueo habría sido **irrompible**.
**S1 §44** enumera el contenido del `DueDiligenceEvidencePackage` —`operator, product, quantity, country, plots,
production_period, suppliers, chain_actors, deforestation_evidence, legality_evidence, risk_assessment,
mitigation, verification, audit_trail`— y **no incluye embarque, despacho ni `dispatch_at`**; el requisito citaba
historias internas, no una sección de la fuente. Por eso la semántica era decisión de producto y se presentó
antes de implementarla.

**b) `dd_package` estaba declarada entidad pendiente.** En `kde-schema.ts` figuraba en `PENDING_ENTITIES`
—«la referencia se acepta como *no verificable*, **nunca como válida**»—, de modo que la compuerta **no habría
podido pasar nunca**. La acreditación sí existe (`dd_exports` con `kind = 'DD_PACKAGE'`), así que se hizo
verificable, con esta división:

| Quién comprueba | Qué |
| --- | --- |
| Validador KDE | Existencia, **tenant** y **tipo** (`DD_PACKAGE`, no `INTERNAL_REVIEW`) |
| La operación | **Correspondencia**: lote del ítem, embarque, ítem, reserva y cantidad |

**Una FK por organización no demuestra correspondencia con el lote**, y por eso no se dejó en manos de la FK.

## 3. Garantías implementadas

| Garantía | Mecanismo |
| --- | --- |
| Acreditación por ítem | `shipment_items.dd_package_export_id` + FK `(organization_id, dd_package_export_id)` |
| Correspondencia real con el lote y el tipo | Disparador de restricción sobre `dd_exports → dd_snapshots → dd_cases` |
| Sin reemplazo silencioso ni retirada | Disparador de inmutabilidad: una vez registrada, no cambia |
| El paquete cubre **este** vínculo | `LINK_MISMATCH` si la instantánea aprobada acredita otro embarque/ítem/reserva/cantidad |
| Un cambio posterior invalida | El vínculo va en el contenido: liberar la reserva deja la instantánea `STALE` sin modificarla |
| `dispatch_at` obligatorio en `DISPATCHED`, ausente antes | `CHECK shipments_dispatch_at_state` (+ `shipments_dispatch_stamp`) |
| Procedencia del sello | Lo pone el servidor en la transacción; **ningún DTO lo acepta** |
| Todo o nada | El despacho revalida dentro de su transacción; si un ítem falla, no se consume ninguna reserva ni queda acreditación parcial |
| Consumo único | Sin cambios en el ledger: reservas `ACTIVE → CONSUMED` con movimiento por reserva |

## 4. Las nueve pruebas (fixtures sintéticas declaradas)

`apps/api/test/d34a-despacho.int-spec.ts`, contra PostgreSQL real, **todas aprobadas**: vínculo previo que
satisface `SHIPMENT_LINK` identificando embarque, ítem, lote, reserva y cantidad; liberar la reserva tras
aprobar desactualiza la acreditación y vuelve a bloquear, sin reescribir la instantánea; la base rechaza un
paquete de otro lote, de otra organización o un borrador; un paquete del lote correcto en **otro contexto de
embarque** no acredita; **un solo ítem sin acreditar revierte toda la operación**; con todos acreditados
despacha una vez, es idempotente y **conserva la acreditación histórica** tras consumir las reservas; el sello
solo existe en `DISPATCHED` y la base lo impone; permisos (auditor y responsable EUDR no despachan, otra
organización no ve nada); y concurrencia (dos despachos simultáneos → **un solo consumo**).

### Qué son exactamente las fixtures sintéticas

Lo **único** sintético es **`READY` y su aprobación**: hoy son inalcanzables por la vía del producto porque
`LEGAL_PROFILE`, `GEOLOCATION_PROFILE`, `RISK_CATALOG_APPROVED`, `REGULATORY_CONCLUSION` y
`DEFORESTATION_ANALYSIS` siguen `NOT_EVALUABLE` (D-05.B, D-07.5/.6, P1-005, D-09.B).

- La instantánea se **captura por la vía real**: contenido, hash, hashes por sección y vínculos auténticos, de
  modo que la comprobación de vigencia funciona igual que en producción.
- `dd_snapshots` **es append-only por disparador y así sigue**: el estado `READY` no se introduce modificando
  ninguna fila, sino **insertando** otra instantánea que copia el contenido y el hash reales.
- **No se cambió ningún requisito regulatorio** ni se fabricó un `READY` por la vía del producto.

**Esto demuestra la MECÁNICA de la compuerta. No demuestra aprobación operativa del expediente y no permite
cerrar P0-017 ni P0-029.**

## 5. Verificación en el DESPLIEGUE

`api` y `worker` reconstruidos sobre `72e4367`. Catálogo **servido** comprobado por la API
(`/kde-catalog`) y la configuración de compuertas en la base:

| Comprobación | Resultado |
| --- | --- |
| Versión del catálogo servida | **1.7.0** |
| `SHIPMENT_ITEM_PACKAGES` | **REQUIRED**, `shipment_items.dd_package_export_id`, compuerta **BLOCKING** |
| `SHIPMENT_DISPATCH_AT` | **REQUIRED**, **sin** condición `undefined_in_contract`, compuerta **BLOCKING** |
| `SHIPMENT_PACKAGE` | **retirada**: no aparece entre las definiciones vigentes |
| Ninguna definición de SHIPMENT con condición indefinida | confirmado |
| `due_diligence_ready` | **0**: ningún expediente alcanza `READY` |

**Límite declarado de esta verificación**: en desarrollo hay **0 embarques**, así que la **evaluación en
ejecución** de la compuerta no se ejercitó en el despliegue; lo verificado allí es su **configuración servida**.
El comportamiento en ejecución —bloquear por dato faltante y no por decisión pendiente— lo ejercita la suite de
integración, donde la compuerta devuelve `REQUIRED_MISSING` en lugar del antiguo `BLOCKED_PENDING_DECISION`.
La respuesta del catálogo tampoco expone `entity`/`field`, así que esa parte se contrastó contra la base.

## 6. El respaldo va por detrás del desarrollo

| | Migraciones | Catálogo KDE | Referencias públicas |
| --- | ---: | --- | ---: |
| Desarrollo | **45** | **1.7.0** | 22 |
| `_respaldos/2026-10-16-post-rf47` | **44** | 1.6.0 | 22 |

**Restaurar hoy desde ese respaldo perdería la migración `0045`**: la acreditación por ítem, los disparadores de
correspondencia e inmutabilidad, los `CHECK` del sello y el catálogo `1.7.0`. Es una **limitación vigente del
retorno**, no un defecto del respaldo: se tomó tras aprobar y desplegar RF-47, antes de esta entrega. **No se
tomó un respaldo nuevo**: procede cuando esta entrega se dé por aceptada.

Se suma a la limitación ya registrada para RF-47: un ciclo `down`/`up` **reversibiliza el esquema pero no
conserva las referencias**, porque `up` las vuelve a generar con valores distintos.

## 7. Lo que NO cambia

- **P0-029 y P0-017 siguen abiertas.** Definir la condición y probar su mecánica no es su aceptación completa.
- **El avance sigue en 26/59 = 44,1 %.** Ni RF-17, ni RF-29, ni RNF-02 se dan por demostrados.
- Conclusión regulatoria **`UNDETERMINED`**, `READY` **bloqueado**, satélite **deshabilitado**.
- No se creó ningún permiso ni se amplió ninguno.
- **D-34 queda adoptada solo como regla provisional del MVP local**, y no acredita conformidad EUDR.
