# RBAC, aislamiento y gobernanza

FUENTE: S1 §§8–9, 58, 79–81; S4 §§2–18. Matriz propuesta para revisión, no catálogo real de permisos instalado.

## Roles documentados

Los adjuntos contienen 12 códigos: `SUPER_ADMIN`, `ORG_ADMIN`, `MANAGER`, `FIELD_TECHNICIAN`, `RECEPTION_OPERATOR`, `QUALITY_OPERATOR`, `TRACEABILITY_MANAGER`, `EUDR_MANAGER`, `EXPORT_MANAGER`, `BUYER`, `AUDITOR`, `PRODUCER`. No crear `RISK_MANAGER` como nuevo rol por el nombre de una pantalla; la responsabilidad puede corresponder a EUDR_MANAGER. Confirmar roles adicionales en repo.

## Matriz de capacidad

| Rol | Ámbito | Lectura | Escritura/acción | Restricción crítica |
| --- | --- | --- | --- | --- |
| SUPER_ADMIN | Plataforma | Organizaciones, salud, uso, auditoría técnica | Crear/suspender tenant, configurar integraciones | Acceso a contenido personal/operativo por elevación documentada; sin acceso irrestricto implícito |
| ORG_ADMIN | Organización | Configuración y operación propia | Miembros, roles permitidos, catálogos, onboarding | No asignar rol global; aprobar DD solo si tiene permiso específico |
| MANAGER | Operación propia | Operaciones, excepciones y pendientes | Asignar trabajo y resolver incidencias según permiso | No modificar metodología legal por ser supervisor |
| FIELD_TECHNICIAN | Asignaciones propias | Productores/parcelas asignados | Captura, documentos, entregas y correcciones de captura | No aprobar riesgo ni presentar DDS |
| RECEPTION_OPERATOR | Centros asignados | Entregas, producto y lotes autorizados | Recibir, pesar, vincular origen/lote | No eliminar evento confirmado ni ajustar sin motivo |
| QUALITY_OPERATOR | Muestras/lotes autorizados | Recepción y calidad | Registrar análisis, liberar/rechazar calidad | No liberar exportación jurídica |
| TRACEABILITY_MANAGER | Cadena propia | Grafo, lotes, movimientos | Procesamiento, relación y corrección autorizada | No inventar vínculos de origen |
| EUDR_MANAGER | Casos propios/asignados | Evidencia, riesgo, legalidad, DD | Evaluar, crear mitigación, revisar, preparar/validar paquete | Envío oficial exige permiso adicional y operador válido |
| EXPORT_MANAGER | Embarques propios | Lotes, compradores, bloqueos, paquetes | Reservar, preparar, liberar despacho si gates pasan | No ignorar bloques legales/operativos |
| BUYER | Recursos compartidos | Lotes, mapa y paquete según grant | Comentarios/solicitudes si se habilitan | Sin edición de origen ni datos de terceros |
| AUDITOR | Encargo/alcance concedido | Eventos, snapshots y evidencia autorizada | Registrar hallazgo si se habilita | No editar operación auditada |
| PRODUCER | Recursos propios | Perfil, parcelas, entregas, documentos, pendientes | Enviar información/confirmaciones según flujo | No acceso a otros productores ni configuración |

**Precisión (2026-10-23, AJ-02):** las «entregas» propias del PRODUCER se concretan en `delivery:read_own` (PRODUCER y ORG_ADMIN, que debe poder asignar el rol): **solo el listado** de las entregas del productor vinculado a la cuenta (estado, cantidades y recepción). El detalle de una entrega (personal, compuertas internas, historial) y toda escritura siguen siendo de quien opera. Una cuenta sin vínculo recibe una lista vacía. Evidencia: `qa/EVIDENCIA_AJ_ENTREGA2_2026-10-23.md`.

La separación entre quien aporta una mitigación y quien la verifica es política propuesta; para equipos pequeños, cualquier excepción debe tener permiso, motivo y auditoría explícitos.

## Permisos propuestos

| Familia | Acciones mínimas |
| --- | --- |
| organization / membership / role | read, create, update, suspend, assign |
| producer / plot / delivery | read, create, update_draft, correct, archive |
| reception / quality | read, confirm, analyze, release_quality, reject_quality |
| lot / process / stock / shipment | read, create, close, adjust, reserve, release_dispatch, dispatch |
| document / evidence | read, upload, download, link, submit_review, verify, reject |
| risk / mitigation / dd | read, assess, recalculate, assign, submit_evidence, verify, approve_package, export_package |
| dds | submit, read_receipt, reconcile; no concesión por defecto |
| audit / report / share | read, export, grant, revoke |

Son nombres conceptuales; reutilizar catálogo real y mapearlos. La UI obtiene permisos efectivos, no interpreta privilegios por comparación de strings de rol.

## Algoritmo de autorización

Autenticar usuario → comprobar membresía activa → obtener tenant desde contexto confiable → comprobar permiso → cargar recurso dentro de ese tenant → comprobar asignación/propiedad/grant → filtrar campos → ejecutar/auditar. Aplicar también a FK enviadas en payload, búsquedas, totalizadores, snapshots, downloads, GIS y jobs.

- Sin sesión: 401. Falta de permiso en recurso del tenant: 403. Recurso ajeno/no visible: 404 cuando se aplica política para evitar enumeración. No traducir 403 a «no hay datos».
- Un `organization_id` en body o query no concede pertenencia.
- Descargas usan autorización previa y URL de vida corta; acceso por QR no esquiva el filtro.
- Jobs verifican vigencia del alcance al publicar/descargar el resultado.
- SUPER_ADMIN requiere ámbito administrativo claro y elevación auditable para contenido sensible.

## Datos compartidos

