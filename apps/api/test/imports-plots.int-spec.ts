import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { AuthorizationService } from '../src/authz/authorization.service';
import type { Permission } from '../src/authz/catalog';
import { writeXlsx } from '../src/imports/xlsx';
import { PlotsService } from '../src/plots/plots';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-026 plantilla PARCELAS_V1 (RF-26 / QA-03) contra PostgreSQL/PostGIS real. Archivos sintéticos.
// Incluye FIXTURES DE AUTORIZACIÓN: permisos sintéticos sustituidos en memoria (AuthorizationService.tenantContext) para
// usuarios de prueba; ningún rol de producción ni la tabla de roles cambia.
const FIX_ASIGNADOS: Permission[] = ['organization:read', 'import:manage', 'producer:read_assigned', 'plot:read_assigned', 'plot:create_assigned', 'plot:update_assigned'];
const FIX_SOLO_EDITA: Permission[] = ['organization:read', 'import:manage', 'producer:read_assigned', 'plot:read_assigned', 'plot:update_assigned'];

describeDb('P0-026 importación Excel de parcelas (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const fixtures = new Map<string, Permission[]>();
  const http = () => h.http();
  const as = (email: string) => h.as(email);
  const base = (org: string) => `/api/v1/organizations/${org}/imports`;
  const ADMIN = 'admin-a@test.local';
  const MANAGER = 'supervisor@test.local';
  const ASIG = 'fixture-asig@test.local';
  const EDITA = 'fixture-edita@test.local';
  const HEAD = ['codigo_parcela', 'codigo_productor', 'nombre', 'cultivo', 'variedad', 'superficie_declarada_ha'];
  const MAP = { A: 'plot_code', B: 'producer_code', C: 'name', D: 'crop', E: 'variety', F: 'area_declared_ha' };
  const book = (rows: string[][], head = HEAD) => writeXlsx([{ name: 'parcelas', rows: [head, ...rows] }]);

  async function join(admin: string, org: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const membershipId = async (email: string, org = orgA) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;
  const upload = (actor: string, org: string, buf: Buffer) =>
    http().post(base(org)).set(as(actor)).field('operation_id', randomUUID()).field('template', 'PARCELAS_V1').attach('file', buf, 'parcelas.xlsx');
  async function staged(actor: string, org: string, buf: Buffer, columns: Record<string, string> = MAP) {
    const up = await upload(actor, org, buf).expect(201);
    const id = up.body.batch.id as string;
    const mapped = await http().post(`${base(org)}/${id}/mapping`).set(as(actor)).send({ columns, expected_version: up.body.batch.row_version }).expect(200);
    const preview = (await http().get(`${base(org)}/${id}/preview`).set(as(actor)).expect(200)).body;
    return { id, up: up.body, mapped: mapped.body, preview };
  }
  const commit = (actor: string, org: string, id: string, planHash: string, op = randomUUID()) =>
    http().post(`${base(org)}/${id}/commit`).set(as(actor)).send({ operation_id: op, plan_hash: planHash });
  const plot = (org: string, code: string) => h.db.selectFrom('plots').selectAll().where('organization_id', '=', org).where('plot_code', '=', code).executeTakeFirst();
  const versions = (plotId: string) => h.db.selectFrom('plot_versions').select(['id', 'version_number', 'survey_method', 'geometry_type', 'geometry_hash', sql<string | null>`area_declared_ha::text`.as('area'), sql<string | null>`area_calculated_ha::text`.as('calc'), 'validation_status', 'created_at']).where('plot_id', '=', plotId).orderBy('version_number').execute();
  const counts = async (org: string) => {
    const n = async (t: 'plots' | 'plot_versions' | 'plot_history') => Number((await h.db.selectFrom(t).select(sql<string>`count(*)`.as('n')).where('organization_id', '=', org).executeTakeFirstOrThrow()).n);
    const ev = Number((await h.db.selectFrom('domain_events').select(sql<string>`count(*)`.as('n')).where('organization_id', '=', org).where('aggregate_type', '=', 'PLOT').executeTakeFirstOrThrow()).n);
    return { plots: await n('plots'), versions: await n('plot_versions'), history: await n('plot_history'), events: ev };
  };
  const errs = (pv: { rows: Array<{ row_number: number; errors: Array<{ code: string }> }> }, n: number) => pv.rows.find((r) => r.row_number === n)!.errors.map((e) => e.code);
  const createProducer = (org: string, admin: string, body: Record<string, unknown>) => http().post(`/api/v1/organizations/${org}/producers`).set(as(admin)).send(body).expect(201).then((r) => r.body.id as string);

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local'))
        .send({ name, organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Asociación A', ADMIN);
    orgB = await mk('Asociación B', 'admin-b@test.local');
    await join(ADMIN, orgA, MANAGER, 'MANAGER');
    await join(ADMIN, orgA, 'tecnico@test.local', 'FIELD_TECHNICIAN');
    await join(ADMIN, orgA, 'auditor@test.local', 'AUDITOR');
    for (const email of [ASIG, EDITA]) await join(ADMIN, orgA, email, 'FIELD_TECHNICIAN');
    const users = await h.db.selectFrom('users').select(['id', 'email']).where('email', 'in', [ASIG, EDITA]).execute();
    for (const u of users) fixtures.set(u.id, u.email === ASIG ? FIX_ASIGNADOS : FIX_SOLO_EDITA);
    const original = AuthorizationService.prototype.tenantContext;
    jest.spyOn(AuthorizationService.prototype, 'tenantContext').mockImplementation(async function (this: AuthorizationService, user, organizationId) {
      const ctx = await original.call(this, user, organizationId);
      const perms = fixtures.get(user.id);
      return ctx && perms ? { ...ctx, permissions: [...perms].sort() } : ctx;
    });
    await createProducer(orgA, ADMIN, { producer_code: 'PRD-1', first_name: 'Ana', last_name: 'Uno' });
    const p2 = await createProducer(orgA, ADMIN, { producer_code: 'PRD-BAJA', first_name: 'Baja', last_name: 'Dos' });
    await http().post(`/api/v1/organizations/${orgA}/producers/${p2}/archive`).set(as(ADMIN)).send({ expected_version: 1, reason: 'Baja de prueba' }).expect(200);
    await createProducer(orgA, ADMIN, { producer_code: 'PRD-ASIG', first_name: 'Rosa', last_name: 'Asignada', assigned_membership_id: await membershipId(ASIG) });
    await createProducer(orgA, ADMIN, { producer_code: 'PRD-EDITA', first_name: 'Luz', last_name: 'Edita', assigned_membership_id: await membershipId(EDITA) });
    await createProducer(orgA, ADMIN, { producer_code: 'PRD-AJENO', first_name: 'Secreta', last_name: 'Ajena' });
    await createProducer(orgB, 'admin-b@test.local', { producer_code: 'PRD-B', first_name: 'Otra', last_name: 'Org' });
  });
  afterAll(async () => { jest.restoreAllMocks(); await h?.close(); });

  it('plantilla: admin y MANAGER autorizados; técnico y auditor (sin import:manage) 403; otra organización 404', async () => {
    const info = await http().get(`${base(orgA)}/templates/plots`).set(as(ADMIN)).expect(200);
    expect(info.body).toMatchObject({ template: 'PARCELAS_V1', key_field: 'plot_code' });
    expect(info.body.fields.map((f: { header: string }) => f.header)).toEqual(['codigo_parcela', 'codigo_productor', 'nombre', 'cultivo', 'variedad', 'uso_suelo', 'provincia', 'canton', 'parroquia', 'superficie_declarada_ha']);
    expect(JSON.stringify(info.body.fields)).not.toMatch(/latitud|longitud|geometr[ií]a"|coordenada"/i);
    await http().get(`${base(orgA)}/templates/plots`).set(as(MANAGER)).expect(200);
    await http().get(`${base(orgA)}/templates/plots`).set(as('tecnico@test.local')).expect(403);
    await http().get(`${base(orgA)}/templates/plots`).set(as('auditor@test.local')).expect(403);
    await http().get(`${base(orgA)}/templates/plots`).set(as('admin-b@test.local')).expect(404);
  });

  it('errores por fila: repetidos, productor inexistente/de baja, obligatorios, superficie inválida y #BORRAR no permitido; nada se escribe', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([
      ['PAR-DUP', 'PRD-1', '', 'Cacao', '', ''],
      ['PAR-DUP', 'PRD-1', '', 'Cacao', '', ''],
      ['PAR-X', 'PRD-NO-EXISTE', '', 'Cacao', '', ''],
      ['PAR-BAJA', 'PRD-BAJA', '', 'Cacao', '', ''],
      ['PAR-SINCULT', 'PRD-1', '', '', '', ''],
      ['PAR-SINPROD', '', '', 'Cacao', '', ''],
      ['PAR-COMA', 'PRD-1', '', 'Cacao', '', '2,5'],
      ['PAR-CERO', 'PRD-1', '', 'Cacao', '', '0'],
      ['PAR-BORRA', 'PRD-1', '', '#BORRAR', '', '#BORRAR'],
    ]));
    expect(errs(s.preview, 2)).toContain('DUPLICATE_IN_FILE');
    expect(errs(s.preview, 3)).toContain('DUPLICATE_IN_FILE');
    expect(errs(s.preview, 4)).toEqual(['PRODUCER_NOT_AVAILABLE']);
    expect(errs(s.preview, 5)).toEqual(['PRODUCER_INACTIVE']);
    expect(errs(s.preview, 6)).toEqual(['REQUIRED_FOR_CREATE']);
    expect(errs(s.preview, 7)).toEqual(['REQUIRED_FOR_CREATE']);
    expect(errs(s.preview, 8)).toEqual(['INVALID_FORMAT']); // coma decimal: no se interpreta
    expect(errs(s.preview, 9)).toEqual(['INVALID_AREA']);
    expect(errs(s.preview, 10)).toEqual(['CANNOT_CLEAR', 'CANNOT_CLEAR']);
    expect(s.preview).toMatchObject({ can_commit: false, summary: { error: 9 } });
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(422);
    expect(await counts(orgA)).toEqual(before);
  });

  it('alta: parcela ACTIVA y versión DECLARED sin geometría ni superficie calculada, NOT_VALIDATED; procedencia; vista previa sin escrituras', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([['PAR-1', 'PRD-1', 'Lote norte', 'Cacao', 'Nacional', '2.5'], ['PAR-2', 'PRD-1', '', 'Cacao', '', '']]));
    expect(s.preview).toMatchObject({ persisted: false, can_commit: true, summary: { create: 2, error: 0 } });
    expect(s.preview.rows[0].changed_fields).toEqual(['name', 'crop', 'variety', 'area_declared_ha']);
    expect(await counts(orgA)).toEqual(before);
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    const p1 = await plot(orgA, 'PAR-1');
    expect(p1).toMatchObject({ status: 'ACTIVE', name: 'Lote norte', crop: 'Cacao', variety: 'Nacional' });
    const v = await versions(p1!.id);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ version_number: 1, survey_method: 'DECLARED', geometry_type: null, geometry_hash: null, area: '2.5000', calc: null, validation_status: 'NOT_VALIDATED' });
    expect((await plot(orgA, 'PAR-2'))!.current_version_id).toBeNull(); // sin superficie: sin versión (no se inventa)
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'payload']).where('aggregate_id', '=', p1!.id).orderBy('aggregate_version').execute();
    expect(ev.map((e) => e.event_type)).toEqual(['PlotRegistered', 'PlotGeometryVersionCreated']);
    expect(ev.every((e) => (e.payload as { source?: { kind: string } }).source?.kind === 'EXCEL_IMPORT')).toBe(true);
    const hist = await h.db.selectFrom('plot_history').select(['change_type', 'reason']).where('plot_id', '=', p1!.id).execute();
    expect(hist.every((x) => x.reason?.includes(s.id))).toBe(true);
  });

  it('reimportar sin cambios: ni versiones, ni historial, ni eventos', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([['PAR-1', 'PRD-1', 'Lote norte', 'Cacao', 'Nacional', '2.5000'], ['PAR-2', 'PRD-1', '', 'Cacao', '', '']]));
    expect(s.preview.summary).toMatchObject({ unchanged: 2, create: 0, update: 0, error: 0 });
    expect((await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(409)).body.error.code).toBe('NOTHING_TO_IMPORT');
    expect(await counts(orgA)).toEqual(before);
  });

  it('mapeo parcial, vacío y #BORRAR; superficie nueva = versión nueva y la anterior queda intacta', async () => {
    const p1 = await plot(orgA, 'PAR-1');
    const v1 = (await versions(p1!.id))[0];
    // Nombre #BORRAR, variedad vacía (no cambia), cultivo sin mapear (se conserva), superficie 3.
    const s = await staged(ADMIN, orgA, book([['PAR-1', '#BORRAR', '', '3']], ['codigo_parcela', 'nombre', 'variedad', 'superficie_declarada_ha']), { A: 'plot_code', B: 'name', C: 'variety', D: 'area_declared_ha' });
    expect(s.preview.rows[0]).toMatchObject({ action: 'UPDATE', changed_fields: ['name', 'area_declared_ha'] });
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect(await plot(orgA, 'PAR-1')).toMatchObject({ name: null, crop: 'Cacao', variety: 'Nacional', producer_id: p1!.producer_id });
    const vs = await versions(p1!.id);
    expect(vs).toHaveLength(2);
    expect(vs[0]).toEqual(v1); // la versión anterior no cambia
    expect(vs[1]).toMatchObject({ version_number: 2, survey_method: 'DECLARED', area: '3.0000', geometry_type: null, validation_status: 'NOT_VALIDATED' });
  });

  it('geometría existente: una edición descriptiva no la toca y la superficie declarada la conserva exacta en una versión nueva', async () => {
    const p2 = await plot(orgA, 'PAR-2');
    const polygon = { type: 'Polygon', coordinates: [[[-80.10, -0.80], [-80.09, -0.80], [-80.09, -0.79], [-80.10, -0.79], [-80.10, -0.80]]] };
    await http().post(`/api/v1/organizations/${orgA}/plots/${p2!.id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: Number(p2!.row_version), survey_method: 'MANUAL_COORDINATES', geometry: polygon }).expect(201);
    const geomBefore = await versions(p2!.id);
    const captured = geomBefore[geomBefore.length - 1];
    const s2 = await staged(ADMIN, orgA, book([['PAR-2', 'PRD-1', 'Con geometría', 'Cacao', '', '']]));
    expect(s2.preview.rows[0]).toMatchObject({ action: 'UPDATE', changed_fields: ['name'] });
    await commit(ADMIN, orgA, s2.id, s2.preview.plan_hash).expect(201);
    expect((await plot(orgA, 'PAR-2'))!.current_version_id).toBe(captured.id);
    expect(await versions(p2!.id)).toEqual(geomBefore);

    const s = await staged(ADMIN, orgA, book([['PAR-2', 'PRD-1', 'Con geometría', 'Cacao', '', '1.2']]));
    expect(s.preview.rows[0]).toMatchObject({ action: 'UPDATE', changed_fields: ['area_declared_ha'] });
    expect(JSON.stringify(s.preview)).not.toContain('-80.1');
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    const vs = await versions(p2!.id);
    expect(vs.slice(0, geomBefore.length)).toEqual(geomBefore); // anteriores intactas
    const nv = vs[vs.length - 1];
    expect(nv).toMatchObject({ survey_method: captured.survey_method, geometry_type: 'POLYGON', geometry_hash: captured.geometry_hash, area: '1.2000', calc: captured.calc, validation_status: 'NOT_VALIDATED' });
    const same = await sql<{ same: boolean; origin: string | null }>`SELECT ST_Equals(n.geometry, c.geometry) AND ST_AsBinary(n.geometry) = ST_AsBinary(c.geometry) AS same, n.geometry_origin_version_id AS origin
      FROM plot_versions n, plot_versions c WHERE n.id = ${nv.id} AND c.id = ${captured.id}`.execute(h.db);
    expect(same.rows[0]).toEqual({ same: true, origin: captured.id });
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'payload']).where('aggregate_id', '=', p2!.id).orderBy('aggregate_version', 'desc').executeTakeFirstOrThrow();
    expect(ev).toMatchObject({ event_type: 'PlotDeclaredAreaUpdated', payload: { change_kind: 'DECLARED_AREA_UPDATE', geometry_origin_version_id: captured.id, source: { kind: 'EXCEL_IMPORT' } } });
    expect(JSON.stringify(ev.payload)).not.toContain('-80.1');
  });

  it('no reasigna productor ni reactiva parcelas', async () => {
    const s = await staged(ADMIN, orgA, book([['PAR-1', 'PRD-ASIG', '', 'Cacao', '', '']]));
    expect(errs(s.preview, 2)).toEqual(['PLOT_PRODUCER_CHANGE_NOT_ALLOWED']);
    const p = await plot(orgA, 'PAR-1');
    await http().post(`/api/v1/organizations/${orgA}/plots/${p!.id}/archive`).set(as(ADMIN)).send({ expected_version: Number(p!.row_version), reason: 'Baja de prueba' }).expect(200);
    const s2 = await staged(ADMIN, orgA, book([['PAR-1', 'PRD-1', 'Reactivar', 'Cacao', '', '']]));
    expect(errs(s2.preview, 2)).toEqual(['PLOT_INACTIVE']);
    await commit(ADMIN, orgA, s2.id, s2.preview.plan_hash).expect(422);
    expect(await plot(orgA, 'PAR-1')).toMatchObject({ status: 'INACTIVE', name: null });
  });

  it('fixture de autorización: productor inexistente, ajeno a la asignación o de otra organización → misma respuesta', async () => {
    const s = await staged(ASIG, orgA, book([['PAR-F1', 'PRD-ASIG', '', 'Cacao', '', '1'], ['PAR-F2', 'PRD-AJENO', '', 'Cacao', '', ''], ['PAR-F3', 'PRD-NADA', '', 'Cacao', '', ''], ['PAR-F4', 'PRD-B', '', 'Cacao', '', '']]));
    expect(s.preview.rows[0].action).toBe('CREATE');
    const [, ajeno, nada, otraOrg] = s.preview.rows;
    const strip = (r: Record<string, unknown>) => { const { row_number: _n, code: _c, fields: _f, ...rest } = r; void _n; void _c; void _f; return rest; };
    expect(ajeno.errors).toEqual([{ column: 'B', field: 'producer_code', code: 'PRODUCER_NOT_AVAILABLE', message: 'El productor indicado no está disponible para ti en esta organización.' }]);
    expect(strip(ajeno)).toEqual(strip(nada));
    expect(strip(otraOrg)).toEqual(strip(nada));
    const ajenoId = (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'PRD-AJENO').executeTakeFirstOrThrow()).id;
    expect(JSON.stringify(s.preview)).not.toContain(ajenoId);
    expect(JSON.stringify(s.preview)).not.toContain('Secreta');
  });

  it('fixture de autorización: parcela fuera de alcance e inexistente (rol sin alta) → misma respuesta; sin plot:read_geometry no hay muestras de columnas sueltas', async () => {
    const ajeno = (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'PRD-AJENO').executeTakeFirstOrThrow()).id;
    await http().post(`/api/v1/organizations/${orgA}/plots`).set(as(ADMIN)).send({ producer_id: ajeno, plot_code: 'PAR-AJENA', crop: 'Cacao', name: 'Parcela secreta' }).expect(201);
    const edita = (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'PRD-EDITA').executeTakeFirstOrThrow()).id;
    await http().post(`/api/v1/organizations/${orgA}/plots`).set(as(ADMIN)).send({ producer_id: edita, plot_code: 'PAR-EDITA', crop: 'Cacao' }).expect(201);
    const head = ['codigo_parcela', 'nombre', 'coordenadas_campo'];
    const up = await upload(EDITA, orgA, book([['PAR-EDITA', 'Editada', '-0.8479,-80.1601'], ['PAR-AJENA', 'X', '-0.8479,-80.1601'], ['PAR-NO-EXISTE', 'Y', '-0.8479,-80.1601']], head)).expect(201);
    expect(up.body.batch.columns.every((c: { samples: unknown }) => c.samples === null)).toBe(true);
    expect(JSON.stringify(up.body)).not.toContain('-80.1601');
    const m = await http().post(`${base(orgA)}/${up.body.batch.id}/mapping`).set(as(EDITA)).send({ columns: { A: 'plot_code', B: 'name' }, expected_version: up.body.batch.row_version }).expect(200);
    expect(m.body.columns.map((c: { samples: unknown }) => c.samples)).toEqual([['PAR-EDITA', 'PAR-AJENA', 'PAR-NO-EXISTE'], ['Editada', 'X', 'Y'], null]);
    const pv = (await http().get(`${base(orgA)}/${up.body.batch.id}/preview`).set(as(EDITA)).expect(200)).body;
    const [mine, fuera, nada] = pv.rows;
    expect(mine).toMatchObject({ action: 'UPDATE', changed_fields: ['name'] });
    const strip = (r: Record<string, unknown>) => { const { row_number: _n, code: _c, fields: _f, ...rest } = r; void _n; void _c; void _f; return rest; };
    expect(fuera.errors).toEqual([{ column: 'A', field: 'plot_code', code: 'CODE_NOT_AVAILABLE', message: 'Ese código de parcela no está disponible para tu importación.' }]);
    expect(strip(fuera)).toEqual(strip(nada));
    expect(JSON.stringify(pv)).not.toContain('Parcela secreta');
    expect(JSON.stringify(pv)).not.toContain('-80.1601');
  });

  it('permisos y asignación revalidados al confirmar', async () => {
    const edita = (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'PRD-EDITA').executeTakeFirstOrThrow()).id;
    const s = await staged(EDITA, orgA, book([['PAR-EDITA', 'Nuevo nombre']], ['codigo_parcela', 'nombre']), { A: 'plot_code', B: 'name' });
    expect(s.preview.rows[0].action).toBe('UPDATE');
    // 1) asignación retirada → el plan ya no coincide
    await h.db.updateTable('producers').set({ assigned_membership_id: null }).where('id', '=', edita).execute();
    expect((await commit(EDITA, orgA, s.id, s.preview.plan_hash).expect(409)).body.error.code).toBe('PREVIEW_STALE');
    await h.db.updateTable('producers').set({ assigned_membership_id: await membershipId(EDITA) }).where('id', '=', edita).execute();
    // 2) permiso de parcela retirado → 403
    const uid = (await h.db.selectFrom('users').select('id').where('email', '=', EDITA).executeTakeFirstOrThrow()).id;
    fixtures.set(uid, ['organization:read', 'import:manage', 'producer:read_assigned', 'plot:read_assigned']);
    await commit(EDITA, orgA, s.id, s.preview.plan_hash).expect(403);
    fixtures.set(uid, FIX_SOLO_EDITA);
    expect((await plot(orgA, 'PAR-EDITA'))!.name).toBeNull();
    // 3) versión cambiada tras la vista previa → PREVIEW_STALE
    const p = await plot(orgA, 'PAR-EDITA');
    await http().patch(`/api/v1/organizations/${orgA}/plots/${p!.id}`).set(as(ADMIN)).send({ variety: 'CCN-51', expected_version: Number(p!.row_version) }).expect(200);
    expect((await commit(EDITA, orgA, s.id, s.preview.plan_hash).expect(409)).body.error.code).toBe('PREVIEW_STALE');
  });

  it('rollback completo: un fallo al crear la versión de la segunda fila deshace también la primera', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([['PAR-RB1', 'PRD-1', '', 'Cacao', '', ''], ['PAR-RB2', 'PRD-1', '', 'Cacao', '', '4']]));
    const spy = jest.spyOn(PlotsService.prototype, 'updateDeclaredAreaInTx').mockRejectedValueOnce(new Error('fallo inyectado'));
    try {
      await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await plot(orgA, 'PAR-RB1')).toBeUndefined();
    expect(await plot(orgA, 'PAR-RB2')).toBeUndefined();
    expect(await counts(orgA)).toEqual(before);
    expect((await h.db.selectFrom('import_batches').select('status').where('id', '=', s.id).executeTakeFirstOrThrow()).status).toBe('MAPPED');
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect((await versions((await plot(orgA, 'PAR-RB2'))!.id))[0].area).toBe('4.0000');
  });

  it('concurrencia: dos lotes con el mismo código nuevo → uno confirma, el otro se revierte entero', async () => {
    const a = await staged(ADMIN, orgA, book([['PAR-CC', 'PRD-1', '', 'Cacao', '', ''], ['PAR-CC-A', 'PRD-1', '', 'Cacao', '', '']]));
    const b = await staged(MANAGER, orgA, book([['PAR-CC-B', 'PRD-1', '', 'Cacao', '', ''], ['PAR-CC', 'PRD-1', '', 'Cacao', '', '']]));
    const [ra, rb] = await Promise.all([commit(ADMIN, orgA, a.id, a.preview.plan_hash), commit(MANAGER, orgA, b.id, b.preview.plan_hash)]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(['IMPORT_CONCURRENT_CHANGE', 'PREVIEW_STALE']).toContain(loser.body.error.code);
    expect(await plot(orgA, ra.status === 201 ? 'PAR-CC-B' : 'PAR-CC-A')).toBeUndefined();
  });

  it('aislamiento: lote ajeno 404; mismo código de parcela en otra organización es otra parcela', async () => {
    const s = await staged(ADMIN, orgA, book([['PAR-ISO', 'PRD-1', '', 'Cacao', '', '']]));
    for (const path of ['', '/preview', '/report']) await http().get(`${base(orgA)}/${s.id}${path}`).set(as('admin-b@test.local')).expect(404);
    const sb = await staged('admin-b@test.local', orgB, book([['PAR-2', 'PRD-B', '', 'Cacao', '', ''], ['PAR-X1', 'PRD-1', '', 'Cacao', '', '']]));
    expect(sb.preview.rows[0]).toMatchObject({ action: 'CREATE', plot_id: null });
    expect(errs(sb.preview, 3)).toEqual(['PRODUCER_NOT_AVAILABLE']); // productor de otra organización: no disponible
  });
});
