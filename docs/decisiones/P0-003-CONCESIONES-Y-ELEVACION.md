# P0-003 — Concesiones externas y elevación de plataforma

**Estado: ambas mitades ADOPTADAS como políticas provisionales locales e implementadas.**
Concesiones (D-P0003.1 = A) el 2026-10-16; **elevación supervisada (D-04) y descarga por concesión** el
2026-10-17. Fecha de origen del contraste: 2026-10-16.
Criterios originales (`docs/18_BACKLOG.md` P0-003): «catálogo efectivo, permisos por acción/recurso, checks de
FK/jobs/objects; casos A→A y A→B, **buyer/grants** y **superadmin/elevación**; UI no sustituye backend».
RF-03 · QA-02.

Este documento separa **dos cosas que el criterio junta en una línea y que no son la misma**, dice qué está
implementado y qué falta, contrasta D-04 y los permisos actuales, y presenta **solo** las decisiones que
bloquean de verdad la implementación.

---

## 1. Las dos mitades, que no son la misma

| | **Concesión externa** (grant) | **Elevación de plataforma** |
| --- | --- | --- |
| Quién accede | Una organización **externa** o su cuenta (p. ej. un comprador europeo) | **SUPER_ADMIN**, que no es miembro de la organización |
| Quién decide | **La organización dueña de los datos** | La **plataforma**, con la aprobación que D-04 fije |
| Naturaleza | Acto **voluntario** del dueño: comparte parte de lo suyo | Acto **excepcional** del operador: entra donde no le pertenece |
| Riesgo principal | Compartir de más, o que no se pueda revocar | Acceso silencioso sin que el dueño se entere |
| Decisión abierta | **Contrato de grants** (ADR-0002, P1-001) | **D-04** |

**No se deben resolver juntas.** Una concesión la otorga el dueño y debe poder retirarla; una elevación la
ejerce la plataforma contra la voluntad potencial del dueño y por eso exige notificación y caducidad. Mezclarlas
produciría un mecanismo que sirve de puerta trasera.

---

## 2. Qué está implementado hoy (verificado)

De los criterios de P0-003, **ya están demostrados**: catálogo efectivo de permisos, permisos por acción y
recurso, organización y membresía activas, referencias del mismo tenant, anti-escalamiento, efecto inmediato de
las revocaciones, ausencia de datos de otra organización, y varios roles y organizaciones por cuenta
(`rbac.int-spec.ts`, `members.int-spec.ts`, E2E por rol). El caso **A→A y A→B** está cubierto para los recursos
operativos.

### 2.1 Qué es hoy un «BUYER», que no es lo que parece

Dos cosas distintas llevan ese nombre, y conviene no confundirlas:

| | Qué es | Acceso que da |
| --- | --- | --- |
| **`buyers`** (tabla) | Una fila de **catálogo comercial dentro de la organización**: `code`, `name`, `country`, `status`. La contraparte de un embarque | **Ninguno.** No tiene usuario, ni membresía, ni sesión |
| **Rol `BUYER`** | Un rol asignable a una membresía | **Ninguno**: `ROLE_PERMISSIONS.BUYER = []` (`catalog.ts:160`) |

Y en los datos DEMO, «Chocolates Europa (importador UE)» es una **organización propia con su propia membresía**,
no una concesión. **Una segunda membresía DEMO no es una concesión externa** y no debe presentarse como tal: hoy
esa cuenta ve lo suyo porque es miembro de su organización, no porque nadie le haya concedido nada.

### 2.2 Qué es hoy SUPER_ADMIN

Solo permisos de plataforma: `organization:create`, `organization:suspend`, `organization:list_all`,
`organization:onboard_admin`, `user:deactivate` (`catalog.ts` `PLATFORM_PERMISSIONS`). **No hay bypass global.**
Cualquier acceso a miembros, datos personales, bitácora u operación de una organización donde no es miembro
responde hoy `ELEVATION_REQUIRED` o `404` — y ese rechazo existe en **un solo sitio**: `members.ts:110`.

---

## 3. Qué falta, y qué parte NO depende de ninguna decisión

**No existe ninguna estructura**: no hay tablas de concesiones, de elevación ni de compartición. Comprobado en la
base de desarrollo.

