import { createServer, connect, type Server, type Socket } from 'net';
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { describeDb, setupHarness, PASSWORD } from './helpers';
import { MALWARE_SCANNER, type MalwareScanner } from '../src/storage/scanner';

// RNF-10 — Avisos operativos: detección **y recuperación**, con fallos INDUCIDOS en entorno aislado, y
// **separación entre la respuesta pública mínima y la información operativa restringida**.
//
// Lo que esta suite tiene que demostrar, además de que los avisos funcionan:
//   · la respuesta ANÓNIMA **no revela identificadores**, **ni recuentos de recursos protegidos**, **ni
//     detalle de ninguna organización** — y no cambia aunque haya actividad;
//   · la información operativa se sirve **por organización** y **permiso a permiso**, con un **control
//     autorizado** en la misma respuesta que prueba que el dato existía y se reservó de verdad.
//
// El entorno es el arnés de integración: base `*_test` propia, Redis tras un proxy TCP que se puede cortar y
// restaurar, y un escáner sustituible. **No se toca desarrollo ni el otro proyecto Compose.**
class TcpProxy {
  private server?: Server;
  private sockets = new Set<Socket>();
  port = 0;
  constructor(private readonly target: { host: string; port: number }) {}
  start(port = 0): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((client) => {
        const upstream = connect(this.target.port, this.target.host);
        for (const s of [client, upstream]) {
          this.sockets.add(s);
          s.on('close', () => this.sockets.delete(s));
          s.on('error', () => s.destroy());
        }
        client.pipe(upstream).pipe(client);
      });
      this.server.listen(port, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port;
        resolve();
      });
    });
  }
  stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
const proxy = new TcpProxy({ host: url.hostname, port: Number(url.port || 6379) });

type Aviso = { code: string; state: string; condition: string; observed: string; action: string | null; degradacion: boolean };
type Respuesta = { status: string; scope: string; organization_id?: string; alerts: Aviso[] };

