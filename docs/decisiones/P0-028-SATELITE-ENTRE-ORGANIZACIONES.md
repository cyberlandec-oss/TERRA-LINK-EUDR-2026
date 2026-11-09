# Análisis satelital entre organizaciones (recorrido Productor → exportadora) — 2026-10-30

Instrucción del propietario (2026-10-30). Este documento fija **qué se implementó**, **qué no** y la matriz de operaciones de Whisp. No acredita proveedor seleccionado (D-09 parte B), análisis de parcelas reales ni conformidad EUDR.

## Reglas del diseño
1. **La parcela conserva su organización y autoría.** No se copia, no se reasigna y no se crea una parcela «espejo» en la exportadora. El trabajo satelital vive en el tenant de la parcela (`satellite_jobs.organization_id`).
2. **Autorización explícita y revocable por parcela concreta** (`satellite_plot_authorizations`, migración `0072`): la concede la organización **propietaria** (`satellite:authorize`, hoy solo ORG_ADMIN) a **otra** organización. Vencimiento obligatorio (tope **provisional** de 180 días, cifra por confirmar), `can_download` opcional (por omisión **no**: la respuesta original contiene la geometría enviada), términos inmutables (se revoca y se otorga otra), revocada no se reactiva, una sola vigente por (parcela, destinataria). **No es** una concesión de lectura (`access_grants`, que solo cubre lote, embarque y expediente) y no da acceso a la parcela, a su geometría ni a su productor.
3. **Cada encargo conserva**: organización solicitante (`requesting_organization_id`), autorización de origen (`authorization_id`), versión geométrica (`plot_version_id`) y huella (`geometry_hash`). La base impide un trabajo cuya autorización no corresponda a su parcela y solicitante (disparador) y una autorización sin solicitante distinto (CHECK).
4. **La credencial es la de la organización que solicita** (no la propietaria): el corredor lee `satellite_credentials` de `requesting_organization_id` (cifrada con su propio contexto). Probado con dos credenciales distintas.
5. **Revocar** cancela lo pendiente (`REQUESTED`), pide cancelar lo en curso (`RUNNING`) y corta de inmediato la consulta y descarga de la destinataria; la propietaria conserva el historial. Una autorización **vencida** deja de servir aunque no se haya revocado; al otorgar otra se cierra la vencida (queda en el historial).
6. **El worker revalida antes de enviar la geometría** (no solo al aceptar el encargo): autorización no revocada y no vencida, y ambas organizaciones activas; si no, el trabajo termina `CANCELLED` con `AUTHORIZATION_REVOKED`, `AUTHORIZATION_EXPIRED` u `ORGANIZATION_NOT_ACTIVE` y **no sale ninguna coordenada** (proveedor espía en la prueba: 0 llamadas). La versión vigente se revalida como siempre (`SUPERSEDED_GEOMETRY`). Un trabajo que ya salió hacia el proveedor no se corta aquí: la revocación lo cancela por la vía de cancelación.
7. El resultado sigue siendo `conclusion = NOT_EVALUATED`, cobertura declarada y límites escritos: no es certificación, conclusión favorable ni READY.

## Permisos (cambios efectivos)
| Rol | Antes | Ahora |
| --- | --- | --- |
| EXPORT_MANAGER | sin satélite | `satellite:read`, `satellite:request` **solo** por las rutas de parcelas autorizadas. Sigue sin `plot:*`, `risk:*`, `dd:*`, `evidence:verify`, `satellite:authorize`. Por la ruta de la propietaria no puede (no es miembro; además carece de `plot:read_geometry`). |
| PRODUCER (vinculado) | sin satélite | `satellite:read`: ve el estado y los resultados de **sus** parcelas (el alcance lo pone `plots.load`; la ajena es 404). Sigue sin `satellite:request` ni `satellite:authorize`. |
| ORG_ADMIN | `satellite:read/request` | + `satellite:authorize` |
| Demás | sin cambio | sin cambio |

La invariante «todo rol con `satellite:request` tiene `plot:read_geometry`» pasa a tener **una excepción nombrada y probada**: EXPORT_MANAGER, porque la autorización de la propietaria es el consentimiento a que salga esa geometría.

## API (bajo `/api/v1/organizations/{orgId}`)
Propietaria: `POST plots/{plotId}/satellite/authorizations`, `GET plots/{plotId}/satellite/authorizations`, `POST satellite/authorizations/{authId}/revoke`.
Destinataria (`orgId` = su organización): `GET satellite/authorized-plots` (sin coordenadas ni productor: código de parcela, propietaria, vigencia, versión y huella), `GET satellite/authorized-plots/{authId}`, `POST satellite/authorized-plots/{authId}/analyses` (solo la versión vigente), `GET satellite/authorized-analyses/{jobId}`, `POST …/{jobId}/cancel`, `GET …/{jobId}/original` (exige `can_download` otorgado por la propietaria **y** `satellite:request`: un rol que solo lee —p. ej. el auditor de la exportadora— no descarga la geometría enviada), `GET …/{jobId}/indicators.csv`.
Ambas: `GET satellite/analyses/{jobId}/indicators.csv` (indicadores en CSV con procedencia en cada fila, **sin geometría**; protegido contra inyección de fórmulas; auditado en ambas organizaciones).
Un identificador ajeno responde **404**; autorización revocada o vencida, **403** con su código (`SATELLITE_AUTHORIZATION_REVOKED` / `_EXPIRED`). La propietaria **no** cancela por su ruta el encargo de otra organización: revoca.