| Criterio de P0-003 | Estado | ¿Bloqueado por una decisión? |
| --- | --- | --- |
| Catálogo efectivo, permisos por acción/recurso | **Verificado** | — |
| Casos A→A y A→B sobre recursos operativos | **Verificado** | — |
| UI no sustituye backend | **Verificado** | — |
| **Checks de jobs y objetos** | **No demostrado como criterio** | **No.** Se difirió «hasta que existan esos recursos», y **ya existen**: exportaciones del expediente, descargas de documentos, trabajos satelitales, exportaciones de reportes y el depósito de objetos. Hay aislamiento probado en suites sueltas, pero **no una matriz QA-02 que lo acredite como criterio** |
| **buyer/grants** | **No implementado** | **Sí**: falta el contrato de grants |
| **superadmin/elevación** | **No implementado** | **Sí**: falta D-04 |

**Lo implementable ya, sin esperar a nadie**: consolidar la **matriz QA-02 de jobs y objetos** —acceso cruzado a
exportaciones, descargas, trabajos satelitales y objetos del depósito, con caso autorizado de control— y
cerrarlo como criterio. No necesita ninguna decisión de producto.

---

## 4. Decisiones que bloquean de verdad

Solo dos. Todo lo demás de P0-003 o está hecho o es trabajo sin decisión.

### D-P0003.1 — Contrato de concesiones externas

ADR-0002 está **PROPUESTO**, no aceptado, y solo fija la dirección: «compartición mediante **grants tipados**,
campos/vigencia/revocación y **no joins implícitos por identidad**». Las fuentes piden el resultado, no el
mecanismo: S3 §22.8 describe el Buyer Portal de un lote y dice **«Con acceso controlado»**; S4 añade que «el
BUYER **no debería ver el backoffice completo**». Ninguna define concedente, alcance, duración ni revocación.

**Lo que hay que fijar, campo por campo** (esta es la propuesta a decidir, no algo adoptado):

| Elemento | Propuesta | Por qué |
| --- | --- | --- |
| **Concedente** | La organización **dueña del recurso**, por un rol con facultad explícita (`grant:manage`), nunca por quien solo opera | Es un acto de disposición sobre datos propios |
| **Destinatario** | Una **organización** externa identificada, no un correo suelto ni un enlace | Permite revocar por organización y auditar a quién se dio |
| **Recursos** | **Enumerados y por instancia**: este lote, este embarque, este expediente. **Nunca «todos los lotes»** | Evita que una concesión se convierta en acceso general |
| **Acciones** | Solo **lectura** y **descarga del paquete**, en esta etapa. Sin escritura | Un tercero no opera sobre datos ajenos |
| **Duración** | **Vencimiento obligatorio**, con máximo; sin opción «indefinida» | Una concesión sin caducidad es una membresía encubierta |
| **Revocación** | En cualquier momento, **con efecto inmediato** y sin borrar el registro histórico | Ya se exige «efecto inmediato de revocaciones» para membresías |
| **Clasificación de datos** | La concesión **no levanta** la clasificación: `PERSONAL_DATA` sigue exigiendo su permiso, y la identidad cifrada **no se entrega**. El portal muestra **agregados y dictámenes**, como en S3 §22.8 («183 productores», no sus nombres) | Compartir un lote no es compartir a sus productores |
| **Auditoría** | Otorgar, usar y revocar quedan en la bitácora con actor, momento, recurso y motivo | QA-02 lo exige para membresías; una concesión no puede ser menos |

**Tres opciones de alcance para esta etapa:**

| Opción | Qué entrega | Consecuencia |
| --- | --- | --- |
| **A** *(recomendada)* | **Solo el contrato y el mecanismo**: tabla de concesiones tipadas con vigencia y revocación, autorización en backend y matriz QA-02 — **sin portal** | Cierra el criterio «buyer/grants» de P0-003 con pruebas reales, sin invadir RF-32/P1-001, que es donde vive el portal |
| **B** | Contrato **más** portal de lectura para el destinatario | Cierra P0-003 y adelanta RF-32, pero mezcla dos historias y amplía mucho la superficie en una sola entrega |
| **C** | Esperar a P1-001 y dejar el criterio abierto | P0-003 sigue bloqueada indefinidamente por una historia de evolución |

**Recomendación: A.** El criterio de P0-003 es «buyer/grants» como **control de autorización**, no como pantalla.
Con A se demuestra que una organización externa puede recibir acceso acotado, vencido y revocable, y que **sin
concesión no ve nada** — que es lo que QA-02 debe acreditar. El portal queda en RF-32/P1-001.

### D-P0003.2 — D-04, política de elevación

`docs/22` ya enuncia la decisión mínima: **(1)** quién puede elevar y con qué aprobación, **(2)** motivo
obligatorio y duración máxima, **(3)** alcance (lectura o escritura, y sobre qué recursos), **(4)** cómo se
notifica a la organización y cómo se audita. **No la reabro ni la propongo resuelta**: es de producto y
seguridad, y sin esas cuatro respuestas no hay nada que implementar.

