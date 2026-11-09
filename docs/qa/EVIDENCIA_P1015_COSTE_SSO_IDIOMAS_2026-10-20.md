# Evidencia — P1-015 / D-54: coste estimado, acceso federado (OIDC + PKCE) e inglés (2026-10-20)

Entrega funcional agrupada. **P1-015 permanece PARCIAL** y la cobertura de requisitos **no cambia** (42/60 = 70 %).

| | |
| --- | --- |
| Candidato funcional **validado y desplegado** | **`4f7e635`** (el commit documental `9ff1cc5` y los posteriores no cambian código funcional ni repiten la validación) |
| Validación | `validation-results/2026-10-20T02-56-21-428Z` — **APROBADA**: typecheck, lint, build, OpenAPI, pruebas unitarias+integración (**88 suites, 953 pruebas**), E2E (**78**, incluidos 6 nuevos) |
| Despliegue | `/version` → `commit=4f7e635`, esquema `0056_p1015_coste_plataforma_sso` (56 migraciones) |
| Respaldo | `_respaldos/2026-10-20-p1015-migracion-0056/` (ver §6) |
| Dependencia nueva | `openid-client` 5.7.1 (certificada OpenID, CJS) |

## 1. Cómo se llegó a `4f7e635` (candidatos descartados, con su causa)

| SHA | Resultado | Causa y tratamiento |
| --- | --- | --- |
| `1859aa0` | validación **APROBADA** (`2026-10-20T01-33-24-732Z`) | Primer candidato funcional. Al ejercerlo contra **Keycloak real** apareció un defecto que el proveedor simulado no podía mostrar (siguiente fila). **No se atribuye a `1859aa0` la corrección.** |
| `85afbfe` | validación **FALLIDA** en E2E (`2026-10-20T02-14-54-015Z`; pruebas de integración aprobadas) | Corrige el defecto de Keycloak (abajo). El E2E falló en **un** caso porque el `.env` del equipo traía `SSO_ENABLED=true` (demostración) y el servidor E2E lo heredó: **entorno no hermético, no el producto**. Registros conservados. |
| `4f7e635` | validación **APROBADA**; **desplegado** | El servidor E2E fija `SSO_ENABLED=false` de forma explícita. |

**Defecto real hallado con Keycloak (corregido en `85afbfe`)**: Keycloak 26 declara
`authorization_response_iss_parameter_supported` (RFC 9207) y la librería exige que el retorno traiga `iss`. La API y la
página de retorno no lo reenviaban → todo acceso federado real habría fallado con `SSO_PROTOCOL_ERROR`. El proveedor
simulado no lo declaraba y por eso 18/18 pruebas pasaban. Ahora el simulado lo declara y envía, y hay pruebas de **emisor
ausente** y de **emisor ajeno** (ambos rechazados). Lección registrada: **las pruebas con proveedor simulado no
sustituyen la demostración con el proveedor real**, y por eso se distinguen abajo.

## 2. Criterios originales de P1-015 (literal) y estado

| Criterio (`docs/03:62`, `docs/18:216`) | Estado |
| --- | --- |
| RF-46 «**Español primero** y **decisiones de coste**» | **Español: CUMPLIDO** (fuente y reserva; inglés añadido sin degradarlo). **Coste: decidido y demostrado en local** (D-54 adoptada para desarrollo y demostración local), no validado con una tarifa acordada |
| «**ADR por componente**» | **CUMPLIDO**: 0007, 0008, 0009, ahora con estado y comportamiento implementado |
| «**español conservado**» | **CUMPLIDO**, comprobado en E2E y vitest |
| «**límites** … comprobados» | **CUMPLIDO** (10 límites; superar uno se rechaza con explicación, en español y en inglés) |
| «**coste** … comprobado» | **Demostrado en local** con **tarifas sintéticas identificadas** (D-54 adoptada): configuración, período, vigencia, ausencia de tarifa, consulta y reproducción. El texto original **no exige una tarifa acordada** |
| «**SSO** comprobado» | **Demostrado en local con Keycloak real** como proveedor de ensayo (§4). El texto original **no exige un proveedor de un cliente**; conectar uno quedó fuera de esta entrega |
| Dependencia «**TECH-001 y piloto**» | **PILOTO: NO EXISTE.** Esta entrega no lo sustituye |