## Pruebas (PostgreSQL real, datos sintéticos, proveedor = fixture sintética)
`apps/api/test/satellite-autorizacion.int-spec.ts` (16): catálogo; sin autorización no ve ni encarga (control: la propietaria sí); quién autoriza; validaciones e idempotencia; recorrido completo con versión/huella/auditoría en ambas organizaciones; aislamiento con una tercera organización; cancelar; revocar; vencimiento; descarga original por huella; credencial del solicitante y coherencia en base; términos inmutables; **revalidación del worker** (vencida, revocada en carrera, organización suspendida, versión sustituida; control vigente = 1 envío); **alcance de CSV y descargas** (el Productor no alcanza el trabajo de otra persona por ninguna vía; la exportadora solo los suyos; el auditor no descarga el original; revocada = 403 también en CSV y original); **migración 0072 sobre una base con un trabajo COMPLETED** (bajar a 0071 y subir; el defecto se encontró al desplegar y la prueba falla sin la corrección). Regresión: `satellite.int-spec.ts`, `qa02-jobs-objetos`, `satelite-riesgo-expediente`. **Lo que no acreditan:** ningún análisis satelital real.

## Matriz de operaciones de Whisp (especificación desplegada = 2.3.1, sha256 `29ce6009c0c7d89…` **idéntica** a la copia de 2026-10-23, comprobada el 2026-10-30)
Columnas: **disponible** (en la especificación desplegada) · **integrada** (el adaptador la usa) · **prueba controlada** (servidor controlado/fixture) · **prueba real** (observada contra el servicio, con geometría artificial, 2026-10-29).

| Operación | Disponible | Integrada | Prueba controlada | Prueba real | Decisión |
| --- | --- | --- | --- | --- | --- |
| `GET /api/config` (límites) | sí | sí (antes de enviar) | sí | **indirecta**: el adaptador la consulta antes de cada envío y el envío prosperó; su respuesta no se registró aparte | Sin cambio |
| `POST /api/submit/geojson` | sí | sí (`async: true`) | sí | **sí** (202, trabajo `async`) | Único flujo interno de geometrías validadas |
| `GET /api/status/{token}` (seguimiento) | sí | sí (avance, reanudación) | sí | **sí** (completó en ≈9 s) | Sin cambio |
| `POST /api/status/{token}/cancel` | sí | sí | sí | **no observada** | Pendiente de prueba real (requiere otro envío artificial) |
| `GET /api/generate-geojson/{token}` | sí | sí | sí | **no confirmada** (no se registró cuál ruta entregó el resultado) | Sin cambio; no se afirma |
| `GET /api/download-csv/{token}` | sí | **no** | — | no | **No integrada**: el CSV del proveedor no aporta datos que Terra Link no conserve ya (indicadores del GeoJSON guardado). Se ofrece un **CSV propio derivado de los indicadores guardados**, con procedencia por fila y sin geometría (arriba). Equivalencia con el CSV del proveedor: **no comprobada** |
| Descripción de indicadores | referencia pública (`whisp.openforis.org/docs/reference/result-fields`; README: `Risk_PCrop` para cultivos perennes) | **no** (Terra Link no interpreta, D-07) | — | no | La pantalla muestra los valores sin interpretar y remite a la referencia del proveedor; el significado por columna sigue pendiente de D-07 |
| `POST /api/submit/wkt` | sí | **no** | — | no | No se incorpora: Terra Link ya valida y almacena GeoJSON; WKT no aporta función |
| `POST /api/submit/geo-ids` | sí | **no** | — | no | No se incorpora: enviaría identificadores de terceros en vez de la geometría validada; cambiaría la procedencia |
| `GET /api/status/{token}/stream` (SSE) | sí | **no** | — | no | No se incorpora: el sondeo actual cubre el avance sin mantener conexiones abiertas |
| `GET /api/health` | sí | no | — | no | No se usa |

Repositorio oficial consultado el 2026-10-30: `github.com/forestdatapartnership/whisp` (biblioteca, MIT; remite a la documentación de la API y a `whisp-app`); no se halló un repositorio público de la API con el nombre probado. La especificación desplegada es la fuente del contrato.

## Pendiente (no bloquea esta entrega)
- Tope de vigencia de 180 días: **cifra provisional**, por confirmar.
- Quién, además del ORG_ADMIN, puede autorizar (p. ej., el propio Productor sobre sus parcelas): decisión del propietario; hoy no.
- Prueba real de `cancel`, `generate-geojson` y `download-csv` de Whisp: solo con geometría artificial y dentro del alcance ya autorizado; no se ejecutó en esta entrega.
- Activación permanente y envío de parcelas reales: decisiones separadas (D-09 parte B).
- La web se demuestra con las cuentas vigentes: ver `docs/qa/EVIDENCIA_SATELITE_ENTRE_ORGANIZACIONES_2026-10-30.md` (se completa tras el despliegue).
