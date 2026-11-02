import { randomUUID } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';

// P0-017 — ledger de inventario: ÚNICA fuente de existencia física, reserva y disponible (docs/decisiones/
// P0-017-EFECTOS-LEDGER.md). Append-only. Un movimiento (cabecera) agrupa líneas firmadas por tenedor (recepción o
// lote), ubicación (o pendiente = NULL) y cubeta (PHYSICAL | RESERVED). Invariantes por tenedor/ubicación verificados por
// trigger diferido; los casos de uso bloquean además las filas del tenedor para serializar la concurrencia.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any> | Transaction<any>;

export type MovementType = 'RECEPTION_IN' | 'RECEPTION_CORRECTION' | 'LOT_ASSIGN' | 'LOT_RELEASE' | 'PROCESS_RESERVE' | 'PROCESS_RESERVE_RELEASE'
  | 'PROCESS_CLOSE' | 'STOCK_LOSS' | 'TRANSFER' | 'LOCATION_ASSIGN' | 'ADJUSTMENT' | 'SHIPMENT_RESERVE' | 'SHIPMENT_RESERVE_RELEASE' | 'SHIPMENT_DISPATCH'
  | 'CUSTODY_RESERVE' | 'CUSTODY_RESERVE_RELEASE' | 'CUSTODY_OUT' | 'CUSTODY_IN' | 'CUSTODY_RETURN';
export interface Line { reception_id?: string | null; lot_id?: string | null; location_id: string | null; bucket: 'PHYSICAL' | 'RESERVED'; quantity: string }
export interface Movement {
  organizationId: string; type: MovementType; sourceType: string | null; sourceId: string | null; operationId: string | null; actorId: string | null;
  reason?: string | null; processLoss?: string | null; reference?: Record<string, unknown>; lines: Line[];
}

