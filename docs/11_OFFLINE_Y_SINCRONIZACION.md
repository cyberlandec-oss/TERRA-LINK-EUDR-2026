# Offline y sincronización

FUENTE: S1 §§45–48 y S3 §18. La arquitectura móvil y sus librerías se confirman en repo. SQLite es propuesta de la fuente; preservar almacenamiento real si ofrece las garantías y hay ADR.

## Flujo

Autenticación online inicial → descargar solo asignaciones necesarias → sesión local protegida → capturar/validar → guardar entidad y operación de cola en una transacción local → sincronizar cuando vuelva conexión → validar en servidor → reconciliar resultado sin pérdida de datos.

Offline no significa renovar credenciales sin red. Definir política de sesión offline, periodo permitido y desbloqueo local por ADR; al volver online se revalidan membresía y permisos. Datos de un usuario no deben aparecer al iniciar otra cuenta en el mismo teléfono.

## Operación propuesta

```json
{
  "operation_id": "<uuid>",
  "device_id": "<registered-device-id>",
  "entity_id": "<client-generated-uuid>",
  "operation_type": "PLOT_GEOMETRY_CREATE",
  "base_version": 3,
  "depends_on": ["<producer-create-operation-id>"],
  "captured_at": "2026-10-09T15:00:00Z",
  "payload": {"plot_id": "<uuid>", "geometry": "<typed-geojson>"},
  "attachment_refs": ["<local-attachment-id>"]
}
```

Estados locales: `PENDING → UPLOADING → SYNCED`; error transitorio → PENDING con backoff; validación permanente → FAILED; versión divergente → CONFLICT. App cerrada durante UPLOADING recupera la operación como reintentable. UUID de operación se mantiene; un reintento no crea otro ID.

## Contrato de servidor

`push` recibe lote limitado, verifica cada operación/entidad y devuelve por operación: aceptada, duplicada, rechazada, conflicto o dependencia pendiente. Una operación rechazada no hace perder las independientes. Unique tenant/operation_id y hash de payload: mismo contenido retorna mismo resultado; distinto contenido produce conflicto.

`pull` usa cursor opaco estable por tenant y alcance, incluye cambios y tombstones. No paginar cambios solo por timestamp sin desempate. Si expira el cursor, realizar bootstrap reconciliado conservando operaciones locales pendientes. Los límites y política de cursor se fijan con pruebas de volumen.

Resolver productor antes de parcela, parcela antes de entrega y entidad antes de enlace de evidencia. La dependencia local no concede acceso a ninguna entidad. Confirmar estado servidor antes de quitar operación de cola; conservar registro de resultado.

## Conflictos

No last-write-wins para geometría, peso, origen, legalidad o estado confirmado. Mostrar valor local, valor servidor, versiones y motivo. Resolución por usuario autorizado crea nueva operación basada en versión actual, conserva historial y justificación. Fusionar automáticamente solo campos/operaciones no conflictivas con regla explícita y probada.

## Fotografías y documentos

Guardar referencias y bytes locales persistentes; checksum y límites. Subida reanudable/deduplicada según API/objeto real. Metadata sincronizada sin bytes completos no significa evidencia disponible. Estados separados para entidad y adjunto. El servidor finaliza, escanea y valida antes de habilitar descarga/evaluación. Evitar perder una foto al limpiar caches del formulario.

## Seguridad local

Mínimo dataset asignado; claves/tokens en almacenamiento seguro; cifrado disponible y probado en la plataforma elegida; separación por cuenta/tenant y procedimiento de cierre/suspensión sin destruir capturas no enviadas inadvertidamente. Un teléfono revocado no puede enviar como autorizado al volver a red; los borradores quedan en recuperación controlada.

## Aceptación