**Qué queda de P1-015, con su referencia exacta.** Texto original (`03bb2f6:docs/18_BACKLOG.md:157`): dependencia «**TECH-001 y
piloto**»; aceptación «**ADR por componente, español conservado y límites/coste/SSO comprobados**». RF-46 (`docs/03:62`):
«**Español primero** y **decisiones de coste**». Ninguno nombra una tarifa acordada ni un proveedor de identidad de cliente
(S2 cita SSO solo entre las capacidades del «Nivel 4 — Enterprise»).

| Elemento | Qué es | Estado |
| --- | --- | --- |
| Capacidad técnica | coste estimado, SSO OIDC+PKCE, inglés, rechazo por límites | **Demostrada** (§3–§5) |
| **Condición original** | dependencia «**piloto**» = P0-031 («recorrido con dataset/usuarios de piloto, Android real, discrepancias, restore, capacitación; hallazgos y gates pendientes explícitos») | **NO EXISTE** (P0-031 no iniciada). Es el **único** elemento original pendiente |
| Configuración comercial de un cliente | tarifa acordada, IdP del cliente | **No es criterio original.** Se registrará como *gate pendiente explícito* del piloto si el cliente la requiere (P0-031 pide «gates pendientes explícitos»); no es compuerta de P1-015 |

**P1-015 permanece PARCIAL** mientras falte su dependencia original «piloto». Si esa dependencia puede darse por satisfecha
con evidencia local (regla de `docs/18`: «dependencia satisfecha por evidencia o contrato/mock explícito») es una **decisión del
propietario del producto que no se ha tomado**; este documento no la toma ni la presupone.

## 3. Coste estimado de la plataforma (decisión 2)

- **Qué es**: estimación de **USD por organización y mes calendario**, con período explícito (inicio incluido, fin excluido,
  alineado a meses, máximo 24). Es el coste de **usar la plataforma**; **no** es el presupuesto de preparación (P1-010) ni el
  precio comercial del cacao (P1-012). **No factura ni cobra.**
- **Tarifa**: dato **declarado**, **versionado** (motivo obligatorio desde la versión 2) y con **vigencia**; sintética o
  acordada, siempre rotulada. **No hay tarifas precargadas** (organización nueva → lista vacía). Gana la versión más
  reciente que cubre el **mes completo**.
- **Separación**: consumo observado (con procedencia), tarifa aplicada, resultado, y **conceptos que no se valoran**
  (almacenamiento, eventos, usuarios activos; y «facturación y cobro: NO_IMPLEMENTADO»).
- **Un precio ausente no es cero**: sin tarifa → `SIN_TARIFA` con total nulo; meses sin tarifa → `PARCIAL` con esos meses
  «sin precio». Una tarifa declarada en `0.0000` sí es un precio (cero).
- **Reproducible**: cada estimación guarda líneas, consumo, conceptos pendientes y `inputs_hash`; `GET …/verify` recalcula
  con las tarifas existentes al calcular y compara. Tras declarar una tarifa posterior, la estimación antigua **sigue
  siendo reproducible** y una nueva usa la versión nueva.
- **Qué NO es**: el consumo mostrado aparte **no convierte la tarifa en un coste medido**. El resultado corresponde a la
  **tarifa declarada por organización y mes**; el consumo informa, no se factura.
- Permisos: `platform_cost:manage` (declarar tarifas, registrar estimaciones) y `platform_cost:read`, solo ORG_ADMIN.

## 4. Acceso federado OIDC (decisión 3) — dos niveles de evidencia, NO equivalentes

