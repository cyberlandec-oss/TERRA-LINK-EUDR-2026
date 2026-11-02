import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// P1-015 (RF-46; `docs/18:216`) — Límites y consumo.
//
// Lo que estas pruebas protegen:
//   · que los límites publicados sean **los que el producto aplica de verdad** —se comprueba superando uno
//     y viendo el rechazo—, no una lista escrita a mano;
//   · que el **consumo no se presente como coste**, porque no hay tarifa;
//   · que **no se insinúe un SSO** que no existe;
//   · que el **español** sea el idioma declarado y disponible;
//   · permisos y aislamiento entre organizaciones.
describeDb('P1-015 límites y consumo (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let productor: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const SUPER = 'super@test.local';
  const ADMIN = 'admin-lim@test.local';
  const ADMIN_B = 'admin-limb@test.local';
  const TEC = 'tecnico-lim@test.local';

  interface Limite { code: string; label: string; what: string; value: number | string; unit: string; source: string; enforced_at: string; on_exceed: string }
  interface Vista {
    limits: Limite[];
    usage: { documents: number; document_versions: number; stored_bytes: number; quota_bytes: number; quota_note: string; plots: number; deliveries: number; events: number };
    language: { primary: string; available: string[]; note: string };
    cost_note: string; sso_note: string; note: string;
    cost: { currency: string; unit: string; note: string };
    sso: { enabled: boolean; method: string; local_login_kept: boolean };
  }
  const ver = async (actor = ADMIN, org = orgA) =>
    (await http().get(`${api(org)}/limits`).set(as(actor)).expect(200)).body as Vista;
  const pdf = () => Buffer.from(`%PDF-1.4\n% sintetico ${randomUUID()}\n%%EOF\n`);

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Limites A', ADMIN);
    orgB = await mk('Coop Limites B', ADMIN_B);
    const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email: TEC, role_code: 'FIELD_TECHNICIAN' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'X', last_name: 'Y', password: PASSWORD }).expect(200);
    await h.login(TEC);
    productor = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'LIM-P1', legal_name: 'Finca Limites' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('cada límite dice qué limita, de dónde sale y qué pasa al superarlo', async () => {
    const v = await ver();
    expect(v.limits.length).toBeGreaterThanOrEqual(8);
    for (const l of v.limits) {
      expect(l.code).toBeTruthy();
      expect(l.what.length).toBeGreaterThan(10);
      expect(l.value).not.toBeNull();
      expect(l.unit).toBeTruthy();
      expect(l.source).toMatch(/variables? de entorno|constante del código|dependencia fijada/);
      expect(l.enforced_at.length).toBeGreaterThan(5);
      expect(l.on_exceed.length).toBeGreaterThan(10);
    }
  });

  it('EL LÍMITE PUBLICADO ES EL QUE SE APLICA: se supera uno y el producto lo rechaza', async () => {
    const v = await ver();
    const limite = v.limits.find((l) => l.code === 'DOCUMENT_MAX_BYTES')!;
    const bytes = Number(limite.value);
    expect(bytes).toBeGreaterThan(0);

    // Justo por encima del límite publicado: el producto lo rechaza, y con el código que la respuesta anuncia.
    const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes + 1, 0x20)]);
    const r = await http().post(`${api(orgA)}/documents`).set(as(ADMIN))
      .field('operation_id', randomUUID()).field('document_type', 'DELIVERY_SUPPORT')
      .field('owner_type', 'producer').field('owner_id', productor).field('title', 'Grande')
      .attach('file', grande, { filename: 'grande.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('FILE_TOO_LARGE');
    expect(limite.on_exceed).toMatch(/FILE_TOO_LARGE/);
  });

  it('EL CONSUMO SE MIDE DE VERDAD: subir un documento lo mueve', async () => {
    const antes = await ver();
    await http().post(`${api(orgA)}/documents`).set(as(ADMIN))
      .field('operation_id', randomUUID()).field('document_type', 'DELIVERY_SUPPORT')
      .field('owner_type', 'producer').field('owner_id', productor).field('title', 'Consumo')
      .attach('file', pdf(), { filename: 'c.pdf', contentType: 'application/pdf' }).expect(201);
    const despues = await ver();
    expect(despues.usage.documents).toBe(antes.usage.documents + 1);
    expect(despues.usage.document_versions).toBe(antes.usage.document_versions + 1);
    expect(despues.usage.stored_bytes).toBeGreaterThan(antes.usage.stored_bytes);
    // Y el denominador es la cuota configurada, dicho explícitamente.
    expect(despues.usage.quota_bytes).toBeGreaterThan(0);
    expect(despues.usage.quota_note).toMatch(/El denominador es la cuota configurada/);
  });

  it('EL CONSUMO NO ES UN COSTE; el SSO se declara como lo que es (implementado, deshabilitado aquí)', async () => {
    const v = await ver();
    expect(v.cost_note).toMatch(/NO es un coste por sí mismo/i);
    expect(v.cost_note).toMatch(/tarifas declaradas/i);
    expect(v.sso_note).toMatch(/autenticación es local/i);
    expect(v.sso_note).toMatch(/deshabilitado en este despliegue/i);
    expect(v.sso_note).toMatch(/No hay conectado ningún proveedor de identidad de un cliente/i);
    // Ninguna cifra del consumo viene con símbolo de moneda ni se llama «importe».
    expect(JSON.stringify(v.usage)).not.toMatch(/USD|EUR|importe|precio|tarifa/i);
  });

  it('ESPAÑOL PRIMERO, con inglés como segunda lengua: el español es fuente y reserva', async () => {
    const v = await ver();
    expect(v.language.primary).toBe('es');
    expect(v.language.available).toEqual(['es', 'en']);
    expect(v.language.note).toMatch(/lengua fuente y de reserva/i);
    expect(v.language.note).toMatch(/no son traducciones jurídicas certificadas/i);
    // Y los textos que el producto publica aquí están en español, no son claves de traducción.
    const textos = [v.cost_note, v.sso_note, v.note, ...v.limits.map((l) => l.what)];
    for (const t of textos) {
      expect(t).not.toMatch(/^[a-z]+(\.[a-z_]+)+$/);   // nada como «errors.document.too_large»
      expect(t).toMatch(/[áéíóúñ¿¡]|\b(de|la|el|no|que|los|las)\b/i);
    }
  });

  it('INGLÉS: los límites se publican traducidos, con los mismos valores y códigos; sin traducción cae al español', async () => {
    const es = await ver();
    const en = (await http().get(`${api(orgA)}/limits?lang=en`).set(as(ADMIN)).expect(200)).body as Vista & { lang: string };
    expect(en.lang).toBe('en');
    expect(en.limits.map((l) => l.code)).toEqual(es.limits.map((l) => l.code));
    expect(en.limits.map((l) => l.value)).toEqual(es.limits.map((l) => l.value));
    const tam = en.limits.find((l) => l.code === 'DOCUMENT_MAX_BYTES')!;
    expect(tam.label).toBe('Maximum size of a document');
    expect(tam.on_exceed).toMatch(/FILE_TOO_LARGE/);
    // Ningún campo es una clave de traducción ni queda vacío.
    for (const l of en.limits) for (const t of [l.label, l.what, l.on_exceed, l.enforced_at]) {
      expect(t.length).toBeGreaterThan(3);
      expect(t).not.toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
    expect(en.cost_note).toMatch(/NOT a cost by itself/);
    expect(en.language.note).toMatch(/not certified legal translations/);
    // Un idioma desconocido no rompe nada: responde en español.
    const raro = (await http().get(`${api(orgA)}/limits?lang=xx`).set(as(ADMIN)).expect(200)).body as Vista & { lang: string };
    expect(raro.lang).toBe('es');
  });

  it('SUPERAR UN LÍMITE SE RECHAZA CON EXPLICACIÓN y sin sobrecoste automático', async () => {
    const v = await ver();
    const limite = v.limits.find((l) => l.code === 'DOCUMENT_MAX_BYTES')!;
    const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(Number(limite.value) + 1, 0x20)]);
    const r = await http().post(`${api(orgA)}/documents`).set(as(ADMIN))
      .field('operation_id', randomUUID()).field('document_type', 'DELIVERY_SUPPORT')
      .field('owner_type', 'producer').field('owner_id', productor).field('title', 'Grande 2')
      .attach('file', grande, { filename: 'grande2.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(422);
    expect(r.body.error.message.length).toBeGreaterThan(15);
    expect(v.note).toMatch(/no se cobra nada automáticamente/i);
  });

  it('NO FIJA NINGÚN LÍMITE: la superficie es de solo lectura', async () => {
    expect((await http().post(`${api(orgA)}/limits`).set(as(ADMIN)).send({})).status).toBe(404);
    expect((await http().patch(`${api(orgA)}/limits`).set(as(ADMIN)).send({})).status).toBe(404);
  });

  it('PERMISOS Y AISLAMIENTO: cada organización ve su consumo, y nadie el ajeno', async () => {
    // El técnico pertenece a la organización: lee su consumo.
    await http().get(`${api(orgA)}/limits`).set(as(TEC)).expect(200);
    // El admin de B no alcanza A, ni al revés: 404 opaco.
    expect((await http().get(`${api(orgA)}/limits`).set(as(ADMIN_B))).status).toBe(404);
    expect((await http().get(`${api(orgB)}/limits`).set(as(ADMIN))).status).toBe(404);
    // Y el consumo de A no incluye nada de B.
    const a = await ver(ADMIN, orgA);
    const b = await ver(ADMIN_B, orgB);
    expect(b.usage.documents).toBe(0);
    expect(a.usage.documents).toBeGreaterThan(0);
  });
});
