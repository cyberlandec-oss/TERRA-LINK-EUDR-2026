import { describeDb, setupHarness } from './helpers';

// Salud con el escáner antimalware INACCESIBLE (puerto cerrado): la API sigue lista para tráfico (200) pero el estado es
// «degraded», checks.scanner «unavailable» y el análisis de documentos «UNAVAILABLE»; un archivo subido nunca queda limpio.
describeDb('salud: escáner inaccesible degrada el análisis, no lo oculta', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  beforeAll(async () => { h = await setupHarness({ scanner: { host: '127.0.0.1', port: 1, timeoutMs: 1000 } }); });
  afterAll(async () => h?.close());

  it('readiness 200 con status degraded y escáner no disponible; documento nuevo queda pendiente (FAILED), nunca CLEAN', async () => {
    const r = await h.http().get('/health/ready').expect(200);
    expect(r.body).toMatchObject({ status: 'degraded', checks: { database: 'ok', schema: 'ok', redis: 'ok', scanner: 'unavailable' }, capabilities: { document_analysis: 'UNAVAILABLE' } });
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-h@test.local');
    const org = (await h.http().post('/api/v1/organizations').set(h.as('super@test.local')).send({ name: 'Coop Salud', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: 'admin-h@test.local' }).expect(201)).body.id;
    const producer = (await h.http().post(`/api/v1/organizations/${org}/producers`).set(h.as('admin-h@test.local')).send({ producer_code: 'HS-1', legal_name: 'Finca Salud' }).expect(201)).body.id;
    const doc = (await h.http().post(`/api/v1/organizations/${org}/documents`).set(h.as('admin-h@test.local')).field('operation_id', '11111111-1111-4111-8111-111111111111').field('document_type', 'DELIVERY_SUPPORT').field('owner_type', 'producer').field('owner_id', producer).field('title', 'Soporte sintético')
      .attach('file', Buffer.from('%PDF-1.4\n% sintético\n%%EOF\n'), { filename: 's.pdf', contentType: 'application/pdf' }).expect(201)).body.document;
    expect(doc.versions[0]).toMatchObject({ scan: { status: 'FAILED' }, availability: 'SCAN_FAILED', downloadable: false });
  });
});