export async function postMovement(db: AnyDb, m: Movement): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO stock_movements (id, organization_id, movement_type, source_type, source_id, operation_id, actor_id, reason, process_loss, reference)
    VALUES (${id}, ${m.organizationId}, ${m.type}, ${m.sourceType}, ${m.sourceId}, ${m.operationId}, ${m.actorId}, ${m.reason ?? null}, ${m.processLoss ?? null}, ${JSON.stringify(m.reference ?? {})}::jsonb)`.execute(db);
  for (const l of m.lines) {
    if (/^-?0+(\.0+)?$/.test(l.quantity)) continue;
    await sql`INSERT INTO stock_entries (id, organization_id, movement_id, reception_id, lot_id, location_id, bucket, signed_quantity, unit)
      VALUES (${randomUUID()}, ${m.organizationId}, ${id}, ${l.reception_id ?? null}, ${l.lot_id ?? null}, ${l.location_id}, ${l.bucket}, ${l.quantity}, 'KG')`.execute(db);
  }
  return id;
}

export interface BalanceRow { location_id: string | null; location_code: string | null; location_name: string | null; physical: string; reserved: string; available: string }

/** Saldos por ubicación de un tenedor (recepción o lote). */
export async function holderBalances(db: AnyDb, organizationId: string, holder: { reception_id?: string; lot_id?: string }): Promise<BalanceRow[]> {
  const col = holder.lot_id ? sql`e.lot_id` : sql`e.reception_id`;
  const id = holder.lot_id ?? holder.reception_id!;
  return (await sql<BalanceRow>`
    SELECT e.location_id, l.code AS location_code, l.name AS location_name,
           coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'PHYSICAL'), 0)::text AS physical,
           coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'RESERVED'), 0)::text AS reserved,
           (coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'PHYSICAL'), 0) - coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'RESERVED'), 0))::text AS available
    FROM stock_entries e LEFT JOIN locations l ON l.id = e.location_id
    WHERE e.organization_id = ${organizationId} AND ${col} = ${id}
    GROUP BY e.location_id, l.code, l.name ORDER BY l.code NULLS LAST`.execute(db)).rows;
}

const exists = (type: MovementType, src: ReturnType<typeof sql>) => sql`EXISTS (SELECT 1 FROM stock_movements m WHERE m.movement_type = ${type} AND m.source_id = ${src})`;

/**
 * Incorporación idempotente de datos existentes (P0-012/P0-016) al ledger: un movimiento por registro de dominio, con su
 * referencia original; repetirla no duplica nada. No crea ajustes para cuadrar totales: lo que no pueda ubicarse sin
 * inventar se informa en `unresolved`.
 */
export async function incorporateOrganization(db: AnyDb, organizationId: string, actorId: string | null) {
  const created: Record<string, number> = {};
  const unresolved: Array<{ kind: string; id: string; reason: string }> = [];
  const bump = (k: string) => { created[k] = (created[k] ?? 0) + 1; };
  // Recepciones: entrada por el peso ORIGINAL; cada corrección, su delta (historia conservada).
  const recs = (await sql<{ id: string; location_id: string; quantity: string }>`
    SELECT r.id, r.location_id, r.quantity_received::text AS quantity FROM receptions r WHERE r.organization_id = ${organizationId} AND NOT ${exists('RECEPTION_IN', sql`r.id`)} ORDER BY r.created_at`.execute(db)).rows;
  for (const r of recs) {
    await postMovement(db, { organizationId, type: 'RECEPTION_IN', sourceType: 'reception', sourceId: r.id, operationId: null, actorId, reference: { incorporated: true }, lines: [{ reception_id: r.id, location_id: r.location_id, bucket: 'PHYSICAL', quantity: r.quantity }] });
    bump('RECEPTION_IN');
  }
  const adjs = (await sql<{ id: string; reception_id: string; location_id: string; delta: string }>`
    SELECT a.id, a.reception_id, r.location_id, (a.new_quantity - a.previous_quantity)::text AS delta FROM reception_adjustments a JOIN receptions r ON r.id = a.reception_id
    WHERE a.organization_id = ${organizationId} AND NOT ${exists('RECEPTION_CORRECTION', sql`a.id`)} ORDER BY a.reception_id, a.adjustment_number`.execute(db)).rows;
  for (const a of adjs) {
    await postMovement(db, { organizationId, type: 'RECEPTION_CORRECTION', sourceType: 'reception_adjustment', sourceId: a.id, operationId: null, actorId, reference: { incorporated: true }, lines: [{ reception_id: a.reception_id, location_id: a.location_id, bucket: 'PHYSICAL', quantity: a.delta }] });
    bump('RECEPTION_CORRECTION');
  }
  // Asignaciones y liberaciones (en orden de tiempo): mueven cantidad, no crean entrada física.
  const events = (await sql<{ kind: 'ASSIGN' | 'RELEASE'; id: string; lot_id: string; reception_id: string; location_id: string; quantity: string; at: string }>`
    SELECT 'ASSIGN' AS kind, i.id, i.lot_id, i.reception_id, r.location_id, i.quantity::text AS quantity, i.assigned_at AS at FROM lot_inputs i JOIN receptions r ON r.id = i.reception_id
    WHERE i.organization_id = ${organizationId} AND NOT ${exists('LOT_ASSIGN', sql`i.id`)}
    UNION ALL
    SELECT 'RELEASE', x.input_id, i.lot_id, i.reception_id, r.location_id, i.quantity::text, x.released_at FROM lot_input_releases x JOIN lot_inputs i ON i.id = x.input_id JOIN receptions r ON r.id = i.reception_id
    WHERE x.organization_id = ${organizationId} AND NOT ${exists('LOT_RELEASE', sql`x.input_id`)}
    ORDER BY at`.execute(db)).rows;
  for (const e of events) {
    const sign = e.kind === 'ASSIGN' ? '' : '-';
    const inv = e.kind === 'ASSIGN' ? '-' : '';
    await postMovement(db, { organizationId, type: e.kind === 'ASSIGN' ? 'LOT_ASSIGN' : 'LOT_RELEASE', sourceType: e.kind === 'ASSIGN' ? 'lot_input' : 'lot_input_release', sourceId: e.id, operationId: null, actorId, reference: { incorporated: true },
      lines: [{ reception_id: e.reception_id, location_id: e.location_id, bucket: 'PHYSICAL', quantity: `${inv}${e.quantity}` }, { lot_id: e.lot_id, location_id: e.location_id, bucket: 'PHYSICAL', quantity: `${sign}${e.quantity}` }] });
    bump(e.kind === 'ASSIGN' ? 'LOT_ASSIGN' : 'LOT_RELEASE');
  }
  // Procesos: reserva para los iniciados (en curso o cerrados) y cierre para los cerrados, en orden de creación.
  const runs = (await sql<{ id: string; status: string }>`SELECT id, status FROM process_runs WHERE organization_id = ${organizationId} AND status IN ('RUNNING','CLOSED') ORDER BY started_at, created_at`.execute(db)).rows;
  for (const run of runs) {
    const inputs = (await sql<{ id: string; lot_id: string; quantity: string; location_id: string | null }>`SELECT id, lot_id, quantity::text AS quantity, location_id FROM process_inputs WHERE run_id = ${run.id} ORDER BY lot_id`.execute(db)).rows;
    for (const i of inputs) {
      if (await movementExists(db, 'PROCESS_RESERVE', i.id)) continue;
      const loc = i.location_id ?? (await singleLocationWith(db, organizationId, i.lot_id, i.quantity));
      if (loc === undefined) { unresolved.push({ kind: 'process_input', id: i.id, reason: 'El lote no tiene la cantidad en un único centro: no se reparte sin decisión.' }); continue; }
      await postMovement(db, { organizationId, type: 'PROCESS_RESERVE', sourceType: 'process_input', sourceId: i.id, operationId: null, actorId, reference: { incorporated: true, run_id: run.id, location_id: loc },
        lines: [{ lot_id: i.lot_id, location_id: loc, bucket: 'RESERVED', quantity: i.quantity }] });
      bump('PROCESS_RESERVE');
    }
    if (run.status === 'CLOSED' && !(await movementExists(db, 'PROCESS_CLOSE', run.id))) {
      const reserves = (await sql<{ lot_id: string; location_id: string | null; quantity: string }>`
        SELECT e.lot_id, e.location_id, e.signed_quantity::text AS quantity FROM stock_movements m JOIN stock_entries e ON e.movement_id = m.id
        WHERE m.movement_type = 'PROCESS_RESERVE' AND m.reference->>'run_id' = ${run.id}`.execute(db)).rows;
      if (reserves.length !== inputs.length) { unresolved.push({ kind: 'process_run', id: run.id, reason: 'Reservas incompletas: el cierre no se incorpora.' }); continue; }
      const outs = (await sql<{ lot_id: string; quantity: string }>`SELECT lot_id, quantity::text AS quantity FROM process_outputs WHERE run_id = ${run.id}`.execute(db)).rows;
      const loss = (await sql<{ loss: string }>`SELECT loss_quantity::text AS loss FROM process_runs WHERE id = ${run.id}`.execute(db)).rows[0].loss;
      await postMovement(db, { organizationId, type: 'PROCESS_CLOSE', sourceType: 'process_run', sourceId: run.id, operationId: null, actorId, processLoss: loss, reference: { incorporated: true },
        lines: closeLines(reserves, outs) });
      bump('PROCESS_CLOSE');
    }
  }
  return { created, unresolved };
}

async function movementExists(db: AnyDb, type: MovementType, sourceId: string) {
  return (await sql<{ n: number }>`SELECT count(*)::int AS n FROM stock_movements WHERE movement_type = ${type} AND source_id = ${sourceId}`.execute(db)).rows[0].n > 0;
}
/** Centro único donde el lote tiene disponible suficiente; `undefined` si no hay uno solo (no se reparte). */
export async function singleLocationWith(db: AnyDb, organizationId: string, lotId: string, quantity: string): Promise<string | null | undefined> {
  const rows = (await holderBalances(db, organizationId, { lot_id: lotId })).filter((b) => Number(b.available) > 0);
  const fit = rows.filter((b) => compare(b.available, quantity) >= 0);
  return rows.length === 1 && fit.length === 1 ? fit[0].location_id : undefined;
}
/** Líneas del cierre: liberar la reserva y consumir cada entrada; acreditar cada salida en el centro común o pendiente. */
export function closeLines(reserves: Array<{ lot_id: string; location_id: string | null; quantity: string }>, outs: Array<{ lot_id: string; quantity: string }>): Line[] {
  const locs = [...new Set(reserves.map((r) => r.location_id ?? 'NULL'))];
  const outLoc = locs.length === 1 && locs[0] !== 'NULL' ? locs[0] : null; // PROPUESTA 1: centro común o pendiente
  return [
    ...reserves.flatMap((r) => [
      { lot_id: r.lot_id, location_id: r.location_id, bucket: 'RESERVED' as const, quantity: `-${r.quantity}` },
      { lot_id: r.lot_id, location_id: r.location_id, bucket: 'PHYSICAL' as const, quantity: `-${r.quantity}` },
    ]),
    ...outs.map((o) => ({ lot_id: o.lot_id, location_id: outLoc, bucket: 'PHYSICAL' as const, quantity: o.quantity })),
  ];
}
function compare(a: string, b: string) {
  const s = (x: string) => { const [i, f = ''] = x.replace('-', '').split('.'); const v = BigInt(i) * 1_000_000n + BigInt((f + '000000').slice(0, 6)); return x.startsWith('-') ? -v : v; };
  const d = s(a) - s(b);
  return d > 0n ? 1 : d < 0n ? -1 : 0;
}

/** Conciliación ledger ↔ dominio: informa diferencias; nunca corrige con ajustes. */
export async function reconcile(db: AnyDb, organizationId: string) {
  const receptions = (await sql<{ id: string; expected: string; ledger: string }>`
    SELECT r.id, (reception_current_quantity(r.id) - coalesce((SELECT sum(i.quantity) FROM lot_inputs i WHERE i.reception_id = r.id AND NOT EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id)), 0))::text AS expected,
           coalesce((SELECT sum(e.signed_quantity) FROM stock_entries e WHERE e.reception_id = r.id AND e.bucket = 'PHYSICAL'), 0)::text AS ledger
    FROM receptions r WHERE r.organization_id = ${organizationId}`.execute(db)).rows;
  const lots = (await sql<{ id: string; lot_code: string; expected_physical: string; ledger_physical: string; expected_reserved: string; ledger_reserved: string }>`
    SELECT l.id, l.lot_code,
           (lot_base_quantity(l.id) - coalesce((SELECT sum(p.quantity) FROM process_inputs p JOIN process_runs r ON r.id = p.run_id WHERE p.lot_id = l.id AND r.status = 'CLOSED'), 0)
             + coalesce((SELECT sum(e.signed_quantity) FROM stock_entries e JOIN stock_movements m ON m.id = e.movement_id WHERE e.lot_id = l.id AND e.bucket = 'PHYSICAL' AND m.movement_type IN ('STOCK_LOSS','ADJUSTMENT')), 0)
             - coalesce((SELECT sum(s.quantity) FROM shipment_reservations s WHERE s.lot_id = l.id AND s.status = 'CONSUMED'), 0)
             + coalesce((SELECT sum(e.signed_quantity) FROM stock_entries e JOIN stock_movements m ON m.id = e.movement_id WHERE e.lot_id = l.id AND e.bucket = 'PHYSICAL' AND m.movement_type IN ('CUSTODY_OUT','CUSTODY_IN','CUSTODY_RETURN')), 0))::text AS expected_physical,
           coalesce((SELECT sum(e.signed_quantity) FROM stock_entries e WHERE e.lot_id = l.id AND e.bucket = 'PHYSICAL'), 0)::text AS ledger_physical,
           (coalesce((SELECT sum(p.quantity) FROM process_inputs p JOIN process_runs r ON r.id = p.run_id WHERE p.lot_id = l.id AND r.status = 'RUNNING'), 0)
             + coalesce((SELECT sum(s.quantity) FROM shipment_reservations s WHERE s.lot_id = l.id AND s.status = 'ACTIVE'), 0)
             + coalesce((SELECT sum(e.signed_quantity) FROM stock_entries e JOIN stock_movements m ON m.id = e.movement_id WHERE e.lot_id = l.id AND e.bucket = 'RESERVED' AND m.movement_type IN ('CUSTODY_RESERVE','CUSTODY_RESERVE_RELEASE','CUSTODY_OUT')), 0))::text AS expected_reserved,
           coalesce((SELECT sum(e.signed_quantity) FROM stock_entries e WHERE e.lot_id = l.id AND e.bucket = 'RESERVED'), 0)::text AS ledger_reserved
    FROM lots l WHERE l.organization_id = ${organizationId}`.execute(db)).rows;
  const diffs = [
    ...receptions.filter((r) => compare(r.expected, r.ledger) !== 0).map((r) => ({ kind: 'reception', id: r.id, expected: r.expected, ledger: r.ledger })),
    ...lots.filter((l) => compare(l.expected_physical, l.ledger_physical) !== 0).map((l) => ({ kind: 'lot_physical', id: l.id, code: l.lot_code, expected: l.expected_physical, ledger: l.ledger_physical })),
    ...lots.filter((l) => compare(l.expected_reserved, l.ledger_reserved) !== 0).map((l) => ({ kind: 'lot_reserved', id: l.id, code: l.lot_code, expected: l.expected_reserved, ledger: l.ledger_reserved })),
  ];
  return { checked: { receptions: receptions.length, lots: lots.length }, consistent: diffs.length === 0, differences: diffs, note: 'Las diferencias se informan; no se corrigen con ajustes automáticos.' };
}
