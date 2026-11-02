// P0-020: tipos y etiquetas de evaluaciones técnicas de riesgo. Sin puntuaciones; las etiquetas no cambian el dato.

export interface RiskFactor { code: string; category: string; result: 'HIT' | 'NOT_HIT' | 'NOT_EVALUABLE'; effect: string; explanation: string; limit: string; source: string; depends_on: string | null; reason: string; references: string[] }
export interface RiskEvaluation {
  id: string; subject: { type: string; id: string; code: string }; evaluation_number: number; is_latest: boolean;
  freshness: { status: 'CURRENT' | 'STALE'; reason: string | null };
  rules: { version: string; approval_status: string; note: string };
  snapshot: { hash: string };
  technical_findings: RiskFactor[]; data_quality: RiskFactor[]; factors: RiskFactor[];
  categories: Array<{ category: string; rules: number; status: string; note: string | null }>;
  technical_result: { status: string; label: string };
  risk_result: {
    severity: string; severity_label?: string; severity_scope?: string; conclusion: string; note: string;
    /** La severidad NUNCA se muestra sin esto: sola se leería como si la evaluación hubiera sido completa. */
    severity_coverage?: {
      rules_total: number; evaluated: number; not_evaluable: number; not_evaluable_codes: string[];
      hits: number; hits_without_declared_severity: string[]; categories_without_rules: string[];
      complete: boolean; reason?: string; note?: string;
    } | null;
  };
  provenance: { mode: string; trigger_kind: string | null; triggered_by: string; executed_by: string; reviewed_by: string | null; review_status: string };
  review: { process_status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED'; history: Array<{ action: string; reason: string; at: string; reviewer: string }>; note: string };
  evaluated_at: string; evaluated_by: string;
  actions: { reevaluate: boolean; review: boolean };
}
export const RESULT_TONE: Record<string, 'neutral' | 'valid' | 'review' | 'blocked' | 'process'> = { BLOCKED: 'blocked', REVIEW_REQUIRED: 'review', INCOMPLETE: 'review', NO_FINDINGS_IN_EVALUATED_RULES: 'neutral' };
export const CATEGORY: Record<string, string> = {
  DEFORESTATION: 'Deforestación', LEGALITY: 'Legalidad', MIXING: 'Mezcla', SUPPLY_CHAIN: 'Cadena de suministro', DOCUMENT_CREDIBILITY: 'Credibilidad documental', TRACEABILITY: 'Trazabilidad',
  EVASION: 'Evasión', HUMAN_RIGHTS: 'Derechos humanos', INDIGENOUS_RIGHTS: 'Derechos indígenas', DATA_QUALITY: 'Calidad de datos',
};
export const FACTOR_RESULT: Record<string, string> = { HIT: 'Hallazgo', NOT_HIT: 'Sin hallazgo', NOT_EVALUABLE: 'No evaluable' };
export const EFFECT: Record<string, string> = { BLOCKING: 'bloqueante', REVIEW_REQUIRED: 'requiere revisión', NOT_ASSESSED: 'no evaluado' };
export const CATEGORY_STATUS: Record<string, string> = { NO_RULES: 'sin reglas en las fuentes', FINDINGS: 'con hallazgos', NOT_ASSESSED: 'no evaluada', NO_FINDINGS: 'sin hallazgos en lo evaluado' };
export const PROCESS: Record<string, string> = { OPEN: 'Abierta', UNDER_REVIEW: 'En revisión', RESOLVED: 'Resuelta (revisión humana)' };
export const MIT_TONE: Record<string, 'neutral' | 'valid' | 'review' | 'blocked' | 'process'> = { OPEN: 'neutral', SUBMITTED: 'process', VERIFIED: 'valid', REJECTED: 'review', REOPENED: 'review' };
export const OUTCOME_TONE: Record<string, 'neutral' | 'valid' | 'review' | 'blocked' | 'process'> = { NOT_REVIEWED: 'neutral', ACCEPTED: 'valid', NOT_ACCEPTED: 'blocked', PENDING: 'process', CRITERION_MET: 'valid', CRITERION_NOT_MET: 'blocked', NOT_RECORDED: 'review', PERSISTS: 'blocked', NOT_DETECTED: 'valid', UNKNOWN: 'review' };