- Crear offline, cerrar app, reiniciar dispositivo y recuperar captura/cola/adjuntos.
- Reintentar la misma operación tras timeout sin duplicar productor, peso ni stock.
- Sincronizar productor/parcela/entrega en dependencia; error de una operación no bloquea independientes.
- Conflicto local/servidor visible y resoluble con audit trail.
- Sesión o permiso revocado: servidor rechaza; UI explica y conserva trabajo pendiente para recuperación.
- Cambiar cuenta no revela dataset anterior; GPS denegado, almacenamiento lleno y archivo interrumpido tienen recuperación.
- Ensayo Android real con fotos y GPS, offline prolongado, reconnect y reporte reproducible. Emulador no sustituye este gate.

## Implementación P0-023 (2026-10-10) — captura local, sin sincronización

Código: `apps/mobile` (ADR-0006, PROPUESTO). Estado: **ABIERTA**; falta el ensayo en Android real.

- Transacción local: «Guardar en cola» pasa el borrador a `QUEUED` y crea sus operaciones (`PLOT_FIELD_NOTE_CREATE`,
  `PLOT_LOCATION_SAMPLE_CREATE` dependiente de la nota, `PLOT_PHOTO_ATTACH` dependiente de la muestra) en una transacción
  exclusiva; si algo falla no queda nada parcial. `operation_id` se genera al encolar y no cambia.
- Estados implementados: `DRAFT` (borrador local), `QUEUED` con operaciones `PENDING`; recuperación de `UPLOADING` →
  `PENDING` conservando la identidad (`recovered_count`). `SYNCED`, `FAILED` y `CONFLICT` existen en el esquema y se
  implementan en P0-024.
- Dataset: solo las parcelas que `GET /plots` devuelve a la cuenta en la organización (el servidor aplica la asignación).
- Separación: base y adjuntos por cuenta + organización; cerrar sesión borra token y sesión, no las capturas.

### Offline prolongado: tres capacidades distintas y propuesta D-40 (revisada 2026-10-30; NO aprobada, NO aplicada)

Fuentes: RNF-04 («ensayo de 7 días simulados y de interrupción/cierre real; **duración objetivo final por ADR**»), QA-08 («…7 días simulados, retry, adjunto interrumpido y conflicto → persistencia sin pérdida, misma operación una vez, dependencias/conflicto visibles»), S1 §90 («Offline session») y ADR-0006. **Ninguna fuente fija cuántos días debe poder capturarse sin conexión** ni obliga a una autorización local; no hay decisión posterior que apruebe D-40. La ventana de 72 h que figuraba aquí se retiró el 2026-10-11 y no está en el código.

| Capacidad | Hoy | Evidencia | Lo que NO demuestra |
| --- | --- | --- | --- |
| **(1) Conservar** lo capturado durante 7 días (y tras reiniciar) | **Sí**: el almacén no borra por antigüedad; solo reemplaza el dataset al descargar | `store.test.ts` «7 días simulados»: reloj +7 días y reinicio, mismas operaciones (`operation_id`, huella, estado) y foto presente; antes, cierre forzado y reloj +2 h en emulador (`docs/qa/EVIDENCIA_MOVIL_ALTAS_MAPA_2026-10-28.md`) | No se avanzó 7 días el reloj de un emulador ni de un teléfono; no mide batería, ahorro de energía ni limpieza del sistema |
| **(2) Capturar de nuevo** durante esos 7 días | **No**: la captura nueva termina al vencer el JWT (1 h, sin refresh); se bloquea sin borrar nada | Mismo test (bloqueo a +7 días con la sesión original) y `captureGate` (vencida, reloj atrasado, sin permiso, otra organización) | No prueba que se pueda capturar: es lo contrario. Solo existiría con D-40 |
| **(3) Reconectar y sincronizar** con autorización vigente | **Sí**, tras iniciar sesión online: el servidor revalida sesión, membresía, permisos y recurso | Mismo test (sesión nueva → `syncOnce`, mismas operaciones sin duplicar; transporte **simulado**); `sync-altas.int-spec.ts` y las pruebas de dispositivo revocado con servidor y PostgreSQL reales; emulador con `relogin` y respuesta perdida | El test de 7 días usa un transporte simulado; no hay un envío real tras 7 días de reloj. Conservar (1) no prueba (3) ni al revés |

Ninguna fila sustituye a otra: conservar no es poder capturar, y poder capturar no es poder enviar.

