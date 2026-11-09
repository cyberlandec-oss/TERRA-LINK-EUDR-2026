import { randomUUID } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { schemaProblems, type Condition, type Requirement, type Validation, type ValueType } from './kde-schema';

// P0-014 KDE — publicación por versiones de catálogo (mismo patrón que CTE, sin administración por pantalla).
// Cada definición referencia la versión EXACTA de un hito (cte_definitions.id). Publicar una nueva versión
// de un KDE retira la anterior sin modificarla. Todo ocurre en la transacción del llamador.

export interface KdeDefinitionInput {
  code: string;
  cte: string;                 // código del hito; se liga a su versión vigente al publicar
  name: string;
  entity: string;              // entidad del contrato (docs/06) o «—» si no existe
  field: string;               // campo del contrato
  value_type: ValueType;
  requirement: Requirement;
  condition: Condition | null;
  validation: Validation;
  responsible_roles: string[];
  responsible_note: string;
  source: string;
  difference: string | null;   // diferencia entre fuentes o con el modelo real
}

export interface KdeReleaseInput {
  version: string;
  source: string;
  notes: string;
  publish: KdeDefinitionInput[];
  retire?: Array<{ code: string; reason: string }>;
}

type Db = Kysely<unknown> | Transaction<unknown>;

export async function publishKdeRelease(db: Db, r: KdeReleaseInput) {
  const problems = r.publish.flatMap((d) => schemaProblems(d));
  if (problems.length) throw new Error(`KDE fuera del esquema: ${problems.join('; ')}`);
  await sql`INSERT INTO kde_catalog_releases (version, source, notes) VALUES (${r.version}, ${r.source}, ${r.notes})`.execute(db);
  const codes = new Set(r.publish.map((d) => d.code));
  for (const d of r.publish) {
    const cte = await sql<{ id: string }>`
      SELECT d.id FROM cte_definitions d
      WHERE d.code = ${d.cte} AND NOT EXISTS (SELECT 1 FROM cte_definition_retirements t WHERE t.definition_id = d.id)
      ORDER BY d.version DESC LIMIT 1`.execute(db);
    if (!cte.rows[0]) throw new Error(`KDE ${d.code}: el hito ${d.cte} no tiene versión vigente`);
    const deps = !d.condition ? [] : d.condition.kind === 'quantities_differ' ? [d.condition.a, d.condition.b] : d.condition.kind === 'undefined_in_contract' ? [] : [d.condition.kde];
    for (const dep of deps) {
      if (codes.has(dep)) continue;
      const exists = await sql<{ n: number }>`SELECT count(*)::int AS n FROM kde_definitions WHERE code = ${dep}`.execute(db);
      if (!exists.rows[0].n) throw new Error(`KDE ${d.code}: la condición usa ${dep}, que no existe`);
    }
    const prev = await sql<{ id: string; version: number }>`SELECT id, version FROM kde_definitions WHERE code = ${d.code} ORDER BY version DESC LIMIT 1`.execute(db);
    const previous = prev.rows[0];
    await sql`
      INSERT INTO kde_definitions (id, code, version, cte_definition_id, name, entity, field, value_type, requirement, condition, validation,
        responsible_roles, responsible_note, source, difference, release_version, supersedes_id)
      VALUES (${randomUUID()}, ${d.code}, ${previous ? previous.version + 1 : 1}, ${cte.rows[0].id}, ${d.name}, ${d.entity}, ${d.field}, ${d.value_type},
        ${d.requirement}, ${d.condition ? JSON.stringify(d.condition) : null}::jsonb, ${JSON.stringify(d.validation)}::jsonb, ${d.responsible_roles}::text[],
        ${d.responsible_note}, ${d.source}, ${d.difference}, ${r.version}, ${previous?.id ?? null})`.execute(db);
    if (previous) {
      await sql`INSERT INTO kde_definition_retirements (definition_id, release_version, reason) VALUES (${previous.id}, ${r.version}, ${'Sustituida por una nueva versión'})
        ON CONFLICT (definition_id) DO NOTHING`.execute(db);
    }
  }
  for (const x of r.retire ?? []) {
    const cur = await sql<{ id: string }>`
      SELECT d.id FROM kde_definitions d
      WHERE d.code = ${x.code} AND NOT EXISTS (SELECT 1 FROM kde_definition_retirements t WHERE t.definition_id = d.id)
      ORDER BY d.version DESC LIMIT 1`.execute(db);
    if (!cur.rows[0]) throw new Error(`KDE ${x.code} no tiene una definición vigente que retirar`);
    await sql`INSERT INTO kde_definition_retirements (definition_id, release_version, reason) VALUES (${cur.rows[0].id}, ${r.version}, ${x.reason})`.execute(db);
  }
}

export interface KdeGateInput { transition: string; kde: string | null; mode: 'BLOCKING' | 'PENDING_ALLOWED' | 'NOT_EVALUATED' | 'BLOCKED_PENDING_DECISION'; note: string }

/**
 * P0-012 — compuertas por transición: qué comprueba cada operación sobre los KDE vigentes.
 * BLOCKING: debe estar presente y válido. PENDING_ALLOWED: si falta o es desconocido queda como pendiente
 * visible (nunca como válido). NOT_EVALUATED: la regla no está definida; se informa, no se decide.
 */
export async function publishKdeGates(db: Db, version: string, gates: KdeGateInput[]) {
  for (const g of gates) {
    if (g.kde) {
      const exists = await sql<{ n: number }>`SELECT count(*)::int AS n FROM kde_definitions WHERE code = ${g.kde}`.execute(db);
      if (!exists.rows[0].n) throw new Error(`Compuerta ${g.transition}: el KDE ${g.kde} no existe`);
    }
    await sql`INSERT INTO kde_transition_gates (release_version, transition, kde_code, mode, note) VALUES (${version}, ${g.transition}, ${g.kde}, ${g.mode}, ${g.note})`.execute(db);
  }
}