Grant con organización propietaria, destinatario autenticado, recurso/expediente, campos, propósito, vigencia y revocación. No cambiar `organization_id` ni unir cadenas privadas por un código coincidente. Datos previamente descargados no pueden retirarse mágicamente: informar alcance del intercambio y auditar exportación; acortar URLs y validar revocación en nuevas consultas.

## Gobernanza

| Función | Responsabilidad |
| --- | --- |
| Data Owner | Autoriza uso y compartición de datos de organización |
| Data Steward | Resuelve calidad, duplicados y vigencia |
| Data Collector | Captura con procedencia y método |
| Data Consumer | Usa información dentro del propósito autorizado |

Registrar base/propósito del tratamiento, retención por clase documental y atención de rectificaciones. No asumir que «consentimiento» siempre es la única base legal ni que el SaaS posee los datos del productor. Política aplicable y responsables se validan antes de producción.

## Matriz implementada (catálogo `2026-10-10.1`, P0-003)

Fuente de verdad: `apps/api/src/authz/catalog.ts`, expuesta en `GET /api/v1/rbac/roles`. El catálogo efectivo del usuario, por organización, está en `GET /api/v1/me/permissions`. Roles: los 12 de S1 §9 y S4, sin discrepancias de código con el catálogo. Solo se declaran permisos de recursos **ya implementados**. Las familias de la tabla «Permisos propuestos» (producer, plot, delivery, lot, risk, dd…) se añaden en la historia que crea cada recurso.

### Permisos de organización (por membresía activa en ESA organización)

| Rol | organization:read | organization:update | membership:read | membership:assign | audit:read |
| --- | :-: | :-: | :-: | :-: | :-: |
| ORG_ADMIN | ✔ | ✔ | ✔ | ✔ | ✔ |
| MANAGER | ✔ | | ✔ | | |
| AUDITOR | ✔ | | | | ✔ |
| FIELD_TECHNICIAN, RECEPTION_OPERATOR, QUALITY_OPERATOR, TRACEABILITY_MANAGER, EUDR_MANAGER, EXPORT_MANAGER | ✔ | | | | |
| BUYER, PRODUCER | | | | | |

BUYER y PRODUCER no ven la ficha de la organización: su acceso será por concesión o por recurso propio (P1-001 / historias del productor).

### Acciones y recurso

| Acción (endpoint) | Permiso | Recurso validado | Sin membresía | Con membresía sin permiso |
| --- | --- | --- | --- | --- |
| Ver organización (`GET /organizations/:id`) | organization:read | org = membresía activa | 404 | 403 |
| Configurar (`PATCH /organizations/:id`) | organization:update + org ACTIVE | ídem; `expected_version` | 404 | 403 / `ORGANIZATION_SUSPENDED` |
| Listar miembros e invitaciones | membership:read | filas de la org | 404 | 403 |
| Invitar / revocar | membership:assign + rol ⊆ permisos del actor | invitación de la org | 404 | 403 / `ROLE_NOT_GRANTABLE` |
| Cambiar roles (`PUT …/members/:id/roles`) | membership:assign; roles añadidos, retirados y actuales ⊆ permisos del actor; no a uno mismo | membresía de la org | 404 | 403 / 409 `SELF_ROLE_CHANGE` |
| Desactivar / reactivar miembro | ídem | membresía de la org | 404 | 403 / 409 |
| Bitácora (`GET …/audit-logs`, `/facets`, `/:id`) | audit:read | filas de la org **y** del recurso que el usuario puede leer (ver P0-025); actores no miembros como `PLATFORM` | 404 | 403 |
| Exportar bitácora (`GET …/audit-logs/export`) | audit:export + audit:read | mismo alcance, filtros y redacción que la consulta | 404 | 403 |

### Plataforma (SUPER_ADMIN, `users.platform_role`)

| Permiso | Alcance |
| --- | --- |
| organization:create, organization:suspend, organization:list_all | Metadatos de organizaciones (nombre, tipo, estado) |
| organization:onboard_admin | Solo en una org donde **no** es miembro: invitar ORG_ADMIN y ver o revocar invitaciones ORG_ADMIN |
| user:deactivate | Desactivar o reactivar cuentas globales (invalida sesiones) |

No hay bypass global: sin membresía, SUPER_ADMIN recibe `ELEVATION_REQUIRED` (403) en miembros y cambios de rol, y 404 en la bitácora. Si además es miembro de una organización, actúa con los roles de esa membresía.

### Invariantes probadas (`apps/api/test/rbac.int-spec.ts`, `members.int-spec.ts`, `organizations.int-spec.ts`)

- Un rol en una organización no concede nada en otra (usuario MANAGER en A y ORG_ADMIN en B).
- Revocación, desactivación y cambio de rol tienen efecto en la siguiente solicitud con el mismo token. La desactivación de cuenta invalida los tokens por `token_version`.
- Las referencias del cuerpo no conceden tenant (`organization_id` extra → 400). Una membresía de otra org por la ruta propia → 404. La FK compuesta `role_assignments → memberships(organization_id, id)` impide asignaciones cruzadas en BD.
- Listados y errores no incluyen nombres, correos ni identificadores de otra organización.
- El tipo comercial de organización (D-18) no interviene en la autorización.

### Productores (catálogo `2026-10-10.2`, P0-004, propuesta provisional)

| Rol | read | read_assigned | read_identity | create | update | update_assigned | assign | archive |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| ORG_ADMIN | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| MANAGER | ✔ | | ✔ | ✔ | ✔ | | ✔ | ✔ |
| FIELD_TECHNICIAN | | ✔ | ✔ | ✔ | | ✔ | | |
| TRACEABILITY_MANAGER | ✔ | | | | | | | |
| EUDR_MANAGER | ✔ | | ✔ | | | | | |
| AUDITOR | ✔ | | | | | | | |
| RECEPTION_OPERATOR, QUALITY_OPERATOR, EXPORT_MANAGER, BUYER, PRODUCER | | | | | | | | |