#### Propuesta D-40: autorización local de captura de hasta 7 días (opción de producto)
Es una **opción derivada del ensayo de 7 días previsto en RNF-04/QA-08**, no una obligación EUDR ni una aprobación concedida. Sin aprobación del propietario no se implementa.
- **Emisión (solo online, por el servidor):** a un usuario con sesión vigente, desde un dispositivo registrado y activo (`POST /devices`), en una organización con membresía activa y permiso de captura. Un nuevo `POST …/devices/{id}/offline-grants` devuelve una credencial **ligada** a usuario + dispositivo + organización, con `issued_at`, `expires_at` (máximo 7 días; menor si la organización lo fija) y alcance **solo de captura local** (los permisos de captura que el rol tenía al emitirla; no concede nada nuevo). Firmada por el servidor con una clave distinta de la del JWT; la app solo verifica integridad.
- **Vencimiento:** duro y sin renovación sin red. Al vencer: no se captura de nuevo, **no se borra nada**; renovar exige conexión.
- **Protección local:** guardada en el almacén seguro (Keystore) ligada a la clave de la base; SQLCipher obligatorio (ya exigido en build nativo); desbloqueo local (PIN o biometría del dispositivo) para usarla —**hoy no existe en la app** y requeriría una dependencia nueva—. La credencial **no sirve para enviar**, no es un token y no sale del dispositivo.
- **Reloj alterado:** se conserva la hora máxima observada (ya existe, `last_seen_at`) y se añade el tiempo transcurrido por el reloj monotónico del sistema. Atrasar el reloj bloquea hasta volver online; adelantarlo solo acorta la vigencia, nunca la alarga. Límite declarado: tras un reinicio el reloj monotónico se reinicia, y entonces solo protege la hora máxima observada.
- **Revocación:** sin red no se detecta (límite inevitable). Al reconectar, el servidor rechaza el envío del dispositivo, usuario o membresía revocados y lo capturado queda en recuperación controlada, visible y sin borrarse; el borrado remoto no se incluye (exige conexión) y sería otra decisión.
- **Recuperación de pendientes:** vencida, revocada o con el reloj alterado, todo lo guardado permanece visible. Para enviar hace falta **autenticación online** y **revalidación del servidor** (tenant, membresía, permiso, recurso); las mismas `operation_id`; los rechazos se muestran con su motivo.
- **Qué cambia respecto de la hora actual:** hoy se captura hasta que vence el JWT (1 h); con la propuesta, hasta 7 días con credencial local. No cambian: el inicio de sesión solo online, el JWT de 1 h sin refresh, el envío con sesión y revalidación, ni los criterios para dar el offline por terminado (RNF-04, QA-08).
- **Decisión exacta que requiere el propietario** (una de tres): **A)** mantener 1 h, como hoy; **B)** aprobar la credencial local de hasta 7 días con los parámetros anteriores (más su desbloqueo local); **C)** otra duración, indicada. Con B debe decidir además (i) si el desbloqueo local es PIN o biometría, (ii) quién fija una duración menor por organización. Recomendación: decidir según la conectividad real del piloto; si el campo se cierra con conectividad diaria, A basta. Con B o C el trabajo es servidor (emisión, firma, revocación), móvil (verificación, desbloqueo, reloj) y el ensayo QA-08 de 7 días **con** la credencial, en emulador y después en teléfono.

### Contrato de dispositivo (propuesta para P0-024)

- El cliente genera un `device_id` local (UUID en almacenamiento seguro). **No es prueba de autorización**: el servidor
  autoriza por sesión, membresía, permiso y recurso en cada operación.
- Propuesta: `POST /devices` (autenticado) registra el dispositivo para el usuario y la organización y devuelve un
  identificador emitido por el servidor; `push` exige sesión válida y rechaza dispositivos revocados; la revocación no
  borra capturas locales: quedan en recuperación controlada.
- Brecha de contrato: la API de muestras de ubicación solo acepta `source = BROWSER_GEOLOCATION`. P0-024 debe añadir una
  procedencia para el servicio de ubicación nativo (`DEVICE_LOCATION_SERVICE`) sin atribuir GPS.

