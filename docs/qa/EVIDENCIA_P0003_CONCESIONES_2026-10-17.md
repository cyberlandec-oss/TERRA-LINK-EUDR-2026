# Evidencia — P0-003: concesiones externas, matriz QA-02 y referencias autorizadas (2026-10-17)

Contrato: `docs/decisiones/P0-003-CONCESIONES-Y-ELEVACION.md`. **Primera entrega bajo la organización por
entregas funcionales completas** (`CLAUDE.md` §«Organización por entregas funcionales completas»).

| | |
| --- | --- |
| Candidato rechazado | `33af232` — **FALLIDA** en lint. Registros en `validation-results/2026-10-17T14-06-26-000Z` |
| Candidato aprobado | **`05c22eb`** |
| Validación | `2026-10-17T14-08-09-655Z` — **APROBADA** |
| Pruebas | **67 suites, 622** unitarias e integración · **72** E2E · 0 fallos |
| Fases | servicios 1 s · typecheck 14 s · lint 11,5 s · build 62,1 s · openapi 15 s · pruebas 776,7 s · e2e 141,8 s |
| Respecto de `72e4367` | 65→**67** suites y 607→**622** pruebas: las dos suites nuevas y sus 15 casos |
| Migraciones | **46** (`0046_p0003_concesiones_externas`) · 109 tablas |

## 1. Qué se entregó

Un solo resultado verificable —**el acceso externo acotado**— con sus tres piezas juntas.

**Concesiones externas** (D-P0003.1 opción A). `access_grants` con vencimiento obligatorio y posterior a la
creación, revocación completa o ninguna, **una sola activa** por destinatario y recurso (índice único parcial),
y dos disparadores: el recurso debe ser **de la organización concedente**, y los términos **no se editan** ni se
reactiva una revocada. Concede `ORG_ADMIN` con el permiso nuevo `grant:manage`, y **no puede conceder lectura o
descarga que él no tenga**. El destinatario es una cuenta **existente y activa**, nunca inferida por identidad.

La vía del concesionario (`/api/v1/granted`) **no consulta membresías**: revalida cuenta, concesión,
vencimiento, revocación y acción **en cada acceso**, y responde igual para inexistente y no concedido. La
proyección entrega **agregados** —productores y parcelas como conteos, al modo de S3 §22.8— **sin identidad, sin
geometrías y sin documentos**: la concesión **no levanta la clasificación**.

**Matriz QA-02 de jobs y objetos**, el criterio que estaba diferido «hasta que existan esos recursos». Seis
recursos reales: exportación del expediente, trabajo satelital, contenido de documento y exportaciones de
indicadores, de reporte por entidad y de bitácora.

**RF-47**: la referencia se entrega en la **lectura autorizada** de productor, lote y embarque. Entregarla a
quien ya puede leer el recurso **no es publicarla por audiencias** —eso sigue siendo RF-33—, y la revisión deja
de depender de consultar la base. No altera contenido ni hash de ninguna instantánea.

## 2. La decisión que la entrega destapó

**La DESCARGA no se concede todavía**, y se rechaza con `GRANT_DOWNLOAD_PENDING_DECISION`, que explica el
motivo en vez de fallar en silencio. El conflicto está contrastado en el código: construir el paquete para una
cuenta sin permisos produce **redacciones** (geometrías y documentos con datos personales), y la exportación de
un `DD_PACKAGE` **se bloquea** cuando las hay (`EXPORT_SCOPE_INSUFFICIENT`, `dd.ts`); servir en su lugar el ya
exportado entregaría ese contenido, que es justo lo que el punto 6 del contrato prohíbe ampliar sin contrato
expreso. Es la única decisión de producto pendiente de esta funcionalidad.

## 3. Pruebas

**`access-grants.int-spec.ts` (11)**: sin concesión no se ve nada; solo `ORG_ADMIN` concede y nadie concede lo
que no tiene; recurso de otra organización rechazado por la base; vencimiento obligatorio y futuro; descarga con
su decisión declarada; proyección sin identidad ni geometrías ni documentos; la concesión **no abre** la vía
normal ni el acceso a productores; concesión por **instancia**, no por tipo; revocación inmediata, irreversible
y con términos inmutables; concesión vencida que deja de servir; cuenta desactivada; concurrencia (dos
simultáneas → **una sola activa**); rollback de auditoría sin dejar concesión; y auditoría de **crear, usar y
revocar** sin secretos.