Origen: S1 §9 (FIELD_TECHNICIAN `producer:create/read`) y doc 07/14 («solo asignaciones» para el técnico). `update` corresponde a `update_draft/correct` de la tabla conceptual; `archive` cubre baja, reactivación y activación de borradores. RECEPTION_OPERATOR podrá necesitar lectura al implementar entregas (P0-012): se decidirá allí.

- `read_assigned` / `update_assigned`: solo productores con `assigned_membership_id` = membresía del usuario. Lo que registra un técnico sin `producer:read` queda asignado a él.
- `read_identity`: documento, teléfono y dirección (respuesta, historial y búsqueda exacta por documento). Sin él, esos campos no se devuelven.
- Responsable asignado: membresía ACTIVA de la misma organización y con acceso a productores (422 si no). FK compuesta en BD.

### Revisión de duplicados (catálogo `2026-10-10.3`, P0-005)

`producer:review_duplicates` (Data Steward): ORG_ADMIN y MANAGER. Permite listar y resolver casos de `producer_match_reviews`. Los datos de identidad del caso se muestran solo con `producer:read_identity`. Quien registra un productor coincidente recibe solo el número de casos abiertos, nunca datos del otro productor.

### Parcelas (catálogo `2026-10-10.4`, P0-006, propuesta provisional)

| Rol | read | read_assigned | create | create_assigned | update | update_assigned | archive |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| ORG_ADMIN | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| MANAGER | ✔ | | ✔ | | ✔ | | ✔ |
| FIELD_TECHNICIAN | | ✔ | | ✔ | | ✔ | |
| TRACEABILITY_MANAGER, EUDR_MANAGER, AUDITOR | ✔ | | | | | | |
| RECEPTION_OPERATOR, QUALITY_OPERATOR, EXPORT_MANAGER, BUYER, PRODUCER | | | | | | | |

`_assigned` = parcelas cuyo **productor** está asignado a la membresía del usuario (misma política que productores). La consulta por id fuera de alcance responde 404 y reasignar el productor cambia el alcance de inmediato. `update` incluye crear versiones geométricas. `archive` = baja lógica y reactivación. El tipo comercial de la organización no interviene.

### Geometría exacta (catálogo `2026-10-10.5`)

Doc 06: «geometrías exactas exigen clasificación de acceso». Clasificación de desarrollo:

| Nivel | Contenido | Permiso |
| --- | --- | --- |
| Parcela (atributos) | Código, productor, cultivo, estado, tipo de geometría, superficies, método, fechas y precisión de captura | `plot:read` / `plot:read_assigned` |
| **Geometría exacta** | Coordenadas de la versión actual y de versiones anteriores, coordenadas de muestras de ubicación | `plot:read_geometry` (dentro del mismo alcance) |

`plot:read_geometry`: ORG_ADMIN, MANAGER, FIELD_TECHNICIAN (solo parcelas de sus productores asignados), TRACEABILITY_MANAGER y EUDR_MANAGER, es decir, los roles que ya veían coordenadas. **AUDITOR deja de recibirlas** (restricción, D-24). Sin el permiso, la API devuelve `geometry: null`, `geometry_visible: false` y muestras sin longitud ni latitud. Las coordenadas no se leen de la base (filtro en SQL), no se ocultan en la interfaz. Registrar coordenadas (manuales o capturadas) también exige `plot:read_geometry`. Eventos y auditoría nunca contienen coordenadas. Una futura exportación (P0-009) debe aplicar esta misma política.

**Sincronización de campo (P0-024, catálogo 2026-10-11.19; propuesta provisional)**: `sync:use` — registrar un dispositivo propio, enviar, recibir y subir adjuntos (ORG_ADMIN, MANAGER, FIELD_TECHNICIAN y, desde la entrega D de 2026-10-27, PRODUCER con alcance propio: solo sus parcelas, vía `plot:update_own`); `device:manage` — ver y revocar dispositivos de otros miembros (ORG_ADMIN). Cada operación revalida además el permiso de dominio (p. ej. `plot:update(_assigned)` y `plot:read_geometry` para ubicaciones, `document:upload` para fotos) y el alcance del recurso. El dispositivo no concede permisos.

**Debida diligencia (P0-022, catálogo 2026-10-10.18; propuesta provisional)**: `dd:read` (ORG_ADMIN, EUDR_MANAGER, AUDITOR); `dd:manage` — crear expediente y capturar instantáneas (ORG_ADMIN, EUDR_MANAGER); `dd:approve_package` — iniciar, devolver o aprobar la revisión; aprobar exige todos los requisitos cumplidos (ORG_ADMIN, EUDR_MANAGER); `dd:export_package` — generar y descargar paquetes (ORG_ADMIN, EUDR_MANAGER). Alcance de organización completo. Las geometrías del paquete exigen `plot:read_geometry` y los documentos PERSONAL_DATA `producer:read_identity` (si no, se redactan); la identidad de productores nunca se copia.

**Mitigación (P0-021, catálogo 2026-10-10.17; propuesta provisional)**: `mitigation:read` (ORG_ADMIN, EUDR_MANAGER, TRACEABILITY_MANAGER, AUDITOR); `mitigation:manage` — crear/asignar (ORG_ADMIN, EUDR_MANAGER); `mitigation:contribute` — aportar soportes y entregar, solo si eres el responsable asignado (ORG_ADMIN, EUDR_MANAGER, TRACEABILITY_MANAGER); `mitigation:verify` (ORG_ADMIN, EUDR_MANAGER). **Separación de funciones (docs/13)**: quien entregó o aportó soportes en una entrega no la verifica ni la rechaza; no existe política expresa de excepción. Esta regla aplica a mitigaciones y **no** cambia la política de Evidencias (D-37 sigue pendiente). Todo exige alcance de organización completo, como riesgo.