## Revisión P0-023 (2026-10-11)

- **Sesión**: la captura local termina cuando vence la sesión emitida por el servidor (JWT, 1 h, sin refresh). Se eliminó
  la ventana de 72 h: D-40 es una propuesta no aprobada y no amplía ninguna autorización. Bloquear no borra nada; tras
  reiniciar o con reloj atrasado sigue bloqueado y lo guardado sigue visible. **Contrato pendiente (D-40)** si se quiere
  capturar más tiempo que la sesión: credencial local distinta del token, emitida por el servidor para un dispositivo
  registrado, con caducidad corta y explícita, desbloqueo local (PIN/biometría), sin valor para enviar (el envío exige
  sesión online y revalidación), revocable y registrada. No implementado.
- **Cifrado**: Expo Go = entorno de prueba SIN cifrado, limitado a organizaciones DEMO con datos sintéticos (la app lo
  impide para otras). En un build nativo, si SQLCipher no se inicializa, el almacén no se abre: no se descarga ni se
  escribe el dataset protegido. Las fotos se guardan como BLOB dentro de la base (comparten su cifrado); la copia
  temporal de la cámara se borra tras importarla y durante una subida existe una copia temporal en la caché.
  **No ejecutado**: build nativo con SQLCipher en Android (instrucciones en `apps/mobile/README.md`).

## Implementación P0-024 (2026-10-11)

Endpoints (`/api/v1/organizations/{org}`): `POST /devices`, `GET /devices`, `POST /devices/{id}/revoke`,
`POST /sync/push`, `GET /sync/pull?device_id&cursor`, `POST /sync/attachments/{operation_id}/content`.

- **Dispositivo**: registrado por el usuario autenticado; identificador emitido por el servidor; `client_device_id`
  informativo. Revocado: no envía, no recibe y no vuelve a registrarse con el mismo identificador (un dispositivo con
  otro identificador sí puede registrarse: la revocación de la persona se hace por membresía o usuario). Cada petición
  revalida sesión, dispositivo (del usuario, de la organización, activo), membresía, organización y permisos.
- **Push**: lote ≤ 50; resultado por operación `ACCEPTED`, `DUPLICATE`, `REJECTED`, `CONFLICT`, `DEPENDENCY_PENDING`,
  `FORBIDDEN`, `TRANSIENT_ERROR`. Hash SHA-256 del contenido canónico recalculado en el servidor (el del cliente debe
  coincidir). Mismo id + hash → mismo resultado, revalidando permisos (si se retiraron: `FORBIDDEN` sin revelar el
  resultado); mismo id + otro hash → `CONFLICT`; el dispositivo no forma parte del hash. Solo se guardan resultados
  definitivos. Efectos idempotentes por operation_id: un timeout tras el commit se recupera al reintentar.
- **Dependencias**: deben estar aceptadas en la misma organización; ausente → `DEPENDENCY_PENDING` (no se guarda);
  rechazada o en conflicto → `REJECTED DEPENDENCY_FAILED`. Una operación fallida no bloquea las independientes.
- **Conflictos**: versión de parcela obsoleta → `CONFLICT` con `base_version` y `server_row_version`; sin
  last-write-wins. Resolución: nueva operación (otro id) sobre la versión actual con `resolves_operation_id`; la
  original queda registrada en conflicto.
- **Pull**: cursor de servidor ligado a organización, usuario y dispositivo, con el conjunto visible al emitirlo
  (caduca a los 7 días → `CURSOR_EXPIRED`; de otra cuenta o dispositivo → `CURSOR_INVALID`). Cambios = parcelas visibles
  hoy con versión distinta; tombstones = solo recursos que ese cursor entregó y que ya no están en el alcance. La
  visibilidad se recalcula en cada pull: un cursor antiguo no conserva acceso.