Lo único que añado es el **contraste técnico**: hoy el rechazo vive en un solo punto (`members.ts:110`), así que
implementar la elevación **no** exige tocar la autorización general; exige una concesión temporal registrada que
ese punto —y los equivalentes que D-04 incluya en su alcance— consulten.

**Opciones de alcance, para cuando se decida:**

| Opción | Qué permite | Consecuencia |
| --- | --- | --- |
| **A** | Elevación de **solo lectura**, temporal, con motivo y notificación | La más defendible; cubre soporte y diagnóstico, que es el caso real |
| **B** | Lectura y escritura | Mucho más difícil de justificar ante el dueño de los datos; no hay caso de uso declarado que lo exija |
| **C** | Sin elevación: la plataforma nunca entra | Defendible, y dejaría el criterio cerrado por diseño en vez de por implementación |

**No recomiendo ninguna todavía**: a diferencia de los grants, aquí la decisión es **de política**, no de
mecanismo, y la última palabra no es técnica. Lo que sí señalo es que **C es una respuesta válida** y hoy nadie
la ha considerado: si la plataforma no necesita entrar, el criterio se cierra declarando que no hay elevación.

---

## 5. Lo que no se hará en ningún caso

- **No se concede acceso automático a `BUYER` ni a `SUPER_ADMIN`.** Siguen sin permisos y sin bypass.
- **No se convierte una segunda membresía DEMO en una concesión externa.** Una membresía y una concesión son
  mecanismos distintos y se probarán por separado.
- **No se infiere acceso por identidad**: ni por coincidencia de correo, ni de nombre, ni de país. ADR-0002 lo
  prohíbe explícitamente («no joins implícitos por identidad»).
- **Una concesión no levanta la clasificación de datos** ni entrega identidad cifrada.
- No se tocan P0-017/P0-029, la conclusión `UNDETERMINED`, los requisitos de `READY` ni el satélite.

## 6. Qué propongo hacer ahora

1. **Sin decisión**: consolidar la matriz **QA-02 de jobs y objetos**, que estaba diferida porque esos recursos
   no existían y hoy existen. Cierra una parte del criterio con pruebas reales.
2. **Con decisión D-P0003.1 = A**: implementar el contrato de concesiones —tabla tipada, vigencia, revocación,
   autorización en backend, auditoría— y su matriz QA-02, **sin portal**.
3. **D-04 queda a la espera.** No se implementa nada de elevación hasta que sus cuatro preguntas tengan
   respuesta, y **C (no haber elevación) es una de las respuestas posibles**.

Con 1 y 2, P0-003 quedaría con **un solo criterio abierto** —elevación— en lugar de dos.

---

# Parte II — Políticas adoptadas el 2026-10-17

## 7. Elevación de plataforma supervisada (D-04)

**Decisiones de diseño del MVP local, no obligaciones deducidas de las fuentes.** Implementada en la migración
`0047_d04_elevacion_supervisada` y en `apps/api/src/authz/platform-elevation.ts`.

| # | Política | Cómo se garantiza |
| --- | --- | --- |
| 1 | La pide **solo SUPER_ADMIN**, autenticado y con **comprobación reciente de contraseña** | `requirePlatform` + `verifyPassword`; conocer un identificador de organización no basta |
| 2 | La aprueba un **ORG_ADMIN activo y distinto** de la organización afectada. **Sin autoaprobación ni excepción de emergencia** | `CHECK approved_by <> requested_by`, disparador que exige ORG_ADMIN activo de esa organización, y comprobación en el caso de uso |
| 3 | Identifica organización, finalidad, motivo, ámbito, acciones y duración. **Máximo 15 minutos** desde la activación, con la hora del servidor | Campos obligatorios; `CHECK duration_seconds BETWEEN 60 AND 900`; `expires_at` se fija al aprobar y se compara con `now()` |
| 4 | **No modifica roles ni crea membresías.** Ligada al solicitante y **a su sesión**; no acumula entre organizaciones | No toca `memberships` ni `role_assignments`; **`session_id` (el `jti` del token firmado) liga la sesión concreta**, y `session_token_version` queda como protección adicional para la invalidación global; índice único por organización y solicitante. Ver §7.2 |
| 5 | Solo acciones **expresamente solicitadas, aprobadas y soportadas**. Sin «acceso total». Identidad, geometrías, documentos personales, escritura y administración de permisos **excluidos** | Catálogo cerrado `['members:read']` con `CHECK actions <@ ...`; la lectura elevada **redacta nombres y correos**; las escrituras de `members.ts` siguen bloqueadas |
| 6 | **Revocación inmediata** por el aprobador y **finalización anticipada** por el solicitante (solo desde su propia sesión). Vencimiento, cierre de sesión, desactivación **o que el aprobador pierda su condición** cortan el acceso | Rutas `revoke` y `end`; `vigente()` revalida estado, `expires_at > now()`, cuenta activa, `token_version`, **`session_id`** y que el **aprobador siga siendo `ORG_ADMIN` activo** |
| 7 | Auditoría de solicitud, aprobación o rechazo, activación, revocación y **uso**, sin datos protegidos; y **visibilidad para la organización** | `elevation.request/approve/reject/revoke/end/use` en la bitácora; `GET …/platform-elevations` lista solicitudes, estado y nº de usos para quien administra membresías |