**Riesgo (P0-020, catálogo 2026-10-10.16; propuesta provisional)**: `risk:read` (ORG_ADMIN, EUDR_MANAGER, TRACEABILITY_MANAGER, AUDITOR), `risk:evaluate` y `risk:review` (ORG_ADMIN, EUDR_MANAGER; docs/07 «evaluar, revisar»). Leer o evaluar exige además alcance de organización completo (`delivery:read`, `lot:read`, `plot:read`, `producer:read`, `document:read`): las evaluaciones recorren todo el grafo de origen; sin ese alcance → 403, de modo que no se revelan referencias, conteos ni razones de recursos ocultos. La revisión humana no aprueba conclusiones regulatorias.

**Inventario (P0-017, catálogo 2026-10-10.15; propuesta en `docs/decisiones/P0-017-EFECTOS-LEDGER.md`)**: `stock:read` (roles con `lot:read`); `stock:move` — merma, traslado, asignación de ubicación (ORG_ADMIN, TRACEABILITY_MANAGER); `stock:adjust` — ajuste con motivo (ORG_ADMIN); `stock:incorporate` — incorporación y conciliación (ORG_ADMIN). `stock:reserve`/`dispatch` no se asignan hasta P0-029.

**Satélite (P0-028, catálogo 2026-10-14.23; `docs/decisiones/P0-028-SATELITE.md`)**: `satellite:read` (ORG_ADMIN, EUDR_MANAGER, TRACEABILITY_MANAGER, AUDITOR) consulta el registro de proveedores, los trabajos y los resultados; `satellite:request` (ORG_ADMIN, EUDR_MANAGER) encarga un análisis. docs/07 no nombra el satélite: la asignación sigue el backlog («Como EUDR_MANAGER, necesito resultado con procedencia») y es una propuesta. **Clasificación de coordenadas**: encargar un análisis envía la geometría exacta fuera del equipo, así que exige además `plot:read_geometry` y el alcance de la parcela; quien no puede ver las coordenadas tampoco puede hacer que salgan. `satellite:request` no concede lectura de parcelas. La credencial del proveedor se guarda cifrada por organización, nunca se devuelve por la API ni se registra. Sin acceso entre organizaciones.

**Reportes (P0-030, catálogo 2026-10-14.22; `docs/decisiones/P0-030-REPORTES.md`)**: `report:read` (ORG_ADMIN, MANAGER, TRACEABILITY_MANAGER, EUDR_MANAGER, EXPORT_MANAGER, AUDITOR) abre la pantalla de indicadores, **no los datos**: cada indicador exige además el permiso de su dominio (`producer:read`, `plot:read`, `delivery:read`, `lot:read`, `evidence:read`, `risk:read`, `dd:read`) y, sin él, sale `RESTRICTED` sin valor, numerador ni denominador, de modo que no se deduce lo oculto por diferencia. Los alcances `*_assigned` **no** habilitan agregados. `report:export` (ORG_ADMIN, EUDR_MANAGER, AUDITOR) es un permiso separado, revalidado al descargar. Estos reportes no incluyen identidad ni coordenadas.

**Embarques (P0-029, catálogo 2026-10-12.21; `docs/decisiones/P0-029-EMBARQUES.md`)**: `shipment:read` (ORG_ADMIN, EXPORT_MANAGER, TRACEABILITY_MANAGER, EUDR_MANAGER, AUDITOR); `shipment:manage` — compradores, embarques, ítems, cancelar; `stock:reserve` — reservar y liberar en el ledger; `shipment:dispatch` — despachar si el preflight y la compuerta pasan (ORG_ADMIN, EXPORT_MANAGER). EXPORT_MANAGER recibe además `location:read`. El Lot Hub muestra embarques solo con `shipment:read`. Las recepciones sin lote y los movimientos que solo las tocan se muestran solo con `delivery:read`/asignado; si no, se omiten sin conteos. No se presuponen asignaciones de operadores a centros ni acceso entre organizaciones.

**Lotes y procesos (P0-016, catálogo 2026-10-10.14; D-39.4 adoptada para desarrollo local)**: `lot:read` (ORG_ADMIN, MANAGER, RECEPTION_OPERATOR, QUALITY_OPERATOR, TRACEABILITY_MANAGER, EUDR_MANAGER, EXPORT_MANAGER, AUDITOR); `lot:create` — formar lotes y asignar recepciones (ORG_ADMIN, MANAGER, RECEPTION_OPERATOR «vincular origen/lote», TRACEABILITY_MANAGER «relación»); `lot:release_input` (ORG_ADMIN, TRACEABILITY_MANAGER «corrección autorizada»); `process:manage` — preparar, iniciar, cancelar (ORG_ADMIN, TRACEABILITY_MANAGER «procesamiento»); `process:close` — cerrar procesos, permiso específico (ORG_ADMIN, TRACEABILITY_MANAGER). QUALITY_OPERATOR no lo obtiene por su rol de calidad (D-39.4); el KDE nombra a QUALITY_OPERATOR como responsable del **dato** de secado (docs/08), no como permiso. FIELD_TECHNICIAN sin acceso a lotes. Las recepciones y productores del grafo se muestran solo con `delivery:read`/asignado; si no, se omiten sin conteos.

