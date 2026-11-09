# Evidencia — P0-003 cerrada: elevación supervisada y descarga por concesión (2026-10-17)

Contrato: `docs/decisiones/P0-003-CONCESIONES-Y-ELEVACION.md` (Parte II).
Entrega agrupada bajo `CLAUDE.md` §«Organización por entregas funcionales completas».

| | |
| --- | --- |
| Candidato **aprobado pero incumplidor** | `8f54b71` — validación **APROBADA** (`2026-10-17T14-48-58-076Z`) y **rechazado igualmente**: ver §2 |
| Candidato final | **`de7f996`** |
| Validación | `2026-10-17T15-12-32-239Z` — **APROBADA** |
| Pruebas | **68 suites, 638** unitarias e integración · **72** E2E · 0 fallos |
| Migraciones | **48** (`0047` elevación supervisada, `0048` ligada a la sesión) |

## 1. Qué se entregó

**Elevación de plataforma (D-04)**, política provisional local: la pide solo SUPER_ADMIN con comprobación
reciente de contraseña, la aprueba un **ORG_ADMIN activo y distinto** de la organización afectada, dura **15
minutos** como máximo desde la activación con la hora del servidor, no toca roles ni membresías, habilita
**solo** acciones de un catálogo cerrado, se revoca y se termina anticipadamente, y se audita **incluido el
uso**, con **visibilidad para la organización**.

**Descarga por concesión**: **vista compartida interna** de la **misma** proyección que el destinatario ya puede
leer —`leer()` y `descargar()` comparten una sola implementación—, identificada como tal y declarando que **no
es `DD_PACKAGE`, ni DDS, ni prueba de conformidad, ni presentación oficial**.

### 1.1 La diferencia que hubo que presentar antes de implementar

El perfil propuesto **no nombraba ninguna acción**, y el único punto de **lectura** que respondía
`ELEVATION_REQUIRED` era el **listado de miembros** (los otros dos son escrituras, que el perfil excluye). Sin
`members:read` la elevación no habilitaría nada y el criterio no podría demostrarse. Se añadió **esa sola
acción**, de lectura y **con nombres y correos redactados**.

## 2. `8f54b71` aprobó sus pruebas e **incumplía el contrato**

Queda registrado porque es la lección de la entrega: **una validación verde no acredita el contrato**.

`8f54b71` ligaba la elevación a `users.token_version`. **Esa columna es por cuenta**: permite invalidar todas
las sesiones a la vez, pero **no distingue dos sesiones simultáneas** del mismo usuario. La prueba que yo había
escrito afirmaba «la sesión queda ligada» y solo demostraba la invalidación global — una propiedad más débil.

**Reproducción del defecto** (comprobación dirigida sobre `8f54b71`):

| Observado | Resultado |
| --- | --- |
| Dos inicios de sesión de la misma cuenta | Los tokens eran **byte a byte idénticos**: el payload solo llevaba `sub` y `tv`, así que dos emisiones en el mismo segundo producían la misma cadena firmada |
| `token_version` de ambas | **El mismo** |
| Sesión B pidiendo el listado de miembros | **200 OK** — heredaba la elevación aprobada para A |

El servidor **no tenía forma alguna** de distinguir las dos sesiones.

## 3. La corrección (`0048`, `auth.ts`)

| Elemento | Antes | Ahora |
| --- | --- | --- |
| Identidad de sesión | **Ninguna** en el token | **`jti`** propio por emisión, firmado por el servidor y **nunca aceptado del cliente** |
| Qué se guarda | — | **Solo el identificador**, jamás el token |
| Vinculación de la elevación | `token_version` (por cuenta) | **`session_id`** de la sesión que probó la contraseña |
| Terminar anticipadamente | Cualquier sesión de la cuenta | **Solo esa misma sesión** |
| Invalidación global | `token_version` | **Conservado**, como protección adicional |
| Aprobador | No se revisaba después | Si deja de ser **`ORG_ADMIN` activo**, la elevación **deja de servir** |

La migración impide además **aprobar sin sesión ligada** y suma la sesión a los términos inmutables.

## 4. Pruebas

**`platform-elevation.int-spec.ts` (15)**: sin aprobación no habilita nada; solicitar exige SUPER_ADMIN y
contraseña reciente; **sin autoaprobación** ni aprobación por quien no es ORG_ADMIN activo de esa organización;
aprobada habilita **solo lectura redactada** y las escrituras siguen bloqueadas; alcance cerrado (acción fuera
del catálogo, lista vacía y duración > 15 min rechazadas); no cruza de organización; **la elevación pertenece a
la sesión solicitante** —A autorizada, **B denegada** con el mismo `token_version`, B no puede finalizarla y
volver a iniciar sesión no hereda—; **el aprobador que pierde su condición** corta el acceso; revocación
inmediata e irreversible; vencimiento con la hora del servidor; finalización anticipada; auditoría de
solicitud, aprobación, **uso** y revocación con visibilidad para la organización; y **una elevación no es una
concesión**.

**`access-grants.int-spec.ts` (12)**, con la descarga: entrega la **misma** proyección, identificada como vista
compartida interna; sin la acción concedida no hay descarga aunque se pueda leer; revocada tampoco.

