import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildOpenApi } from '../src/bootstrap';
import { sql } from 'kysely';
import { describeDb, setupHarness } from './helpers';

// QA-01/QA-02 (docs/16 «Comprobaciones críticas de seguridad»): barrido SISTEMÁTICO de TODA la superficie HTTP descrita en el OpenAPI, no módulo a módulo.
// Base desechable `*_test` y datos sintéticos. Tres barridos: (1) sin credenciales, (2) usuario de OTRA organización sobre las rutas de una organización ajena,
// (3) rol de solo lectura (AUDITOR) sobre las escrituras de su propia organización. Un 2xx donde no corresponde o un 5xx es un hallazgo.
type Ruta = { metodo: 'get' | 'post' | 'put' | 'patch' | 'delete'; plantilla: string; multipart: boolean; consultaObligatoria: string[] };

// Rutas que SON públicas por diseño (cada una con su razón); cualquier otra sin credenciales debe responder 401.
const PUBLICAS: Record<string, string> = {
  'get /health/live': 'sonda de vida',
  'get /health/ready': 'sonda de disponibilidad',
  'get /operations/alerts': 'salud de la infraestructura SIN recuentos ni datos de organizaciones (operations/alerts.ts, revisión 2026-10-17)',
  'get /version': 'versión y esquema desplegados, sin datos de negocio',
  'post /api/v1/auth/login': 'inicio de sesión',
  'post /api/v1/invitations/preview': 'vista previa por token de invitación',
  'post /api/v1/invitations/accept': 'aceptación por token de invitación',
  'get /api/v1/public-references/{reference}': 'referencia pública (RF-47) sin datos privados',
  'get /api/v1/public-references/{reference}/qr.svg': 'QR de la referencia pública',
  'get /api/v1/auth/sso/config': 'configuración pública del acceso federado',
  'post /api/v1/auth/sso/start': 'inicio del flujo federado',
  'post /api/v1/auth/sso/callback': 'retorno del flujo federado',
  'get /api/v1/catalog/organization-types': 'catálogo público de tipos',
};

// Descriptores ESTÁTICOS bajo una ruta de organización: no leen ningún dato de la organización (el contenido es el mismo para todos) y exigen sesión.
const ESTATICAS = new Set(['get /api/v1/organizations/{orgId}/exchange/format']);

// Tablas donde una petición DENEGADA puede dejar rastro legítimo: solo la bitácora (resultado DENIED).
const RASTRO_PERMITIDO = new Set(['audit_logs']);