**Entregas y recepción (P0-012, catálogo 2026-10-10.13; propuesta provisional)**: `delivery:read` (ORG_ADMIN, MANAGER, RECEPTION_OPERATOR, QUALITY_OPERATOR, TRACEABILITY_MANAGER, EUDR_MANAGER, AUDITOR) y `delivery:read_assigned` (FIELD_TECHNICIAN: productores asignados); `delivery:create` (ORG_ADMIN, MANAGER, RECEPTION_OPERATOR) y `delivery:create_assigned` (FIELD_TECHNICIAN); `delivery:correct` (ORG_ADMIN, MANAGER); `reception:confirm` (ORG_ADMIN, MANAGER, RECEPTION_OPERATOR); `reception:correct` (ORG_ADMIN, RECEPTION_OPERATOR); `location:read` (roles que leen entregas) y `location:manage` (ORG_ADMIN); `quality:record` (ORG_ADMIN, RECEPTION_OPERATOR, QUALITY_OPERATOR: muestras y mediciones) y `quality:decide` (ORG_ADMIN, QUALITY_OPERATOR: liberar/rechazar calidad, nunca liberación jurídica). El receptor y el responsable del pesaje salen de la sesión (no del cuerpo). Vincular soportes exige además `document:read` y alcance del titular: el operador de recepción no lo tiene y no se amplió (D-35 pendiente). La identidad del productor solo con `producer:read_identity` + lectura del productor; el operador de recepción ve el código. Centros asignados a operadores: sin contrato (alcance de organización). Operaciones entre cooperativa y acopiadora como tenants distintos: no habilitadas (sin concesiones, P0-003).

**Auditoría (P0-025, catálogo 2026-10-10.12)**: `audit:read` (ORG_ADMIN, AUDITOR) consulta; `audit:export` (ORG_ADMIN, AUDITOR; propuesta D-38) exporta. Tener `audit:read` no amplía el alcance: cada fila exige poder leer su recurso (productor: `producer:read` o asignado con `producer:read_assigned`; parcela: ídem por su productor; documento: `document:read` + alcance del titular; afirmación: `evidence:read` + alcance de la entidad; producto: `product:read`; posibles duplicados: `producer:read`). El filtro va en SQL: totales, páginas, facetas, detalle, cursor y exportación nunca cuentan ni revelan filas fuera de alcance; un recurso ajeno o fuera de alcance responde igual que uno inexistente (vacío o 404). Redacción de presentación por lista blanca de campos por tipo de registro; nunca se presentan secretos, tokens, enlaces, claves, coordenadas, contenido de documentos ni identidad protegida; el correo de invitaciones y de actores solo con `membership:read`; los recuentos GIS solo con `plot:read`; los soportes de evidencia que el usuario no puede leer se omiten como en P0-019. La fila original no se modifica (append-only). Ningún rol de técnico tiene `audit:read`; la regla de alcance asignado se prueba con un contexto simulado.

**Evidencias (P0-019, catálogo 2026-10-10.11)**: `evidence:read` (ORG_ADMIN, MANAGER, FIELD_TECHNICIAN, TRACEABILITY_MANAGER, EUDR_MANAGER, AUDITOR), `evidence:link` (ORG_ADMIN, MANAGER, FIELD_TECHNICIAN, EUDR_MANAGER: crear afirmación, vincular/retirar soportes, enviar, reabrir), `evidence:verify` (ORG_ADMIN, EUDR_MANAGER: verificar, rechazar, revocar). Además: alcance de la entidad de la afirmación y, por soporte, `document:read` + alcance del titular del documento. Los soportes que el usuario no puede leer **se omiten por completo** (sin identificadores, tipos de relación ni conteos), también en la consulta inversa por documento y en los motivos de revisión. Consultar la afirmación ≠ ver metadatos del soporte ≠ acceder al contenido (este último sigue la clasificación del documento). Verificar exige acceso a todos los soportes vigentes.

**Documentos (P0-018, catálogo 2026-10-10.10)**: `document:read` (ORG_ADMIN, MANAGER, FIELD_TECHNICIAN, TRACEABILITY_MANAGER, EUDR_MANAGER, AUDITOR), `document:upload` (ORG_ADMIN, MANAGER, FIELD_TECHNICIAN, EUDR_MANAGER), `document:review` (ORG_ADMIN, EUDR_MANAGER). Además se exige el alcance del **titular**: leer el productor/parcela para consultar o descargar; poder editarlo para subir o vincular (el técnico solo con sus asignados). Contenido `PERSONAL_DATA` (tenencia): descargar exige `producer:read_identity` (el auditor ve metadatos, no contenido). Sin URLs públicas ni firmadas: cada descarga revalida permisos y alcance, verifica el SHA-256 y queda auditada. La revisión es facultad separada; el autor no es revisor automático.

**Eventos (P0-015, catálogo 2026-10-10.9)**: historial por agregado (`GET /aggregates/{producers|plots|products}/{id}/events`) autorizado sobre el recurso real con su alcance efectivo (reasignar el productor o desactivar la membresía retira el acceso de inmediato); solo campos permitidos por tipo de evento; actor como nombre de miembro o etiqueta (sin correo ni id). Corregir una actualización de productor exige `producer:update`/`producer:update_assigned` sobre ese productor (también al reintentar). `events:reprocess` (solo ORG_ADMIN) lista entregas DEAD de su organización y las reencola con motivo y auditoría. Concesiones externas y elevación de plataforma: pendientes en P0-003.

**Datos mínimos KDE (P0-014)**: consulta del catálogo y `POST /kde/validate` con `traceability:read_catalog` (sin permiso nuevo). La validación resuelve referencias en la organización y en el alcance del usuario (productores/parcelas asignados para el técnico; productos con `product:read`; miembros con `membership:read` o solo la propia membresía). Un id ajeno, fuera de alcance o inexistente devuelve el mismo `REFERENCE_NOT_FOUND`. La respuesta no repite valores; no se registran payloads en logs, eventos ni auditoría, y la validación no se persiste.

