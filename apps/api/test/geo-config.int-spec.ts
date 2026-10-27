import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// GEOLOCATION_PROFILE — configuración versionada de reglas, su revisión, su adopción y su aplicación al expediente. PostgreSQL real, datos SINTÉTICOS aislados.
// Toda configuración «revisada» de esta suite es sintética y vive en la base de prueba: no se aprueba ninguna configuración real. Se demuestra: caso positivo con datos
// completos; datos ausentes, incompatibles u obsoletos; configuración ausente, sin revisar o fuera de alcance; objeción o retirada posterior; aislamiento entre
// organizaciones; y conservación histórica/obsolescencia de instantáneas. Ninguna condición técnica es una conclusión regulatoria ni habilita READY.
describeDb('GEOLOCATION_PROFILE: configuración versionada de reglas', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = ''; let orgB = ''; let producer = ''; let baba = ''; let center = '';
  const SUPER = 'geo-super@test.local'; const ADMIN = 'geo-admin-a@test.local'; const ADMIN_B = 'geo-admin-b@test.local'; const E1 = 'geo-eudr@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const P = '/api/v1/platform/geolocation-config';
  const today = new Date().toISOString().slice(0, 10);
  const point = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });

  async function mkPlot(code: string, geometry: unknown | null, declared: number) {
    const id = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: code, crop: 'Cacao' }).expect(201)).body.id as string;
    await http().post(`${base(orgA)}/plots/${id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: geometry ? 'MANUAL_COORDINATES' : 'DECLARED', ...(geometry ? { geometry } : {}), area_declared_ha: declared }).expect(201);
    return id;
  }
  const evaluar = (plot: string) => http().post(`${base(orgA)}/plots/${plot}/geo-profile/evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);
  async function lotFrom(plots: string[]) {
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '30', unit: 'KG', origins: plots.map((p) => ({ plot_id: p })), register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: '30', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    const lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: '30' }] }).expect(201)).body.lot.id as string;
    await http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201);
    return lot;
  }
  const mkCase = async (lot: string) => (await http().post(`${base(orgA)}/dd-cases`).set(as(E1)).send({ operation_id: randomUUID(), lot_id: lot, scope_note: 'Expediente sintético de configuración de geolocalización' }).expect(201)).body.case.id as string;
  const capture = async (caseId: string) => (await http().post(`${base(orgA)}/dd-cases/${caseId}/snapshots`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
  const req = (s: { requirements: Array<{ code: string; status: string; detail: string; references: string[] }> }) => s.requirements.find((r) => r.code === 'GEOLOCATION_PROFILE')!;

  const fuente = { code: 'REG-SINT', title: 'Fuente sintética de prueba', citation: 'Artículo sintético', url: 'https://example.test/regla', file_sha256: 'b'.repeat(64) };
  const reglaTec = { code: 'GEO-TECH', kind: 'GEO_TECH_PROFILE', status: 'ACTIVE', source_code: 'REG-SINT', article: 'Artículo sintético', criterion: 'Cada parcela de origen tiene una evaluación vigente del perfil técnico que cumple.' };
  const preparar = (over: Record<string, unknown> = {}, actor = SUPER) => http().post(`${P}/versions`).set(as(actor)).send({
    operation_id: randomUUID(), version: '9.0.0', technical_profile_version: '1.0.0', scope_note: 'Configuración sintética de prueba, sin valor jurídico', reason: 'Preparación sintética de ensayo',
    sources: [fuente], rules: [reglaTec], ...over });
  const revisar = (over: Record<string, unknown> = {}, actor = SUPER) => http().post(`${P}/reviews`).set(as(actor)).send({
    operation_id: randomUUID(), version: '9.0.0', decision: 'REVIEWED', reviewer_name: 'Persona sintética de prueba', reviewer_capacity: 'Responsable sintético (fixture)', reviewed_on: today,
    basis: 'Fundamento sintético de prueba: no acredita ninguna revisión real', supports: [{ kind: 'CONFIG_SOURCE', source_code: 'REG-SINT' }], applicable_organizations: [orgA], applicability_note: 'Operación sintética de ensayo', ...over });
  const adoptar = (org: string, actor: string, version: string, decision = 'ADOPT') => http().post(`${base(org)}/geolocation-config/adoptions`).set(as(actor)).send({ operation_id: randomUUID(), version, decision, reason: 'Adopción sintética de ensayo' });
  const lista = async () => (await http().get(`${P}/versions`).set(as(SUPER)).expect(200)).body.configs as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const vigente = async (v: string) => (await lista()).find((c) => c.version === v)!.current_review?.id ?? null;
  const contar = async (t: string) => Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)}`.execute(h.db)).rows[0].n);

  let lotA = ''; let caseA = ''; let plot1 = ''; let plot2 = '';

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN'); await h.user(ADMIN); await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER)).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id as string;
    orgA = await mk('Coop Geo A', ADMIN); orgB = await mk('Coop Geo B', ADMIN_B);
    const inv = await http().post(`${base(orgA)}/invitations`).set(as(ADMIN)).send({ email: E1, role_code: 'EUDR_MANAGER' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: 'Eudr', password: PASSWORD }).expect(200);
    await h.login(E1);
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'GC-1', legal_name: 'Finca Config Sintética' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CGC', name: 'Centro GC', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    plot1 = await mkPlot('GC-OK1', point(-80.1601, -0.8479), 2); plot2 = await mkPlot('GC-OK2', point(-80.1701, -0.8579), 2);
    await evaluar(plot1); await evaluar(plot2);
    lotA = await lotFrom([plot1, plot2]); caseA = await mkCase(lotA);
  }, 240_000);
  afterAll(async () => { await h?.close(); });

  it('permisos: solo la plataforma prepara y revisa; la organización consulta y adopta con sus facultades; sin pasar por otros roles (control autorizado incluido)', async () => {
    await http().get(`${P}/versions`).set(as(ADMIN)).expect(403);
    await preparar({}, ADMIN).expect(403);
    await revisar({ version: '0.1.0' }, ADMIN).expect(403);
    expect((await http().get(`${P}/versions`).set(as(SUPER)).expect(200)).body.configs.length).toBeGreaterThanOrEqual(1);
    await http().get(`${base(orgA)}/geolocation-config/catalog`).set(as(ADMIN)).expect(200);
    await adoptar(orgA, E1, '0.1.0').expect(403); // EUDR_MANAGER no adopta (risk:approve_rules)
  });

  it('la configuración candidata sembrada 0.1.0: reglas explícitas, una activa y dos candidatas con sus preguntas, sin revisión ni adopción', async () => {
    const c = (await lista()).find((x) => x.version === '0.1.0')!;
    expect(c.technical_profile_id).toBe('EUDR_GEO_V1');
    expect(c.rules.map((r: { code: string; status: string }) => `${r.code}:${r.status}`).sort()).toEqual(['GEO-PRODUCTION-COUNTRY:CANDIDATE', 'GEO-PRODUCTION-PERIOD:CANDIDATE', 'GEO-TECH-PROFILE:ACTIVE']);
    expect(c.rules.filter((r: { status: string }) => r.status === 'CANDIDATE').every((r: { pending_questions: string }) => r.pending_questions.length >= 10)).toBe(true);
    expect(c.status).toBe('NONE');
    expect(c.gaps).toEqual(expect.arrayContaining(['NO_REVIEW', 'CANDIDATE_RULES_PENDING']));
    expect(await contar('geo_requirement_config_adoptions')).toBe(0);
    const s = await capture(caseA);
    expect(req(s).status).toBe('NOT_EVALUABLE'); // estado real conservado: sin configuración adoptada
    expect(req(s).detail).toMatch(/no ha adoptado ninguna configuración/);
  });

  it('preparar: se rechazan sin escribir una regla activa de período/país, una candidata sin preguntas, una fuente desconocida, otro perfil técnico, códigos repetidos y versión existente', async () => {
    const antes = await contar('geo_requirement_configs');
    const cand = { code: 'GEO-PER', kind: 'PRODUCTION_PERIOD', status: 'CANDIDATE', source_code: 'REG-SINT', article: 'Art. sintético', criterion: 'Periodo de producción por parcela, sintético.' };
    expect((await preparar({ rules: [{ ...cand, status: 'ACTIVE' }] }).expect(422)).body.error.code).toBe('CONFIG_RULE_NOT_APPLICABLE');
    expect((await preparar({ rules: [reglaTec, cand] }).expect(422)).body.error.code).toBe('CONFIG_CANDIDATE_QUESTIONS_REQUIRED');
    expect((await preparar({ rules: [{ ...reglaTec, source_code: 'NO-EXISTE' }] }).expect(422)).body.error.code).toBe('CONFIG_RULE_SOURCE_UNKNOWN');
    expect((await preparar({ technical_profile_version: '2.0.0' }).expect(422)).body.error.code).toBe('TECHNICAL_PROFILE_MISMATCH');
    expect((await preparar({ rules: [reglaTec, reglaTec] }).expect(422)).body.error.code).toBe('CONFIG_DUPLICATE_CODE');
    expect((await preparar({ version: '0.1.0' }).expect(409)).body.error.code).toBe('CONFIG_VERSION_EXISTS');
    await preparar({ sources: [], rules: [reglaTec] }).expect(400);
    expect(await contar('geo_requirement_configs')).toBe(antes);
  });

  it('preparar 9.0.0 (solo regla activa): queda inmutable y SIN revisión; la base impide reglas activas de tipos no evaluables', async () => {
    const r = await preparar().expect(201);
    expect(r.body.replayed).toBe(false);
    const op = randomUUID();
    await preparar({ operation_id: op, version: '9.0.1' }).expect(201);
    expect((await preparar({ operation_id: op, version: '9.0.1' }).expect(201)).body.replayed).toBe(true);
    await preparar({ operation_id: op, version: '9.0.2' }).expect(409);
    await expect(sql`UPDATE geo_requirement_configs SET scope_note = 'reescrita intencionalmente'`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`INSERT INTO geo_requirement_config_rules (version, code, kind, status, source_code, article, criterion) VALUES ('9.0.0','GEO-X','PRODUCTION_COUNTRY','ACTIVE','REG-SINT','Art. sintético','Criterio sintético de prueba')`.execute(h.db)).rejects.toThrow();
    const c = (await lista()).find((x) => x.version === '9.0.0')!;
    expect(c.status).toBe('NONE');
    expect(c.gaps).toEqual(['NO_REVIEW']);
  });

  it('CONFIGURACIÓN SIN REVISAR adoptada: el requisito sigue NOT_EVALUABLE; adoptar no la revisa ni la declara aplicable; idempotencia y conflictos', async () => {
    const op = randomUUID();
    const a = await http().post(`${base(orgA)}/geolocation-config/adoptions`).set(as(ADMIN)).send({ operation_id: op, version: '9.0.0', decision: 'ADOPT', reason: 'Adopción sintética de ensayo' }).expect(201);
    expect((await http().post(`${base(orgA)}/geolocation-config/adoptions`).set(as(ADMIN)).send({ operation_id: op, version: '9.0.0', decision: 'ADOPT', reason: 'Adopción sintética de ensayo' }).expect(201)).body.replayed).toBe(true);
    expect(a.body.note).toMatch(/Adoptar no revisa/);
    expect((await adoptar(orgA, ADMIN, '9.0.0').expect(409)).body.error.code).toBe('ALREADY_ADOPTED');
    expect((await adoptar(orgA, ADMIN, '9.0.1', 'WITHDRAW').expect(409)).body.error.code).toBe('NOT_ADOPTED');
    expect((await adoptar(orgA, ADMIN, '8.8.8').expect(422)).body.error.code).toBe('CONFIG_UNKNOWN');
    const s = await capture(caseA);
    expect(req(s).status).toBe('NOT_EVALUABLE');
    expect(req(s).detail).toMatch(/ninguna revisión registrada/);
  });

  it('REVISADA PERO FUERA DE ALCANCE: declarada aplicable solo a OTRA organización → NOT_EVALUABLE para esta; la otra no ve a quién más se declaró', async () => {
    await revisar({ applicable_organizations: [orgB], expected_current_review_id: null }).expect(201);
    const s = await capture(caseA);
    expect(req(s).status).toBe('NOT_EVALUABLE');
    expect(req(s).detail).toMatch(/NO la declara aplicable a esta organización/);
    // aislamiento: la vista de cada organización dice solo si la incluye a ELLA; nunca lista las demás
    const vistaA = (await http().get(`${base(orgA)}/geolocation-config/catalog`).set(as(ADMIN)).expect(200)).body;
    const vistaB = (await http().get(`${base(orgB)}/geolocation-config/catalog`).set(as(ADMIN_B)).expect(200)).body;
    const cA = vistaA.configs.find((c: { version: string }) => c.version === '9.0.0'); const cB = vistaB.configs.find((c: { version: string }) => c.version === '9.0.0');
    expect(cA.current_review.applies_to_this_organization).toBe(false);
    expect(cB.current_review.applies_to_this_organization).toBe(true);
    expect(JSON.stringify(vistaA)).not.toContain(orgB);
    expect(JSON.stringify(vistaB)).not.toContain(orgA);
    expect(cA.gaps).toContain('NOT_APPLICABLE_TO_ORGANIZATION');
    expect(vistaA.adopted).toBe('9.0.0'); expect(vistaB.adopted).toBeNull(); // la adopción de A no cruza a B
    await http().get(`${base(orgB)}/geolocation-config/catalog`).set(as(ADMIN)).expect(404); // A no consulta a B
    await http().post(`${base(orgB)}/geolocation-config/adoptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), version: '9.0.0', decision: 'ADOPT', reason: 'Intento cruzado' }).expect(404);
  });

  let snapMet: { id: string; readiness: { effective: string; captured: string }; requirements: Array<{ code: string; status: string; detail: string; references: string[] }> };
  it('CASO POSITIVO SINTÉTICO: revisada, aplicable y con datos completos → MET (condición técnica); queda registrado qué configuración, revisión y evaluaciones lo sustentan', async () => {
    const actual = await vigente('9.0.0');
    const rev = await revisar({ applicable_organizations: [orgA, orgB], expected_current_review_id: actual }).expect(201);
    snapMet = await capture(caseA);
    expect(req(snapMet).status).toBe('MET');
    expect(req(snapMet).references.sort()).toEqual([plot1, plot2].sort());
    expect(snapMet.readiness.captured).not.toBe('READY'); // MET de un requisito no es estar listo
    expect(snapMet.requirements.find((r) => r.code === 'REGULATORY_CONCLUSION')!.status).toBe('NOT_EVALUABLE');
    // Trazabilidad en el contenido de la instantánea
    const contenido = (await sql<{ content: { profiles: { geolocation_profile: { config_version: string; review: { id: string; decision: string }; applicable_to_organization: boolean; plots: Array<{ plot_id: string; evaluation_id: string; status: string; plot_version_id: string }> } } } }>`
      SELECT content FROM dd_snapshots WHERE id = ${snapMet.id}`.execute(h.db)).rows[0].content.profiles.geolocation_profile;
    expect(contenido).toMatchObject({ config_version: '9.0.0', review: { id: rev.body.review.id, decision: 'REVIEWED' }, applicable_to_organization: true });
    expect(contenido.plots).toHaveLength(2);
    expect(contenido.plots.every((p) => p.evaluation_id && p.status === 'MEETS_PROFILE' && p.plot_version_id)).toBe(true);
  });

  it('DATOS: parcela sin evaluación vigente o con geometría nueva → PENDING; no cumple → INVALID; sin geometría → NOT_EVALUABLE; un cambio posterior vuelve obsoleta la instantánea', async () => {
    const pendiente = await mkPlot('GC-NEVER', point(-80.18, -0.86), 2); // nunca evaluada
    const falla = await mkPlot('GC-FAILS', point(-80.17, -0.85), 5); await evaluar(falla); // punto > 4 ha: exige polígono
    const sinGeo = await mkPlot('GC-NOGEO', null, 2); await evaluar(sinGeo);
    for (const [plot, esperado] of [[pendiente, 'PENDING'], [falla, 'INVALID'], [sinGeo, 'NOT_EVALUABLE']] as const) {
      const c = await mkCase(await lotFrom([plot]));
      expect(req(await capture(c)).status).toBe(esperado);
    }
    // geometría nueva en una parcela que cumplía: la evaluación anterior ya no es vigente
    const rv = Number((await sql<{ row_version: string }>`SELECT row_version FROM plots WHERE id = ${plot1}`.execute(h.db)).rows[0].row_version);
    await http().post(`${base(orgA)}/plots/${plot1}/geometry-versions`).set(as(ADMIN)).send({ expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: point(-80.2, -0.9), area_declared_ha: 2 }).expect(201);
    const detalle = (await http().get(`${base(orgA)}/dd-snapshots/${snapMet.id}`).set(as(E1)).expect(200)).body;
    expect(detalle.readiness.effective).toBe('STALE'); // la instantánea que decía MET queda desactualizada...
    expect(req(detalle).status).toBe('MET'); // ...pero lo capturado no se reescribe
    const nueva = await capture(caseA);
    expect(req(nueva).status).toBe('PENDING');
    expect(req(nueva).detail).toMatch(/sin evaluación vigente/);
    await evaluar(plot1); // se restablece con una evaluación de la versión nueva
    expect(req(await capture(caseA)).status).toBe('MET');
  });

  it('OBJECIÓN posterior: la instantánea previa queda desactualizada y conserva lo capturado; la nueva es NOT_EVALUABLE; la retirada solo aplica a una favorable; se restablece sin reescribir', async () => {
    const previa = await capture(caseA);
    expect(req(previa).status).toBe('MET');
    const antes = (await lista()).find((c) => c.version === '9.0.0')!.history.length;
    const obj = await revisar({ decision: 'OBJECTED', basis: 'Objeción sintética: el criterio no es suficiente', supports: [], expected_current_review_id: await vigente('9.0.0') }).expect(201);
    const hist = (await http().get(`${base(orgA)}/dd-snapshots/${previa.id}`).set(as(E1)).expect(200)).body;
    expect(hist.readiness.effective).toBe('STALE');
    expect(req(hist).status).toBe('MET');
    const nueva = await capture(caseA);
    expect(req(nueva).status).toBe('NOT_EVALUABLE');
    expect(req(nueva).detail).toMatch(/objetada/);
    const c = (await lista()).find((x) => x.version === '9.0.0')!;
    expect(c.history).toHaveLength(antes + 1);
    expect(c.history.filter((h2: { is_current: boolean }) => h2.is_current)).toHaveLength(1);
    expect(c.current_review.id).toBe(obj.body.review.id);
    expect((await revisar({ decision: 'WITHDRAWN', basis: 'Retirada sin revisión favorable vigente', supports: [], expected_current_review_id: await vigente('9.0.0') }).expect(422)).body.error.code).toBe('NOTHING_TO_WITHDRAW');
    await revisar({ basis: 'Nueva revisión favorable sintética tras subsanar', applicable_organizations: [orgA], expected_current_review_id: await vigente('9.0.0') }).expect(201);
    expect(req(await capture(caseA)).status).toBe('MET');
    await revisar({ decision: 'WITHDRAWN', basis: 'Retirada sintética de la revisión favorable', supports: [], applicable_organizations: [], expected_current_review_id: await vigente('9.0.0') }).expect(201);
    const retirada = await capture(caseA);
    expect(req(retirada).status).toBe('NOT_EVALUABLE');
    expect(req(retirada).detail).toMatch(/retirada/);
  });

  it('REVISIÓN DE OTRO OBJETO: la revisión de la configuración no es la del perfil jurídico y viceversa; revisar la una no cambia la otra', async () => {
    const legalAntes = await contar('legal_profile_reviews');
    expect(legalAntes).toBe(0); // ninguna de las revisiones geográficas creó una revisión jurídica
    await http().post('/api/v1/platform/legal-profile/reviews').set(as(SUPER)).send({
      operation_id: randomUUID(), version: '0.1.0', decision: 'OBJECTED', reviewer_name: 'Persona sintética de prueba', reviewer_capacity: 'Fixture', reviewed_on: today,
      basis: 'Objeción jurídica sintética que no debe afectar a la configuración geográfica', supports: [], expected_current_review_id: null }).expect(201);
    const c = (await lista()).find((x) => x.version === '9.0.0')!;
    expect(c.status).toBe('WITHDRAWN'); // sin cambio por la revisión jurídica
    expect(await contar('geo_requirement_config_reviews')).toBeGreaterThanOrEqual(5);
  });

  it('REGLAS CANDIDATAS: la 0.1.0 revisada, aplicable y adoptada deja el requisito PENDING (nunca MET) y lista las reglas candidatas; no se deduce período ni país', async () => {
    await adoptar(orgA, ADMIN, '9.0.0', 'WITHDRAW').expect(201);
    await adoptar(orgA, ADMIN, '0.1.0').expect(201);
    await revisar({ version: '0.1.0', supports: [{ kind: 'CONFIG_SOURCE', source_code: 'REG-2023-1115' }], applicable_organizations: [orgA], expected_current_review_id: null }).expect(201);
    const s = await capture(caseA);
    expect(req(s).status).toBe('PENDING');
    expect(req(s).detail).toContain('CANDIDATAS sin resolver (GEO-PRODUCTION-COUNTRY, GEO-PRODUCTION-PERIOD)');
    expect(s.readiness.captured).not.toBe('READY');
  });

  it('no se concede nada más: ningún permiso de concluir y la conclusión sigue UNDETERMINED; la API no admite campos de actor', async () => {
    expect(Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_evaluations WHERE conclusion <> 'UNDETERMINED'`.execute(h.db)).rows[0].n)).toBe(0);
    await http().post(`${P}/reviews`).set(as(SUPER)).send({ operation_id: randomUUID(), version: '0.1.0', decision: 'REVIEWED', recorded_by: 'otro' }).expect(400);
  });
});
