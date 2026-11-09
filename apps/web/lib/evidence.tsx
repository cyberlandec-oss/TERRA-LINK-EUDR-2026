'use client';

// P0-019 (UX_UI §17): presentación de afirmaciones y soportes. Estados distintos e identificados:
// archivo disponible (análisis limpio) ≠ documento revisado ≠ afirmación verificada. Nada de esto es
// conformidad EUDR ni riesgo nulo.

export interface EvidenceSource {
  id: string; relationship: 'SUPPORTS' | 'CONTRADICTS' | 'BASED_ON'; note: string | null; added_at: string; active: boolean;
  withdrawn: { reason: string; at: string } | null;
  document: { id: string; title: string; type_label: string; classification: string; content_access: 'ALLOWED' | 'RESTRICTED' };
  version: { id: string; version_number: number; newer_version_exists: boolean; availability: string; validity: string; review: string | null };
}
export interface Evidence {
  id: string; claim: { code: string; label: string; limitation: string; source: string }; entity: { type: string; id: string };
  status: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'REVOKED'; validity: { from: string | null; to: string | null; expired: boolean };
  row_version: number; created_at: string; requires_review: boolean; review_reasons: string[]; sources: EvidenceSource[];
  decisions: Array<{ action: string; from_status: string; to_status: string; reason: string; decided_at: string; contradictions_acknowledged: boolean; actor: string }>;
  next_step: string; actions: Record<'add_source' | 'submit' | 'verify' | 'reject' | 'revoke' | 'reopen', boolean>; note: string;
}

export const STATUS: Record<Evidence['status'], { label: string; tone: 'neutral' | 'review' | 'valid' | 'blocked' | 'process' }> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  SUBMITTED: { label: 'En revisión', tone: 'process' },
  VERIFIED: { label: 'Afirmación verificada', tone: 'valid' },
  REJECTED: { label: 'Rechazada', tone: 'blocked' },
  REVOKED: { label: 'Revocada', tone: 'review' },
};
export const RELATION: Record<EvidenceSource['relationship'], string> = { SUPPORTS: 'Respalda', CONTRADICTS: 'Contradice', BASED_ON: 'Contexto (se basa en)' };
export const REVIEW_REASON: Record<string, string> = {
  NEWER_DOCUMENT_VERSION: 'el documento tiene una versión más reciente que la vinculada',
  SOURCE_EXPIRED: 'un soporte está vencido',
  SOURCE_REJECTED: 'un soporte fue rechazado en revisión documental',
  SOURCE_UNAVAILABLE: 'un soporte no está disponible (análisis pendiente, fallido o rechazado)',
  ACTIVE_CONTRADICTION: 'hay un soporte que contradice la afirmación',
};
export const FILE_STATE: Record<string, string> = { AVAILABLE: 'Archivo disponible (análisis limpio)', PENDING: 'Archivo pendiente de análisis', SCAN_FAILED: 'Archivo no disponible (análisis fallido)', REJECTED: 'Archivo rechazado por el análisis' };
export const ACTION_LABEL: Record<string, string> = { SUBMIT: 'Envío a revisión', VERIFY: 'Verificación', REJECT: 'Rechazo', REVOKE: 'Revocación', REOPEN: 'Reapertura' };