**Catálogo de hitos CTE (P0-013, catálogo 2026-10-10.8)**: `traceability:read_catalog` (mismos roles que consultan productos: ORG_ADMIN, MANAGER, FIELD_TECHNICIAN, RECEPTION_OPERATOR, QUALITY_OPERATOR, TRACEABILITY_MANAGER, EUDR_MANAGER, EXPORT_MANAGER, AUDITOR) consulta el catálogo de sistema dentro de una organización de la que es miembro. No existe facultad de administración: el catálogo se publica por migración con versiones (`publishCteRelease`).

**Productos (P0-011, catálogo 2026-10-10.7)**: `product:read` (ORG_ADMIN, MANAGER, FIELD_TECHNICIAN, RECEPTION_OPERATOR, QUALITY_OPERATOR, TRACEABILITY_MANAGER, EUDR_MANAGER, EXPORT_MANAGER, AUDITOR) consulta el catálogo de su organización; `product:manage` (ORG_ADMIN, «catálogos» en la matriz) da de alta, edita datos descriptivos y activa/desactiva, con organización activa. BUYER y PRODUCER no acceden. Otra organización → 404.

**Evaluación GIS técnica (P0-010, catálogo 2026-10-10.6)**: `plot:evaluate_gis` (ORG_ADMIN, MANAGER, TRACEABILITY_MANAGER, EUDR_MANAGER) y `plot:evaluate_gis_assigned` (FIELD_TECHNICIAN, solo parcelas asignadas) ejecutan la evaluación; requiere organización activa. Consultar resultados usa `plot:read`/`plot:read_assigned` (AUDITOR consulta, no evalúa). La ubicación del problema técnico solo se entrega con `plot:read_geometry`. El alcance de comparación es el del evaluador; quien no lee toda la organización ve la comparación de una evaluación de organización como «Reservada», sin tipos ni cantidades de relaciones ocultas. Eventos y auditoría llevan códigos controlados, sin coordenadas.

**Importación y exportación GeoJSON (P0-009)**: analizar, confirmar y descartar exigen `plot:update` o `plot:update_assigned` sobre la parcela, `plot:read_geometry` y organización activa; cada escritura revalida membresía, asignación y versión esperada. Ver una importación, descargar el original y exportar una versión exigen `plot:read` o `plot:read_assigned` y `plot:read_geometry` (AUDITOR → 403). El original no tiene URL pública ni firmada: la API lo lee del almacenamiento privado tras autorizar y verifica su SHA-256 antes de entregarlo; conocer la clave de objeto no da acceso. Descargas y exportaciones quedan auditadas sin coordenadas.

**Borradores de polígono (P0-008)**: crear, leer, añadir vértice, deshacer, cancelar y confirmar exigen `plot:update` o `plot:update_assigned` sobre la parcela **y** `plot:read_geometry`; sin este último → 403 y no se devuelve ningún vértice. Cada escritura revalida membresía activa, asignación del productor (reasignado → 404) y organización activa (suspendida → 403 `ORGANIZATION_SUSPENDED`). El detalle de vértices de una versión confirmada solo incluye longitud/latitud con `plot:read_geometry` (AUDITOR recibe precisión y fechas, no coordenadas).

**Coste de la plataforma y acceso federado (P1-015 / D-54, 2026-10-20)**: `platform_cost:manage` (declarar tarifas y registrar estimaciones) y `platform_cost:read` (consultarlas y verificarlas) solo para ORG_ADMIN; son distintos de `cost:*` (presupuesto de preparación, P1-010). El **acceso federado no concede permisos**: una identidad OIDC se vincula a una cuenta por emisor+sujeto, y organización, rol y permisos siguen saliendo de las membresías. Vincular y desvincular una identidad es un acto **de la propia persona** sobre su cuenta (sin permiso de organización); no hay vinculación administrativa por correo. Cerrar sesión revoca solo esa sesión (`jti`).

## Ampliación autorizada A-01 (2026-10-20): alcance PROPIO y captura web

Catálogo ampliado con permisos de alcance propio: `producer:read_own`, `plot:read_own`, `plot:create_own`, `plot:update_own` y
`producer:link_self` (vincular o desvincular al productor con su cuenta). **El rol Productor no concede nada por sí solo**: hace
falta el vínculo explícito `producers.self_membership_id`, que se registra con motivo, queda versionado
(`producer_versions.change_type = 'LINK_SELF'`) y auditado (`producer.link_self`, evento `ProducerSelfLinked`). Una membresía
se vincula a un solo productor de su misma organización (índice único y disparador en 0057).

| Rol | Recorrido nuevo que puede completar | Límite |
| --- | --- | --- |
| Productor (vinculado) | Elegir su parcela, escribir coordenadas, dibujar sobre el mapa (o croquis), usar el polígono por vértices y la importación GeoJSON, revisar, guardar, corregir con motivo, adjuntar evidencias y fotografías, **consultar y descargar las fotografías de sus parcelas**, consultar sus versiones | Solo sus parcelas, documentos y evidencias; 404 ante lo ajeno; no evalúa GIS, no encarga satélite, no ve riesgo ni miembros, no aprueba evidencias |
| Técnico de campo | Lo mismo sobre parcelas de productores **asignados** (la extracción documental ahora también respeta la asignación) | Sin parcelas de productores no asignados; sin evaluación GIS fuera de sus permisos previos |
| Administrador de organización | Todo el recorrido sobre la organización; vincula productor–usuario; encarga satélite (ensayo) | Su organización |
| Gerente | Según sus permisos de gestión **vigentes** (lee la organización completa y gestiona productores y parcelas como ya podía). **No vincula cuentas a productores** (corrección del 2026-10-21, ver «Aclaración de alcance») | Sin captura propia adicional ni administración de accesos |
| Auditor | Consulta autorizada | Sin captura: la revisión previa y la confirmación devuelven 403 |
| Comprador | Nada de parcelas por su rol | 403 |

