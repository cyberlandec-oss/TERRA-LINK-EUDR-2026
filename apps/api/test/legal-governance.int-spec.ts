import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { describeDb, setupHarness } from './helpers';

describeDb('P1-005 gobernanza legal: autorización, versión, vigencia, retiro y auditoría', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  const past = '2020-01-01';
  const url = 'https://eur-lex.europa.eu/eli/reg/2023/1115/2026-09-18/eng/pdf';
  const control = (status: 'PENDING' | 'ACTIVE' | 'EXPIRED') => ({ code: `CTRL_${status}`, kind: 'LEGAL_BASIS', title: 'Base jurídica de prueba', status, source_reference: 'Prueba controlada', notes: 'Prueba sintética; no es aprobación jurídica.' });

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('governance-super@test.local', 'SUPER_ADMIN');
    await h.user('governance-regular@test.local');
  });
  afterAll(async () => h?.close());

  it('separa administración de catálogo, bloquea controles pendientes, respeta vigencia/retiro y audita', async () => {
    const body = { version: '9.9.1', effective_from: past, source_url: url, purpose: 'Versión sintética para probar gobernanza.', controls: [control('PENDING')] };
    await h.http().get('/api/v1/platform/legal-governance/versions').set(h.as('governance-regular@test.local')).expect(403);
    await h.http().post('/api/v1/platform/legal-governance/versions').set(h.as('governance-regular@test.local')).send(body).expect(403);
    await h.http().post('/api/v1/platform/legal-governance/versions').set(h.as('governance-super@test.local')).send(body).expect(201);
    expect((await h.http().post('/api/v1/platform/legal-governance/versions/9.9.1/decision').set(h.as('governance-super@test.local')).send({ operation_id: randomUUID(), decision: 'APPROVE', basis: 'No se puede aprobar con controles pendientes.' }).expect(422)).body.error.code).toBe('LEGAL_GOVERNANCE_PENDING_CONTROLS');
    await h.db.updateTable('legal_governance_controls').set({ status: 'ACTIVE' }).where('version', '=', '9.9.1').execute();
    await h.http().post('/api/v1/platform/legal-governance/versions/9.9.1/decision').set(h.as('governance-super@test.local')).send({ operation_id: randomUUID(), decision: 'APPROVE', basis: 'Aprobación sintética de prueba controlada.' }).expect(201);
    await h.http().post('/api/v1/platform/legal-governance/versions/9.9.1/decision').set(h.as('governance-super@test.local')).send({ operation_id: randomUUID(), decision: 'RETIRE', basis: 'Retiro sintético para comprobar transición.' }).expect(201);
    const audit = await h.db.selectFrom('audit_logs').select(['action', 'entity_id']).where('entity_id', '=', '9.9.1').orderBy('occurred_at').execute();
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(['legal_governance.create', 'legal_governance.approve', 'legal_governance.retire']));
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM legal_governance_versions WHERE version = '9.9.1'`.execute(h.db)).rows[0].n).toBe(1);
  });

  it('rechaza versiones fuera de vigencia y no permite duplicar una versión inmutable', async () => {
    await h.http().post('/api/v1/platform/legal-governance/versions').set(h.as('governance-super@test.local')).send({ version: '9.9.2', effective_from: '2030-01-01', source_url: url, purpose: 'Versión futura sintética para probar vigencia.', controls: [control('ACTIVE')] }).expect(201);
    expect((await h.http().post('/api/v1/platform/legal-governance/versions/9.9.2/decision').set(h.as('governance-super@test.local')).send({ operation_id: randomUUID(), decision: 'APPROVE', basis: 'No se aprueba fuera de vigencia.' }).expect(422)).body.error.code).toBe('LEGAL_GOVERNANCE_NOT_EFFECTIVE');
    expect((await h.http().post('/api/v1/platform/legal-governance/versions').set(h.as('governance-super@test.local')).send({ version: '9.9.2', effective_from: past, source_url: url, purpose: 'Intento de sustituir versión.', controls: [control('ACTIVE')] }).expect(409)).body.error.code).toBe('LEGAL_GOVERNANCE_VERSION_EXISTS');
  });
});
