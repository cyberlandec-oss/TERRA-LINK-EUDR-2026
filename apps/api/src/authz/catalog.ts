// Catálogo RBAC versionado (docs/07_RBAC_Y_GOBERNANZA.md). Se amplía por historia; no inferir
// privilegios comparando nombres de rol fuera de este módulo.
export const RBAC_CATALOG_VERSION = '2026-10-17.24';

export type Permission =
  | 'organization:read'
  | 'organization:update'
  | 'membership:read'
  | 'membership:assign'
  | 'audit:read'
  // P0-025: exportar la bitácora con el mismo alcance y redacción que la consulta.
  | 'audit:export'
  // P0-004. `_assigned` = solo productores asignados a la membresía del usuario.
  | 'producer:read'
  | 'producer:read_assigned'
  | 'producer:read_identity'
  | 'producer:create'
  | 'producer:update'
  | 'producer:update_assigned'
  | 'producer:assign'
  | 'producer:archive'
  // P0-005: revisar posibles duplicados (Data Steward).
  | 'producer:review_duplicates'
  // P0-006. `_assigned` = parcelas de productores asignados a la membresía del usuario.
  | 'plot:read'
  | 'plot:read_assigned'
  | 'plot:create'
  | 'plot:create_assigned'
  | 'plot:update'
  | 'plot:update_assigned'
  | 'plot:archive'
  // Clasificación de acceso a geometrías exactas (doc 06): coordenadas solo con este permiso, dentro del
  // mismo alcance de lectura de parcelas. Sin él, la API omite coordenadas (no las oculta la UI).
  | 'plot:read_geometry'
  // P0-010: ejecutar la evaluación GIS técnica (consultar resultados usa plot:read/plot:read_assigned).
  | 'plot:evaluate_gis'
  | 'plot:evaluate_gis_assigned'
  // A-01 (2026-10-20) — alcance PROPIO del productor: solo su productor vinculado (`producers.self_membership_id`) y sus
  // parcelas. `producer:link_self` administra ese vínculo (explícito y auditable); el rol por sí solo no concede nada.
  | 'producer:read_own'
  // A-01: ver y descargar las FOTOGRAFÍAS DE CAMPO (FIELD_PHOTO, dato personal) de las parcelas del propio productor vinculado. NO es
  // `producer:read_identity` ni lectura de otras fotografías: el alcance por titular (parcela propia) lo sigue fijando PlotsService.
  | 'document:read_field_photo_own'
  | 'plot:read_own'
  | 'plot:create_own'
  | 'plot:update_own'
  | 'producer:link_self'
  // P0-011: catálogo de productos de la organización. Administrar = alta, edición y baja lógica.
  | 'product:read'
  | 'product:manage'
  // P0-013: consultar el catálogo de sistema de hitos críticos (CTE). Sin facultad de administración.
  | 'traceability:read_catalog'
  // P0-015: reprocesar manualmente entregas DEAD del outbox de la propia organización (con motivo y auditoría).
  | 'events:reprocess'
  // P0-018: documentos. Consultar y subir se limitan además por el alcance del titular (productor/parcela);
  // revisar es una facultad separada; el contenido PERSONAL_DATA exige producer:read_identity.
  | 'document:read'
  | 'document:upload'
  | 'document:review'
  // P1-013 — ejecutar la extracción asistida. Separado de `upload`: subir un archivo no autoriza a
  // leer su contenido, y separado de `review`: proponer no es confirmar.
  | 'document:extract'
  // P0-019: evidencias. Consultar/vincular se limitan además por el alcance de la entidad y del documento;
  // verificar/rechazar/revocar es una facultad separada.
  | 'evidence:read'
  | 'evidence:link'
  | 'evidence:verify'
  // P0-012: entregas y recepción (docs/07 «delivery: read, create, correct»; «reception/quality: read, confirm,
  // analyze, release_quality, reject_quality»). `_assigned` = entregas de productores asignados a la membresía.
  // Centros asignados para RECEPTION_OPERATOR: sin contrato de asignación todavía (alcance de organización).
  | 'delivery:read'
  | 'delivery:read_assigned'
  // A-05/AJ-02 (2026-10-23): LISTADO de las entregas del productor vinculado a la cuenta (docs/07: PRODUCER «recursos propios: perfil, parcelas, entregas, documentos»).
  // Es solo el listado (estado, cantidades y recepción): el DETALLE de una entrega (personal, compuertas, historial) sigue siendo de quien opera.
  | 'delivery:read_own'
  | 'delivery:create'
  | 'delivery:create_assigned'
  | 'delivery:correct'
  | 'reception:confirm'
  | 'reception:correct'
  | 'location:read'
  | 'location:manage'
  | 'quality:record'
  | 'quality:decide'
  // P0-016 (docs/07 «lot / process: read, create, close»; D-39.4 adoptada para desarrollo local): leer lotes; crear lotes
  // y asignar recepciones; liberar asignaciones; preparar/iniciar/cancelar procesos; cerrar procesos (permiso específico).
  | 'lot:read'
  | 'lot:create'
  | 'lot:release_input'
  | 'process:manage'
  | 'process:close'
  // P0-017 (docs/07 «stock: read, adjust, …»; propuesta en docs/decisiones/P0-017-EFECTOS-LEDGER.md): saldos y movimientos;
  // merma, traslado y asignación de ubicación; ajuste con motivo; incorporación/conciliación. Reserva y despacho: P0-029.
  // P0-030 (S1 §60; docs/decisiones/P0-030-REPORTES.md): `report:read` abre la pantalla de indicadores, NO los datos.
  // Cada indicador exige además el permiso de su dominio (producer/plot/delivery/lot/evidence/risk/dd:read); sin él sale
  // RESTRICTED, sin valor ni conteo. `report:export` es un permiso aparte, revalidado al descargar.
  | 'report:read'
  | 'report:export'
  | 'stock:read'
  | 'stock:move'
  | 'stock:adjust'
  | 'stock:incorporate'
  // P0-020 (docs/07 EUDR_MANAGER «evaluar»; AUDITOR y TRACEABILITY_MANAGER lectura): evaluaciones técnicas de riesgo y
  // su revisión humana. Leer/evaluar exige además lectura de organización completa (comprobado en el servicio).
  | 'risk:read'
  | 'risk:evaluate'
  | 'risk:review'
  /** D-07.1: adoptar o retirar un catálogo de reglas DENTRO de una organización. No publica nada global. */
  | 'risk:approve_rules'
  /** D-07.6: registrar la CONCLUSIÓN HUMANA (NEGLIGIBLE / NON_NEGLIGIBLE) de una evaluación. Solo EUDR_MANAGER (rol responsable EUDR); el motor nunca concluye. */
  | 'risk:conclude'
  // P0-021 (docs/13 §Mitigación; docs/07 EUDR_MANAGER «crear mitigación, revisar»): leer, crear/asignar, aportar soportes
  // (solo el responsable asignado) y verificar/rechazar (nunca quien ejecutó: separación de funciones sin excepción).
  | 'mitigation:read'
  | 'mitigation:manage'
  | 'mitigation:contribute'
  | 'mitigation:verify'
  // P0-022 (docs/09 «dd:read/approve_package/export_package»; docs/07 EUDR_MANAGER): leer el expediente, gestionarlo (crear y
  // capturar instantáneas), revisar/aprobar la preparación (aprobar exige todos los requisitos cumplidos) y exportar paquetes.
  | 'dd:read'
  | 'dd:manage'
  | 'dd:approve_package'
  | 'dd:export_package'
  // P0-024 (docs/11): usar la sincronización de campo con un dispositivo propio (registrar, enviar, recibir) y gestionar
  // (revocar) dispositivos de otros miembros. El dispositivo nunca concede permisos: cada operación revalida los suyos.
  | 'sync:use'
  | 'device:manage'
  // P0-026 (docs/09 «permiso de importación y de cada entidad»; docs/14 ORG_ADMIN «mapear Excel»): cargar, mapear,
  // previsualizar y confirmar importaciones. NO concede nada sobre las entidades: cada fila exige además el permiso y el
  // alcance de la entidad (p. ej. producer:create, producer:update/_assigned, producer:read_identity).
  | 'import:manage'
  // P1-006 — intercambio con un registro externo (GUIA/Agrocalidad). `manage` registra el acuerdo y retira;
  // `use` exporta y concilia. **Verificar el canal NO está aquí**: es un permiso de plataforma, porque una
  // organización no puede certificar su propio canal (RF-37: «solo canal/acuerdo comprobados»).
  | 'exchange:manage'
  | 'exchange:use'
  // P1-008 — integración ERP por webhooks (RF-39). `manage` configura destinos y rota secretos; `read`
  // consulta destinos e intentos. Separados: ver cómo va la integración no es poder cambiarla.
  | 'integration:manage'
  | 'integration:read'
  // P1-010 — presupuesto de preparación. `manage` registra los parámetros presupuestarios (dinero declarado
  // por la organización, no tarifas de Terra Link); `read` consulta y estima. Separados porque fijar importes
  // no es lo mismo que usarlos.
  | 'cost:manage'
  | 'cost:read'
  // P1-015 / D-54 — coste estimado de USO DE LA PLATAFORMA (USD, tarifas declaradas). Distinto de `cost:*`, que es
  // el presupuesto de preparación de P1-010. `manage` declara tarifas y registra estimaciones; `read` las consulta.
  | 'platform_cost:manage'
  | 'platform_cost:read'
  // P1-012 — precio, prima y pagos informados de la operación comercial con el productor (RF-43 «moneda y
  // privacidad»; S3 §32). SEPARADOS de `delivery:*` a propósito: quien registra o lee una entrega no ve por
  // ello su dinero. Registrar no es corregir, porque corregir exige motivo y deja historial.
  // P1-014 — indicadores comerciales (RF-45). Abre la pantalla; CADA indicador exige además el permiso de su
  // dominio (economía, coste, entregas, parcelas), de modo que un agregado no filtre lo que el rol no lee.
  | 'analytics:read'
  | 'economics:read'
  | 'economics:record'
  | 'economics:correct'
  // P0-029 (docs/07 «shipment: reserve, release_dispatch, dispatch»; EXPORT_MANAGER «reservar, preparar, liberar despacho si
  // gates pasan»): leer embarques y compradores; gestionarlos (crear, ítems, cancelar); reservar y liberar en el ledger;
  // despachar (solo si el preflight y la compuerta SHIPMENT_DISPATCH pasan).
  // P0-003 / D-P0003.1: conceder y revocar acceso externo sobre instancias concretas. Es facultad de
  // DISPOSICIÓN sobre datos propios, por eso solo ORG_ADMIN. No amplía nada por sí misma: quien concede no
  // puede conceder lo que no tiene.
  | 'grant:manage'
  | 'shipment:read'
  | 'shipment:manage'
  | 'stock:reserve'
  | 'shipment:dispatch'
  // P0-028 (backlog: «Como EUDR_MANAGER, necesito resultado con procedencia»; docs/07 no nombra el satélite):
  // consultar trabajos/resultados satelitales y encargar un análisis. `satellite:request` NO concede lectura de
  // parcelas y, por sí solo, tampoco basta: encargar un análisis saca la geometría exacta del equipo, así que el
  // servicio exige además `plot:read_geometry` y el alcance de la parcela.
  | 'satellite:read'
  | 'satellite:request'
  // Autorizar (o revocar) que OTRA organización analice parcelas concretas de la propia. Acto del propietario; no concede lectura de la parcela.
  | 'satellite:authorize'
  // A-03 (2026-10-21) — traspaso de custodia física entre organizaciones. Cada permiso es de UN lado del traspaso; ninguno concede lectura del
  // inventario ajeno. Ofrecer reserva existencia del propio libro: no requiere otro permiso.
  | 'partnership:manage'
  | 'transfer:read' | 'transfer:offer' | 'transfer:accept' | 'transfer:dispatch' | 'transfer:receive' | 'transfer:resolve';