`PlotsService.load/inScope` es la puerta central del alcance (documentos, evidencias, historial, GIS, satélite, legal e importaciones
la usan); `plot:read_geometry` del Productor es la lectura de la geometría de **sus** parcelas, no acceso general. Pruebas: permisos
exactos en `catalog.spec.ts`, alcance por recurso en `a01-alcance-propio.int-spec.ts`. Hueco cerrado: `document:read` bastaba para leer
la extracción de cualquier documento por su identificador; ahora se verifica el alcance del titular **antes** del reintento idempotente.

**Fotografías propias (A-01, decisión 2026-10-20)**: permiso `document:read_field_photo_own` (Productor y administración de la organización). Permite ver y descargar el contenido
de los documentos `FIELD_PHOTO` (dato personal) **solo** cuando el titular (la parcela) está en el alcance propio del productor vinculado: el alcance por titular se comprueba
al consultar el documento y al obtener su contenido; no concede `producer:read_identity`, ni lectura de otras fotografías de la organización; retirar el vínculo corta el acceso al instante.
Auditor, comprador y técnicos sin identidad siguen sin acceso al contenido. El polígono por vértices y la importación GeoJSON admiten `plot:update_own` (antes devolvían 403 al productor).

### Aclaración de alcance del propietario (2026-10-21) y contraste con el catálogo
**Alcance autorizado.** La documentación raíz sigue gobernando el proyecto: se conservan los **roles canónicos, sus responsabilidades y sus permisos base**; la ampliación de captura geográfica **no crea roles alternativos ni redistribuye funciones**. A-01 añade capacidades **concretas a los roles existentes**:
| Rol canónico | Capacidad que añade A-01 |
| --- | --- |
| Productor/agricultor | Captura y consulta **sobre sus parcelas vinculadas** |
| Técnico de campo | Captura sobre productores y parcelas **asignados** (sin permisos nuevos: usa los de asignación que ya tenía) |
| Administrador de organización | Gestión dentro de su organización (incluye vincular cuentas a productores) |
| Gerente | Captura cuando corresponda a sus permisos y responsabilidades **vigentes** (sin permisos de captura nuevos) |
Estos permisos adicionales **no conceden facultades generales sobre otros módulos**. Capturar coordenadas **no** concede ejecutar análisis satelitales, aprobar evidencias ni concluir riesgo: esas acciones conservan su autorización específica.
**Separación.** La captura web permite preparar parcelas y demostrar el recorrido de evaluación satelital sin esperar al teléfono. Se conservan **separados** el mapa base, la geometría capturada y el resultado satelital; los escenarios locales siguen identificados como **ensayo** y no habilitan decisiones operativas.
**App móvil.** Conserva su alcance original. Su **ensayo físico sigue pospuesto**; la web **no sustituye** esa aceptación ni permite cerrar sus criterios pendientes (P0-023/P0-024).

**Contraste (2026-10-21): ¿modificó A-01 permisos o responsabilidades ajenas a su alcance?** Comparación exacta del catálogo efectivo por rol entre `1859aa0` (antes de A-01) y `4913dd3` (cierre de A-01), ignorando A-03:
| Rol | Permisos añadidos por A-01 | ¿Dentro del alcance aclarado? |
| --- | --- | --- |
| PRODUCER | `producer:read_own`, `plot:read_own`, `plot:create_own`, `plot:update_own`, `document:read_field_photo_own`; además `plot:read_geometry`, `document:read`, `document:upload` | **Sí.** Los tres últimos son «la puerta de entrada»; el alcance real lo fija el titular (parcela o productor propios) y **no** da lectura general: lo comprueban las pruebas «SOLO LO PROPIO», «LA PARCELA AJENA NO SE TOCA» y «CAPTURAR NO ES DECIDIR» (sin evaluar GIS, sin revisar documentos, sin encargar satélite, sin ver riesgo) |
| ORG_ADMIN | `producer:link_self`, `producer:read_own`, `document:read_field_photo_own`, `plot:read_own`, `plot:create_own`, `plot:update_own` | **Sí** (gestión dentro de su organización) |
| FIELD_TECHNICIAN | Ninguno | **Sí** (usa los permisos de asignación que ya tenía) |
| **MANAGER** | **`producer:link_self`** | **No.** Vincular una cuenta a un productor otorga a esa cuenta acceso a sus parcelas y fotografías (dato personal): es **administración de accesos**, no captura, y el Gerente no tenía gestión de membresías. Excedía la aclaración («Gerente: captura cuando corresponda a sus permisos vigentes») |
**Corrección.** Se retira `producer:link_self` del Gerente. **Se conservan** todas las capacidades autorizadas: el Gerente mantiene los permisos de gestión de productores y parcelas que ya tenía (captura cuando le corresponde), y la vinculación sigue disponible para la administración de la organización. Ningún otro rol cambia. Prueba: `src/authz/catalog.spec.ts` («A-01: los permisos de captura propia no amplían responsabilidades ajenas…») y las suites `a01-alcance-propio`, `rbac`, `members`, `producers`. La corrección es un cambio funcional de autorización: **validada y desplegada en `1de15c0`** (validación APROBADA `2026-10-21T18-00-11-041Z`; demostración 6/6: el Gerente recibe 403 también por solicitud directa, la administración conserva la operación, ningún vínculo existente se tocó). Evidencia en `docs/qa/EVIDENCIA_GEOLOCATION_PROFILE_I1I4_2026-10-21.md` §4.