- **Adjuntos**: `PLOT_PHOTO_ATTACH` acepta el registro (`AWAITING_CONTENT`); el archivo se sube aparte, se verifica
  tamaño y SHA-256 (si no coincide: `ATTACHMENT_INTEGRITY_MISMATCH`, nada se guarda) y entra por el módulo Documentos
  (tipo `FIELD_PHOTO`, clasificación PERSONAL_DATA, escaneo antimalware y permisos). Estados: `AWAITING_CONTENT`,
  `PENDING_SCAN`, `AVAILABLE`, `REJECTED`.
- **Procedencia nativa**: `DEVICE_LOCATION_SERVICE` solo por sincronización (la API pública sigue aceptando únicamente
  `BROWSER_GEOLOCATION`); conserva hora de adquisición, precisión informada o nula, detalle del proveedor, marca de
  simulación y dispositivo; no afirma GPS ni autenticidad física.

### Tipos de operación

| Tipo | Servidor | Móvil |
| --- | --- | --- |
| `PLOT_LOCATION_SAMPLE_CREATE` | Sí (crea versión de geometría POINT; conflicto por versión) | Sí |
| `PLOT_POLYGON_VERTEX_ADD` (D, 2026-10-27) | Sí (añade un vértice al BORRADOR de polígono de la parcela; no crea versión de geometría ni confirma; idempotente por `operation_id`; los vértices van encadenados por `depends_on`) | Sí |
| `PLOT_PHOTO_ATTACH` | Sí (registro + archivo vía Documentos) | Sí (la nota viaja como leyenda) |
| `PRODUCER_CREATE` (D, 2026-10-28) | Sí (alta con referencia local; requiere `producer:create`; atómica con su registro) | Sí (pantalla «Altas») |
| `PLOT_CREATE` (D, 2026-10-28) | Sí (productor por `producer_id` o `producer_local_ref`; alcance de alta del usuario) | Sí |
| `DOCUMENT_ATTACH` (2026-10-29) | Sí (titular parcela o productor, existente o por referencia local; tipo del catálogo de Documentos con ese titular; sin tipos nuevos; excluye `FIELD_PHOTO` y `DELIVERY_SUPPORT`) | Sí (archivo aparte: SHA-256, firma de bytes, escaneo; estados independientes; aportar no revisa ni aprueba). Exige `document:upload`; el catálogo `reference.document_types` solo llega a quien lo tiene |
| `DELIVERY_CREATE` (D, 2026-10-28) | Sí (declaración de entrega idempotente por `operation_id`; productor y parcelas de origen por id o por referencia local; `delivery:create` / `create_assigned`; borrador, o registrada solo si se pide y la compuerta lo permite) | Sí (pantalla «Altas») |
| Recepciones, pesaje, calidad, lotes, inventario | No (`UNSUPPORTED_OPERATION_TYPE`) | No — por diseño: son flujos del servidor y la web; ninguna fuente (RF-23/24, S1 §§45–48, S4 §§5–7) los exige como operaciones móviles |

Una nota sin ubicación ni foto no tiene entidad en el servidor y no se encola.

## Revisión 2026-10-11: escáner en contenedor, D-41, Expo Go y entorno Android

- **Escáner**: el servicio `api` de docker-compose no recibía `SCANNER_HOST` (corregido, commit `761d07f`). Recorrido por
  la API en contenedor con ClamAV real (`e2e/review/escaner-contenedor.mjs`, evidencia en
  `docs/qa/evidencia-escaner-contenedor.json`): foto sintética `AWAITING_CONTENT → AVAILABLE`; con el escáner detenido la
  versión queda `FAILED` (`PENDING_SCAN`), **nunca CLEAN**; al volver el escáner, el reintento la deja `AVAILABLE`.
  Observación: `/health/ready` responde 200 aunque el escáner no esté disponible (no lo comprueba).
- **D-41 (adoptada para el MVP local)**: «Fotografía de campo», dato personal, sin autenticidad ni valor probatorio
  automático. El móvil elimina EXIF/XMP/IPTC/comentarios antes del hash; el servidor rechaza fotos con metadatos
  (`PHOTO_METADATA_PRESENT`). El documento usa título y nombre de archivo neutros (la nota libre de campo no se publica;
  queda solo en el registro de sincronización de su autor). Eventos y auditoría no incluyen leyenda, nombre de archivo ni
  coordenadas (probado).