// Permisos de plataforma: solo SUPER_ADMIN (users.platform_role), nunca por membresía.
export type PlatformPermission =
  | 'organization:create'
  | 'organization:suspend'
  | 'organization:list_all'
  | 'organization:onboard_admin'
  | 'user:deactivate'
  // RNF-13 (S1 §77): leer métricas y trazas del servicio. Es INFRAESTRUCTURA saneada —método, ruta en patrón,
  // clase de estado, duración—, nunca datos de una organización, y por eso NO necesita la elevación D-04 ni la
  // habilita. Si algún día la instrumentación tuviera que mirar datos de negocio, eso sería otra decisión.
  | 'observability:read'
  // P1-006: verificar el acuerdo/canal de intercambio con un registro externo. Separado de la organización
  // a propósito: quien va a intercambiar no puede declarar comprobado su propio canal.
  | 'exchange:verify'
  // D-07.5(b), b-1: vincular una versión NUEVA del catálogo de riesgo (global) con una versión de perfil jurídico revisado.
  // NO concede concluir ni adoptar: la adopción es de cada organización y la conclusión sigue bloqueada.
  | 'risk_catalog:link_profile'
  // P1-005: registrar el ACTO de revisión de una versión del perfil jurídico (global). Registrar no es una conclusión jurídica del sistema.
  | 'legal_profile:record_review'
  // GEOLOCATION_PROFILE: preparar y revisar versiones de la CONFIGURACIÓN de reglas de geolocalización (global). No concede concluir riesgo.
  | 'geo_config:manage';