**Con proveedor SIMULADO** (`test/sso.int-spec.ts`, **19** casos, PostgreSQL real; el proveedor es un servidor de prueba que
habla el protocolo y permite provocar fallos): PKCE S256/state/nonce; destinos de retorno en lista cerrada; configuración que
rechaza comodines y fragmentos; vínculo solo desde la propia sesión y por **emisor+sujeto** (el correo del proveedor es
informativo y **no vincula**); conflictos (identidad ya vinculada, cuenta con otra identidad del mismo emisor); estado de un
solo uso y vencimiento; nonce/emisor/audiencia/caducidad/`iss` incorrectos rechazados sin filtrar detalle; código robado sin
verificador PKCE rechazado; **usuario deshabilitado en Terra Link** (`SSO_ACCOUNT_DISABLED`, y la sesión previa deja de
valer); cierre de sesión por sesión (las demás sesiones de la cuenta siguen) con URL de cierre del proveedor; desvincular;
tope de inicios abiertos (429); acceso local intacto; auditoría. **Permisos y aislamiento**: la identidad externa no concede
organización ni permisos (un usuario sin membresías entra y no ve nada; el administrador de A recibe 404 en B).

**Con KEYCLOAK real** (26.0.7, `docker compose --profile sso`, realm `terra-link-dev`, cliente público con PKCE S256 exigido
y redirecciones explícitas): `e2e/review/p1015-demostracion.mjs`, salida en `docs/qa/p1015-demostracion-2026-10-20.txt`,
**21/21**, con una organización propia «ENSAYO P1-015 (sintético)» y usuarios sintéticos de Keycloak (contraseñas
generadas en memoria; no se leen ni se imprimen credenciales):

| # | Comprobación con Keycloak real | Resultado |
| --- | --- | --- |
| 2.1 | la autorización lleva `code_challenge_method=S256`, `state` y `nonce` | OK |
| 2.2 | **sin PKCE el proveedor rechaza** (devuelve el error a la aplicación; sin formulario ni testigo) | OK |
| 2.3 | destino de retorno no permitido: 422 en la API y rechazo del proveedor | OK |
| 2.4 | **identidad sin vínculo** con el **mismo correo** que una cuenta local: `SSO_IDENTITY_NOT_LINKED`, sin testigo | OK |
| 2.5 | vincular desde «Mi cuenta» con la sesión propia | OK (emisor `…/realms/terra-link-dev`) |
| 2.6 | acceso con la identidad vinculada: mismo testigo; ve **su** organización (200) y **no** la ajena (404) | OK |
| 2.7 | el acceso con contraseña sigue disponible | OK |
| 2.8 | **cierre de sesión**: testigo local → 401; navegación al cierre del proveedor; un nuevo intento **pide credenciales** (la sesión del proveedor se cerró) | OK |
| 2.9 | **usuario deshabilitado en el proveedor**: no entra, sin testigo | OK |
| 2.10 | limpieza: el vínculo de ensayo se desvincula (la historia queda en la auditoría) | OK |

**Diferencia que no se oculta**: el caso «usuario deshabilitado» tiene **dos mitades**: deshabilitado **en el proveedor**
(Keycloak real, 2.9) y deshabilitado **en Terra Link** con identidad aún vinculada (solo con proveedor simulado). El
caso «no vinculado» sí se ejerció en ambos niveles.

## 5. Idiomas, errores y límites (decisión 4)

- **Español fuente, inglés segunda lengua** (ADR-0007 opción B): la clave de cada texto **es** el texto en español; sin
  traducción se muestra español, nunca una clave. Cubre acceso (incluido el error de credenciales, que conserva el correo),
  navegación y menú, estados y errores del panel, «Mi cuenta», límites y consumo, y coste. Los textos de los límites los
  traduce la API (`?lang=en`) con los mismos códigos y valores. **No son traducciones jurídicas certificadas**; documentos y
  evidencias originales no se tocan. `lib/i18n.test.ts` (8 pruebas web) falla si un texto marcado no tiene traducción.
- **Límites**: se mantiene el **rechazo** al superarlos, con explicación, **sin sobrecoste automático** (3.2: documento de
  `max+1` bytes → 422 `FILE_TOO_LARGE`).
- **Teclado y 390 px** (E2E `idiomas-coste-acceso.spec.ts`, 6 casos): selector de idioma con teclado, menú con teclado,
  ninguna pantalla del recorrido desborda horizontalmente a 390 px.

## 6. Respaldo de 0056