Sin regresiones: 58 pruebas de `auth`, `members`, `rbac` y concesiones en verde antes del candidato.

Un hueco real que las pruebas destaparon: `actions: []` pasaba la validación del DTO y llegaba al `CHECK` de la
base como 500. Corregido con `@ArrayMinSize(1)`.

## 5. Recorrido en el DESPLIEGUE

Servicios reconstruidos **una vez** sobre `de7f996`. `e2e/review/acceso-supervisado.mjs`, **17/17 APROBADO**,
con **dos inicios de sesión reales** de la cuenta de plataforma:

| Comprobación | Resultado |
| --- | --- |
| CONTROL: lotes legibles por su organización | 200, 3 lotes |
| Conceder lectura y descarga | 201 |
| La cuenta externa lee la proyección | 200, agregados sin identidad |
| La descarga entrega la **misma** proyección, identificada | 200, `misma proyección=true`, avisos presentes |
| Revocar, y la descarga deja de servirse | 201 / 404 |
| Sin elevación, la plataforma no ve los miembros | 403 `ELEVATION_REQUIRED` |
| Solicitar desde la sesión A | 201 `PENDING` |
| Pendiente: por sí sola no habilita nada | 403 |
| **La organización VE la solicitud** | 200 |
| Aprueba un ORG_ADMIN de la organización | 201 `APPROVED` |
| **La sesión A obtiene la lectura redactada** | 200, 10 membresías, **sin nombres ni correos** |
| **La sesión B de la MISMA cuenta queda denegada** | **403 `ELEVATION_REQUIRED`** |
| La sesión B tampoco puede finalizar la de A | 404 |
| La elevación **no** abre el resto de la organización | 404 |
| La sesión A la termina anticipadamente, y la plataforma vuelve a quedar fuera | 201 / 403 |

## 6. Respaldo

`_respaldos/2026-10-17-post-p0003-elevacion`, con QA-16. **48 migraciones, 110 tablas**, clave `k2` no expuesta,
`SHA256SUMS` verificado y ACL restringida. **Los ocho anteriores se conservan.**

**Las 22 referencias públicas siguen intactas**: huella `93d21b4c…0ec9`, **idéntica** en los respaldos
post-RF-47, post-D-34.A, post-P0-003 y este. Ninguna entrega las ha alterado.

Contiene artefactos del recorrido —dos concesiones revocadas y una elevación terminada—, **ninguno activo**.

## 7. Contraste de los criterios originales de P0-003

| Criterio original | Estado | Dónde |
| --- | --- | --- |
| Catálogo efectivo, permisos por acción/recurso | **Demostrado** | `rbac`, `members`, `catalog.spec` |
| Checks de FK / **jobs** / **objects** | **Demostrado** | `qa02-jobs-objetos.int-spec.ts` (6 recursos, con control autorizado) |
| Casos A→A y A→B | **Demostrado** | `rbac`, `members`, matriz QA-02 |
| **buyer/grants** | **Demostrado** | `access-grants.int-spec.ts` (12), con concesión real a cuenta **no miembro** y **grant vencido** (QA-02) |
| **superadmin/elevación** | **Demostrado** | `platform-elevation.int-spec.ts` (15) + recorrido en despliegue |
| UI no sustituye backend | **Demostrado** | E2E por rol |

**P0-003 → DONE_LOCAL.** Y con ella: **RF-03** («permisos por recurso/acción y controles por tenant en API,
jobs, descargas y relaciones», QA-01 y QA-02) y **RNF-01** («cero accesos cruzados en la matriz QA-02, incluidos
objetos y relaciones») pasan a **demostrados**.

### Alcance declarado, para que no se lea de más

La elevación habilita **una sola acción de lectura redactada**. **No** habilita escritura, ni datos personales,
ni geometrías, ni documentos, ni administración de permisos. Cualquier soporte que los necesitara **no está
contemplado** y exigiría una decisión nueva. `DONE_LOCAL` **no** acredita producción ni conformidad EUDR.

## 8. Métricas

| Medida | Antes | Ahora |
| --- | ---: | ---: |
| Requisitos del catálogo completo | 26/59 = 44,1 % | **28/59 = 47,5 %** |
| Requisitos del alcance MVP | 25/43 = 58,1 % | **27/43 = 62,8 %** |
| Historias del MVP cerradas | 24/32 = 75 % | **25/32 = 78,1 %** |

Suben **RF-03** y **RNF-01**, ambos del MVP. Los requisitos **parciales siguen fuera del numerador**.

## 9. Medición de la segunda entrega agrupada

| | Primera (P0-003 concesiones) | Segunda (elevación + descarga) |
| --- | --- | --- |
| Validaciones completas | 2 (1 fallida por lint) | **2** (1 aprobada **pero rechazada por contrato**) |
| Despliegues | 1 | **1** |
| Respaldos | 1 | **1** |
| Commits de resultados | 1 | **1** |

Las dos repeticiones tuvieron **causas distintas y ninguna fue la agrupación**: la primera, no repasar lint tras
el último ajuste; la segunda, **un defecto de contrato que las pruebas verdes no detectaban** y que apareció al
comprobarlo de forma dirigida. La segunda es, de hecho, el argumento a favor de la comprobación dirigida: sin
ella se habría cerrado una entrega que incumplía su propio contrato.
