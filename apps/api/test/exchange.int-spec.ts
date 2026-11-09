import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { FORMATO } from '../src/exchange/exchange';
import { readXlsx, writeXlsx } from '../src/imports/xlsx';

// P1-006 (RF-37; S2 §29; S3 §§14, 19; docs/15) — Intercambio con GUIA/Agrocalidad **por archivo**, cerrado
// tras una compuerta que la organización no puede abrirse a sí misma.
//
// Lo que estas pruebas protegen: que **sin canal comprobado no se intercambie nada**, que **conciliar no
// escriba** en los datos operativos, y que el formato **no se presente como oficial**.
describeDb('P1-006 intercambio con GUIA/Agrocalidad (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string; let p2: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}/exchange`;
  const SUPER = 'super@test.local';
  const ADMIN = 'admin-ex@test.local';
  const ADMIN_B = 'admin-exb@test.local';
  const TEC = 'tecnico-ex@test.local';
  const hoy = new Date().toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  interface Acuerdo { id: string; status: string; can_exchange: boolean; decisions: Array<{ decision: string }>; note: string }
  interface Dif { id: string; external_key: string; kind: string; field: string | null; external_value: string | null; our_value: string | null; resolution: { decision: string } | null }
  interface Acto { id: string; kind: string; format_version: string; row_count: number; content_hash: string; summary: Record<string, number>; differences: Dif[]; pending: number; note: string }

  const registrar = (cuerpo: Record<string, unknown> = {}, actor = ADMIN, org = orgA) =>
    http().post(`${api(org)}/agreements`).set(as(actor)).send({
      operation_id: randomUUID(), counterpart: 'GUIA_AGROCALIDAD', reference: 'Convenio DEMO 2026-01',
      scope: 'Padrón de operadores: código, nombre y ubicación administrativa.', valid_from: ayer, ...cuerpo,
    });
  const decidir = (id: string, decision: string, actor: string, reason = 'Revisión del canal', org = orgA) =>
    http().post(`${api(org)}/agreements/${id}/decisions`).set(as(actor)).send({ operation_id: randomUUID(), decision, reason });

  /** Archivo de la contraparte en el formato declarado. */
  const archivo = (filas: string[][]) => writeXlsx([{ name: FORMATO.sheet, rows: [FORMATO.fields.map((f) => f.header), ...filas] }]);

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Intercambio A', ADMIN);
    orgB = await mk('Coop Intercambio B', ADMIN_B);
    const inv = await http().post(`/api/v1/organizations/${orgA}/invitations`).set(as(ADMIN)).send({ email: TEC, role_code: 'FIELD_TECHNICIAN' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'T', last_name: 'Campo', password: PASSWORD }).expect(200);
    await h.login(TEC);
    p1 = (await http().post(`/api/v1/organizations/${orgA}/producers`).set(as(ADMIN))
      .send({ producer_code: 'EX-1', legal_name: 'Finca Uno', province: 'Manabí', canton: 'Chone', parish: 'Canuto' }).expect(201)).body.id;
    p2 = (await http().post(`/api/v1/organizations/${orgA}/producers`).set(as(ADMIN))
      .send({ producer_code: 'EX-2', legal_name: 'Finca Dos', province: 'Manabí', canton: 'Portoviejo', parish: 'Riochico' }).expect(201)).body.id;
    expect(p1 && p2).toBeTruthy();
  });
  afterAll(async () => h?.close());

  it('el formato se publica como NO OFICIAL y mapea a los elementos de la guía', async () => {
    const f = (await http().get(`${api(orgA)}/format`).set(as(ADMIN)).expect(200)).body;
    expect(f.official).toBe(false);
    expect(f.version).toMatch(/no-oficial/);
    expect(f.warning).toMatch(/NO está autorizado por GUIA\/Agrocalidad/);
    expect(f.warning).toMatch(/no envía datos a ningún servicio externo/);
    // Cada columna declara a qué elemento de la guía corresponde: el mapeo no es implícito.
    expect(f.fields.every((c: { element: string }) => c.element.length > 3)).toBe(true);
    expect(f.elements_source).toMatch(/ubicación geográfica/i);
    // Y lo excluido se dice, no se omite.
    expect(JSON.stringify(f.excluded)).toMatch(/Geometrías y coordenadas/);
    expect(JSON.stringify(f.excluded)).toMatch(/Documento de identidad/);
  });

  it('SIN CANAL COMPROBADO no se exporta ni se concilia, aunque el acuerdo esté registrado', async () => {
    // Antes de registrar nada.
    expect((await http().post(`${api(orgA)}/export`).set(as(ADMIN))).status).toBe(409);
    const a = (await registrar().expect(201)).body as Acuerdo;
    expect(a).toMatchObject({ status: 'REGISTRADO', can_exchange: false });
    expect(a.note).toMatch(/Registrar el acuerdo no habilita el intercambio/);

    // Registrado pero sin verificar: sigue cerrado, y el motivo lo dice.
    const r = await http().post(`${api(orgA)}/export`).set(as(ADMIN));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EXCHANGE_CHANNEL_NOT_VERIFIED');
    expect(r.body.error.message).toMatch(/una organización no verifica su propio canal/i);
    expect((await http().post(`${api(orgA)}/reconcile`).set(as(ADMIN)).attach('file', archivo([]), 'x.xlsx')).status).toBe(409);
  });

  it('la organización NO puede verificar su propio canal: la verificación es de plataforma', async () => {
    const a = (await registrar({ reference: 'Convenio DEMO 2026-02' }).expect(201)).body as Acuerdo;
    // Ni el administrador de la organización, ni nadie de dentro.
    expect((await decidir(a.id, 'VERIFY', ADMIN)).status).toBe(403);
    expect((await decidir(a.id, 'VERIFY', TEC)).status).toBe(403);
    // CONTROL: la plataforma sí, y entonces el intercambio se abre.
    const v = (await decidir(a.id, 'VERIFY', SUPER, 'Canal comprobado contra el convenio').expect(201)).body as Acuerdo;
    expect(v).toMatchObject({ status: 'VERIFICADO_VIGENTE', can_exchange: true });
    expect(v.decisions[0]).toMatchObject({ decision: 'VERIFY' });
  });

  it('exportar entrega el padrón en el formato, SIN geometrías ni identidad, y queda registrado', async () => {
    // El canal tiene que estar abierto antes de exportar: si no, el fallo diría «409» sin decir por qué.
    const estado = (await http().get(`${api(orgA)}/agreements`).set(as(ADMIN)).expect(200)).body;
    expect(estado.agreements.map((a: Acuerdo) => `${a.status}:${a.can_exchange}`)).toContain('VERIFICADO_VIGENTE:true');
    // supertest no bufferiza un tipo binario desconocido: hay que pedírselo, como en las plantillas.
    const r = await http().post(`${api(orgA)}/export`).set(as(ADMIN)).buffer(true)
      .parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); })
      .expect(201);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    const hoja = readXlsx(r.body as Buffer, FORMATO.sheet);
    expect(hoja.rows[0].cells.map((c) => c?.value)).toEqual(FORMATO.fields.map((f) => f.header));
    const codigos = hoja.rows.slice(1).map((f) => f.cells[0]?.value);
    expect(codigos).toEqual(['EX-1', 'EX-2']);
    // Lo que NO viaja: ni coordenadas, ni documento de identidad.
    const texto = JSON.stringify(hoja.rows);
    expect(texto).not.toMatch(/coordinates|geometry|-80\.|document_number/);

    // El acto queda en el registro, con su versión de formato y su huella.
    const actos = (await http().get(`${api(orgA)}/acts`).set(as(ADMIN)).expect(200)).body;
    expect(actos.acts[0]).toMatchObject({ kind: 'EXPORT', format_version: FORMATO.version, row_count: 2 });
    expect(actos.acts[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('conciliar produce diferencias de las tres clases y NO escribe en los datos operativos', async () => {
    const antes = (await http().get(`/api/v1/organizations/${orgA}/producers`).set(as(ADMIN)).expect(200)).body;
    const nombresAntes = (antes.items ?? antes).map((p: { code: string; name: string }) => `${p.code}:${p.name}`).sort();

    const r = await http().post(`${api(orgA)}/reconcile`).set(as(ADMIN)).attach('file', archivo([
      ['EX-1', 'Finca Uno', 'Manabí', 'Chone', 'Canuto', '0'],             // coincide
      ['EX-2', 'FINCA DOS', 'Manabí', 'Santa Ana', 'Riochico', '0'],       // difiere en cantón (el nombre solo en mayúsculas NO es diferencia)
      ['EX-9', 'Finca que no tenemos', 'Manabí', 'Chone', 'Canuto', '0'],  // solo en la contraparte
    ]), 'contraparte.xlsx').expect(201);
    const acto = r.body as Acto;
    expect(acto.kind).toBe('RECONCILE');
    expect(acto.summary).toMatchObject({ external_rows: 3, our_rows: 2, matches: 1, only_external: 1, field_differs: 1 });

    const clases = acto.differences.map((d) => `${d.kind}:${d.external_key}${d.field ? `/${d.field}` : ''}`).sort();
    expect(clases).toEqual(['FIELD_DIFFERS:EX-2/canton', 'ONLY_EXTERNAL:EX-9']);
    const campo = acto.differences.find((d) => d.kind === 'FIELD_DIFFERS')!;
    expect(campo).toMatchObject({ external_value: 'Santa Ana', our_value: 'Portoviejo', resolution: null });
    expect(acto.pending).toBe(2);
    expect(acto.note).toMatch(/NO escribe en los datos operativos/);

    // Lo decisivo: ningún dato operativo cambió.
    const despues = (await http().get(`/api/v1/organizations/${orgA}/producers`).set(as(ADMIN)).expect(200)).body;
    expect((despues.items ?? despues).map((p: { code: string; name: string }) => `${p.code}:${p.name}`).sort()).toEqual(nombresAntes);
    const cantones = await h.db.selectFrom('producers').select(['producer_code', 'canton']).where('organization_id', '=', orgA).orderBy('producer_code').execute();
    expect(cantones).toEqual([
      expect.objectContaining({ producer_code: 'EX-1', canton: 'Chone' }),
      expect.objectContaining({ producer_code: 'EX-2', canton: 'Portoviejo' }),
    ]);
    // Y no se creó el productor que solo existe en la contraparte.
    expect(cantones.some((c) => c.producer_code === 'EX-9')).toBe(false);
  });

  it('un archivo sin las columnas del formato se rechaza diciendo cuáles faltan', async () => {
    const malo = writeXlsx([{ name: FORMATO.sheet, rows: [['codigo_operador', 'otra_cosa'], ['EX-1', 'x']] }]);
    const r = await http().post(`${api(orgA)}/reconcile`).set(as(ADMIN)).attach('file', malo, 'malo.xlsx');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('EXCHANGE_HEADERS_MISSING');
    expect(r.body.error.message).toMatch(/nombre_operador/);
    // Sin archivo tampoco se inventa una conciliación vacía.
    expect((await http().post(`${api(orgA)}/reconcile`).set(as(ADMIN))).status).toBe(400);
  });

  it('resolver una diferencia deja decisión y motivo, y SIGUE sin tocar el dato', async () => {
    const actos = (await http().get(`${api(orgA)}/acts`).set(as(ADMIN)).expect(200)).body;
    const id = actos.acts.find((a: { kind: string }) => a.kind === 'RECONCILE').id;
    const acto = (await http().get(`${api(orgA)}/acts/${id}`).set(as(ADMIN)).expect(200)).body as Acto;
    const dif = acto.differences.find((d) => d.kind === 'FIELD_DIFFERS')!;

    const tras = (await http().post(`${api(orgA)}/differences/${dif.id}/decisions`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), decision: 'ACCEPT_EXTERNAL', reason: 'La contraparte tiene el cantón correcto; se corregirá en la ficha' })
      .expect(201)).body as Acto;
    const resuelta = tras.differences.find((d) => d.id === dif.id)!;
    expect(resuelta.resolution).toMatchObject({ decision: 'ACCEPT_EXTERNAL' });
    expect(tras.pending).toBe(1);

    // Aceptar NO sobrescribe: el cantón sigue siendo el nuestro hasta que se corrija por su caso de uso.
    const p = await h.db.selectFrom('producers').select('canton').where('producer_code', '=', 'EX-2').where('organization_id', '=', orgA).executeTakeFirstOrThrow();
    expect(p.canton).toBe('Portoviejo');

    // Append-only: la decisión no se edita ni se borra.
    await expect(h.db.deleteFrom('exchange_difference_decisions').where('difference_id', '=', dif.id).execute())
      .rejects.toThrow(/append-only/);
  });

  it('retirar el acuerdo cierra el canal, y el histórico de actos se conserva', async () => {
    const lista = (await http().get(`${api(orgA)}/agreements`).set(as(ADMIN)).expect(200)).body;
    const vigente = lista.agreements.find((a: Acuerdo) => a.can_exchange);
    expect(vigente).toBeTruthy();
    const actosAntes = (await http().get(`${api(orgA)}/acts`).set(as(ADMIN)).expect(200)).body.acts.length;

    const tras = (await decidir(vigente.id, 'WITHDRAW', ADMIN, 'Se retira el canal para la prueba').expect(201)).body as Acuerdo;
    expect(tras).toMatchObject({ status: 'RETIRADO', can_exchange: false });
    expect((await http().post(`${api(orgA)}/export`).set(as(ADMIN))).status).toBe(409);

    // El histórico no se reescribe: los actos siguen, y las dos decisiones conviven.
    expect((await http().get(`${api(orgA)}/acts`).set(as(ADMIN)).expect(200)).body.acts.length).toBe(actosAntes);
    expect(tras.decisions.map((d) => d.decision).sort()).toEqual(['VERIFY', 'WITHDRAW']);
  });

  it('autorización: alcance de organización, permisos por acción y aislamiento entre organizaciones', async () => {
    // El técnico no gestiona ni usa el intercambio.
    expect((await registrar({}, TEC)).status).toBe(403);
    expect((await http().get(`${api(orgA)}/acts`).set(as(TEC))).status).toBe(403);
    expect((await http().post(`${api(orgA)}/export`).set(as(TEC))).status).toBe(403);
    // CONTROL: el administrador sí.
    await http().get(`${api(orgA)}/acts`).set(as(ADMIN)).expect(200);
    // Otra organización: 404, no 403, y no se ve ni su existencia.
    expect((await http().get(`${api(orgB)}/acts`).set(as(ADMIN))).status).toBe(404);
    expect((await registrar({}, ADMIN, orgB)).status).toBe(404);
    // Un acuerdo ajeno tampoco se verifica desde la propia.
    const ajeno = (await registrar({ reference: 'Convenio B' }, ADMIN_B, orgB).expect(201)).body as Acuerdo;
    expect((await http().get(`${api(orgA)}/agreements/${ajeno.id}`).set(as(ADMIN))).status).toBe(404);
  });

  it('la vigencia manda: un acuerdo verificado pero fuera de fecha no abre el canal', async () => {
    const pasado = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const anteayer = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const a = (await registrar({ reference: 'Convenio vencido', valid_from: pasado, valid_to: anteayer }).expect(201)).body as Acuerdo;
    const v = (await decidir(a.id, 'VERIFY', SUPER, 'Verificado, pero su vigencia ya terminó').expect(201)).body as Acuerdo;
    expect(v).toMatchObject({ status: 'VERIFICADO_NO_VIGENTE', can_exchange: false });
    expect((await http().post(`${api(orgA)}/export`).set(as(ADMIN))).status).toBe(409);
    // Y una vigencia invertida se rechaza al registrarla.
    expect((await registrar({ reference: 'Invertido', valid_from: hoy, valid_to: pasado })).status).toBe(422);
  });
});