- **Expo Go**: pertenecer a una organización DEMO **no** vuelve sintética una captura real. En Expo Go la app usa solo
  fixtures sintéticos (foto y ubicación de prueba); la cámara y la ubicación reales solo existen en el build nativo.
- **Copia temporal de subida**: archivo `tl-upload-*` en la caché privada de la app, sin cifrar mientras dura la subida;
  se borra al terminar (éxito o fallo) y, si una interrupción lo deja, se borra al abrir la app (la base es la fuente).
- **Entorno Android**: no se instaló SDK/JDK ni se generó build: el único disco (C:) tenía 6,3 GB libres, insuficientes
  para NDK, caché de Gradle, salidas de compilación e imagen de emulador sin arriesgar los volúmenes de PostgreSQL/Docker.
  SQLCipher real, fallo cerrado nativo y ensayo en dispositivo: **no ejecutados**.

## Revisión 2026-10-11 (2): salud del escáner, foto procesada, orientación y build nativo

- `/health/ready`: el escáner es una capacidad, no una dependencia núcleo. Caído → HTTP 200 con `status: degraded`,
  `checks.scanner: unavailable` y `capabilities.document_analysis: UNAVAILABLE` (los archivos nuevos quedan con análisis
  pendiente, nunca limpios). Base, esquema o Redis caídos → 503. Probado en contenedor y en integración.
- La foto guardada es un **archivo procesado por la app** (sin metadatos embebidos): su SHA-256 corresponde a esos bytes,
  no al archivo original de la cámara. Se conserva solo la orientación EXIF (segmento mínimo) para que la foto se vea
  igual; probado con fixtures (JPEG orientaciones 1, 3, 6, 8; PNG 8). No se renderizan píxeles.
- Build nativo Android generado; autoprueba de seguridad aprobada **en emulador** (SQLCipher 4.7.0 activo, archivo no
  legible, clave incorrecta rechazada, temporales limpiados): `docs/qa/EVIDENCIA_LIMPIEZA_Y_ANDROID_2026-10-11.md`.
  Teléfono físico: pendiente.

## Revisión 2026-10-11 (3): defecto de transacción con SQLCipher y sonda de cifrado

- El recorrido en emulador encontró que `withExclusiveTransactionAsync` (expo-sqlite) usa una conexión nueva sin
  `PRAGMA key`: con SQLCipher la primera transacción falla («file is not a database»). El adaptador usa ahora una sola
  conexión con clave, cola de operaciones y `BEGIN IMMEDIATE/COMMIT/ROLLBACK` explícitos (la garantía de que solo las
  sentencias del callback entran en la transacción se mantiene con la cola). Pendiente de recompilar y verificar en
  emulador.
- Build nativo: sonda de cifrado al iniciar; sin SQLCipher, bloqueo antes del inicio de sesión (sin token, dataset ni
  fotos). HTTP sin TLS solo hacia localhost/127.0.0.1 (configuración de seguridad de red).


## Entidades creadas sin conexión: referencias locales (D, 2026-10-28)

**Diseño (breve).** El teléfono da a todo productor o parcela que crea una **referencia local** estable: el UUID del registro, que viaja como `entity_id` de su operación de alta (`PRODUCER_CREATE`, `PLOT_CREATE`). Sus dependientes la citan con `producer_local_ref` / `plot_local_ref` (en lugar de `producer_id` / `plot_id`; exactamente una de las dos) y `depends_on` apunta a la operación de alta. Al aceptar el alta, el servidor guarda la correspondencia en `sync_entity_refs` (clave: organización + **usuario** + referencia local; migración 0070) con el identificador definitivo y la versión de la parcela producida.