const ALL_MEMBER_READ: Permission[] = ['organization:read'];

const PRODUCER_ALL: Permission[] = [
  'producer:read', 'producer:read_assigned', 'producer:read_identity', 'producer:create',
  'producer:update', 'producer:update_assigned', 'producer:assign', 'producer:archive', 'producer:review_duplicates', 'producer:link_self', 'producer:read_own', 'document:read_field_photo_own',
];

const PLOT_ALL: Permission[] = [
  'plot:read', 'plot:read_assigned', 'plot:create', 'plot:create_assigned', 'plot:update', 'plot:update_assigned', 'plot:archive', 'plot:read_geometry',
  'plot:evaluate_gis', 'plot:evaluate_gis_assigned', 'plot:read_own', 'plot:create_own', 'plot:update_own',
];

// Permisos de productor: propuesta provisional derivada de S1 §9 (FIELD_TECHNICIAN producer:create/read)
// y doc 07/14 («solo asignaciones» para el técnico). Pendiente de ratificación con el resto de la matriz.
const TRANSFER_ALL: Permission[] = ['partnership:manage', 'transfer:read', 'transfer:offer', 'transfer:accept', 'transfer:dispatch', 'transfer:receive', 'transfer:resolve'];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ORG_ADMIN: [...TRANSFER_ALL, 'audit:read', 'audit:export', 'organization:read', 'organization:update', 'membership:read', 'membership:assign', 'grant:manage', ...PRODUCER_ALL, ...PLOT_ALL, 'product:read', 'traceability:read_catalog', 'product:manage', 'events:reprocess', 'document:read', 'document:upload', 'document:review', 'document:extract', 'evidence:read', 'evidence:link', 'evidence:verify', 'delivery:read', 'delivery:read_assigned', 'delivery:read_own', 'delivery:create', 'delivery:create_assigned', 'delivery:correct', 'reception:confirm', 'reception:correct', 'location:read', 'location:manage', 'quality:record', 'quality:decide', 'lot:read', 'lot:create', 'lot:release_input', 'process:manage', 'process:close', 'stock:read', 'stock:move', 'stock:adjust', 'stock:incorporate', 'risk:read', 'risk:evaluate', 'risk:review', 'risk:approve_rules', 'mitigation:read', 'mitigation:manage', 'mitigation:contribute', 'mitigation:verify', 'dd:read', 'dd:manage', 'dd:approve_package', 'dd:export_package', 'sync:use', 'device:manage', 'import:manage', 'exchange:manage', 'exchange:use', 'integration:manage', 'integration:read', 'cost:manage', 'cost:read', 'platform_cost:manage', 'platform_cost:read', 'economics:read', 'economics:record', 'economics:correct', 'analytics:read', 'shipment:read', 'shipment:manage', 'stock:reserve', 'shipment:dispatch', 'report:read', 'report:export', 'satellite:read', 'satellite:request', 'satellite:authorize'],
  MANAGER: ['transfer:read', ...ALL_MEMBER_READ, 'membership:read', 'producer:read', 'producer:read_identity', 'producer:create', 'producer:update', 'producer:assign', 'producer:archive', 'producer:review_duplicates', 'plot:read', 'plot:create', 'plot:update', 'plot:archive', 'plot:read_geometry', 'plot:evaluate_gis', 'product:read', 'traceability:read_catalog', 'document:read', 'document:upload', 'document:extract', 'evidence:read', 'evidence:link', 'delivery:read', 'delivery:create', 'delivery:correct', 'reception:confirm', 'location:read', 'lot:read', 'lot:create', 'stock:read', 'sync:use', 'import:manage', 'exchange:use', 'integration:read', 'cost:manage', 'cost:read', 'economics:read', 'economics:record', 'economics:correct', 'analytics:read', 'report:read'],
  FIELD_TECHNICIAN: [...ALL_MEMBER_READ, 'producer:read_assigned', 'producer:read_identity', 'producer:create', 'producer:update_assigned',
    'plot:read_assigned', 'plot:create_assigned', 'plot:update_assigned', 'plot:read_geometry', 'plot:evaluate_gis_assigned', 'product:read', 'traceability:read_catalog', 'document:read', 'document:upload', 'evidence:read', 'evidence:link', 'delivery:read_assigned', 'delivery:create_assigned', 'location:read', 'sync:use'],
  RECEPTION_OPERATOR: ['transfer:read', 'transfer:receive', ...ALL_MEMBER_READ, 'product:read', 'traceability:read_catalog', 'delivery:read', 'delivery:create', 'reception:confirm', 'reception:correct', 'location:read', 'quality:record', 'lot:read', 'lot:create', 'stock:read'],
  QUALITY_OPERATOR: [...ALL_MEMBER_READ, 'product:read', 'traceability:read_catalog', 'delivery:read', 'location:read', 'quality:record', 'quality:decide', 'lot:read', 'stock:read'],
  TRACEABILITY_MANAGER: ['transfer:read', 'transfer:offer', 'transfer:accept', 'transfer:dispatch', 'transfer:receive', 'transfer:resolve', ...ALL_MEMBER_READ, 'producer:read', 'plot:read', 'plot:read_geometry', 'plot:evaluate_gis', 'product:read', 'traceability:read_catalog', 'document:read', 'evidence:read', 'delivery:read', 'location:read', 'lot:read', 'lot:create', 'lot:release_input', 'process:manage', 'process:close', 'stock:read', 'stock:move', 'risk:read', 'mitigation:read', 'mitigation:contribute', 'shipment:read', 'report:read', 'satellite:read'],
  EUDR_MANAGER: [...ALL_MEMBER_READ, 'producer:read', 'producer:read_identity', 'plot:read', 'plot:read_geometry', 'plot:evaluate_gis', 'product:read', 'traceability:read_catalog', 'document:read', 'document:upload', 'document:review', 'evidence:read', 'evidence:link', 'evidence:verify', 'delivery:read', 'location:read', 'lot:read', 'stock:read', 'risk:read', 'risk:evaluate', 'risk:review', 'risk:conclude', 'mitigation:read', 'mitigation:manage', 'mitigation:contribute', 'mitigation:verify', 'dd:read', 'dd:manage', 'dd:approve_package', 'dd:export_package', 'cost:read', 'shipment:read', 'report:read', 'report:export', 'satellite:read', 'satellite:request'],
  EXPORT_MANAGER: ['transfer:read', 'transfer:offer', 'transfer:accept', 'transfer:dispatch', ...ALL_MEMBER_READ, 'product:read', 'traceability:read_catalog', 'location:read', 'lot:read', 'stock:read', 'shipment:read', 'shipment:manage', 'stock:reserve', 'shipment:dispatch', 'report:read',
    // Consulta, encarga, sigue, cancela y descarga análisis SOLO de parcelas que otra organización le autorizó (no concede plot:*, risk:* ni dd:*).
    'satellite:read', 'satellite:request'],
  BUYER: [],
  AUDITOR: ['transfer:read', ...ALL_MEMBER_READ, 'audit:read', 'audit:export', 'economics:read', 'analytics:read', 'producer:read', 'plot:read', 'product:read', 'traceability:read_catalog', 'document:read', 'evidence:read', 'delivery:read', 'location:read', 'lot:read', 'stock:read', 'risk:read', 'mitigation:read', 'dd:read', 'shipment:read', 'report:read', 'report:export', 'satellite:read'],
  // A-01: el productor captura y consulta SOLO lo suyo. Sin `plot:evaluate_gis*`, `document:review`, `evidence:*`, `risk:*`:
  // registrar coordenadas no concede aprobar evidencias ni concluir riesgo. `document:read/upload` son la puerta de entrada;
  // el alcance real lo pone el titular del documento (parcela o productor propios).
  PRODUCER: ['sync:use', 'producer:read_own', 'delivery:read_own', 'plot:read_own', 'plot:create_own', 'plot:update_own', 'plot:read_geometry', 'document:read', 'document:upload', 'document:read_field_photo_own', 'satellite:read'],
};

