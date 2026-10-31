import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { MALWARE_SCANNER, type MalwareScanner } from '../src/storage/scanner';

// Integración P0-019 Evidencias (PostgreSQL, S3 y ClamAV reales). Documentos SINTÉTICOS.
describeDb('P0-019 evidencias: afirmaciones, soportes por versión y decisiones', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let scanner: MalwareScanner;
  let orgA: string;
  let orgB: string;
  let p1: string; // asignado a tecnico1
  let p2: string;
  let doc1: { id: string; v1: string; row_version: number };
  let doc2: { id: string; v1: string; row_version: number }; // titular p2 (fuera del alcance de tecnico1)
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const pdf = (tag: string = randomUUID()) => Buffer.from(`%PDF-1.4\n% evidencia sintética ${tag}\n%%EOF\n`);
  async function uploadDoc(owner: string, extra: Record<string, string> = {}) {
    const r = http().post(`${base(orgA)}/documents`).set(as('admin-a@test.local')).field('operation_id', randomUUID())
      .field('document_type', 'LAND_TENURE').field('owner_type', 'producer').field('owner_id', owner).field('title', 'Tenencia sintética');
    for (const [k, v] of Object.entries(extra)) r.field(k, v);
    const d = (await r.attach('file', pdf(), { filename: 'tenencia.pdf', contentType: 'application/pdf' }).expect(201)).body.document;
    return { id: d.id as string, v1: d.versions[0].id as string, row_version: d.row_version as number };
  }
  const createClaim = (actor: string, entity: string, extra: Record<string, unknown> = {}) =>
    http().post(`${base(orgA)}/evidence`).set(as(actor)).send({ operation_id: randomUUID(), claim_type: 'LAND_TENURE_DOCUMENTED', entity_type: 'producer', entity_id: entity, ...extra });
  const addSource = (actor: string, ev: { id: string; row_version: number }, version: string, relationship = 'SUPPORTS', extra: Record<string, unknown> = {}) =>
    http().post(`${base(orgA)}/evidence/${ev.id}/sources`).set(as(actor)).send({ operation_id: randomUUID(), expected_version: ev.row_version, document_version_id: version, relationship, ...extra });
  const decide = (actor: string, ev: { id: string; row_version: number }, action: string, extra: Record<string, unknown> = {}) =>
    http().post(`${base(orgA)}/evidence/${ev.id}/${action}`).set(as(actor)).send({ expected_version: ev.row_version, reason: `Motivo ${action}`, ...extra });

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await setupHarness();
    scanner = h.app.get(MALWARE_SCANNER);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop A', 'admin-a@test.local');
    orgB = await mk('Coop B', 'admin-b@test.local');
    await join('admin-a@test.local', orgA, 'tecnico1@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'tecnico2@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'auditor@test.local', 'AUDITOR');
    await join('admin-a@test.local', orgA, 'eudr@test.local', 'EUDR_MANAGER');
    await join('admin-a@test.local', orgA, 'eudr2@test.local', 'EUDR_MANAGER');
    p1 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'P-1', legal_name: 'Finca uno', document_type: 'CEDULA', document_number: '0912345678', assigned_membership_id: await mid('tecnico1@test.local') }).expect(201)).body.id;
    p2 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'P-2', legal_name: 'Finca dos secreta' }).expect(201)).body.id;
    doc1 = await uploadDoc(p1);
    doc2 = await uploadDoc(p2);
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  let ev: { id: string; row_version: number };

  it('flujo autorizado: afirmación → soporte por versión exacta → envío → verificación; adjuntar no valida', async () => {
    let e = (await createClaim('tecnico1@test.local', p1).expect(201)).body.evidence;
    expect(e).toMatchObject({ status: 'DRAFT', claim: { code: 'LAND_TENURE_DOCUMENTED' }, entity: { type: 'producer', id: p1 }, actions: { add_source: true, verify: false } });
    e = (await addSource('tecnico1@test.local', e, doc1.v1).expect(201)).body.evidence;
    expect(e.status).toBe('DRAFT'); // un soporte disponible no valida la afirmación
    expect(e.sources[0]).toMatchObject({ relationship: 'SUPPORTS', version: { id: doc1.v1, version_number: 1, availability: 'AVAILABLE', review: null } });
    e = (await decide('tecnico1@test.local', e, 'submit').expect(200)).body;
    await decide('tecnico1@test.local', e, 'verify').expect(403); // facultad separada
    e = (await decide('eudr@test.local', e, 'verify').expect(200)).body;
    expect(e).toMatchObject({ status: 'VERIFIED', requires_review: false });
    expect(e.decisions.map((d: { action: string }) => d.action)).toEqual(['VERIFY', 'SUBMIT']);
    expect(e.note).toMatch(/no significa conformidad EUDR/);
    ev = e;
    const evts = await h.db.selectFrom('domain_events').select(['event_type', 'payload']).where('aggregate_id', '=', e.id).orderBy('aggregate_version').execute();
    expect(evts.map((x) => x.event_type)).toEqual(['EvidenceCreated', 'EvidenceSourceLinked', 'EvidenceSubmitted', 'EvidenceVerified']);
    expect(JSON.stringify(evts)).not.toMatch(/Tenencia sintética|tenencia\.pdf|0912345678|Finca/);
  });

  it('nueva versión del documento: no se hereda ni se sustituye el enlace; la afirmación pide revisión', async () => {
    await http().post(`${base(orgA)}/documents/${doc1.id}/versions`).set(as('admin-a@test.local')).field('operation_id', randomUUID()).field('expected_version', String(doc1.row_version ?? 1))
      .attach('file', pdf('v2'), { filename: 'tenencia-v2.pdf', contentType: 'application/pdf' }).expect(201);
    const e = (await http().get(`${base(orgA)}/evidence/${ev.id}`).set(as('admin-a@test.local')).expect(200)).body;
    expect(e).toMatchObject({ status: 'VERIFIED', requires_review: true, review_reasons: ['NEWER_DOCUMENT_VERSION'] });
    expect(e.sources[0].version).toMatchObject({ id: doc1.v1, version_number: 1, newer_version_exists: true }); // apunta a v1
    const doc = (await http().get(`${base(orgA)}/documents/${doc1.id}`).set(as('admin-a@test.local')).expect(200)).body;
    const v2 = doc.versions.find((v: { version_number: number }) => v.version_number === 2);
    let r = (await decide('eudr@test.local', e, 'revoke').expect(200)).body;
    r = (await decide('tecnico1@test.local', r, 'reopen').expect(200)).body;
    r = (await addSource('tecnico1@test.local', r, v2.id).expect(201)).body.evidence;
    r = (await http().post(`${base(orgA)}/evidence/${ev.id}/sources/${r.sources[0].id}/withdraw`).set(as('tecnico1@test.local')).send({ expected_version: r.row_version, reason: 'Sustituida por la versión 2' }).expect(200)).body;
    r = (await decide('tecnico1@test.local', r, 'submit').expect(200)).body;
    r = (await decide('eudr@test.local', r, 'verify').expect(200)).body;
    expect(r).toMatchObject({ status: 'VERIFIED', requires_review: false });
    expect(r.sources).toHaveLength(2); // la historia del soporte retirado se conserva
    expect(r.sources[0]).toMatchObject({ active: false, withdrawn: { reason: 'Sustituida por la versión 2' } });
    expect(r.decisions.map((d: { action: string }) => d.action)).toEqual(['VERIFY', 'SUBMIT', 'REOPEN', 'REVOKE', 'VERIFY', 'SUBMIT']);
  });

  it('soportes vencidos, rechazados o no disponibles impiden verificar (motivos distintos)', async () => {
    const expired = await uploadDoc(p1, { expires_at: '2020-01-01' });
    const rejected = await uploadDoc(p1);
    await http().post(`${base(orgA)}/documents/${rejected.id}/versions/${rejected.v1}/reviews`).set(as('admin-a@test.local')).send({ decision: 'REJECTED', reason: 'Ilegible' }).expect(201);
    jest.spyOn(scanner, 'scan').mockResolvedValueOnce({ result: 'FAILED', engine: 'clamd', signature: null, error_code: 'SCANNER_UNAVAILABLE' });
    const pending = await uploadDoc(p1);
    for (const [doc, code] of [[expired, 'SOURCE_EXPIRED'], [rejected, 'SOURCE_REJECTED'], [pending, 'SOURCE_UNAVAILABLE']] as const) {
      let e = (await createClaim('admin-a@test.local', p1).expect(201)).body.evidence;
      e = (await addSource('admin-a@test.local', e, doc.v1).expect(201)).body.evidence;
      e = (await decide('admin-a@test.local', e, 'submit').expect(200)).body;
      const r = await decide('eudr@test.local', e, 'verify').expect(422);
      expect(r.body.error).toMatchObject({ code: 'SOURCES_NOT_VERIFIABLE' });
      expect(r.body.error.details.map((d: { reason: string }) => d.reason)).toContain(code);
    }
  });

  it('contradicción preservada: verificar exige reconocerla expresamente; no se sobrescribe', async () => {
    const other = await uploadDoc(p1);
    let e = (await createClaim('admin-a@test.local', p1).expect(201)).body.evidence;
    e = (await addSource('admin-a@test.local', e, doc1.v1, 'SUPPORTS').expect(201)).body.evidence;
    e = (await addSource('admin-a@test.local', e, other.v1, 'CONTRADICTS', { note: 'Linderos distintos' }).expect(201)).body.evidence;
    expect(e.review_reasons).toContain('ACTIVE_CONTRADICTION');
    e = (await decide('admin-a@test.local', e, 'submit').expect(200)).body;
    // doc1 tiene una versión más nueva: se usa la vigente para este caso
    expect((await decide('eudr@test.local', e, 'verify').expect(422)).body.error.code).toBe('SOURCE_SUPERSEDED');
    let f = (await createClaim('admin-a@test.local', p1).expect(201)).body.evidence;
    f = (await addSource('admin-a@test.local', f, other.v1, 'SUPPORTS').expect(201)).body.evidence;
    const contra = await uploadDoc(p1);
    f = (await addSource('admin-a@test.local', f, contra.v1, 'CONTRADICTS').expect(201)).body.evidence;
    f = (await decide('admin-a@test.local', f, 'submit').expect(200)).body;
    expect((await decide('eudr@test.local', f, 'verify').expect(422)).body.error.code).toBe('CONTRADICTION_NOT_ACKNOWLEDGED');
    f = (await decide('eudr@test.local', f, 'verify', { contradictions_acknowledged: true }).expect(200)).body;
    expect(f).toMatchObject({ status: 'VERIFIED', decisions: [expect.objectContaining({ action: 'VERIFY', contradictions_acknowledged: true }), expect.anything()] });
    expect(f.sources.find((s: { relationship: string }) => s.relationship === 'CONTRADICTS')).toMatchObject({ active: true });
    await expect(sql`UPDATE evidence_sources SET relationship = 'SUPPORTS' WHERE evidence_id = ${f.id}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('autorización: referencias ajenas o fuera de asignación rechazadas; auditor solo consulta', async () => {
    await createClaim('tecnico1@test.local', p2).expect(404);
    let e = (await createClaim('tecnico1@test.local', p1).expect(201)).body.evidence;
    await addSource('tecnico1@test.local', e, doc2.v1).expect(404); // documento de un productor no asignado
    await addSource('tecnico1@test.local', e, randomUUID()).expect(404);
    e = (await http().get(`${base(orgA)}/evidence/${e.id}`).set(as('tecnico1@test.local')).expect(200)).body;
    await createClaim('auditor@test.local', p1).expect(403);
    await http().get(`${base(orgA)}/evidence?entity_type=producer&entity_id=${p1}`).set(as('auditor@test.local')).expect(200);
    await http().get(`${base(orgA)}/evidence/${e.id}`).set(as('admin-b@test.local')).expect(404);
    await http().post(`${base(orgB)}/evidence`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), claim_type: 'LAND_TENURE_DOCUMENTED', entity_type: 'producer', entity_id: p1 }).expect(404);
    expect((await createClaim('admin-a@test.local', p1, { claim_type: 'PLOT_FIELD_CAPTURED' }).expect(422)).body.error.code).toBe('ENTITY_TYPE_NOT_ALLOWED');
    expect((await createClaim('admin-a@test.local', p1, { claim_type: 'DEFORESTATION_FREE' }).expect(422)).body.error.code).toBe('CLAIM_TYPE_UNKNOWN');
  });

  it('privacidad del grafo: nodos, relaciones, consultas inversas y conteos fuera de alcance no se revelan', async () => {
    let e = (await createClaim('admin-a@test.local', p1).expect(201)).body.evidence;
    e = (await addSource('admin-a@test.local', e, doc2.v1, 'CONTRADICTS').expect(201)).body.evidence; // soporte del productor p2
    const asTech = (await http().get(`${base(orgA)}/evidence/${e.id}`).set(as('tecnico1@test.local')).expect(200)).body;
    expect(asTech.sources).toEqual([]);
    expect(asTech.review_reasons).not.toContain('ACTIVE_CONTRADICTION');
    const blob = JSON.stringify(asTech);
    for (const leak of [doc2.id, doc2.v1, 'CONTRADICTS', 'secreta']) expect(blob).not.toContain(leak);
    await http().get(`${base(orgA)}/documents/${doc2.id}/evidence`).set(as('tecnico1@test.local')).expect(404);
    await http().get(`${base(orgA)}/documents/${doc1.id}/evidence`).set(as('tecnico2@test.local')).expect(404);
    expect((await http().get(`${base(orgA)}/evidence`).set(as('tecnico2@test.local')).expect(200)).body).toEqual([]);
    const inverse = (await http().get(`${base(orgA)}/documents/${doc2.id}/evidence`).set(as('admin-a@test.local')).expect(200)).body;
    expect(inverse.map((x: { id: string }) => x.id)).toContain(e.id);
    // metadatos sí, contenido personal no (auditor sin producer:read_identity)
    const aud = (await http().get(`${base(orgA)}/evidence/${ev.id}`).set(as('auditor@test.local')).expect(200)).body;
    expect(aud.sources[0].document).toMatchObject({ content_access: 'RESTRICTED' });
    expect(JSON.stringify(aud)).not.toContain('0912345678');
  });

  it('acceso revocado: reasignar el productor retira el acceso a sus afirmaciones', async () => {
    await http().get(`${base(orgA)}/evidence/${ev.id}`).set(as('tecnico1@test.local')).expect(200);
    const pr = await http().get(`${base(orgA)}/producers/${p1}`).set(as('admin-a@test.local')).expect(200);
    await http().put(`${base(orgA)}/producers/${p1}/assignment`).set(as('admin-a@test.local')).send({ expected_version: pr.body.row_version, membership_id: await mid('tecnico2@test.local') }).expect(200);
    await http().get(`${base(orgA)}/evidence/${ev.id}`).set(as('tecnico1@test.local')).expect(404);
    await http().get(`${base(orgA)}/evidence/${ev.id}`).set(as('tecnico2@test.local')).expect(200);
  });

  it('reintentos, concurrencia y rollback sin efectos parciales', async () => {
    const op = randomUUID();
    const a = await http().post(`${base(orgA)}/evidence`).set(as('admin-a@test.local')).send({ operation_id: op, claim_type: 'LAND_TENURE_DOCUMENTED', entity_type: 'producer', entity_id: p2 }).expect(201);
    const b = await http().post(`${base(orgA)}/evidence`).set(as('admin-a@test.local')).send({ operation_id: op, claim_type: 'LAND_TENURE_DOCUMENTED', entity_type: 'producer', entity_id: p2 }).expect(200);
    expect(b.body.evidence.id).toBe(a.body.evidence.id);
    await http().post(`${base(orgA)}/evidence`).set(as('admin-a@test.local')).send({ operation_id: op, claim_type: 'LAND_TENURE_DOCUMENTED', entity_type: 'producer', entity_id: p1 }).expect(409);
    let e = a.body.evidence;
    const sop = randomUUID();
    e = (await http().post(`${base(orgA)}/evidence/${e.id}/sources`).set(as('admin-a@test.local')).send({ operation_id: sop, expected_version: e.row_version, document_version_id: doc2.v1, relationship: 'SUPPORTS' }).expect(201)).body.evidence;
    await http().post(`${base(orgA)}/evidence/${e.id}/sources`).set(as('admin-a@test.local')).send({ operation_id: sop, expected_version: 1, document_version_id: doc2.v1, relationship: 'SUPPORTS' }).expect(200);
    e = (await decide('admin-a@test.local', e, 'submit').expect(200)).body;
    const [x, y] = await Promise.all([decide('eudr@test.local', e, 'verify'), decide('eudr2@test.local', e, 'reject')]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const final = (await http().get(`${base(orgA)}/evidence/${e.id}`).set(as('admin-a@test.local')).expect(200)).body;
    expect(final.decisions.filter((d: { action: string }) => d.action === 'VERIFY' || d.action === 'REJECT')).toHaveLength(1);
    // rollback: falla al registrar la decisión → sin cambio de estado, evento ni auditoría
    const g = (await createClaim('admin-a@test.local', p2).expect(201)).body.evidence;
    const g2 = (await addSource('admin-a@test.local', g, doc2.v1).expect(201)).body.evidence;
    const count = async () => (await sql<{ e: number; a: number }>`SELECT (SELECT count(*)::int FROM domain_events WHERE aggregate_id = ${g.id}) AS e, (SELECT count(*)::int FROM audit_logs WHERE entity_id = ${g.id}) AS a`.execute(h.db)).rows[0];
    const before = await count();
    await sql`CREATE OR REPLACE FUNCTION p019_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla forzada'; END $$`.execute(h.db);
    await sql`CREATE TRIGGER p019_fail BEFORE INSERT ON evidence_decisions FOR EACH ROW EXECUTE FUNCTION p019_fail()`.execute(h.db);
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await decide('admin-a@test.local', g2, 'submit').expect(500);
    } finally {
      spy.mockRestore();
      await sql`DROP TRIGGER p019_fail ON evidence_decisions`.execute(h.db);
      await sql`DROP FUNCTION p019_fail`.execute(h.db);
    }
    expect(await count()).toEqual(before);
    expect((await http().get(`${base(orgA)}/evidence/${g.id}`).set(as('admin-a@test.local')).expect(200)).body.status).toBe('DRAFT');
  });
});
