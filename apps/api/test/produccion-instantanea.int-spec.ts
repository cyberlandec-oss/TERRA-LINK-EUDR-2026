import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { produccionDeContenido } from '../src/sharing/indicadores';

// Período y país de producción en la INSTANTÁNEA, contra PostgreSQL real. Datos SINTÉTICOS.
// Lo que se demuestra: el período sale de la cosecha declarada en cada entrega (nunca de la fecha de entrega); el país es una declaración explícita por parcela
// de origen, versionada y de solo añadir; lo declarado, lo declarado como desconocido y lo sin declarar quedan separados (con varios orígenes, períodos distintos y un
// origen desconocido); la instantánea fija las versiones, una corrección posterior no cambia las anteriores y desactualiza la vigente; el comprador solo lo ve con concesión.
describeDb('período y país de producción en la instantánea', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = ''; let orgB = '';
  let externoId = '';
  const plots: Record<string, string> = {}; const entregas: Record<string, { id: string; v: number }> = {};
  let caso: { id: string }; let snap1: { id: string }; let loteId = '';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local'; const ADMIN_B = 'admin-b@test.local';
  const EXTERNO = 'comprador-prod@test.local'; const OTRO = 'otro-comprador-prod@test.local'; const TEC = 'tecnico-prod@test.local';
  const futuro = (dias = 7) => new Date(Date.now() + dias * 86400000).toISOString();
  const punto = (i: number) => ({ type: 'Point', coordinates: [-80.1 - i * 0.01, -0.8] });

  async function join(o: string, email: string, role: string, admin: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const pais = (plot: string, body: Record<string, unknown>, actor = ADMIN) => http().post(`${base(orgA)}/plots/${plot}/production-country`).set(as(actor)).send({ operation_id: randomUUID(), ...body });
  const conceder = (cuerpo: Record<string, unknown>) => http().post(`${base(orgA)}/access-grants`).set(as(ADMIN)).send({ operation_id: randomUUID(), grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap1.id, expires_at: futuro(), reason: 'Producción de la instantánea', ...cuerpo });
  const snapshotDe = async (id: string) => (await sql<{ content: { deliveries: Array<{ code: string; harvest?: { precision: string; start: string | null; correction_number: number } }>; plots: Array<{ plot_code: string; production_country?: { declaration_number: number; country: string | null } }> } }>`SELECT content FROM dd_snapshots WHERE id = ${id}`.execute(h.db)).rows[0].content;

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN'); await h.user(ADMIN); await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Producción A', ADMIN); orgB = await mk('Coop Producción B', ADMIN_B);
    await join(orgA, TEC, 'FIELD_TECHNICIAN', ADMIN);
    await join(orgB, EXTERNO, 'BUYER', ADMIN_B); await join(orgB, OTRO, 'BUYER', ADMIN_B);
    externoId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${EXTERNO}`.execute(h.db)).rows[0].id;
    const baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const centro = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'C-PR', name: 'Centro PR', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    const productor = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'PR-P', legal_name: 'Finca Producción' }).expect(201)).body.id;
    // Cuatro orígenes: cosecha por DÍA, por MES, declarada como DESCONOCIDA y SIN declarar.
    const cosechas: Array<[string, Record<string, unknown> | undefined]> = [
      ['D', { precision: 'DAY', start: '2026-03-10', end: '2026-03-10' }], ['M', { precision: 'MONTH', start: '2026-05', end: '2026-05' }],
      ['U', { precision: 'UNKNOWN' }], ['N', undefined],
    ];
    const recs: string[] = [];
    let i = 0;
    for (const [k, harvest] of cosechas) {
      const p = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: productor, plot_code: `PR-${k}`, crop: 'Cacao' }).expect(201)).body.id;
      await http().post(`${base(orgA)}/plots/${p}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: punto(i++), area_declared_ha: 1 }).expect(201);
      plots[k] = p;
      const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: productor, product_id: baba, delivery_date: today, quantity_declared: '10', unit: 'KG', origins: [{ plot_id: p }], ...(harvest ? { harvest_period: harvest } : {}), register: true }).expect(201)).body.delivery;
      entregas[k] = { id: d.id, v: d.row_version };
      recs.push((await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(), weighing: { method: 'Báscula sintética', quantity: '10', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id);
    }
    const lote = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: recs.map((r) => ({ reception_id: r, quantity: '10' })) }).expect(201)).body.lot.id;
    loteId = lote;
    caso = (await http().post(`${base(orgA)}/dd-cases`).set(as(ADMIN)).send({ operation_id: randomUUID(), lot_id: lote, scope_note: 'Producción por origen' }).expect(201)).body.case;
  });
  afterAll(async () => h?.close());

  it('declarar el país: explícito, idempotente, versionado y de solo añadir; sin declaración no hay país (ni «Ecuador» por omisión)', async () => {
    const vacio = (await http().get(`${base(orgA)}/plots/${plots.D}/production-country`).set(as(ADMIN)).expect(200)).body;
    expect(vacio.current).toMatchObject({ state: 'NOT_DECLARED', declaration_number: 0, country: null });
    expect(vacio.history).toEqual([]);
    const op = randomUUID();
    const a = (await pais(plots.D, { operation_id: op, expected_declaration_number: 0, country: 'EC', note: 'Declarado por la administración' }).expect(200)).body;
    expect(a.current).toMatchObject({ state: 'DECLARED', country: 'EC', declaration_number: 1 });
    expect(a.current.declared_by).toMatch(/\S/);
    // Reintento idempotente: misma operación → misma respuesta, sin segunda fila.
    const rep = await pais(plots.D, { operation_id: op, expected_declaration_number: 0, country: 'EC' }).expect(200);
    expect(rep.body.replayed).toBe(true);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM plot_production_declarations WHERE plot_id = ${plots.D}`.execute(h.db)).rows[0].n).toBe(1);
    // La misma operación con otro contenido se rechaza; sin cambio y versión obsoleta también.
    expect((await pais(plots.D, { operation_id: op, expected_declaration_number: 0, country: 'PE' }).expect(409)).body.error.code).toBe('OPERATION_ID_REUSED');
    expect((await pais(plots.D, { expected_declaration_number: 1, country: 'EC' }).expect(409)).body.error.code).toBe('NO_CHANGE');
    expect((await pais(plots.D, { expected_declaration_number: 0, country: 'PE' }).expect(409)).body.error.code).toBe('VERSION_CONFLICT');
    // Formato: dos letras mayúsculas o null.
    await pais(plots.M, { expected_declaration_number: 0, country: 'ec' }).expect(400);
    await pais(plots.M, { expected_declaration_number: 0, country: 'ECU' }).expect(400);
    await pais(plots.M, { expected_declaration_number: 0 }).expect(400);
    // El resto de los orígenes: M → PE; U → «declarado como desconocido» (null); N queda SIN declarar.
    await pais(plots.M, { expected_declaration_number: 0, country: 'PE' }).expect(200);
    const u = (await pais(plots.U, { expected_declaration_number: 0, country: null, note: 'La cooperativa no sabe dónde se cosechó' }).expect(200)).body;
    expect(u.current).toMatchObject({ state: 'DECLARED_UNKNOWN', country: null, declaration_number: 1 });
    expect((await http().get(`${base(orgA)}/plots/${plots.N}/production-country`).set(as(ADMIN)).expect(200)).body.current.state).toBe('NOT_DECLARED');
    // De solo añadir: ni siquiera con acceso directo a la base se edita o borra.
    await expect(sql`UPDATE plot_production_declarations SET country = 'CO' WHERE plot_id = ${plots.D}`.execute(h.db)).rejects.toThrow(/solo se agregan/);
    await expect(sql`DELETE FROM plot_production_declarations WHERE plot_id = ${plots.D}`.execute(h.db)).rejects.toThrow(/solo se agregan/);
  });

  it('alcance: quien no puede editar la parcela no declara (control autorizado arriba); fuera de la organización no existe', async () => {
    // El técnico NO está asignado al productor: no ve la parcela → 404, igual que un identificador inexistente.
    await pais(plots.N, { expected_declaration_number: 0, country: 'EC' }, TEC).expect(404);
    await http().get(`${base(orgA)}/plots/${plots.N}/production-country`).set(as(TEC)).expect(404);
    // Un comprador de otra organización: sin pertenencia no hay ruta.
    expect([403, 404]).toContain((await pais(plots.N, { expected_declaration_number: 0, country: 'EC' }, EXTERNO)).status);
    expect([403, 404]).toContain((await http().get(`${base(orgA)}/plots/${plots.N}/production-country`).set(as(EXTERNO))).status);
    expect((await http().get(`${base(orgA)}/plots/${plots.N}/production-country`).set(as(ADMIN)).expect(200)).body.current.state).toBe('NOT_DECLARED');
    await pais(randomUUID(), { expected_declaration_number: 0, country: 'EC' }).expect(404);
  });

  it('la instantánea fija la cosecha efectiva por entrega y el país por parcela; lo sin declarar no lleva clave (no se funde en un intervalo)', async () => {
    snap1 = (await http().post(`${base(orgA)}/dd-cases/${caso.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
    const c = await snapshotDe(snap1.id);
    const h4 = Object.fromEntries(c.deliveries.map((d) => [d.code, d.harvest]));
    const codigos = c.deliveries.map((d) => d.code);
    expect(codigos).toHaveLength(4);
    expect(Object.values(h4).filter(Boolean)).toHaveLength(3);
    expect(Object.values(h4).filter((x) => x === undefined)).toHaveLength(1); // la entrega sin declaración no lleva clave
    expect(Object.values(h4).map((x) => x?.precision).filter(Boolean).sort()).toEqual(['DAY', 'MONTH', 'UNKNOWN']);
    expect(Object.values(h4).filter(Boolean).every((x) => x!.correction_number === 0)).toBe(true);
    const pc = Object.fromEntries(c.plots.map((p) => [p.plot_code, p.production_country]));
    expect(pc['PR-D']).toMatchObject({ country: 'EC', declaration_number: 1 });
    expect(pc['PR-M']).toMatchObject({ country: 'PE', declaration_number: 1 });
    expect(pc['PR-U']).toMatchObject({ country: null, declaration_number: 1 }); // declarado desconocido: la clave existe y el país es null
    expect(pc['PR-N']).toBeUndefined(); // sin declarar: no existe la clave
    // Ninguna fecha de entrega, recepción o análisis se usa como cosecha: la entrega sin declaración sigue sin ella aunque tenga fecha de entrega.
    expect(JSON.stringify(c.deliveries)).not.toContain(today);
  });

  it('función pura: tres estados separados, recuentos y cobertura honesta (un origen desconocido no queda dentro de un intervalo completo)', async () => {
    const c = await snapshotDe(snap1.id);
    const p = produccionDeContenido(c as never);
    expect(p.period.deliveries).toEqual({ total: 4, declared: 2, declared_unknown: 1, not_declared: 1, corrected: 0 });
    expect(p.period.precision).toBe('MONTH'); // precisiones mezcladas: manda la más gruesa
    expect(p.period.start).toBe('2026-03-10');
    expect(p.period.note).toMatch(/Solo 2 de 4 entregas/);
    expect(p.period.by_origin_delivery.map((x) => x.state).sort()).toEqual(['DECLARED', 'DECLARED', 'DECLARED_UNKNOWN', 'NOT_DECLARED']);
    expect(p.country.parcels).toEqual({ total: 4, declared: 2, declared_unknown: 1, not_declared: 1 });
    expect(p.country.declared_countries).toEqual([{ country: 'EC', parcels: 1 }, { country: 'PE', parcels: 1 }]);
    // Sin ninguna declaración: período NONE y ningún país.
    const nada = produccionDeContenido({ deliveries: [{ id: 'x', code: 'E', row_version: '1', origin_plots: [] }], plots: [{ plot_id: 'p', plot_code: 'P', version_id: null, version_number: null, geometry_type: null, geometry_hash: null, validation_status: null, gis_status: null, geometry: null }] });
    expect(nada.period.precision).toBe('NONE');
    expect(nada.country.parcels).toMatchObject({ declared: 0, not_declared: 1 });
  });

  it('el comprador: sin concesión no ve nada; con la concesión de la instantánea ve estados y recuentos SIN códigos; con geometrías, el país de cada parcela', async () => {
    // Sin concesión: ni la instantánea ni su producción existen para la cuenta (control autorizado: con concesión sí).
    expect((await http().get('/api/v1/granted').set(as(OTRO)).expect(200)).body.grants).toEqual([]);
    const g = (await conceder({}).expect(201)).body.grant;
    await http().get(`/api/v1/granted/${g.id}`).set(as(OTRO)).expect(404);
    const v = (await http().get(`/api/v1/granted/${g.id}`).set(as(EXTERNO)).expect(200)).body;
    expect(v.production.period.deliveries).toEqual({ total: 4, declared: 2, declared_unknown: 1, not_declared: 1, corrected: 0 });
    expect(v.production.country.parcels).toEqual({ total: 4, declared: 2, declared_unknown: 1, not_declared: 1 });
    const texto = JSON.stringify(v.production);
    for (const prohibido of ['PR-D', 'PR-M', 'PR-U', 'PR-N', 'ENT-', 'Finca Producción', plots.D]) expect(texto).not.toContain(prohibido);
    // La descarga de la vista compartida lleva lo mismo (una sola proyección) y sigue sin geometrías.
    await http().get(`/api/v1/granted/${g.id}/geometries`).set(as(EXTERNO)).expect(403);
    await http().post(`${base(orgA)}/access-grants/${g.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin' }).expect(201);
    await http().get(`/api/v1/granted/${g.id}`).set(as(EXTERNO)).expect(404);

    const gg = (await conceder({ include_geometries: true }).expect(201)).body.grant;
    const geo = (await http().get(`/api/v1/granted/${gg.id}/geometries`).set(as(EXTERNO)).expect(200)).body;
    const porCodigo = Object.fromEntries(geo.geojson.features.map((f: { properties: { plot_code: string; production_country: unknown } }) => [f.properties.plot_code, f.properties.production_country]));
    expect(porCodigo['PR-D']).toEqual({ state: 'DECLARED', country: 'EC', declaration_number: 1 });
    expect(porCodigo['PR-U']).toEqual({ state: 'DECLARED_UNKNOWN', country: null, declaration_number: 1 });
    expect(porCodigo['PR-N']).toEqual({ state: 'NOT_DECLARED', country: null, declaration_number: 0 });
    await http().post(`${base(orgA)}/access-grants/${gg.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin' }).expect(201);
  });

  it('corrección posterior: la instantánea anterior queda intacta y la vigente se desactualiza; la nueva fija la corrección y su procedencia', async () => {
    const antes = JSON.stringify(await snapshotDe(snap1.id));
    // Corrige la cosecha de la entrega D (mes distinto) y redeclara el país de su parcela.
    const dActual = (await http().get(`${base(orgA)}/deliveries/${entregas.D.id}`).set(as(ADMIN)).expect(200)).body.delivery ?? (await http().get(`${base(orgA)}/deliveries/${entregas.D.id}`).set(as(ADMIN))).body;
    await http().post(`${base(orgA)}/deliveries/${entregas.D.id}/corrections`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), expected_version: Number(dActual.row_version ?? entregas.D.v), reason: 'La cosecha fue en abril', fields: { harvest_period: { precision: 'MONTH', start: '2026-04', end: '2026-04' } } }).expect(201);
    await pais(plots.D, { expected_declaration_number: 1, country: 'CO', note: 'Corregida tras revisar la finca' }).expect(200);
    // La instantánea anterior no cambió ni un byte…
    expect(JSON.stringify(await snapshotDe(snap1.id))).toBe(antes);
    // …y la vigente informa que las secciones de entregas y parcelas cambiaron.
    const vista = (await http().get(`${base(orgA)}/dd-snapshots/${snap1.id}`).set(as(ADMIN)).expect(200)).body;
    expect(vista.readiness.changed_sections).toEqual(expect.arrayContaining(['deliveries', 'plots']));
    // La nueva instantánea fija la corrección con su procedencia (número de corrección y declaración 2); el historial del país conserva la 1.
    const snap2 = (await http().post(`${base(orgA)}/dd-cases/${caso.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
    const c2 = await snapshotDe(snap2.id);
    expect(c2.deliveries.some((d) => d.harvest?.start?.startsWith('2026-04') && d.harvest.correction_number === 1)).toBe(true);
    expect(c2.plots.find((p) => p.plot_code === 'PR-D')!.production_country).toMatchObject({ country: 'CO', declaration_number: 2 });
    const hist = (await http().get(`${base(orgA)}/plots/${plots.D}/production-country`).set(as(ADMIN)).expect(200)).body;
    expect(hist.history.map((x: { declaration_number: number; country: string }) => [x.declaration_number, x.country])).toEqual([[2, 'CO'], [1, 'EC']]);
    // El comprador con la concesión de la instantánea 1 sigue viendo lo que ESA instantánea fijó (EC), no lo corregido.
    const g = (await conceder({ resource_id: snap1.id }).expect(201)).body.grant;
    const geo = (await http().get(`/api/v1/granted/${g.id}`).set(as(EXTERNO)).expect(200)).body;
    expect(geo.production.country.declared_countries).toEqual([{ country: 'EC', parcels: 1 }, { country: 'PE', parcels: 1 }]);
    expect(geo.production.period.deliveries.corrected).toBe(0);
    await http().post(`${base(orgA)}/access-grants/${g.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin' }).expect(201);
    // Defecto hallado al construir esto: la vista del LOTE tomaba la cosecha ORIGINAL de la entrega e ignoraba sus correcciones. Ahora usa la efectiva.
    const gl = (await conceder({ resource_type: 'LOT', resource_id: loteId }).expect(201)).body.grant;
    const lote = (await http().get(`/api/v1/granted/${gl.id}`).set(as(EXTERNO)).expect(200)).body;
    expect(lote.production_period.start).toBe('2026-04');
    expect(lote.production_period.precision).toBe('MONTH');
    await http().post(`${base(orgA)}/access-grants/${gl.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin' }).expect(201);
  });
});
