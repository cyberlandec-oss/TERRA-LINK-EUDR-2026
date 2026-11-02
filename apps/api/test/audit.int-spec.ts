import { createHash, randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { AuthorizationService } from '../src/authz/authorization.service';
import { csvCell } from '../src/audit/audit-query';

// Integración P0-025: consulta, redacción y exportación de la bitácora existente (`audit_logs`) con PostgreSQL real.
// Todos los datos son SINTÉTICOS. La fórmula de prueba es texto inerte.
describeDb('P0-025 auditoría: alcance, redacción y exportación', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string; // asignado a tecnico1
  let p2: string;
  let p3: string; // archivado con un motivo con forma de fórmula
  let t1: string;
  let t2: string;
  let auditorMid: string;
  let legacyId: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const logs = (actor: string, qs = '', o = orgA) => http().get(`${base(o)}/audit-logs${qs}`).set(as(actor));
  const FORMULA = '=HYPERLINK("http://ejemplo.invalid","x")';

  async function join(admin: string, o: string, email: string, role: string, last: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: last, password: PASSWORD }).expect(200);
    await h.login(email);
    return (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', o).executeTakeFirstOrThrow()).id;
  }
  /** Simula un rol con audit:read y alcance asignado (ningún rol actual lo combina) para probar el filtro por recurso. */
  function technicianWithAudit(email: string) {
    const orig = AuthorizationService.prototype.tenantContext;
    return jest.spyOn(AuthorizationService.prototype, 'tenantContext').mockImplementation(async function (this: AuthorizationService, user, orgId) {
      const ctx = await orig.call(this, user, orgId);
      if (ctx && user.email === email) return { ...ctx, permissions: [...ctx.permissions, 'audit:read'] };
      return ctx;
    });
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Auditoría A', 'admin-a@test.local');
    orgB = await mk('Coop Auditoría B', 'admin-b@test.local');
    t1 = await join('admin-a@test.local', orgA, 'tecnico1@test.local', 'FIELD_TECHNICIAN', 'Uno');
    t2 = await join('admin-a@test.local', orgA, 'tecnico2@test.local', 'FIELD_TECHNICIAN', 'Dos');
    auditorMid = await join('admin-a@test.local', orgA, 'auditor@test.local', 'AUDITOR', 'Auditora');
    p1 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'AU-1', legal_name: 'Finca Identidad Protegida', assigned_membership_id: t1 }).expect(201)).body.id;
    p2 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'AU-2', legal_name: 'Finca dos' }).expect(201)).body.id;
    await http().post(`${base(orgB)}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'B-1', legal_name: 'Finca B' }).expect(201);
    // Texto con forma de fórmula (sintético) en el motivo de un archivo: la bitácora debe conservarlo tal cual.
    p3 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'AU-3', legal_name: 'Finca tres' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/producers/${p3}/archive`).set(as('admin-a@test.local')).send({ expected_version: 1, reason: FORMULA }).expect(200);
    // Fila heredada con campos que nunca deben presentarse (se inserta directamente: simula un registro antiguo).
    legacyId = (await h.db.insertInto('audit_logs').values({
      organization_id: orgA, actor_user_id: null, action: 'producer.update', entity_type: 'producer', entity_id: p1, result: 'SUCCESS',
      after: JSON.stringify({ changed_fields: ['legal_name'], token: 'tok-SECRETO-123', password: 'clave-SECRETA', latitude: -0.123456, coordinates: [[-79.1, -0.2]], content: 'contenido del documento', legal_name: 'Finca Identidad Protegida', invitation_link: 'https://x.invalid/i/abc' }),
    }).returning('id').executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('admin y auditor consultan su organización; técnico sin audit:read → 403; otra organización → 404; plataforma anonimizada', async () => {
    const admin = (await logs('admin-a@test.local', '?limit=100').expect(200)).body;
    const auditor = (await logs('auditor@test.local', '?limit=100').expect(200)).body;
    expect(auditor.total).toBe(admin.total);
    expect(admin.items.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['producer.create', 'producer.archive', 'membership.create', 'invitation.accept']));
    const orgCreate = admin.items.find((r: { action: string }) => r.action === 'organization.create');
    expect(orgCreate.actor).toEqual({ key: 'PLATFORM', label: 'Administración de plataforma' });
    const body = JSON.stringify(auditor);
    expect(body).not.toContain(orgB);
    expect(body).not.toContain('Finca B');
    // el auditor (sin membership:read) ve nombres de miembros, no correos
    expect(auditor.items.every((r: { actor: { email?: string } }) => r.actor.email === undefined)).toBe(true);
    expect(admin.items.some((r: { actor: { email?: string } }) => r.actor.email === 'admin-a@test.local')).toBe(true);
    const invite = auditor.items.find((r: { action: string }) => r.action === 'invitation.create');
    expect(invite.after.email).toBeUndefined();
    expect(invite.redacted_fields).toContain('email');
    await logs('tecnico1@test.local').expect(403);
    await logs('admin-b@test.local').expect(404);
    await logs('super@test.local').expect(404);
    await http().get(`${base(orgA)}/audit-logs/facets`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${base(orgA)}/audit-logs/export`).set(as('admin-b@test.local')).expect(404);
    // detalle de una fila de otra organización: 404 (no se distingue de inexistente)
    const rowB = await h.db.selectFrom('audit_logs').select('id').where('organization_id', '=', orgB).executeTakeFirstOrThrow();
    await http().get(`${base(orgA)}/audit-logs/${rowB.id}`).set(as('admin-a@test.local')).expect(404);
  });

  it('filtros (período, entidad, operación, actor, resultado, correlación) y paginación estable sin duplicados ni saltos', async () => {
    const all = (await logs('admin-a@test.local', '?limit=100').expect(200)).body;
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: { id: string }[]; next_cursor: string | null; total: number } = (await logs('admin-a@test.local', `?limit=3${cursor ? `&cursor=${cursor}` : ''}`).expect(200)).body;
      expect(page.total).toBe(all.total);
      seen.push(...page.items.map((r) => r.id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(all.items.map((r: { id: string }) => r.id));
    expect(new Set(seen).size).toBe(seen.length);

    const byEntity = (await logs('admin-a@test.local', `?entity_type=producer&entity_id=${p3}`).expect(200)).body;
    expect(byEntity.items.map((r: { action: string }) => r.action).sort()).toEqual(['producer.archive', 'producer.create']);
    const byAction = (await logs('admin-a@test.local', '?action=producer.archive').expect(200)).body;
    expect(byAction.total).toBe(1);
    expect((await logs('admin-a@test.local', '?action=producer').expect(200)).body.total).toBe(5); // create ×3, archive, fila heredada
    expect((await logs('admin-a@test.local', `?actor=${t1}`).expect(200)).body.items.every((r: { actor: { key: string } }) => r.actor.key === t1)).toBe(true);
    expect((await logs('admin-a@test.local', '?actor=PLATFORM').expect(200)).body.items.every((r: { actor: { key: string } }) => r.actor.key === 'PLATFORM')).toBe(true);
    expect((await logs('admin-a@test.local', '?result=DENIED').expect(200)).body).toMatchObject({ total: 0, items: [] });
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await logs('admin-a@test.local', `?from=${future}`).expect(200)).body.total).toBe(0);
    await logs('admin-a@test.local', `?from=${future}&to=${new Date().toISOString()}`).expect(400);
    const withReq = all.items.find((r: { request_id: string | null }) => r.request_id);
    if (withReq) expect((await logs('admin-a@test.local', `?request_id=${encodeURIComponent(withReq.request_id)}`).expect(200)).body.items.map((r: { id: string }) => r.id)).toContain(withReq.id);
    await logs('admin-a@test.local', `?cursor=${randomUUID()}`).expect(400);
    // cursor de otra organización no sirve de oráculo
    const rowB = await h.db.selectFrom('audit_logs').select('id').where('organization_id', '=', orgB).executeTakeFirstOrThrow();
    await logs('admin-a@test.local', `?cursor=${rowB.id}`).expect(400);
    await logs('admin-a@test.local', '?limit=1000').expect(400);
    await logs('admin-a@test.local', '?entity_type=DROP%20TABLE').expect(400);
  });

  it('alcance por recurso aun con audit:read (técnico simulado): solo sus productores; totales, filtros y detalle sin fugas; reasignación y revocación inmediatas', async () => {
    technicianWithAudit('tecnico1@test.local');
    const mine = (await logs('tecnico1@test.local', '?entity_type=producer&limit=100').expect(200)).body;
    expect(new Set(mine.items.map((r: { entity_id: string }) => r.entity_id))).toEqual(new Set([p1]));
    expect(mine.total).toBe(mine.items.length);
    // filtrar por un productor fuera de alcance devuelve vacío, igual que uno inexistente (sin oráculo)
    const other = (await logs('tecnico1@test.local', `?entity_id=${p2}`).expect(200)).body;
    const none = (await logs('tecnico1@test.local', `?entity_id=${randomUUID()}`).expect(200)).body;
    expect(other).toEqual(none);
    const p2Row = await h.db.selectFrom('audit_logs').select('id').where('entity_id', '=', p2).executeTakeFirstOrThrow();
    await http().get(`${base(orgA)}/audit-logs/${p2Row.id}`).set(as('tecnico1@test.local')).expect(404);
    const facets = (await http().get(`${base(orgA)}/audit-logs/facets`).set(as('tecnico1@test.local')).expect(200)).body;
    expect(facets.actions).not.toContain('producer.archive'); // la única fila de archivo es de p3
    // reasignación: p1 pasa a tecnico2 → tecnico1 deja de ver su historia en la siguiente consulta
    const v = (await http().get(`${base(orgA)}/producers/${p1}`).set(as('admin-a@test.local')).expect(200)).body.row_version;
    await http().put(`${base(orgA)}/producers/${p1}/assignment`).set(as('admin-a@test.local')).send({ membership_id: t2, expected_version: v }).expect(200);
    expect((await logs('tecnico1@test.local', '?entity_type=producer').expect(200)).body.total).toBe(0);
    // revocación: membresía del auditor desactivada → 404 en la siguiente consulta y exportación
    await http().post(`${base(orgA)}/members/${auditorMid}/deactivate`).set(as('admin-a@test.local')).send({ reason: 'Fin del encargo' }).expect(200);
    await logs('auditor@test.local').expect(404);
    await http().get(`${base(orgA)}/audit-logs/export`).set(as('auditor@test.local')).expect(404);
    await http().post(`${base(orgA)}/members/${auditorMid}/reactivate`).set(as('admin-a@test.local')).send({ reason: 'Nuevo encargo' }).expect(200);
    await logs('auditor@test.local').expect(200);
  });

  it('redacción de presentación: sin secretos, enlaces, coordenadas, contenido ni identidad; el original queda intacto', async () => {
    const detail = (await http().get(`${base(orgA)}/audit-logs/${legacyId}`).set(as('auditor@test.local')).expect(200)).body;
    expect(detail.record.after).toEqual({ changed_fields: ['legal_name'] });
    expect(detail.record.redacted_fields).toEqual(['content', 'coordinates', 'invitation_link', 'latitude', 'legal_name', 'password', 'token']);
    const text = JSON.stringify(detail);
    for (const secret of ['tok-SECRETO-123', 'clave-SECRETA', '-0.123456', '-79.1', 'contenido del documento', 'Finca Identidad Protegida', 'x.invalid']) expect(text).not.toContain(secret);
    const raw = await h.db.selectFrom('audit_logs').select('after').where('id', '=', legacyId).executeTakeFirstOrThrow();
    expect(raw.after).toMatchObject({ token: 'tok-SECRETO-123', latitude: -0.123456 }); // presentación ≠ original
    await expect(sql`UPDATE audit_logs SET reason = 'x' WHERE id = ${legacyId}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM audit_logs WHERE id = ${legacyId}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('historia inmutable y trazabilidad de correcciones: la corrección enlaza el evento original y la línea de tiempo conserva ambos', async () => {
    const cur = (await http().get(`${base(orgA)}/producers/${p2}`).set(as('admin-a@test.local')).expect(200)).body;
    await http().patch(`${base(orgA)}/producers/${p2}`).set(as('admin-a@test.local')).send({ expected_version: cur.row_version, canton: 'Chone' }).expect(200);
    const ev = (await http().get(`${base(orgA)}/aggregates/producers/${p2}/events`).set(as('admin-a@test.local')).expect(200)).body.items[0].event_id;
    const v = (await http().get(`${base(orgA)}/producers/${p2}`).set(as('admin-a@test.local')).expect(200)).body.row_version;
    await http().post(`${base(orgA)}/producers/${p2}/events/${ev}/corrections`).set(as('admin-a@test.local'))
      .send({ operation_id: randomUUID(), expected_version: v, reason: 'Cantón correcto', fields: { canton: 'Bolívar' } }).expect(201);
    const corr = (await logs('auditor@test.local', `?action=producer.correct&entity_id=${p2}`).expect(200)).body.items[0];
    const detail = (await http().get(`${base(orgA)}/audit-logs/${corr.id}`).set(as('auditor@test.local')).expect(200)).body;
    expect(detail.links.corrects_event_id).toBe(ev);
    expect(detail.links.correction_event_id).toEqual(expect.any(String));
    expect(detail.timeline.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['producer.create', 'producer.update', 'producer.correct']));
    expect(detail.record.after.changed_fields).toEqual(['canton']);
    expect(JSON.stringify(detail)).not.toContain('Bolívar'); // nombres de campo, no valores
  });

  it('exportación autorizada: mismo alcance y redacción, metadatos, hash verificable, fórmulas neutralizadas, auditada y sin enlace público', async () => {
    const list = (await logs('auditor@test.local', '?entity_type=producer&limit=100').expect(200)).body;
    const res = await http().get(`${base(orgA)}/audit-logs/export?entity_type=producer`).set(as('auditor@test.local')).buffer(true)
      .parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const bytes = res.body as Buffer;
    expect(res.headers['x-content-sha256']).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.location).toBeUndefined();
    const text = bytes.toString('utf8');
    expect(text).toContain('# formato,TL_AUDIT_CSV 0.1 (provisional)');
    expect(text).toContain(`# organizacion_id,${orgA}`);
    expect(text).toContain(`# registros,${list.total}`);
    expect(text.split('\r\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('﻿#')).length).toBe(list.total + 1);
    // fórmula neutralizada en el archivo; la bitácora conserva el valor original
    expect(text).toContain(`"'=HYPERLINK(""http://ejemplo.invalid"",""x"")"`);
    expect(text).not.toMatch(/,=HYPERLINK/);
    const original = await h.db.selectFrom('audit_logs').select('reason').where('action', '=', 'producer.archive').where('entity_id', '=', p3).executeTakeFirstOrThrow();
    expect(original.reason).toBe(FORMULA);
    for (const secret of ['tok-SECRETO-123', 'clave-SECRETA', '-0.123456', 'Finca Identidad Protegida', 'x.invalid/i/abc', 'tecnico1@test.local', PASSWORD]) expect(text).not.toContain(secret);
    expect(text).not.toContain(orgB);
    // auditada (con hash y filtros; sin el contenido)
    const exp = await h.db.selectFrom('audit_logs').select(['after', 'actor_user_id']).where('action', '=', 'audit.export').where('organization_id', '=', orgA).orderBy('occurred_at', 'desc').executeTakeFirstOrThrow();
    expect(exp.after).toMatchObject({ format_version: 'TL_AUDIT_CSV 0.1 (provisional)', row_count: list.total, sha256: res.headers['x-content-sha256'], filters: { entity_type: 'producer' } });
    // técnico simulado: la exportación respeta el mismo alcance (sin audit:export → 403)
    technicianWithAudit('tecnico2@test.local');
    await http().get(`${base(orgA)}/audit-logs/export`).set(as('tecnico2@test.local')).expect(403);
  });

  it('celdas CSV: neutraliza =, +, -, @, tabulador y retorno; respeta comillas y comas', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('+57')).toBe(`"'+57"`);
    expect(csvCell('-cmd')).toBe(`"'-cmd"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('\tx')).toBe(`"'\tx"`);
    expect(csvCell('a,b "c"')).toBe('"a,b ""c"""');
    expect(csvCell('normal')).toBe('normal');
  });

  it('errores sin secretos ni detalles internos', async () => {
    const bad = (await logs('admin-a@test.local', '?from=no-es-fecha').expect(400)).body;
    const s = JSON.stringify(bad);
    expect(s).not.toMatch(/SELECT|audit_logs|stack|postgres/i);
    const denied = (await logs('tecnico1@test.local').expect(403)).body;
    expect(JSON.stringify(denied)).not.toMatch(/audit:read|SELECT/);
  });
});