Hecho con la aplicación detenida, **después** de la demostración para incluir los datos persistentes nuevos.
`_respaldos/2026-10-20-p1015-migracion-0056/VERIFICACION-2026-10-20.md`: restauración aislada con **0 errores**,
**137 tablas con conteos exactos idénticos**, restricciones idénticas (`c=455 f=351 p=137 t=4 u=167`), append-only efectivo en
la copia, **21/21 estimaciones reproducidas desde la copia restaurada**, descifrado de identidad con las claves del respaldo
(12+14 campos, 0 fallos, sin imprimir valores) y objetos con la misma huella (1090 archivos). **0056 no añade claves**
(cliente OIDC público). Restauración eliminada al terminar; **no se tocó ningún volumen anterior**.

## 7. Datos de ensayo que quedan en la base de desarrollo (identificados, sintéticos, append-only)

Siete organizaciones «ENSAYO P1-015 (sintético) …», **una por ejecución del guion** (la primera, de la corrida que falló
por el defecto de `iss`; las demás, de las repeticiones del guion). Cada una tiene **2 tarifas sintéticas** y **3
estimaciones**. Son **datos de ensayo, no actividad de clientes reales**; no son cuentas DEMO. Las tablas son append-only y
**no se intenta eliminarlas**; quien las consulte debe leerlas como ensayo (el nombre y la etiqueta «Tarifa SINTÉTICA …» lo
dicen).

| Identificador de la organización | Nombre | Creada (UTC) | Tarifas (sintéticas) | Estimaciones |
| --- | --- | --- | --- | --- |
| `10495c0c-e9ae-4077-8d3d-b27ad3883247` | ENSAYO P1-015 (sintético) 6ad00c | 2026-10-20 02:09 | 2 (2) | 3 |
| `3951f34b-2418-4bb9-8b44-0554c2d09ebc` | ENSAYO P1-015 (sintético) acf32b | 2026-10-20 03:28 | 2 (2) | 3 |
| `659ef3e6-93fa-4036-966d-27c9f967c549` | ENSAYO P1-015 (sintético) 1dfaec | 2026-10-20 03:30 | 2 (2) | 3 |
| `70012b64-eade-4d2d-8deb-e1fbad97c73a` | ENSAYO P1-015 (sintético) 2ab928 | 2026-10-20 03:31 | 2 (2) | 3 |
| `6fcf93e5-b041-4a76-9fee-e00be3e02290` | ENSAYO P1-015 (sintético) 8165c9 | 2026-10-20 03:32 | 2 (2) | 3 |
| `9d7d20a2-f24b-485b-b435-b2fd4b0eb8cb` | ENSAYO P1-015 (sintético) 1140a4 | 2026-10-20 03:33 | 2 (2) | 3 |
| `d8f2a5ad-87ff-429e-8e54-038be7673934` | ENSAYO P1-015 (sintético) 3b07cb | 2026-10-20 03:34 | 2 (2) | 3 |

Total: 14 tarifas sintéticas y 21 estimaciones, las mismas que contiene el respaldo 0056. Los usuarios sintéticos de
Keycloak eran efímeros (su base se descartó con el contenedor) y las cuentas locales de ensayo usaron contraseñas
generadas en memoria que no se conservaron.

## 8. Repetición parcial del guion

El guion `p1015-demostracion.mjs` se corrigió **cuatro veces** (carreras al esperar la página del proveedor; una
expectativa mal planteada: Keycloak rechaza devolviendo el error a la aplicación; el cierre sin sesión viva en el
proveedor; conservar la misma sesión para probar el cierre en el proveedor) y se repitió completo cada vez. Esas
correcciones son del **guion** (commit de resultados), no del producto, y no repiten la validación funcional.

## 9. Estado de Keycloak y SSO al terminar

- **SSO deshabilitado por defecto** (`SSO_ENABLED` ausente; `/auth/sso/config` → `enabled:false`; la pantalla de acceso no
  ofrece botón). **Keycloak detenido y su contenedor eliminado** (sin volumen: su base H2 era efímera). Imagen conservada.
  El `.env` quedó como estaba antes de la demostración.
- Para repetir: `KEYCLOAK_ADMIN_PASSWORD` y `SSO_*` en `.env` (ver `.env.example`), `docker compose --profile sso up -d
  keycloak`, recrear `api`, y `node e2e/review/p1015-demostracion.mjs`.
