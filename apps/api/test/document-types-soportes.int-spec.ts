import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// AJ-03 — Tipos documentales para los aspectos AMBIENTAL, LABORAL y de DERECHOS DE TERCEROS (migración 0066). PostgreSQL, S3 local y ClamAV REALES; datos SINTÉTICOS.
// Un tipo solo CLASIFICA un archivo: no es obligatorio, no es evidencia aprobada, no acredita autenticidad y no mueve riesgo, READY ni despacho.
describeDb('AJ-03 soportes ambientales, laborales y de derechos de terceros', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org: string;
  let pOwn: string; let pOther: string;
  let plotOwn: string; let plotOther: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = `/api/v1/organizations`;
  const pdf = () => Buffer.from(`%PDF-1.4\n% soporte sintético ${randomUUID()}\n%%EOF\n`);
  const upload = (actor: string, type: string, ownerType: string, ownerId: string, title = `Soporte ${randomUUID().slice(0, 4)} (sintético)`) =>
    http().post(`${base}/${org}/documents`).set(as(actor)).field('operation_id', randomUUID()).field('document_type', type).field('owner_type', ownerType).field('owner_id', ownerId).field('title', title)
      .attach('file', pdf(), { filename: 'soporte.pdf', contentType: 'application/pdf' });
  const tablas = ['risk_evaluations', 'dd_snapshots', 'document_version_reviews', 'evidence', 'legal_profile_reviews', 'risk_conclusions'];
  const conteos = async () => Object.fromEntries(await Promise.all(tablas.map(async (t) => [t, Number((await h.db.selectFrom(t as never).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow() as { n: string }).n)])));

  async function join(admin: string, email: string, role: string) {
    const inv = await http().post(`${base}/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin@test.local');
    org = (await http().post(base).set(as('super@test.local')).send({ name: 'Coop Soportes', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: 'admin@test.local' }).expect(201)).body.id;
    await join('admin@test.local', 'productor@test.local', 'PRODUCER');
    pOwn = (await http().post(`${base}/${org}/producers`).set(as('admin@test.local')).send({ producer_code: 'SP-1', legal_name: 'Finca Propia' }).expect(201)).body.id;
    pOther = (await http().post(`${base}/${org}/producers`).set(as('admin@test.local')).send({ producer_code: 'SP-2', legal_name: 'Finca de Otra Persona' }).expect(201)).body.id;
    const row = (await http().get(`${base}/${org}/producers/${pOwn}`).set(as('admin@test.local')).expect(200)).body;
    await http().put(`${base}/${org}/producers/${pOwn}/self-membership`).set(as('admin@test.local')).send({ expected_version: row.row_version, membership_id: await mid('productor@test.local'), reason: 'Vínculo de prueba' }).expect(200);
    plotOwn = (await http().post(`${base}/${org}/plots`).set(as('admin@test.local')).send({ producer_id: pOwn, plot_code: 'SP-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    plotOther = (await http().post(`${base}/${org}/plots`).set(as('admin@test.local')).send({ producer_id: pOther, plot_code: 'SP-2-P1', crop: 'Cacao' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('el catálogo incluye los tres tipos con su clasificación de privacidad y sus titulares; los anteriores no cambian', async () => {
    const r = (await http().get(`${base}/${org}/document-types`).set(as('productor@test.local')).expect(200)).body.types as Array<{ code: string; classification: string; allowed_owner_types: string[] }>;
    const por = Object.fromEntries(r.map((t) => [t.code, t]));
    expect(Object.keys(por).sort()).toEqual(['DELIVERY_SUPPORT', 'ENVIRONMENTAL_SUPPORT', 'FIELD_EVIDENCE', 'FIELD_PHOTO', 'LABOR_SUPPORT', 'LAND_TENURE', 'THIRD_PARTY_RIGHTS_SUPPORT']);
    expect(por.ENVIRONMENTAL_SUPPORT).toMatchObject({ classification: 'OPERATIONAL', allowed_owner_types: ['plot', 'producer'] });
    expect(por.LABOR_SUPPORT).toMatchObject({ classification: 'PERSONAL_DATA' });
    expect(por.THIRD_PARTY_RIGHTS_SUPPORT).toMatchObject({ classification: 'PERSONAL_DATA' });
    expect(por.LAND_TENURE.classification).toBe('PERSONAL_DATA');            // sin cambios
    expect(por.FIELD_EVIDENCE.classification).toBe('OPERATIONAL');           // sin cambios
  });

  it('el Productor vinculado aporta cada tipo a SU parcela: queda recibido, sin revisión y sin ninguna aprobación automática', async () => {
    const antes = await conteos();
    for (const tipo of ['ENVIRONMENTAL_SUPPORT', 'LABOR_SUPPORT', 'THIRD_PARTY_RIGHTS_SUPPORT']) {
      const d = (await upload('productor@test.local', tipo, 'plot', plotOwn).expect(201)).body.document;
      expect(d).toMatchObject({ document_type: tipo, owner_type: 'plot', owner_id: plotOwn });
      expect(d.versions[0].review).toBeNull();                            // nada se aprueba por cargarlo
    }
    const lista = (await http().get(`${base}/${org}/documents?owner_type=plot&owner_id=${plotOwn}`).set(as('productor@test.local')).expect(200)).body as Array<{ document_type: string }>;
    expect(lista.map((d) => d.document_type).sort()).toEqual(['ENVIRONMENTAL_SUPPORT', 'LABOR_SUPPORT', 'THIRD_PARTY_RIGHTS_SUPPORT']);
    expect(await conteos()).toEqual(antes);                               // ni riesgo, ni expediente, ni evidencia, ni revisiones, ni perfil jurídico cambian
  });

  it('privacidad: el contenido de un soporte con datos personales se restringe al Productor (ve metadatos), el ambiental no', async () => {
    const lab = (await http().get(`${base}/${org}/documents?owner_type=plot&owner_id=${plotOwn}&document_type=LABOR_SUPPORT`).set(as('productor@test.local')).expect(200)).body[0];
    expect(lab.content_access).toBe('RESTRICTED');
    expect(lab.versions[0].file_name).toBeNull();
    expect((await http().get(`${base}/${org}/documents/${lab.id}/versions/${lab.versions[0].id}/content`).set(as('productor@test.local')).expect(403)).body.error.code).toBe('CONTENT_RESTRICTED');
    const env = (await http().get(`${base}/${org}/documents?owner_type=plot&owner_id=${plotOwn}&document_type=ENVIRONMENTAL_SUPPORT`).set(as('productor@test.local')).expect(200)).body[0];
    expect(env.content_access).toBe('ALLOWED');
    await http().get(`${base}/${org}/documents/${env.id}/versions/${env.versions[0].id}/content`).set(as('productor@test.local')).expect(200);
    // El control: quien tiene acceso a la identidad (administración) sí ve el contenido del soporte laboral.
    await http().get(`${base}/${org}/documents/${lab.id}/versions/${lab.versions[0].id}/content`).set(as('admin@test.local')).expect(200);
  });

  it('versionado: una versión nueva conserva la anterior y no hereda revisión', async () => {
    const env = (await http().get(`${base}/${org}/documents?owner_type=plot&owner_id=${plotOwn}&document_type=ENVIRONMENTAL_SUPPORT`).set(as('productor@test.local')).expect(200)).body[0];
    const v2 = await http().post(`${base}/${org}/documents/${env.id}/versions`).set(as('productor@test.local')).field('operation_id', randomUUID()).field('expected_version', String(env.row_version))
      .attach('file', pdf(), { filename: 'v2.pdf', contentType: 'application/pdf' }).expect(201);
    expect(v2.body.document.versions.map((v: { version_number: number }) => v.version_number)).toEqual([2, 1]);
    expect(v2.body.document.versions[0].review).toBeNull();
  });

  it('alcance: la parcela de otro productor no admite soportes ni los muestra; un tipo no admite un titular que no le corresponde', async () => {
    expect([403, 404]).toContain((await upload('productor@test.local', 'ENVIRONMENTAL_SUPPORT', 'plot', plotOther)).status);
    expect((await http().get(`${base}/${org}/documents?owner_type=plot&owner_id=${plotOther}`).set(as('productor@test.local')).expect(200)).body).toEqual([]);
    await upload('admin@test.local', 'LABOR_SUPPORT', 'delivery', randomUUID()).expect((r) => expect([404, 422]).toContain(r.status));
    expect((await upload('admin@test.local', 'ENVIRONMENTAL_SUPPORT', 'plot', plotOther).expect(201)).body.document.owner_id).toBe(plotOther); // control: la administración sí puede
  });
});
