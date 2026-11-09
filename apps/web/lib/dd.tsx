import type { Tone } from './ui';

// P0-022 expediente: etiquetas y tonos (UX_UI §18.3). La preparación la calcula la API; el cliente solo la muestra.
export const REQ_STATUS: Record<string, { label: string; tone: Tone }> = {
  MET: { label: 'Cumplido', tone: 'valid' },
  PENDING: { label: 'Pendiente', tone: 'process' },
  INVALID: { label: 'Inválido', tone: 'blocked' },
  NOT_EVALUABLE: { label: 'No evaluable', tone: 'review' },
};
export const READINESS_TONE: Record<string, Tone> = { BLOCKED: 'blocked', IN_PROGRESS: 'process', READY: 'valid', STALE: 'review' };
export const DD_PROCESS: Record<string, string> = { OPEN: 'Sin revisar', UNDER_REVIEW: 'En revisión', RETURNED: 'Devuelta con motivo', APPROVED: 'Aprobada (interna)' };
