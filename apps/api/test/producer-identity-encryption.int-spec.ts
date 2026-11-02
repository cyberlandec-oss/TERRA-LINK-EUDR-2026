import { randomBytes, randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PiiCipher, parsePiiConfig, producerAad, versionAad } from '../src/crypto/pii';
import { createDb, migrateTo, migrateToLatest } from '../src/db/database';
import { PASSWORD, TEST_URL, describeDb, setupHarness } from './helpers';

// Identidad del productor cifrada en reposo (doc 06): sin texto plano en tabla ni historial, AAD por
// registro, búsqueda por índice ciego y migración 0006 sobre datos existentes.
describeDb('identidad del productor cifrada en reposo (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgId: string;
  const DOC = '1307654321';
  const PHONE = '+593 98 765 4321';
  const ADDRESS = 'Vía a Calceta km 4';

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin@test.local');
    orgId = (await h.http().post('/api/v1/organizations').set(h.as('super@test.local'))
      .send({ name: 'Org cifrado', organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: 'admin@test.local' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('alta y edición: la base no contiene identidad en claro; la API la devuelve a quien tiene permiso', async () => {
    const base = `/api/v1/organizations/${orgId}/producers`;
    const p = await h.http().post(base).set(h.as('admin@test.local'))
      .send({ producer_code: 'ENC-1', first_name: 'Marta', last_name: 'Loor', document_type: 'CEDULA', document_number: DOC, phone: PHONE, address: ADDRESS }).expect(201);
    await h.http().patch(`${base}/${p.body.id}`).set(h.as('admin@test.local')).send({ expected_version: 1, phone: '+593 97 000 1111' }).expect(200);
    const dump = JSON.stringify(await sql`SELECT * FROM producers`.execute(h.db)) + JSON.stringify(await sql`SELECT * FROM producer_versions`.execute(h.db))
      + JSON.stringify(await sql`SELECT * FROM domain_events`.execute(h.db)) + JSON.stringify(await sql`SELECT * FROM audit_logs`.execute(h.db));
    for (const plain of [DOC, PHONE, ADDRESS, '000 1111', 'CEDULA']) expect(dump).not.toContain(plain);
    const cols = await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_name = 'producers'`.execute(h.db);
    expect(cols.rows.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(['document_number']));
    const got = await h.http().get(`${base}/${p.body.id}`).set(h.as('admin@test.local')).expect(200);
    expect(got.body).toMatchObject({ document_number: DOC, phone: '+593 97 000 1111', address: ADDRESS });
    const hist = await h.http().get(`${base}/${p.body.id}/history`).set(h.as('admin@test.local')).expect(200);
    expect(hist.body.find((v: { version: number }) => v.version === 1).snapshot.phone).toBe(PHONE);
    // Búsqueda exacta por documento con otro formato (índice ciego + normalización).
    const found = await h.http().get(`${base}?q=130-765.4321`).set(h.as('admin@test.local')).expect(200);
    expect(found.body.items.map((x: { id: string }) => x.id)).toEqual([p.body.id]);
  });

  it('un texto cifrado trasladado a otro productor no se descifra (AAD por registro)', async () => {
    const base = `/api/v1/organizations/${orgId}/producers`;
    const a = (await h.http().post(base).set(h.as('admin@test.local')).send({ producer_code: 'ENC-A', legal_name: 'A', phone: '+593 91 111 1111' }).expect(201)).body.id;
    const b = (await h.http().post(base).set(h.as('admin@test.local')).send({ producer_code: 'ENC-B', legal_name: 'B' }).expect(201)).body.id;
    await sql`UPDATE producers SET phone_enc = (SELECT phone_enc FROM producers WHERE id = ${a}) WHERE id = ${b}`.execute(h.db);
    await h.http().get(`${base}/${b}`).set(h.as('admin@test.local')).expect(500);
  });
});

describeDb('migración 0006 sobre datos de identidad existentes', () => {
  const db = createDb(TEST_URL!);
  const saved = { k: process.env.PII_KEYS, a: process.env.PII_ACTIVE_KEY_ID, i: process.env.PII_INDEX_KEY };
  const restore = () => {
    for (const [name, v] of [['PII_KEYS', saved.k], ['PII_ACTIVE_KEY_ID', saved.a], ['PII_INDEX_KEY', saved.i]] as const) {
      if (v === undefined) delete process.env[name]; else process.env[name] = v;
    }
  };
  afterAll(async () => {
    restore();
    await db.destroy();
  });

  async function seedAt0005() {
    await sql`DROP SCHEMA IF EXISTS public CASCADE`.execute(db);
    await sql`CREATE SCHEMA public`.execute(db);
    await migrateTo(db, '0005_producers');
    const user = randomUUID();
    const org = randomUUID();
    const producer = randomUUID();
    await sql`INSERT INTO users (id, email, first_name, last_name, status) VALUES (${user}, 'm@test.local', 'M', 'T', 'ACTIVE')`.execute(db);
    await sql`INSERT INTO organizations (id, name, organization_type, country, status, created_by, updated_by) VALUES (${org}, 'O', 'ASSOCIATION', 'EC', 'ACTIVE', ${user}, ${user})`.execute(db);
    await sql`INSERT INTO producers (id, organization_id, producer_code, legal_name, document_type, document_number, phone, status, created_by, updated_by)
      VALUES (${producer}, ${org}, 'OLD-1', 'Finca vieja', 'RUC', '1390012345001', '+593 5 260 0000', 'ACTIVE', ${user}, ${user})`.execute(db);
    await sql`INSERT INTO producer_versions (organization_id, producer_id, version, change_type, changed_fields, snapshot, changed_by)
      VALUES (${org}, ${producer}, 1, 'CREATE', '{}', ${JSON.stringify({ document_type: 'RUC', document_number: '1390012345001', phone: '+593 5 260 0000', address: null })}::jsonb, ${user})`.execute(db);
    return { org, producer };
  }

  it('sin claves PII se detiene sin cambios; con claves cifra tabla e historial y elimina el texto plano', async () => {
    const { org, producer } = await seedAt0005();
    delete process.env.PII_KEYS;
    delete process.env.PII_ACTIVE_KEY_ID;
    delete process.env.PII_INDEX_KEY;
    await expect(migrateToLatest(db)).rejects.toThrow(/PII_KEYS/);
    const still = await sql<{ document_number: string }>`SELECT document_number FROM producers WHERE id = ${producer}`.execute(db);
    expect(still.rows[0].document_number).toBe('1390012345001'); // transacción revertida: nada perdido

    const env = { PII_KEYS: `m1:${randomBytes(32).toString('base64')}`, PII_ACTIVE_KEY_ID: 'm1', PII_INDEX_KEY: randomBytes(32).toString('base64') };
    Object.assign(process.env, env);
    await migrateToLatest(db);
    const cipher = new PiiCipher(parsePiiConfig(env)!);
    const row = (await sql<Record<string, string>>`SELECT * FROM producers WHERE id = ${producer}`.execute(db)).rows[0];
    expect(row.document_number).toBeUndefined();
    expect(cipher.decrypt(row.document_number_enc, producerAad(org, producer, 'document_number'))).toBe('1390012345001');
    expect(cipher.decrypt(row.phone_enc, producerAad(org, producer, 'phone'))).toBe('+593 5 260 0000');
    const snap = (await sql<{ snapshot: Record<string, string | null> }>`SELECT snapshot FROM producer_versions WHERE producer_id = ${producer}`.execute(db)).rows[0].snapshot;
    expect(JSON.stringify(snap)).not.toContain('1390012345001');
    expect(cipher.decrypt(snap.document_number_enc!, versionAad(org, producer, '1', 'document_number'))).toBe('1390012345001');
    // El historial vuelve a ser append-only tras la migración.
    await expect(sql`DELETE FROM producer_versions`.execute(db)).rejects.toThrow(/append-only/);
    restore();
    void PASSWORD;
  });
});
