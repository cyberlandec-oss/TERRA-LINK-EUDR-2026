import { randomUUID } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';

// P0-013 CTE — publicación de versiones del catálogo de hitos críticos de trazabilidad.
// Ámbito: SISTEMA (S1 §19 `cte_definitions` no tiene organización). No hay facultad de administración
// definida para usuarios (doc 07): el catálogo se publica con migraciones mediante esta función, que deja
// una versión de catálogo (release) inmutable como registro de auditoría del cambio.
// - Definición inmutable: (code, version). Cambiar su significado = nueva versión de la definición.
// - Retirar = fila en cte_definition_retirements; la definición y sus referencias siguen resolubles.
// - Vínculos con operaciones: INTEGRATED solo si la operación y su evento existen; si no, PENDING.

export interface CteDefinitionInput {
  code: string;
  name: string;
  description: string;
  stage: 'ORIGIN' | 'INTERNAL' | 'OUTBOUND';
  source: string;
  links: Array<{ operation: string; event_type: string; status: 'INTEGRATED' | 'PENDING'; story: string | null; note: string }>;
}

export interface CteReleaseInput {
  version: string;
  source: string;
  notes: string;
  publish: CteDefinitionInput[];
  retire?: Array<{ code: string; reason: string }>;
}

type Db = Kysely<unknown> | Transaction<unknown>;

/** Publica una versión del catálogo de forma atómica (usar dentro de una transacción o migración). */
export async function publishCteRelease(db: Db, r: CteReleaseInput) {
  await sql`INSERT INTO cte_catalog_releases (version, source, notes) VALUES (${r.version}, ${r.source}, ${r.notes})`.execute(db);
  for (const d of r.publish) {
    const prev = await sql<{ id: string; version: number }>`
      SELECT id, version FROM cte_definitions WHERE code = ${d.code} ORDER BY version DESC LIMIT 1`.execute(db);
    const previous = prev.rows[0];
    const id = randomUUID();
    await sql`
      INSERT INTO cte_definitions (id, code, version, name, description, stage, source, release_version, supersedes_id)
      VALUES (${id}, ${d.code}, ${previous ? previous.version + 1 : 1}, ${d.name}, ${d.description}, ${d.stage}, ${d.source}, ${r.version}, ${previous?.id ?? null})`.execute(db);
    if (previous) {
      await sql`INSERT INTO cte_definition_retirements (definition_id, release_version, reason) VALUES (${previous.id}, ${r.version}, ${'Sustituida por una nueva versión'})`.execute(db);
    }
    for (const l of d.links) {
      await sql`
        INSERT INTO cte_operation_links (definition_id, operation_code, event_type, integration_status, story, note)
        VALUES (${id}, ${l.operation}, ${l.event_type}, ${l.status}, ${l.story}, ${l.note})`.execute(db);
    }
  }
  for (const x of r.retire ?? []) {
    const cur = await sql<{ id: string }>`
      SELECT d.id FROM cte_definitions d
      WHERE d.code = ${x.code} AND NOT EXISTS (SELECT 1 FROM cte_definition_retirements t WHERE t.definition_id = d.id)
      ORDER BY d.version DESC LIMIT 1`.execute(db);
    if (!cur.rows[0]) throw new Error(`CTE ${x.code} no tiene una definición vigente que retirar`);
    await sql`INSERT INTO cte_definition_retirements (definition_id, release_version, reason) VALUES (${cur.rows[0].id}, ${r.version}, ${x.reason})`.execute(db);
  }
}