## Ampliación autorizada A-02 (2026-10-21): administración web de concesiones

La pantalla `/organizaciones/{id}/concesiones` **no crea permisos**: usa `grant:manage` (hoy solo ORG_ADMIN) y, además, solo ofrece recursos que quien concede **puede leer**
(`lot:read`, `shipment:read`, `dd:read`; la API lo impone con `GRANT_BEYOND_GRANTOR`). Una concesión sigue sin crear membresía ni roles, no da propiedad ni capacidad de modificar y proyecta solo
códigos, estados y agregados (sin identidad de productores, geometrías, documentos personales ni economía). El destinatario se identifica por **correo exacto**, sin buscador ni lista de cuentas u organizaciones;
no disponible = inexistente = inactivo (misma respuesta), con intentos fallidos auditados (`grant.recipient_unavailable`, sin el correo en claro) y limitados a 10 por hora y persona.
Recorrido: propietario otorga (revisión + confirmación) → destinatario consulta lo autorizado en `/compartido` → propietario revoca (motivo obligatorio) → el acceso se pierde al instante. Quien no es miembro recibe 404.

**Traspaso entre organizaciones (A-03, 2026-10-21)**: siete permisos nuevos, cada uno de **un lado** del traspaso; ninguno concede lectura del inventario ajeno ni amplía otros permisos. El backend comprueba además el **lado** (emisora/receptora) y que la organización sea parte del traspaso (404 para terceros); el lado se comprueba antes que la versión.

| Permiso | Acción | Roles |
| --- | --- | --- |
| `partnership:manage` | Proponer, confirmar y revocar vínculos | ORG_ADMIN |
| `transfer:read` | Consultar vínculos, traspasos, opciones y linaje | ORG_ADMIN, TRACEABILITY_MANAGER, EXPORT_MANAGER, RECEPTION_OPERATOR, MANAGER, AUDITOR |
| `transfer:offer` | Ofrecer (reserva en el libro propio) y cancelar | ORG_ADMIN, TRACEABILITY_MANAGER, EXPORT_MANAGER |
| `transfer:accept` | Aceptar o rechazar una oferta (receptora) | ORG_ADMIN, TRACEABILITY_MANAGER, EXPORT_MANAGER |
| `transfer:dispatch` | Registrar la salida (emisora); **bloqueada por la compuerta** | ORG_ADMIN, TRACEABILITY_MANAGER, EXPORT_MANAGER |
| `transfer:receive` | Registrar recepciones, faltantes y rechazos en tránsito (receptora) | ORG_ADMIN, TRACEABILITY_MANAGER, RECEPTION_OPERATOR |
| `transfer:resolve` | Resolver diferencias (la contraparte confirma pérdidas y sobrantes) | ORG_ADMIN, TRACEABILITY_MANAGER |

Anti-escalamiento: un rol con estos permisos solo es otorgable por quien los posee. Un auditor lee, no actúa.

## Vinculación del catálogo de riesgo con un perfil jurídico (D-07.5(b), b-1; 2026-10-21)

Nuevo permiso de **plataforma** `risk_catalog:link_profile` (solo `SUPER_ADMIN`, nunca por membresía). Permite consultar los perfiles elegibles, confirmar el acto y ver su historial. **No** concede adoptar un catálogo (sigue `risk:approve_rules` de cada organización), **no** concede registrar conclusiones regulatorias y no cambia ninguna responsabilidad de los roles canónicos. Contrato: `decisiones/D-07-PROPUESTA.md` §13.

**Precisión (2026-10-21):** `risk_catalog:link_profile` es una **capacidad específica de `SUPER_ADMIN` sobre el catálogo global** de reglas de riesgo; no pasa a ningún rol de organización. Los permisos y responsabilidades base de los demás roles no cambian. Crear la versión vinculada, la aprobación técnica, la adopción por organización (`risk:approve_rules`) y la conclusión regulatoria son acciones distintas: ejecutar la primera no ejecuta las otras. No existe permiso para concluir.

## Registro del acto de revisión del perfil jurídico (P1-005; 2026-10-22)

Permiso de **plataforma** `legal_profile:record_review`, solo `SUPER_ADMIN`: capacidad específica sobre el perfil jurídico global; no pasa a ningún rol de organización y no cambia los permisos base de los demás roles. **Registrar el acto no es emitir una conclusión jurídica** ni concede concluir riesgo. Contrato: `09_CONTRATOS_API.md`; datos: `06_DICCIONARIO_DATOS.md`.

## Configuración de reglas de geolocalización (2026-10-22)

Permiso de **plataforma** `geo_config:manage` (solo `SUPER_ADMIN`): preparar versiones y registrar su revisión (capacidad específica sobre el catálogo global; no pasa a ningún rol de organización). La organización consulta con `traceability:read_catalog` y adopta con `risk:approve_rules`. **Ningún permiso para concluir riesgo**; los permisos base de los demás roles no cambian.

## Enmienda acotada (2026-10-22): asignación de `EUDR_MANAGER`

Las reglas «rol ⊆ permisos del actor» (invitar y cambiar roles) admiten **una sola excepción exacta**: el par (`EUDR_MANAGER`, `risk:conclude`)
puede asignarlo quien tenga `membership:assign`, sin poseer `risk:conclude`. `ORG_ADMIN` asigna ese rol solo dentro de su organización
y **no puede concluir**; no obtiene capacidad para conceder otros permisos, asignar `SUPER_ADMIN` ni administrar miembros de otra organización.
Sigue prohibido el cambio de roles a uno mismo. Pruebas: `authz/catalog.spec.ts`, `test/rbac.int-spec.ts`. Evidencia: `qa/EVIDENCIA_D076_CONCLUSION_HUMANA_2026-10-22.md`.
