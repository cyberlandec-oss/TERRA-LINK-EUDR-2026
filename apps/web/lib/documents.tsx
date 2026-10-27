'use client';

// Tipos y presentación de documentos (UX_UI §17). Estados distintos: recibido, disponible tras el análisis,
// revisado por una persona. Un documento no es evidencia aprobada (P0-019).

export interface DocType { code: string; label: string; allowed_owner_types: string[]; classification: 'OPERATIONAL' | 'PERSONAL_DATA'; source: string }
export interface DocVersion {
  id: string; version_number: number; is_current: boolean; file_name: string | null; mime_type: string; size_bytes: number; sha256: string;
  issuer: string | null; issued_at: string | null; expires_at: string | null; uploaded_at: string; upload: string;
  scan: { status: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED'; signature: string | null; error_code: string | null; scanned_at: string | null };
  availability: 'AVAILABLE' | 'PENDING' | 'SCAN_FAILED' | 'REJECTED'; validity: 'VALID' | 'EXPIRED' | 'NO_EXPIRY';
  review: { decision: 'ACCEPTED' | 'REJECTED'; reason: string; reviewed_at: string; reviewer_is_uploader: boolean } | null; downloadable: boolean;
}
export interface Doc {
  id: string; document_type: string; type_label: string; classification: string; owner_type: string; owner_id: string; title: string;
  row_version: number; created_at: string; content_access: 'ALLOWED' | 'RESTRICTED'; versions: DocVersion[];
  links: Array<{ entity_type: string; entity_id: string; created_at: string }>; note: string;
}

export const AVAILABILITY: Record<DocVersion['availability'], { label: string; tone: 'valid' | 'review' | 'blocked' | 'neutral' }> = {
  AVAILABLE: { label: 'Disponible (análisis limpio)', tone: 'valid' },
  PENDING: { label: 'Pendiente de análisis', tone: 'review' },
  SCAN_FAILED: { label: 'Análisis fallido: no disponible', tone: 'review' },
  REJECTED: { label: 'Rechazado por el análisis', tone: 'blocked' },
};
export const VALIDITY: Record<DocVersion['validity'], string> = { VALID: 'Vigente', EXPIRED: 'Vencido', NO_EXPIRY: 'Sin vencimiento' };
export const OWNER_LABEL: Record<string, string> = { producer: 'Productor', plot: 'Parcela', delivery: 'Entrega' };
export const kb = (n: number) => `${(n / 1024).toLocaleString('es-EC', { maximumFractionDigits: 1 })} KB`;
