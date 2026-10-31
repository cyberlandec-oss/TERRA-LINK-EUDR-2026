// P0-025: tipos y etiquetas de la bitácora (consulta de solo lectura). Las etiquetas no cambian el dato registrado.

export interface AuditActor { key: string; label: string; email?: string }
export interface AuditRecord {
  id: string;
  occurred_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
  reason: string | null;
  request_id: string | null;
  actor: AuditActor;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  redacted_fields: string[];
}
export interface AuditPage { items: AuditRecord[]; total: number; next_cursor: string | null; limit: number }
export interface AuditFacets { actions: string[]; entity_types: string[]; actors: AuditActor[]; results: string[] }
export interface AuditDetail {
  record: AuditRecord;
  timeline: AuditRecord[];
  correlated: AuditRecord[];
  links: { corrects_event_id: string | null; correction_event_id: string | null; version_id: string | null };
}

export const ENTITY_LABELS: Record<string, string> = {
  organization: 'Organización', membership: 'Membresía', invitation: 'Invitación', user: 'Cuenta', producer: 'Productor',
  producer_match_review: 'Posible duplicado', plot: 'Parcela', product: 'Producto', document: 'Documento', evidence: 'Afirmación',
  event_delivery: 'Entrega de evento', audit: 'Auditoría',
};

export const RESULT_LABELS: Record<string, { label: string; tone: 'valid' | 'blocked' | 'review' }> = {
  SUCCESS: { label: 'Realizado', tone: 'valid' },
  DENIED: { label: 'Rechazado', tone: 'blocked' },
  FAILED: { label: 'Fallido', tone: 'review' },
};

const ACTION_LABELS: Record<string, string> = {
  'organization.create': 'Organización creada', 'organization.update': 'Configuración modificada', 'organization.suspend': 'Organización suspendida',
  'organization.reactivate': 'Organización reactivada', 'membership.create': 'Membresía creada', 'membership.deactivate': 'Membresía desactivada',
  'membership.reactivate': 'Membresía reactivada', 'membership.roles_change': 'Roles modificados', 'invitation.create': 'Invitación emitida',
  'invitation.revoke': 'Invitación revocada', 'invitation.accept': 'Invitación aceptada',
  'producer.create': 'Productor registrado', 'producer.update': 'Productor editado', 'producer.correct': 'Corrección de productor',
  'producer.assign': 'Productor reasignado', 'producer.archive': 'Productor archivado', 'producer.activate': 'Productor reactivado',
  'producer_match.detect': 'Posible duplicado detectado', 'producer_match.resolve': 'Posible duplicado resuelto',
  'plot.create': 'Parcela registrada', 'plot.update': 'Parcela editada', 'plot.archive': 'Parcela archivada', 'plot.activate': 'Parcela reactivada',
  'plot.geometry_version': 'Nueva versión de geometría', 'plot.location_capture': 'Ubicación capturada', 'plot.polygon_draft_start': 'Borrador de polígono iniciado',
  'plot.polygon_vertex_add': 'Vértice añadido', 'plot.polygon_vertex_undo': 'Vértice deshecho', 'plot.polygon_draft_cancel': 'Borrador cancelado',
  'plot.polygon_confirm': 'Polígono confirmado', 'plot.geometry_import_analyze': 'Importación GeoJSON analizada', 'plot.geometry_import_confirm': 'Importación GeoJSON confirmada',
  'plot.geometry_import_discard': 'Importación GeoJSON descartada', 'plot.geometry_import_original_download': 'Descarga del original GeoJSON',
  'plot.geometry_export': 'Exportación de geometría', 'plot.gis_evaluate': 'Evaluación GIS técnica',
  'product.created': 'Producto creado', 'product.updated': 'Producto editado', 'product.deactivated': 'Producto desactivado', 'product.reactivated': 'Producto reactivado',
  'document.upload': 'Documento cargado', 'document.version_upload': 'Nueva versión de documento', 'document.upload_rejected': 'Carga rechazada por el escáner',
  'document.scan': 'Análisis antimalware', 'document.review': 'Revisión documental', 'document.link': 'Documento vinculado', 'document.download': 'Descarga de documento',
  'evidence.create': 'Afirmación registrada', 'evidence.link_source': 'Soporte vinculado', 'evidence.withdraw_source': 'Soporte retirado',
  'evidence.submit': 'Afirmación enviada a revisión', 'evidence.verify': 'Afirmación verificada', 'evidence.reject': 'Afirmación rechazada',
  'evidence.revoke': 'Verificación revocada', 'evidence.reopen': 'Afirmación reabierta',
  'event_delivery.requeue': 'Entrega de evento reencolada', 'audit.export': 'Exportación de auditoría',
};
export const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

/** Valor legible de un campo permitido (sin interpretar más allá del dato). */
export function fieldValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (Array.isArray(v)) return v.length ? v.map(fieldValue).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export const AUDIT_FILTER_KEYS = ['from', 'to', 'entity_type', 'entity_id', 'action', 'actor', 'result', 'request_id'] as const;
export type AuditFilterState = Partial<Record<(typeof AUDIT_FILTER_KEYS)[number], string>>;
export function filterQuery(f: AuditFilterState): string {
  const p = new URLSearchParams();
  for (const k of AUDIT_FILTER_KEYS) {
    const v = f[k]?.trim();
    if (!v) continue;
    // período por fecha local: desde el inicio del día hasta su final
    if (k === 'from') p.set(k, new Date(`${v}T00:00:00`).toISOString());
    else if (k === 'to') p.set(k, new Date(`${v}T23:59:59.999`).toISOString());
    else p.set(k, v);
  }
  return p.toString();
}