const INFRAESTRUCTURA = ['CORE_DEPENDENCY_DOWN', 'SCHEMA_CODE_MISMATCH', 'DOCUMENT_ANALYSIS_UNAVAILABLE'];
const OPERATIVOS = ['DOCUMENTS_PENDING_ANALYSIS', 'EVENT_DELIVERIES_DEAD'];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describeDb('RNF-10 avisos operativos: se provocan, informan, se recuperan y no se filtran', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let escanerVivo = true;
  let orgA = '';
  let orgB = '';
  let eventoMuerto = '';

  const ADMIN_A = 'avisos-admin-a@test.local';
  const ADMIN_B = 'avisos-admin-b@test.local';
  const AUDITOR = 'avisos-auditor-a@test.local';   // orgA: tiene document:read, NO tiene events:reprocess
  const COMPRADOR = 'avisos-buyer-b@test.local';   // miembro de orgB únicamente
  // Dos técnicos de la MISMA organización con asignaciones distintas: tienen `document:read`, pero su alcance
  // de lectura es `producer:read_assigned`, no toda la organización.
  const TEC_1 = 'avisos-tecnico1-a@test.local';
  const TEC_2 = 'avisos-tecnico2-a@test.local';

  const http = () => h.http();
  const as = (e: string) => h.as(e);
  /** Respuesta PÚBLICA: sin cabecera de sesión. */
  const publicos = () => http().get('/operations/alerts');
  /** Respuesta RESTRINGIDA de una organización. */
  const deOrg = (org: string, actor: string) => http().get(`/api/v1/organizations/${org}/operations/alerts`).set(as(actor));
  const buscar = (body: Respuesta, code: string) => body.alerts.find((a) => a.code === code) as Aviso;

  async function join(org: string, email: string, role: string, admin: string) {
    const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }

  /**
   * Versión de documento SIN análisis limpio, propia de la organización indicada. Fixture sintético, pero con
   * un titular REAL: un disparador exige que el productor pertenezca a la organización.
   */
  const membresiaDe = async (email: string, org: string) => (await h.db.selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id').select('m.id')
    .where('u.email', '=', email).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;

  async function documentoPendiente(org: string, admin: string, creador: string, asignarA?: string) {
    const prod = (await http().post(`/api/v1/organizations/${org}/producers`).set(as(admin))
      .send({ producer_code: `AV-${randomUUID().slice(0, 8)}`, legal_name: 'Finca sintética de avisos' }).expect(201));
    const titular = prod.body.id as string;
    if (asignarA) {
      await http().put(`/api/v1/organizations/${org}/producers/${titular}/assignment`).set(as(admin))
        .send({ expected_version: prod.body.row_version, membership_id: await membresiaDe(asignarA, org) }).expect(200);
    }
    const doc = randomUUID();
    await sql`INSERT INTO documents (id, organization_id, document_type, owner_type, owner_id, title, created_by)
      VALUES (${doc}, ${org}, 'DELIVERY_SUPPORT', 'producer', ${titular}, 'Soporte sintético de avisos', ${creador})`.execute(h.db);
    await sql`INSERT INTO document_versions (id, organization_id, document_id, version_number, object_key, file_name, mime_type, size_bytes, sha256, operation_id, uploaded_by)
      VALUES (${randomUUID()}, ${org}, ${doc}, 1, ${`sintetico/${doc}`}, 'sintetico.pdf', 'application/pdf', 10, ${'0'.repeat(64)}, ${randomUUID()}, ${creador})`.execute(h.db);
  }

  /** Entrega DEAD del outbox sobre un evento sintético de la organización indicada. */
  async function entregaMuerta(org: string) {
    const ev = randomUUID();
    await sql`INSERT INTO domain_events (event_id, organization_id, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, payload, occurred_at)
      VALUES (${ev}, ${org}, 'AvisoSinteticoOcurrido', 1, 'LOT', ${randomUUID()}, 1, '{"synthetic_fixture":true}'::jsonb, now())`.execute(h.db);
    await sql`INSERT INTO event_deliveries (event_id, consumer, status, attempts, last_error)
      VALUES (${ev}, 'consumidor-sintetico', 'DEAD', 5, 'fallo sintético de prueba')`.execute(h.db);
    return ev;
  }

  beforeAll(async () => {
    await proxy.start();
    h = await setupHarness({ redisUrl: `redis://127.0.0.1:${proxy.port}` });
    const falso: MalwareScanner = { ...(h.app.get(MALWARE_SCANNER) as MalwareScanner), ping: async () => escanerVivo };
    Object.defineProperty(h.app.get(MALWARE_SCANNER) as object, 'ping', { value: falso.ping, configurable: true, writable: true });

    await h.user('avisos-super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN_A);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('avisos-super@test.local'))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id as string;
    orgA = await mk('Coop Avisos A', ADMIN_A);
    orgB = await mk('Coop Avisos B', ADMIN_B);
    await join(orgA, AUDITOR, 'AUDITOR', ADMIN_A);
    await join(orgA, TEC_1, 'FIELD_TECHNICIAN', ADMIN_A);
    await join(orgA, TEC_2, 'FIELD_TECHNICIAN', ADMIN_A);
    await join(orgB, COMPRADOR, 'BUYER', ADMIN_B);
  });
  afterAll(async () => {
    escanerVivo = true;
    await h?.close();
    await proxy.stop();
  });

  // ---------------------------------------------------------------- RESPUESTA PÚBLICA

  it('la respuesta pública es SOLO infraestructura: tres avisos, sin recuentos de recursos', async () => {
    const r = await publicos().expect(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.scope).toBe('INFRASTRUCTURE');
    expect(r.body.alerts.map((a: Aviso) => a.code).sort()).toEqual([...INFRAESTRUCTURA].sort());
    for (const a of r.body.alerts as Aviso[]) {
      expect(a.state).toBe('OK');
      expect(a.action).toBeNull();
      expect(a.condition.length).toBeGreaterThan(10);
      expect(a.observed.length).toBeGreaterThan(0);
    }
    const texto = JSON.stringify(r.body);
    for (const prohibido of ['password', 'token', 'secret', 'postgres://', 'redis://', '@']) {
      expect(texto.toLowerCase()).not.toContain(prohibido.toLowerCase());
    }
  });

  it('CON ACTIVIDAD REAL: la respuesta anónima no revela identificadores, recuentos ni organización, y el control autorizado prueba que el dato existía', async () => {
    const antes = (await publicos().expect(200)).body as Respuesta;

    // Se provoca actividad REAL y protegida en orgA: un documento sin análisis limpio y una entrega DEAD.
    const adminAId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${ADMIN_A}`.execute(h.db)).rows[0].id;
    await documentoPendiente(orgA, ADMIN_A, adminAId);
    eventoMuerto = await entregaMuerta(orgA);

    const despues = (await publicos().expect(200)).body as Respuesta;
    const texto = JSON.stringify(despues);

    // 1) No aparecen siquiera los códigos de los avisos de actividad.
    for (const code of OPERATIVOS) expect(despues.alerts.map((a) => a.code)).not.toContain(code);
    // 2) Ningún identificador: ni UUID alguno, ni correos, ni el nombre de la organización.
    expect(texto).not.toMatch(UUID_RE);
    expect(texto).not.toContain(orgA);
    expect(texto).not.toContain('Coop Avisos');
    expect(texto).not.toContain('@test.local');
    // 3) Ningún recuento de recurso protegido.
    expect(texto).not.toMatch(/\d+\s*(versión|versiones|entrega|entregas|documento|documentos)/i);
    // 4) Ningún detalle por organización.
    expect(despues.scope).toBe('INFRASTRUCTURE');
    expect(despues.organization_id).toBeUndefined();
    // 5) Y es INSENSIBLE a la actividad: idéntica antes y después.
    expect(despues.alerts).toEqual(antes.alerts);
    expect(despues.status).toBe(antes.status);

    // CONTROL AUTORIZADO: el dato existía de verdad y se reservó; no es que no hubiera nada.
    const propia = (await deOrg(orgA, ADMIN_A).expect(200)).body as Respuesta;
    expect(buscar(propia, 'DOCUMENTS_PENDING_ANALYSIS').state).toBe('FIRING');
    expect(buscar(propia, 'DOCUMENTS_PENDING_ANALYSIS').observed).toMatch(/1 versión/);
    expect(buscar(propia, 'EVENT_DELIVERIES_DEAD').state).toBe('FIRING');
    expect(buscar(propia, 'EVENT_DELIVERIES_DEAD').observed).toMatch(/1 entrega/);
  });

  // ---------------------------------------------------------------- RESPUESTA RESTRINGIDA

  it('la ruta por organización exige sesión y membresía, con control autorizado', async () => {
    await http().get(`/api/v1/organizations/${orgA}/operations/alerts`).expect(401);          // anónimo
    await deOrg(orgA, COMPRADOR).expect(404);                                                  // miembro de otra organización
    await deOrg(orgB, COMPRADOR).expect(200);                                                  // CONTROL: en la suya sí entra
  });

  it('no hay detalle entre organizaciones: cada una ve lo suyo en el mismo instante', async () => {
    const a = (await deOrg(orgA, ADMIN_A).expect(200)).body as Respuesta;
    const b = (await deOrg(orgB, ADMIN_B).expect(200)).body as Respuesta;
    expect(a.organization_id).toBe(orgA);
    expect(b.organization_id).toBe(orgB);
    // La actividad está en A; B la ve en CERO, no hereda el recuento global.
    expect(buscar(a, 'DOCUMENTS_PENDING_ANALYSIS').observed).toMatch(/1 versión/);
    expect(buscar(b, 'DOCUMENTS_PENDING_ANALYSIS').observed).toMatch(/0 versión/);
    expect(buscar(b, 'DOCUMENTS_PENDING_ANALYSIS').state).toBe('OK');
    expect(buscar(a, 'EVENT_DELIVERIES_DEAD').observed).toMatch(/1 entrega/);
    expect(buscar(b, 'EVENT_DELIVERIES_DEAD').observed).toMatch(/0 entrega/);
    expect(buscar(b, 'EVENT_DELIVERIES_DEAD').state).toBe('OK');
    expect(JSON.stringify(b)).not.toContain(orgA);
  });

  it('cada aviso exige el permiso que ya gobierna ese dato; sin él sale RESTRICTED y SIN valor', async () => {
    // AUDITOR de orgA: tiene document:read, NO tiene events:reprocess.
    const r = (await deOrg(orgA, AUDITOR).expect(200)).body as Respuesta;
    // CONTROL AUTORIZADO en la misma respuesta: el aviso que sí puede ver trae su valor.
    const doc = buscar(r, 'DOCUMENTS_PENDING_ANALYSIS');
    expect(doc.state).toBe('FIRING');
    expect(doc.observed).toMatch(/1 versión/);
    // Y el que no puede ver sale reservado, declarando el permiso y NINGÚN número.
    const ev = buscar(r, 'EVENT_DELIVERIES_DEAD');
    expect(ev.state).toBe('RESTRICTED');
    expect(ev.observed).toContain('events:reprocess');
    expect(ev.observed).not.toMatch(/\d/);
    expect(ev.action).toBeNull();

    // BUYER de orgB no tiene ninguno de los dos: los dos reservados, ninguno con valor.
    const b = (await deOrg(orgB, COMPRADOR).expect(200)).body as Respuesta;
    for (const code of OPERATIVOS) {
      expect(buscar(b, code).state).toBe('RESTRICTED');
      expect(buscar(b, code).observed).not.toMatch(/\d/);
    }
    // Un aviso reservado NO se concluye como degradación: no se opina sobre lo que no se miró.
    expect(b.status).toBe('ok');
  });

  it('ALCANCE POR RECURSO: `document:read` no publica el total de la organización a quien solo lee lo asignado', async () => {
    const adminAId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${ADMIN_A}`.execute(h.db)).rows[0].id;
    const contar = async (actor: string) => {
      const r = (await deOrg(orgA, actor).expect(200)).body as Respuesta;
      return buscar(r, 'DOCUMENTS_PENDING_ANALYSIS');
    };

    // Punto de partida de cada técnico, antes de tocar nada.
    const base1 = Number(/^(\d+)/.exec((await contar(TEC_1)).observed)![1]);
    const base2 = Number(/^(\d+)/.exec((await contar(TEC_2)).observed)![1]);
    const baseAdmin = Number(/^(\d+)/.exec((await contar(ADMIN_A)).observed)![1]);

    // Un documento pendiente cuyo titular está asignado SOLO al técnico 1.
    await documentoPendiente(orgA, ADMIN_A, adminAId, TEC_1);

    const t1 = await contar(TEC_1);
    const t2 = await contar(TEC_2);
    const adm = await contar(ADMIN_A);

    // El técnico 1 lo ve: está en su alcance (CONTROL de que el documento existe y se cuenta de verdad).
    expect(Number(/^(\d+)/.exec(t1.observed)![1])).toBe(base1 + 1);
    expect(t1.state).toBe('FIRING');
    // El técnico 2 NO: ni el recuento ni el estado derivado cambian para él.
    expect(Number(/^(\d+)/.exec(t2.observed)![1])).toBe(base2);
    // El administrador, con alcance de organización, sí lo ve.
    expect(Number(/^(\d+)/.exec(adm.observed)![1])).toBe(baseAdmin + 1);

    // Y el recuento del técnico coincide con lo que la LISTA de documentos le deja ver: misma autorización.
    const visibles = (await http().get(`/api/v1/organizations/${orgA}/documents`).set(as(TEC_2)).expect(200)).body as unknown[];
    expect(Number(/^(\d+)/.exec(t2.observed)![1])).toBeLessThanOrEqual(visibles.length);
    // Quien no tiene alcance completo lo dice en lo observado, para no leerse como total de la organización.
    expect(t2.observed).toMatch(/dentro de tu alcance/);
    expect(adm.observed).not.toMatch(/dentro de tu alcance/);
  });

  it('ALCANCE POR RECURSO: el auditor conserva el total, porque su permiso SÍ es de organización', async () => {
    const adm = buscar((await deOrg(orgA, ADMIN_A).expect(200)).body as Respuesta, 'DOCUMENTS_PENDING_ANALYSIS');
    const aud = buscar((await deOrg(orgA, AUDITOR).expect(200)).body as Respuesta, 'DOCUMENTS_PENDING_ANALYSIS');
    expect(aud.observed).toBe(adm.observed);
    expect(aud.observed).not.toMatch(/dentro de tu alcance/);
  });

  it('la recuperación se reconoce también en la ruta restringida', async () => {
    await sql`UPDATE event_deliveries SET status = 'PENDING', attempts = 0 WHERE event_id = ${eventoMuerto}`.execute(h.db);
    const r = (await deOrg(orgA, ADMIN_A).expect(200)).body as Respuesta;
    expect(buscar(r, 'EVENT_DELIVERIES_DEAD').state).toBe('OK');
    expect(buscar(r, 'EVENT_DELIVERIES_DEAD').observed).toMatch(/0 entrega/);
  });

  // ---------------------------------------------------------------- FALLOS INDUCIDOS

  it('cada aviso declara si es degradación o indisponibilidad', async () => {
    const r = (await publicos().expect(200)).body as Respuesta;
    expect(buscar(r, 'CORE_DEPENDENCY_DOWN').degradacion).toBe(false);
    expect(buscar(r, 'SCHEMA_CODE_MISMATCH').degradacion).toBe(false);
    expect(buscar(r, 'DOCUMENT_ANALYSIS_UNAVAILABLE').degradacion).toBe(true);
    const o = (await deOrg(orgA, ADMIN_A).expect(200)).body as Respuesta;
    for (const code of OPERATIVOS) expect(buscar(o, code).degradacion).toBe(true);
  });

  it('FALLO INDUCIDO — escáner caído: degradación, no caída, y nunca análisis limpio', async () => {
    escanerVivo = false;
    const r = await publicos().expect(200);   // **200**: la API sigue atendiendo
    expect(r.body.status).toBe('degraded');
    const a = buscar(r.body, 'DOCUMENT_ANALYSIS_UNAVAILABLE');
    expect(a.state).toBe('FIRING');
    expect(a.degradacion).toBe(true);
    expect(a.action).toMatch(/PENDIENTE/);
    expect(a.action).toMatch(/No se aprueban como limpios/);
    expect(buscar(r.body, 'CORE_DEPENDENCY_DOWN').state).toBe('OK');
    // `/health/ready` dice lo mismo: una sola fuente, sin contradicción.
    const ready = await http().get('/health/ready').expect(200);
    expect(ready.body).toMatchObject({ status: 'degraded', capabilities: { document_analysis: 'UNAVAILABLE' } });

    // RECUPERACIÓN reconocible: vuelve a OK solo, sin intervención.
    escanerVivo = true;
    const r2 = await publicos().expect(200);
    expect(buscar(r2.body, 'DOCUMENT_ANALYSIS_UNAVAILABLE').state).toBe('OK');
    expect(r2.body.status).toBe('ok');
  });

  it('FALLO INDUCIDO — Redis cortado: indisponibilidad del núcleo, y recuperación al restaurarlo', async () => {
    await proxy.stop();
    const r = await publicos().expect(503);
    expect(r.body.status).toBe('unavailable');
    const a = buscar(r.body, 'CORE_DEPENDENCY_DOWN');
    expect(a.state).toBe('FIRING');
    expect(a.degradacion).toBe(false);
    expect(a.observed).toMatch(/redis/);    // dice QUÉ dependencia, sin trazas ni cadenas de conexión
    expect(a.action).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/ECONNREFUSED|stack|redis:\/\//i);

    await proxy.start(proxy.port);
    let estado = '';
    for (let i = 0; i < 20 && estado !== 'OK'; i++) {
      estado = buscar((await publicos()).body, 'CORE_DEPENDENCY_DOWN').state;
      if (estado !== 'OK') await new Promise((r2) => setTimeout(r2, 250));
    }
    expect(estado).toBe('OK');
  });

  it('no inventa objetivos ni umbrales: ninguna de las dos respuestas declara p95, SLO ni disponibilidad', async () => {
    const textos = [
      JSON.stringify((await publicos().expect(200)).body),
      JSON.stringify((await deOrg(orgA, ADMIN_A).expect(200)).body),
    ];
    for (const texto of textos) {
      for (const inventado of ['p95', 'p99', 'slo', 'sla', 'uptime', 'percentil', '99.9']) {
        expect(texto.toLowerCase()).not.toContain(inventado);
      }
    }
  });
});