**El acceso se demuestra con una concesión real a una cuenta que NO es miembro** de la organización dueña —es
miembro de otra—, no con una segunda membresía.

**`qa02-jobs-objetos.int-spec.ts` (4)**: el dueño accede a los seis recursos (**control autorizado**), ninguna
cuenta ajena accede ni se revela existencia, sin autenticación no se obtiene nada, y el objeto del depósito no
se alcanza por clave adivinada. La suite **se niega a aprobar si algún recurso no pudo prepararse**: así no hay
«OK» por ruta inexistente ni por respuesta vacía.

## 4. Verificación en el DESPLIEGUE

Servicios reconstruidos **una vez** sobre `05c22eb`. `e2e/review/concesiones.mjs`, **11/11 APROBADO**,
comprobando comportamiento y no disponibilidad:

| Comprobación | Resultado |
| --- | --- |
| Lotes legibles por su organización (**control autorizado**) | 200, 3 lotes |
| RF-47: referencia en la lectura autorizada del lote | 200, referencia opaca presente |
| Sin concesión, la cuenta externa no ve el lote | 404 |
| Sin concesión, su lista de concedidos está vacía | 200, 0 concesiones |
| La descarga se rechaza con su decisión pendiente | 422 `GRANT_DOWNLOAD_PENDING_DECISION` |
| Conceder lectura | 201, lectura sí / descarga no |
| La cuenta externa lee la proyección | 200, agregados sin identidad |
| La concesión **no** abre la vía normal ni productores | 404 / 404 |
| Revocar, y la proyección deja de servirse | 201 / 404 |

La revisión deja **una concesión revocada** en los datos DEMO: es un artefacto de revisión, no una concesión
operativa.

## 5. Respaldo

`_respaldos/2026-10-17-post-p0003`, con QA-16: escrituras pausadas, base y objetos del mismo instante,
aplicación reanudada. **46 migraciones, 109 tablas, 22 referencias**, clave `k2` no expuesta, `SHA256SUMS`
verificado y ACL restringida. **Los siete anteriores se conservan.**

**Las 22 referencias públicas son exactamente las mismas** desde RF-47: la huella del conjunto es
`93d21b4c…0ec9` en los respaldos post-RF-47, post-D-34.A y este. Ninguna entrega posterior las alteró.

## 6. Criterios de P0-003: antes y ahora

| Criterio | Antes | Ahora |
| --- | --- | --- |
| Catálogo efectivo, permisos por acción/recurso | Verificado | Verificado |
| Casos A→A y A→B | Verificado | Verificado |
| UI no sustituye backend | Verificado | Verificado |
| **Checks de FK/jobs/objects** | Diferido | **Demostrado** (matriz QA-02) |
| **buyer/grants** | Bloqueado sin contrato | **Demostrado** con concesiones reales |
| **superadmin/elevación** | Bloqueado por D-04 | **Sigue bloqueado** |

**P0-003 queda con un solo criterio abierto** —elevación— en lugar de tres. **No se cierra la historia**: D-04
sigue pendiente y **no se cierra por omisión**; aquí no hay elevación, ni implícita ni explícita.

## 7. Lo que NO cambia

- **El avance sigue en 26/59 = 44,1 %.** RF-03 exige también la elevación, así que no se da por demostrado.
- `BUYER` y `SUPER_ADMIN` **no ganan ningún permiso**. No hay bypass global.
- **No se construyó el portal comprador** (RF-32 / P1-001), que sigue abierto.
- `UNDETERMINED`, `READY` y despacho bloqueados, satélite deshabilitado, P0-017 y P0-029 abiertas.

## 8. Medición de la nueva organización (primera entrega)

| | |
| --- | --- |
| Validaciones completas | **2** (una fallida por lint, una aprobada) |
| Causa de la repetición | **No volver a pasar lint tras el último ajuste del fixture**, no la agrupación |
| Despliegues | **1** |
| Respaldos | **1** |
| Commits de resultados | **1** (este) |

Como referencia, las entregas anteriores de este mismo día consumieron una validación completa **por cada
pieza** (RF-47, D-34.A) más sus despliegues y respaldos. La comparación útil llega con la **segunda** entrega
bajo este procedimiento; no se adelantan porcentajes de ahorro.
