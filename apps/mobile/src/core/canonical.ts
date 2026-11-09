// Hash del contenido de una operación (P0-024). El servidor recalcula el mismo hash sobre el contenido VALIDADO
// (apps/api/src/sync/sync.ts, `operationHash`): claves ordenadas, depends_on ordenado, sin campos de transporte.
export const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
    : JSON.stringify(v ?? null);

export interface OperationContent {
  operation_type: string; entity_id: string; base_version: number | null; depends_on: string[]; captured_at: string; payload: Record<string, unknown>;
}

export function operationCanonical(o: OperationContent): string {
  return canonical({ operation_type: o.operation_type, entity_id: o.entity_id, base_version: o.base_version, depends_on: [...o.depends_on].sort(), captured_at: o.captured_at, payload: o.payload });
}