- **Resolución:** solo por esa tabla y solo para el mismo usuario y organización. Nunca por nombre, código, proximidad ni coincidencias ambiguas; una referencia que no es un UUID se rechaza (`PAYLOAD_INVALID`). Si la alta aún no llegó, el dependiente queda `DEPENDENCY_PENDING` (no se guarda); si la alta fue rechazada o quedó en conflicto, `REJECTED DEPENDENCY_FAILED`.
- **Persistencia en el teléfono:** tablas `local_producers` y `local_plots` (migración 4; `outbox.draft_id` pasa a ser opcional para operaciones de alta). El registro local y su operación en cola se guardan juntos; el `server_id` se enlaza cuando llega el resultado y sobrevive a cierres, respuestas perdidas y reintentos (mismos `operation_id` y hash).
- **Primera captura sobre una parcela nueva:** la versión esperada es la que produjo su alta; el vértice o el punto siguientes de la misma captura toman la versión que produjo el punto propio (la propia sincronización no es un conflicto).
- **Duplicados y rechazos:** código de parcela repetido, productor fuera de alcance, etc. → `REJECTED` con su código. La persona corrige y se crea una **sustituta** con la **misma referencia local** (el servidor no guardó ninguna correspondencia); el rechazo original y las capturas que dependían del alta se conservan como historial y se sustituyen con identificadores nuevos. Posibles duplicados de productor siguen el mecanismo de revisión de duplicados existente (`duplicate_reviews_pending`).
- **Permisos:** cada operación revalida en el servidor. `sync:use` no concede permisos de dominio: PRODUCER_CREATE exige `producer:create` (el Productor con alcance propio no lo tiene); PLOT_CREATE, `plot:create` / `create_assigned` / `create_own` y el alcance del productor indicado.
- **Evidencias:** las fotos de campo sobre una parcela nueva usan el camino existente (`PLOT_PHOTO_ATTACH` con `plot_local_ref` + subida aparte con tamaño y SHA-256; Documentos, clasificación PERSONAL_DATA y escaneo). Estados distinguidos: registro aceptado (`AWAITING_CONTENT`), análisis pendiente (`PENDING_SCAN`), disponible (`AVAILABLE`). Otros tipos documentales (legalidad, ambiente, trabajo) siguen aportándose por la web (AJ-03/AJ-04); no hay captura documental en el móvil.
- **Entregas (`DELIVERY_CREATE`):** es una **declaración** (cantidad en KG como texto decimal con unidad explícita, producto, centro, fecha y parcelas de origen con cantidad opcional). Queda como borrador de entrega; se registra solo si la persona lo pide y la compuerta lo permite. No es recepción, pesaje confirmado ni movimiento de inventario (esas transiciones siguen siendo del servidor, con su autorización; el payload móvil no las contiene). Es idempotente por `operation_id` (un reintento tras una respuesta perdida no duplica). El catálogo de productos y centros baja con el pull (`reference`, solo para roles que declaran entregas) y se guarda en el teléfono; sin catálogo descargado no se declara.

## Productores de referencia y mapa móvil (D, 2026-10-28)
- **Productores de referencia:** `GET /sync/pull` devuelve `reference.producers` (`id`, `producer_code`, `display_name`) para quien puede crear parcelas o declarar entregas, con el alcance de `producers.list` (propio/asignado/organización) y aunque el productor no tenga parcelas. Nada más del productor viaja (sin identidad ni documento). El móvil los guarda en `dataset_producers` y reemplaza el conjunto en cada descarga: un productor que sale del alcance deja de ofrecerse. Se referencian solo por identificador.
- **Mapa:** WebView con MapLibre GL JS embebido (generado por `npm run map:embed`, no versionado). Las teselas vectoriales (OSM/OpenMapTiles, nivel 6–14) se preparan con conexión desde el servicio `maps` del propio despliegue (lecturas de rango del PMTiles) y se guardan en `map_tiles`/`map_areas` de la base de la cuenta (migración local 7). Sin cartografía el mapa lo declara y dibuja igual los puntos; fuera de la zona preparada lo declara. No se piden teselas a otro proveedor ni se envía ninguna parcela. Mostrar «Mi ubicación» no guarda nada; la geometría solo cambia con las acciones explícitas de captura. Sin rótulos (no hay tipografías en el dispositivo). La cartografía es una referencia visual y no acredita límites de propiedad.