describeDb('Barrido de la superficie HTTP (QA-01/QA-02)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  const rutas: Ruta[] = [];
  let orgA = '';
  let orgB = '';
  // Instancia SIN la pipe de validación: con ella, una escritura con cuerpo vacío responde 400 antes de llegar a la autorización y el barrido no probaría nada. Sin ella la petición
  // llega al servicio; si la autorización no es lo primero que ocurre, se ve como 2xx o 5xx.
  let cruda: INestApplication;
  const sustituir = (p: string, org: string) => p.replace('{orgId}', org).replace(/\{[^}]+\}/g, () => randomUUID());
  const llamar = (r: Ruta, url: string, token?: string, app?: INestApplication) => {
    const http = app ? request(app.getHttpServer()) : h.http();
    const req = (http as unknown as Record<string, (u: string) => import('supertest').Test>)[r.metodo](url);
    if (token) req.set({ Authorization: `Bearer ${token}` });
    // Parámetros OBLIGATORIOS (consulta o archivo) con valores sintéticos: así la petición supera la comprobación de forma y llega a la autorización.
    for (const q of r.consultaObligatoria) req.query({ [q]: randomUUID() });
    if (r.multipart) return req.field('operation_id', randomUUID()).attach('file', Buffer.from('{}'), { filename: 'sintetico.geojson', contentType: 'application/geo+json' });
    return r.metodo === 'get' || r.metodo === 'delete' ? req : req.send({});
  };

  beforeAll(async () => {
    h = await setupHarness();
    const doc = buildOpenApi(h.app);
    for (const [plantilla, ops] of Object.entries(doc.paths)) {
      for (const metodo of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const op = (ops as Record<string, { requestBody?: { content?: Record<string, unknown> }; parameters?: { in: string; name: string; required?: boolean }[] }>)[metodo];
        if (op) rutas.push({ metodo, plantilla, multipart: !!op.requestBody?.content?.['multipart/form-data'], consultaObligatoria: (op.parameters ?? []).filter((p) => p.in === 'query' && p.required).map((p) => p.name) });
      }
    }
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await h.http().post('/api/v1/organizations').set(h.as('super@test.local')).send({ name, organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Asociación A', 'admin-a@test.local');
    orgB = await mk('Asociación B', 'admin-b@test.local');
    const inv = await h.http().post(`/api/v1/organizations/${orgA}/invitations`).set(h.as('admin-a@test.local')).send({ email: 'auditor@test.local', role_code: 'AUDITOR' }).expect(201);
    await h.http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'A', last_name: 'B', password: 'password-de-prueba-123' }).expect(200);
    await h.login('auditor@test.local');
    cruda = await NestFactory.create(AppModule.forRoot(h.config, h.db), { logger: ['error'] });
    await cruda.init();
  }, 120_000);
  afterAll(async () => { await cruda?.close(); await h?.close(); });

  it('cabeceras de seguridad en las respuestas de la API (también en errores) y sin huella del framework', async () => {
    for (const [ruta, estado] of [['/health/live', 200], ['/api/v1/me', 401], ['/ruta-inexistente', 404]] as const) {
      const res = await h.http().get(ruta);
      expect(res.status).toBe(estado);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('el barrido cubre la superficie declarada', () => {
    expect(rutas.length).toBeGreaterThan(250);
  });

  it('sin credenciales: toda ruta responde 401, salvo las públicas por diseño (y sin 5xx)', async () => {
    const anomalas: string[] = [];
    for (const r of rutas) {
      const clave = `${r.metodo} ${r.plantilla}`;
      const res = await llamar(r, sustituir(r.plantilla, orgA));
      if (res.status >= 500) anomalas.push(`${clave} → ${res.status} (5xx)`);
      else if (PUBLICAS[clave]) continue;
      else if (res.status !== 401) anomalas.push(`${clave} → ${res.status} (se esperaba 401)`);
    }
    expect(anomalas).toEqual([]);
  }, 300_000);

  it('la lista de rutas públicas no contiene rutas inexistentes (se revisa al cambiar la superficie)', () => {
    const claves = new Set(rutas.map((r) => `${r.metodo} ${r.plantilla}`));
    expect(Object.keys(PUBLICAS).filter((k) => !claves.has(k))).toEqual([]);
  });

  it('usuario de OTRA organización: ninguna ruta de la organización A le entrega datos ni acepta escrituras (403/404)', async () => {
    const anomalas: string[] = [];
    for (const r of rutas.filter((x) => x.plantilla.includes('{orgId}'))) {
      const res = await llamar(r, sustituir(r.plantilla, orgA), h.tokens['admin-b@test.local'], cruda);
      if (ESTATICAS.has(`${r.metodo} ${r.plantilla}`) ? res.status !== 200 : ![403, 404].includes(res.status)) anomalas.push(`${r.metodo} ${r.plantilla} → ${res.status}`);
    }
    expect(anomalas).toEqual([]);
  }, 300_000);

  it('el propio usuario SÍ accede a su organización (control positivo A→A: el barrido no rompe todo acceso)', async () => {
    const res = await h.http().get(`/api/v1/organizations/${orgA}`).set(h.as('admin-a@test.local')).expect(200);
    expect(res.body.id).toBe(orgA);
    await h.http().get(`/api/v1/organizations/${orgB}`).set(h.as('admin-a@test.local')).expect((r) => expect([403, 404]).toContain(r.status));
  });

  it('sensibilidad del barrido: con el administrador PROPIO de A el mismo recorrido sí obtiene 2xx (si no, el barrido no detectaría una fuga)', async () => {
    const rutasOrg = rutas.filter((x) => x.plantilla.includes('{orgId}'));
    expect(rutasOrg.length).toBeGreaterThan(200);
    let exitosas = 0;
    for (const r of rutasOrg.filter((x) => x.metodo === 'get')) {
      const res = await llamar(r, sustituir(r.plantilla, orgA), h.tokens['admin-a@test.local'], cruda);
      if (res.status >= 200 && res.status < 300) exitosas++;
    }
    expect(exitosas).toBeGreaterThan(20);
  }, 300_000);

  it('CONTEOS: las escrituras denegadas (otra organización, plataforma y rol de solo lectura) no alteran el número de filas de ninguna tabla salvo la bitácora (no prueba que el contenido sea idéntico)', async () => {
    const conteos = async () => {
      const tablas = await sql<{ table_name: string }>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'kysely_migration' AND table_name <> 'kysely_migration_lock' ORDER BY 1`.execute(h.db);
      const out: Record<string, number> = {};
      for (const t of tablas.rows) out[t.table_name] = Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(t.table_name)}`.execute(h.db)).rows[0].n);
      return out;
    };
    const antes = await conteos();
    expect(Object.keys(antes).length).toBeGreaterThan(80); // control: se miró el esquema completo
    const escrituras = rutas.filter((x) => x.metodo !== 'get');
    for (const r of escrituras.filter((x) => x.plantilla.includes('{orgId}'))) {
      await llamar(r, sustituir(r.plantilla, orgA), h.tokens['admin-b@test.local'], cruda);
      await llamar(r, sustituir(r.plantilla, orgA), h.tokens['auditor@test.local'], cruda);
    }
    for (const r of escrituras.filter((x) => x.plantilla.includes('/platform/'))) await llamar(r, sustituir(r.plantilla, orgA), h.tokens['admin-a@test.local'], cruda);
    const despues = await conteos();
    const cambios = Object.keys(despues).filter((t) => despues[t] !== antes[t] && !RASTRO_PERMITIDO.has(t)).map((t) => `${t}: ${antes[t]} → ${despues[t]}`);
    expect(cambios).toEqual([]);
    // Sensibilidad: una escritura AUTORIZADA sí cambia una tabla y el mismo método la detecta.
    await h.http().post(`/api/v1/organizations/${orgA}/invitations`).set(h.as('admin-a@test.local')).send({ email: 'sensibilidad@test.local', role_code: 'AUDITOR' }).expect(201);
    const tras = await conteos();
    expect(Object.keys(tras).filter((t) => tras[t] !== despues[t] && !RASTRO_PERMITIDO.has(t)).length).toBeGreaterThan(0);
  }, 300_000);

  it('rutas de plataforma: un administrador de organización (sin SUPER_ADMIN) no accede a ninguna', async () => {
    const anomalas: string[] = [];
    for (const r of rutas.filter((x) => x.plantilla.includes('/platform/'))) {
      const res = await llamar(r, sustituir(r.plantilla, orgA), h.tokens['admin-a@test.local'], cruda);
      if (![403, 404].includes(res.status)) anomalas.push(`${r.metodo} ${r.plantilla} → ${res.status}`);
    }
    expect(anomalas).toEqual([]);
  }, 120_000);

  it('AUDITOR (solo lectura): ninguna escritura sobre su propia organización responde 2xx ni 5xx', async () => {
    const anomalas: string[] = [];
    for (const r of rutas.filter((x) => x.plantilla.includes('{orgId}') && x.metodo !== 'get')) {
      const res = await llamar(r, sustituir(r.plantilla, orgA), h.tokens['auditor@test.local'], cruda);
      if (res.status < 300 || res.status >= 500) anomalas.push(`${r.metodo} ${r.plantilla} → ${res.status}`);
    }
    expect(anomalas).toEqual([]);
  }, 300_000);
});
