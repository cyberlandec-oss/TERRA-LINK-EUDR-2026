import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { ObjectStore } from './object-store';

// Barrido del almacenamiento privado (P0-009, programado en el worker desde P0-010).
// Alcance limitado: solo claves `organizations/<org>/geometry-imports/<id>.geojson` que sean
//   - ORPHAN: sin fila en geometry_imports y con antigüedad mayor que la gracia (un análisis en curso
//     sube el objeto segundos antes de insertar su fila; la gracia evita borrarlo), o
//   - DISCARDED: de una importación descartada.
// Nunca originales de importaciones ANALYZED/CONFIRMED (retención: D-29). Sin caducidad.
// Carrera con la confirmación: antes de borrar se bloquea la fila de la importación (FOR UPDATE), la
// misma que bloquea la confirmación; si la importación no está DISCARDED → SKIPPED_REFERENCED.
// Una importación DISCARDED no puede confirmarse (estado comprobado bajo el mismo bloqueo).
// Varios workers: reclamo con FOR UPDATE SKIP LOCKED + lease. Fallos: FAILED, código controlado,
// reintento con espera exponencial.

export const IMPORT_KEY = /^organizations\/[0-9a-f-]{36}\/geometry-imports\/[0-9a-f-]{36}\.geojson$/;
/** P0-018: originales de documentos. Una versión registrada nunca se borra (retención según política). */
export const DOCUMENT_KEY = /^organizations\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}\.bin$/;
const MANAGED = (k: string) => IMPORT_KEY.test(k) || DOCUMENT_KEY.test(k);

export interface SweeperOptions {
  orphanGraceSeconds: number;
  leaseSeconds: number;
  batchSize: number;
}

export const DEFAULT_SWEEPER: SweeperOptions = { orphanGraceSeconds: 3600, leaseSeconds: 120, batchSize: 50 };

export interface SweepResult { discovered: number; deleted: number; skipped: number; failed: number }

export class StorageSweeper {
  readonly workerId = `sweeper-${randomUUID()}`;

  constructor(private readonly db: Kysely<Database>, private readonly store: ObjectStore, private readonly opts: SweeperOptions = DEFAULT_SWEEPER) {}

  /** Registra una tarea (idempotente). */
  async enqueue(key: string, reason: 'DISCARDED' | 'ORPHAN', db: Kysely<Database> = this.db) {
    if (!MANAGED(key)) return;
    await db.insertInto('object_deletions').values({ object_key: key, reason, status: 'PENDING' }).onConflict((c) => c.column('object_key').doNothing()).execute();
  }

  /** Descubre huérfanos antiguos y descartados sin tarea. Solo lista el prefijo de importaciones. */
  async discover(now = new Date()): Promise<number> {
    const objects = (await this.store.list('organizations/')).filter((o) => MANAGED(o.key));
    const old = objects.filter((o) => o.lastModified && now.getTime() - o.lastModified.getTime() > this.opts.orphanGraceSeconds * 1000);
    if (old.length === 0) return 0;
    const keys = old.map((o) => o.key);
    const rows = await this.db.selectFrom('geometry_imports').select(['object_key', 'status']).where('object_key', 'in', keys).execute();
    const byKey = new Map<string, string>(rows.map((r) => [r.object_key, r.status]));
    const docs = await this.db.selectFrom('document_versions').select('object_key').where('object_key', 'in', keys).execute();
    for (const d of docs) byKey.set(d.object_key, 'CONFIRMED');
    let n = 0;
    for (const key of keys) {
      const status = byKey.get(key);
      if (status === 'ANALYZED' || status === 'CONFIRMED') continue;
      const r = await this.db.insertInto('object_deletions').values({ object_key: key, reason: status === 'DISCARDED' ? 'DISCARDED' : 'ORPHAN', status: 'PENDING' })
        .onConflict((c) => c.column('object_key').doNothing()).executeTakeFirst();
      n += Number(r.numInsertedOrUpdatedRows ?? 0);
    }
    return n;
  }

  /** Procesa tareas vencidas (o solo las claves indicadas). */
  async process(onlyKeys?: string[]): Promise<Omit<SweepResult, 'discovered'>> {
    const claimed = await sql<{ object_key: string; attempts: number }>`
      UPDATE object_deletions SET leased_by = ${this.workerId}, lease_until = now() + make_interval(secs => ${this.opts.leaseSeconds})
      WHERE object_key IN (
        SELECT object_key FROM object_deletions
        WHERE status IN ('PENDING','FAILED') AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until < now())
          ${onlyKeys ? sql`AND object_key = ANY(${onlyKeys})` : sql``}
        ORDER BY next_attempt_at LIMIT ${this.opts.batchSize}
        FOR UPDATE SKIP LOCKED)
      RETURNING object_key, attempts`.execute(this.db);
    const out = { deleted: 0, skipped: 0, failed: 0 };
    for (const task of claimed.rows) {
      try {
        const outcome = await this.db.transaction().execute(async (trx) => {
          const ref = await sql<{ status: string }>`SELECT status FROM geometry_imports WHERE object_key = ${task.object_key} FOR UPDATE`.execute(trx);
          const docRef = await sql<{ id: string }>`SELECT id FROM document_versions WHERE object_key = ${task.object_key}`.execute(trx);
          const status = docRef.rows[0] ? 'CONFIRMED' : ref.rows[0]?.status;
          if (status === 'ANALYZED' || status === 'CONFIRMED') {
            await trx.updateTable('object_deletions').set({ status: 'SKIPPED_REFERENCED', completed_at: new Date(), leased_by: null, lease_until: null })
              .where('object_key', '=', task.object_key).where('leased_by', '=', this.workerId).execute();
            return 'skipped' as const;
          }
          await this.store.delete(task.object_key); // con la fila bloqueada: la confirmación no puede intercalarse
          await trx.updateTable('object_deletions').set({ status: 'DONE', completed_at: new Date(), attempts: task.attempts + 1, last_error_code: null, leased_by: null, lease_until: null })
            .where('object_key', '=', task.object_key).where('leased_by', '=', this.workerId).execute();
          return 'deleted' as const;
        });
        out[outcome]++;
      } catch {
        out.failed++;
        const wait = Math.min(3600, 30 * 2 ** task.attempts);
        await this.db.updateTable('object_deletions')
          .set({ status: 'FAILED', attempts: task.attempts + 1, last_error_code: 'STORAGE_DELETE_FAILED', next_attempt_at: sql`now() + make_interval(secs => ${wait})`, leased_by: null, lease_until: null })
          .where('object_key', '=', task.object_key).where('leased_by', '=', this.workerId).execute()
          .catch(() => undefined); // el lease vence y otra pasada lo retoma
      }
    }
    return out;
  }

  async runOnce(): Promise<SweepResult> {
    const discovered = await this.discover();
    return { discovered, ...(await this.process()) };
  }
}
