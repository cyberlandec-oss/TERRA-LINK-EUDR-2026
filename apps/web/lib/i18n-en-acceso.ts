// Traducción de INTERFAZ al inglés del acceso de plataforma (D-04) y de la observabilidad (RNF-13). Español = fuente (la clave es el texto en español).
// No es una traducción jurídica certificada. Se fusiona con `i18n-en.ts`.

export const EN_ACCESO: Record<string, string> = {
  'Acceso de plataforma': 'Platform access',
  'Qué es y qué no es esto': 'What this is and what it is not',
  'La administración de la plataforma no entra a los datos de una organización por defecto. Puede pedir un acceso acotado, con motivo y alcance, de hasta 15 minutos. Lo aprueba quien administra la organización, nunca quien lo solicita, y queda registrado. Hoy el acceso es solo de lectura de miembros.':
    'Platform administration does not enter an organization’s data by default. It can request limited access, with a reason and scope, for up to 15 minutes. The organization’s administrator approves it, never the requester, and it is recorded. Today the access is read-only for members.',
  'Solicitudes y accesos sobre esta organización': 'Requests and access to this organization',
  'Cargando solicitudes…': 'Loading requests…',
  'No hay solicitudes de acceso de plataforma.': 'There are no platform access requests.',
  'Cuando la plataforma pida un acceso, aparecerá aquí para que lo decidas.': 'When the platform requests access, it will appear here for you to decide.',
  'Solicitudes de acceso de plataforma': 'Platform access requests',
  'Estado': 'Status', 'Solicitó': 'Requested by', 'Motivo y alcance': 'Reason and scope', 'Vigencia': 'Validity', 'Usos': 'Uses', 'Acción': 'Action',
  'Hasta': 'Until', 'Aprobó': 'Approved by',
  'Solo quien administra la organización decide.': 'Only the organization’s administrator decides.',
  'Pendiente de aprobación': 'Pending approval', 'Aprobado y vigente': 'Approved and active', 'Rechazado': 'Rejected', 'Revocado': 'Revoked', 'Vencido': 'Expired', 'Finalizado': 'Ended',
  'Ver los miembros de la organización (solo lectura)': 'View the organization’s members (read-only)',
  'Sin acceso a esta pantalla': 'No access to this screen',
  'Ver las solicitudes de acceso de plataforma requiere administrar los miembros de la organización.': 'Viewing platform access requests requires managing the organization’s members.',
  'Aprobar': 'Approve', 'Rechazar': 'Reject', 'Revocar': 'Revoke',
  'Motivo de la aprobación': 'Reason for approval', 'Motivo del rechazo': 'Reason for rejection', 'Motivo de la revocación': 'Reason for revocation',
  'Enviando…': 'Sending…', 'Confirmar': 'Confirm', 'Cancelar': 'Cancel',
  'Solicitar acceso a esta organización': 'Request access to this organization',
  'Acceso finalizado': 'Access ended', 'Solicitud enviada: pendiente de aprobación': 'Request sent: pending approval',
  'Finalizaste el acceso antes de su vencimiento.': 'You ended the access before it expired.',
  'Quien administra la organización debe aprobarla. Mientras tanto no tienes acceso. Una vez aprobada, podrás ver los miembros hasta que venza.':
    'The organization’s administrator must approve it. Until then you have no access. Once approved, you can view the members until it expires.',
  'Ir a Miembros e invitaciones': 'Go to Members and invitations', 'Finalizar el acceso ahora': 'End the access now',
  'Para qué lo necesitas': 'What you need it for', 'Motivo': 'Reason', 'Recursos o ámbito concreto': 'Specific resources or scope',
  'Qué podrás hacer': 'What you will be able to do', 'Duración': 'Duration', 'minutos': 'minutes',
  'Tu contraseña (se comprueba de nuevo)': 'Your password (checked again)', 'Enviar solicitud': 'Send request',
};

// Gestión global de cuentas (listado mínimo, SUPER_ADMIN).
export const EN_USUARIOS: Record<string, string> = {
  'Usuarios de la plataforma': 'Platform users',
  'Estado de las cuentas y organizaciones a las que pertenecen': 'Account status and the organizations they belong to',
  'El listado es mínimo a propósito: nombre, estado y organizaciones. No muestra correos, roles ni datos operativos. Desactivar una cuenta cierra sus sesiones al instante, exige un motivo y queda en la auditoría.':
    'The list is deliberately minimal: name, status and organizations. It shows no emails, roles or operational data. Deactivating an account closes its sessions immediately, requires a reason and is audited.',
  'Cuenta desactivada: sus sesiones se cerraron.': 'Account deactivated: its sessions were closed.',
  'Cuenta reactivada: deberá iniciar sesión de nuevo.': 'Account reactivated: the person must sign in again.',
  'El cambio quedó registrado en la auditoría.': 'The change was recorded in the audit log.',
  'Cargando usuarios…': 'Loading users…', 'No hay usuarios.': 'There are no users.',
  'Aparecerán aquí cuando existan cuentas.': 'They will appear here when accounts exist.',
  'Cuentas': 'Accounts', 'Nombre': 'Name', 'Organizaciones': 'Organizations', 'Plataforma': 'Platform',
  'Activa': 'Active', 'Inactiva': 'Inactive', 'Tu cuenta': 'Your account', 'Desactivar': 'Deactivate', 'Reactivar': 'Reactivate',
  'Motivo de la desactivación': 'Reason for deactivation', 'Motivo de la reactivación': 'Reason for reactivation',
};

// RNF-13 · observabilidad de la plataforma.
export const EN_OBSERVABILIDAD: Record<string, string> = {
  'Observabilidad': 'Observability',
  'Servicio, versión desplegada y trazas recientes': 'Service, deployed version and recent traces',
  'Muestra el estado del servicio, no los datos de ninguna organización. Las trazas están en la memoria del proceso de la API: se pierden al reiniciar y no incluyen al worker. «ok» describe este momento; no es un compromiso de disponibilidad.':
    'It shows the state of the service, not any organization’s data. Traces are held in the API process memory: they are lost on restart and do not include the worker. “ok” describes this moment; it is not an availability commitment.',
  'Cargando observabilidad…': 'Loading observability…',
  'Dependencias': 'Dependencies',
  'Análisis de documentos no disponible': 'Document analysis unavailable',
  'Sin el escáner, los documentos quedan «análisis pendiente»: no se marcan como limpios.': 'Without the scanner, documents stay “analysis pending”: they are not marked clean.',
  'Código desplegado': 'Deployed code', 'Servicio': 'Service', 'Versión del código (commit)': 'Code version (commit)',
  'No inyectado en la construcción': 'Not injected at build time',
  'Última migración conocida por el código': 'Latest migration known to the code', 'Proceso iniciado': 'Process started',
  'Trazas recientes': 'Recent traces', 'Todavía no hay trazas en memoria.': 'There are no traces in memory yet.',
  'Aparecen cuando la API atiende solicitudes.': 'They appear when the API serves requests.',
  'Traza': 'Trace', 'Inicio': 'Start', 'Duración (ms)': 'Duration (ms)', 'Tramos': 'Spans', 'Ver recorrido': 'View path',
  'Recorrido de la traza': 'Trace path', 'No se encontró la traza': 'Trace not found',
};