### 7.1 La diferencia concreta que hubo que presentar

El perfil propuesto **no nombraba ninguna acción**, y el **único punto de lectura** que hoy responde
`ELEVATION_REQUIRED` es el **listado de miembros** (`members.ts`; los otros dos son escrituras —cambiar
membresía y cambiar roles— que el perfil excluye). Sin incluir `members:read`, la elevación no habilitaría nada
y el criterio «superadmin/elevación» **no podría demostrarse**.

Se añade por eso **una sola acción**, de lectura, y **con los datos personales redactados**: la plataforma ve la
forma de la organización —cuántas membresías, con qué roles y en qué estado— **no quiénes son**. No se amplía
ningún otro privilegio por interpretación.

### 7.2 Corrección: `token_version` no identifica una sesión

La primera implementación ligaba la elevación a `users.token_version`. **Esa columna es por cuenta**: permite
invalidar todas las sesiones a la vez, pero **no distingue dos sesiones simultáneas** del mismo usuario.
Comprobado en la suite, y peor de lo supuesto: dos inicios de sesión de la misma cuenta compartían
`token_version` y, al no haber nada único en el payload, producían **el mismo token**; la segunda sesión
**heredaba** la elevación aprobada para la primera. Eso incumplía «ligada al solicitante y a su sesión».

**Corregido** (migración `0048`, `auth.ts`): el token lleva ahora un **`jti` propio por emisión**, que firma el
servidor y **nunca se acepta del cliente**; la elevación guarda **solo ese identificador**, jamás el token, y el
uso exige que coincida con la sesión que presenta la petición. La comprobación de contraseña queda ligada a esa
misma sesión. `token_version` **se conserva** como protección adicional.

Queda demostrado por prueba: dos sesiones con el **mismo `token_version`**, A obtiene la lectura aprobada y **B
queda denegada**; B tampoco puede **finalizar** la elevación de A; y **volver a iniciar sesión no hereda** la
autorización anterior.

## 8. Descarga por concesión: vista compartida interna

Sustituye al rechazo `GRANT_DOWNLOAD_PENDING_DECISION` que esta misma decisión dejó pendiente el 2026-10-16.

- Es **un archivo interno de la MISMA proyección** que el destinatario ya puede leer. `leer()` y `descargar()`
  comparten **una sola** implementación (`proyeccion()`): no existe una segunda, más amplia.
- Se **identifica como lo que es**: `tipo_de_archivo: VISTA_COMPARTIDA_INTERNA`, con recurso, fecha de
  generación y limitaciones, y dice explícitamente que **no es un `DD_PACKAGE`, ni una DDS, ni prueba de
  conformidad, ni una presentación oficial**.
- **No sirve el paquete final original** ni incorpora identidad, geometrías o documentos que la concesión no
  permita. Revalida cuenta, concesión, vencimiento, revocación y acción **al descargar**, audita la descarga y
  no crea enlaces públicos.

## 9. Estado de los criterios de P0-003

| Criterio original | Estado |
| --- | --- |
| Catálogo efectivo, permisos por acción/recurso | **Verificado** |
| Casos A→A y A→B | **Verificado** |
| UI no sustituye backend | **Verificado** |
| Checks de FK/jobs/objects | **Demostrado** (matriz QA-02, 2026-10-16) |
| buyer/grants | **Demostrado** (concesiones reales + descarga, 2026-10-17) |
| superadmin/elevación | **Demostrado** con el perfil adoptado (2026-10-17) |

**Lo que el perfil adoptado NO cubre, y por tanto no se declara:** la elevación habilita **una** acción de
lectura redactada. Cualquier soporte que exigiera datos personales, geometrías, documentos o escritura
**sigue sin estar contemplado** y necesitaría una decisión nueva. RF-03 y los RNF solo se actualizan si cada
requisito completo queda demostrado; esto se contrasta en el cierre de la entrega, no aquí.