export const PLATFORM_PERMISSIONS: Record<'SUPER_ADMIN', PlatformPermission[]> = {
  // organization:onboard_admin: solo invitar (y ver/revocar invitaciones de) ORG_ADMIN en una organización
  // donde no es miembro. NO da acceso a miembros, datos personales ni operación: eso requiere la
  // política de elevación auditada (D-04, pendiente). No hay bypass global de SUPER_ADMIN.
  SUPER_ADMIN: ['organization:create', 'organization:suspend', 'organization:list_all', 'organization:onboard_admin', 'user:deactivate', 'observability:read', 'exchange:verify', 'risk_catalog:link_profile', 'legal_profile:record_review', 'geo_config:manage'],
};

export function permissionsForRoles(roles: string[]): Permission[] {
  return [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))].sort();
}

export const ORGANIZATION_ROLES = Object.keys(ROLE_PERMISSIONS);

/**
 * Anti-escalamiento: un actor solo puede conceder (o retirar) un rol cuyos permisos ya posee.
 * Exige además membership:assign. SUPER_ADMIN sin membresía solo usa organization:onboard_admin.
 */
export function canGrantRole(actorPermissions: Permission[], roleCode: string): boolean {
  const role = ROLE_PERMISSIONS[roleCode];
  if (!role || !actorPermissions.includes('membership:assign')) return false;
  return role.every((p) => actorPermissions.includes(p) || (roleCode === ROL_RESPONSABLE_EUDR && p === PERMISO_CONCLUIR));
}

/**
 * ÚNICA excepción al anti-escalamiento de docs/07 («rol ⊆ permisos del actor»), adoptada con D-07.6: quien administra los accesos puede ASIGNAR (y retirar) el rol `EUDR_MANAGER` aunque
 * ese rol incluya `risk:conclude`, que `ORG_ADMIN` NO tiene y no obtiene: administrar la asignación y registrar una conclusión son funciones separadas. La excepción es EXACTA: solo el par
 * (rol `EUDR_MANAGER`, permiso `risk:conclude`) y solo para quien ya tiene `membership:assign`. No concede ese permiso a nadie, no abre ningún otro rol ni permiso, y no cambia las demás
 * comprobaciones de `members.ts` (misma organización, no al propio miembro, `SUPER_ADMIN` no asignable).
 */
export const ROL_RESPONSABLE_EUDR = 'EUDR_MANAGER';
export const PERMISO_CONCLUIR: Permission = 'risk:conclude';

export function assignableRoles(actorPermissions: Permission[]): string[] {
  return ORGANIZATION_ROLES.filter((r) => canGrantRole(actorPermissions, r)).sort();
}
