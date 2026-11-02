import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pdfConTexto, pdfEscaneado, pngMinimo } from './pdf-sintetico';

// P1-013 (RF-44; S1 §55) — Extracción asistida de documentos.
//
// Casos exigidos, con archivos SINTÉTICOS de verdad (PDF válidos construidos en la prueba):
//   · **extracción correcta** sobre un PDF con capa de texto;
//   · **información ausente**: un documento sin los datos buscados;
//   · **resultados ambiguos**: varias fechas → no se sugiere ninguna;
//   · **documento sustituido**: una versión nueva no hereda la extracción anterior;
//   · **acceso denegado**: datos personales sin permiso de contenido, y confirmar sin permiso de revisión.
//
// Y lo que no puede romperse: el texto extraído, el valor sugerido y el dato confirmado son **tres cosas
// distintas**; nada se sobrescribe; nada sale a un servicio externo.
describeDb('P1-013 extracción asistida (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let productor: string;
  let productorDelTecnico: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const SUPER = 'super@test.local';
  const ADMIN = 'admin-ex@test.local';   // document:extract + document:review + identidad
  const GESTOR = 'gestor-ex@test.local'; // MANAGER: extract sí, review NO
  const TEC = 'tecnico-ex@test.local';   // sube documentos, pero NO tiene document:extract
  const AUDITOR = 'auditor-ex@test.local'; // lee documentos, pero NO lee identidad: sin contenido personal

  interface Campo {
    id: string; field_code: string;
    suggestion: { value: string | null; basis: string; confidence: string; basis_note: string; source_excerpt: string | null; source_offset: number | null; candidates: Array<{ value: string }> };
    review: { decision: string; confirmed_value: string | null; reason: string | null; decided_by: string } | null;
    state: string;
  }
  interface Vista {
    document: { id: string; title: string; classification: string };
    version: { id: string; version_number: number; mime_type: string; sha256: string; scan: string | null; is_current: boolean };
    version_note: string; supported: boolean;
    extraction: { id: string; run_number: number; status: string; engine: string; engine_version: string; source_sha256: string; text_chars: number; pages: number | null; note: string; extracted_text: string | null } | null;
    engine_limits: string;
    fields: Campo[];
    history: Array<{ run_number: number; status: string }>;
    can_review: boolean; disclaimer: string; no_external: string;
  }

  async function subir(actor: string, bytes: Buffer, tipo = 'DELIVERY_SUPPORT', nombre = 'doc.pdf', mime = 'application/pdf', duenio?: string) {
    const r = await http().post(`${api(orgA)}/documents`).set(as(actor))
      .field('operation_id', randomUUID()).field('document_type', tipo)
      .field('owner_type', 'producer').field('owner_id', duenio ?? productor).field('title', `Doc ${nombre}`)
      .attach('file', bytes, { filename: nombre, contentType: mime });
    if (r.status !== 201) throw new Error(`subir documento: ${r.status} ${JSON.stringify(r.body?.error ?? {})}`);
    return r.body.document;
  }
  async function nuevaVersion(actor: string, docId: string, bytes: Buffer, nombre = 'doc-v2.pdf') {
    const r = await http().post(`${api(orgA)}/documents/${docId}/versions`).set(as(actor))
      .field('operation_id', randomUUID())
      .attach('file', bytes, { filename: nombre, contentType: 'application/pdf' });
    if (r.status !== 201) throw new Error(`nueva versión: ${r.status} ${JSON.stringify(r.body?.error ?? {})}`);
    return r.body.document;
  }
  const ruta = (d: string, v: string) => `${api(orgA)}/documents/${d}/versions/${v}/extraction`;
  const extraer = (actor: string, d: string, v: string) =>
    http().post(ruta(d, v)).set(as(actor)).send({ operation_id: randomUUID() });
  const ver = async (actor: string, d: string, v: string) =>
    (await http().get(ruta(d, v)).set(as(actor)).expect(200)).body as Vista;

  const CERTIFICADO = [
    'CERTIFICADO DE SOPORTE DE ENTREGA',
    'Emitido por: Registro de la Propiedad de Manabi',
    'Fecha de emision: 2026-03-04',
    'Vigente hasta: 2027-03-04',
    'Observaciones: documento sintetico de prueba.',
  ];

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    orgA = (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: 'Coop Extraccion', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id;
    for (const [correo, rol] of [[GESTOR, 'MANAGER'], [TEC, 'FIELD_TECHNICIAN'], [AUDITOR, 'AUDITOR']] as const) {
      const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email: correo, role_code: rol }).expect(201);
      await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'X', last_name: 'Y', password: PASSWORD }).expect(200);
      await h.login(correo);
    }
    productor = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'EX-P1', legal_name: 'Finca Extraccion' }).expect(201)).body.id;
    // El técnico solo trabaja con productores ASIGNADOS: hace falta uno suyo para que pueda subir.
    const mt = (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.id').where('u.email', '=', TEC).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;
    productorDelTecnico = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN))
      .send({ producer_code: 'EX-P2', legal_name: 'Finca del tecnico', assigned_membership_id: mt }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('EXTRACCIÓN CORRECTA: texto del archivo, sugerencias con procedencia y nada confirmado todavía', async () => {
    const d = await subir(ADMIN, pdfConTexto(CERTIFICADO));
    const v = d.versions[0];
    const r = (await extraer(ADMIN, d.id, v.id).expect(201)).body as Vista;

    // 1) TEXTO EXTRAÍDO: sale del archivo, con su motor y la huella del contenido analizado.
    expect(r.extraction!.status).toBe('EXTRAIDA');
    expect(r.extraction!.engine).toBe('pdfjs-dist');
    expect(r.extraction!.source_sha256).toBe(r.version.sha256);
    expect(r.extraction!.extracted_text).toContain('Registro de la Propiedad de Manabi');
    expect(r.extraction!.text_chars).toBeGreaterThan(50);
    expect(r.extraction!.note).toMatch(/en local/i);
    expect(r.extraction!.note).toMatch(/ningún fragmento quedó sin mapear/i);

    // 2) VALOR SUGERIDO: con su fragmento de origen, su posición y la regla que lo propuso.
    const emisor = r.fields.find((f) => f.field_code === 'ISSUER')!;
    expect(emisor.suggestion.value).toBe('Registro de la Propiedad de Manabi');
    expect(emisor.suggestion.basis).toBe('ETIQUETA_EXPLICITA');
    expect(emisor.suggestion.confidence).toBe('ALTA');
    expect(emisor.suggestion.source_excerpt).toContain('Emitido por');
    expect(emisor.suggestion.basis_note).toMatch(/rotula/i);
    expect(r.fields.find((f) => f.field_code === 'ISSUED_AT')!.suggestion.value).toBe('2026-03-04');
    expect(r.fields.find((f) => f.field_code === 'EXPIRES_AT')!.suggestion.value).toBe('2027-03-04');

    // 3) DATO CONFIRMADO: todavía no hay ninguno. Sugerir no es confirmar.
    expect(r.fields.every((f) => f.review === null && f.state === 'PENDIENTE_DE_REVISION')).toBe(true);
    expect(r.disclaimer).toMatch(/NO acredita autenticidad, legalidad, calidad ni suficiencia/i);
    expect(r.no_external).toMatch(/Ningún archivo ni dato personal sale/i);
  });

  it('NO SOBRESCRIBE la versión del documento: confirmar registra, no pisa', async () => {
    const d = await subir(ADMIN, pdfConTexto(CERTIFICADO));
    const v = d.versions[0];
    const antes = await h.db.selectFrom('document_versions').select(['issuer', 'issued_at', 'expires_at'])
      .where('id', '=', v.id).executeTakeFirstOrThrow();
    const r = (await extraer(ADMIN, d.id, v.id).expect(201)).body as Vista;
    const emisor = r.fields.find((f) => f.field_code === 'ISSUER')!;
    await http().post(`${ruta(d.id, v.id)}/fields/${emisor.id}/review`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), decision: 'CONFIRMADO' }).expect(201);

    const despues = await h.db.selectFrom('document_versions').select(['issuer', 'issued_at', 'expires_at'])
      .where('id', '=', v.id).executeTakeFirstOrThrow();
    expect(despues).toEqual(antes);
    // Pero el dato confirmado SÍ consta, en su propio registro y con su autor.
    const d2 = await ver(ADMIN, d.id, v.id);
    const e2 = d2.fields.find((f) => f.field_code === 'ISSUER')!;
    expect(e2.state).toBe('CONFIRMADO');
    expect(e2.review!.confirmed_value).toBe('Registro de la Propiedad de Manabi');
    expect(e2.review!.decided_by).toBe(ADMIN);
  });

  it('INFORMACIÓN AUSENTE: se publica la ausencia, no un valor inventado', async () => {
    const d = await subir(ADMIN, pdfConTexto(['ACTA SIMPLE', 'Sin emisor rotulado ni fechas.']));
    const r = (await extraer(ADMIN, d.id, d.versions[0].id).expect(201)).body as Vista;
    expect(r.extraction!.status).toBe('EXTRAIDA');
    expect(r.fields).toHaveLength(3);
    expect(r.fields.every((f) => f.suggestion.value === null)).toBe(true);
    expect(r.fields.every((f) => f.suggestion.basis === 'PATRON_AMBIGUO')).toBe(true);
    expect(r.fields.every((f) => f.suggestion.basis_note.includes('NO se sugiere valor'))).toBe(true);
  });

  it('RESULTADO AMBIGUO: con varias fechas no se elige ninguna, y se listan los candidatos', async () => {
    const d = await subir(ADMIN, pdfConTexto(['REGISTRO', 'Visita 2025-01-02', 'Revision 2026-07-08', 'Control 2027-09-10']));
    const r = (await extraer(ADMIN, d.id, d.versions[0].id).expect(201)).body as Vista;
    const f = r.fields.find((x) => x.field_code === 'ISSUED_AT')!;
    expect(f.suggestion.value).toBeNull();
    expect(f.suggestion.confidence).toBe('BAJA');
    expect(f.suggestion.candidates.map((c) => c.value)).toEqual(['2025-01-02', '2026-07-08', '2027-09-10']);

    // Confirmar sin escribir valor se rechaza: no hay nada que dar por bueno.
    const sinValor = await http().post(`${ruta(d.id, d.versions[0].id)}/fields/${f.id}/review`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), decision: 'CONFIRMADO' });
    expect(sinValor.status).toBe(422);
    expect(sinValor.body.error.code).toBe('VALUE_REQUIRED');

    // La persona elige uno de los candidatos: eso sí vale, y queda como SUYO.
    await http().post(`${ruta(d.id, d.versions[0].id)}/fields/${f.id}/review`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), decision: 'CONFIRMADO', confirmed_value: '2026-07-08' }).expect(201);
    const d2 = await ver(ADMIN, d.id, d.versions[0].id);
    const f2 = d2.fields.find((x) => x.field_code === 'ISSUED_AT')!;
    expect(f2.review!.confirmed_value).toBe('2026-07-08');
    expect(f2.suggestion.value).toBeNull();   // la sugerencia sigue vacía: no se reescribe
  });

  it('DESCARTAR exige motivo, y lo decidido no se pisa', async () => {
    const d = await subir(ADMIN, pdfConTexto(CERTIFICADO));
    const v = d.versions[0];
    const r = (await extraer(ADMIN, d.id, v.id).expect(201)).body as Vista;
    const f = r.fields.find((x) => x.field_code === 'EXPIRES_AT')!;

    const sinMotivo = await http().post(`${ruta(d.id, v.id)}/fields/${f.id}/review`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), decision: 'DESCARTADO' });
    expect(sinMotivo.status).toBe(422);
    expect(sinMotivo.body.error.code).toBe('REASON_REQUIRED');

    await http().post(`${ruta(d.id, v.id)}/fields/${f.id}/review`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), decision: 'DESCARTADO', reason: 'La fecha del sello no coincide con la del cuerpo.' }).expect(201);
    const d2 = await ver(ADMIN, d.id, v.id);
    expect(d2.fields.find((x) => x.field_code === 'EXPIRES_AT')!.state).toBe('DESCARTADO');

    // Una segunda decisión sobre el mismo campo se rechaza.
    const otra = await http().post(`${ruta(d.id, v.id)}/fields/${f.id}/review`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), decision: 'CONFIRMADO', confirmed_value: '2027-03-04' });
    expect(otra.status).toBe(409);
    expect(otra.body.error.code).toBe('ALREADY_REVIEWED');
    // Y las tablas son append-only de verdad.
    await expect(sql`UPDATE document_extraction_decisions SET decision = 'CONFIRMADO'`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM document_extraction_fields`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('DOCUMENTO SUSTITUIDO: la versión nueva no hereda la extracción anterior', async () => {
    const d = await subir(ADMIN, pdfConTexto(CERTIFICADO));
    const v1 = d.versions[0];
    await extraer(ADMIN, d.id, v1.id).expect(201);
    const d2 = await nuevaVersion(ADMIN, d.id, pdfConTexto(['ACTA CORREGIDA', 'Emitido por: Otra Entidad', 'Fecha de emision: 2026-05-05']));
    const v2 = d2.versions.find((x: { version_number: number }) => x.version_number === 2);

    // La extracción vieja sigue atada a la versión vieja, y se dice que ya no es la vigente.
    const vieja = await ver(ADMIN, d.id, v1.id);
    expect(vieja.version.is_current).toBe(false);
    expect(vieja.version_note).toMatch(/YA NO es la vigente/i);
    expect(vieja.extraction!.extracted_text).toContain('Registro de la Propiedad');

    // La nueva no tiene extracción: nada se arrastra.
    const nueva = await ver(ADMIN, d.id, v2.id);
    expect(nueva.version.is_current).toBe(true);
    expect(nueva.extraction).toBeNull();
    expect(nueva.fields).toEqual([]);

    // Y al extraerla, el texto es el de ESTE archivo.
    const r = (await extraer(ADMIN, d.id, v2.id).expect(201)).body as Vista;
    expect(r.extraction!.extracted_text).toContain('Otra Entidad');
    expect(r.extraction!.extracted_text).not.toContain('Registro de la Propiedad');
    expect(r.fields.find((f) => f.field_code === 'ISSUED_AT')!.suggestion.value).toBe('2026-05-05');
  });

  it('FORMATOS: un PNG no se manda a ningún OCR; se declara no soportado', async () => {
    const d = await subir(ADMIN, pngMinimo(), 'DELIVERY_SUPPORT', 'foto.png', 'image/png');
    const r = (await extraer(ADMIN, d.id, d.versions[0].id).expect(201)).body as Vista;
    expect(r.supported).toBe(false);
    expect(r.extraction!.status).toBe('FORMATO_NO_SOPORTADO');
    expect(r.extraction!.note).toMatch(/exigiría OCR/i);
    // Redacción corregida: la falta de OCR es LIMITACIÓN DEL MOTOR, no una obligación de usar terceros.
    expect(r.extraction!.note).toMatch(/este motor NO implementa OCR/i);
    expect(r.extraction!.note).toMatch(/motores de OCR que se ejecutan en local/i);
    expect(r.extraction!.note).not.toMatch(/NO tiene autorizado/i);
    expect(r.extraction!.note).toMatch(/no se envía el archivo a ningún tercero/i);
    expect(r.extraction!.extracted_text).toBeNull();
    expect(r.fields).toEqual([]);
  });

  it('PDF ESCANEADO: sin capa de texto se dice «sin texto», no se inventa contenido', async () => {
    const d = await subir(ADMIN, pdfEscaneado(), 'DELIVERY_SUPPORT', 'escaneo.pdf');
    const r = (await extraer(ADMIN, d.id, d.versions[0].id).expect(201)).body as Vista;
    expect(r.extraction!.status).toBe('SIN_TEXTO');
    expect(r.extraction!.text_chars).toBe(0);
    expect(r.extraction!.extracted_text).toBeNull();
    expect(r.extraction!.note).toMatch(/no tiene capa de texto/i);
    expect(r.fields).toEqual([]);
  });

  it('PDF DE OTRA HERRAMIENTA: ahora se lee de verdad, con acentos y sugerencias', async () => {
    // Fixture de una HERRAMIENTA INDEPENDIENTE (motor de impresión de Chromium), no del generador propio.
    const ajeno = readFileSync(join(__dirname, 'fixtures/chromium-capa-texto.pdf'));
    const d = await subir(ADMIN, ajeno, 'DELIVERY_SUPPORT', 'ajeno.pdf');
    const r = (await extraer(ADMIN, d.id, d.versions[0].id).expect(201)).body as Vista;
    expect(r.extraction!.status).toBe('EXTRAIDA');
    expect(r.extraction!.engine).toBe('pdfjs-dist');
    expect(r.extraction!.extracted_text).toContain('Registro de la Propiedad de Manabí');
    const emisor = r.fields.find((f) => f.field_code === 'ISSUER')!;
    expect(emisor.suggestion.value).toBe('Registro de la Propiedad de Manabí');
    expect(r.fields.find((f) => f.field_code === 'ISSUED_AT')!.suggestion.value).toBe('2026-03-04');
  });

  it('FUENTE SIN MAPA: se rechaza ENTERO aunque el texto pareciera legible', async () => {
    // Fuente compuesta sin `/ToUnicode`: lo que se obtendría parece texto («HIJK») pero NO es del documento.
    const sinMapa = readFileSync(join(__dirname, 'fixtures/fuente-sin-mapa.pdf'));
    const d = await subir(ADMIN, sinMapa, 'DELIVERY_SUPPORT', 'sin-mapa.pdf');
    const r = (await extraer(ADMIN, d.id, d.versions[0].id).expect(201)).body as Vista;
    expect(r.extraction!.status).toBe('TEXTO_NO_INTERPRETABLE');
    expect(r.extraction!.extracted_text).toBeNull();
    expect(r.extraction!.text_chars).toBe(0);
    expect(r.fields).toEqual([]);                       // NO se sugiere nada
    expect(r.extraction!.note).toMatch(/NO declaran su mapa «ToUnicode» en su propio diccionario/i);
    expect(r.extraction!.note).toMatch(/ToUnicode/);
    expect(r.engine_limits).toMatch(/NO acredita compatibilidad/i);
  });

  it('EL TEXTO EXTRAÍDO HEREDA la protección del documento de origen', async () => {
    const d = await subir(ADMIN, pdfConTexto(CERTIFICADO), 'LAND_TENURE', 'tenencia-clasificada.pdf');
    const v = d.versions[0];
    await extraer(ADMIN, d.id, v.id).expect(201);
    const visto = await ver(ADMIN, d.id, v.id);
    expect(visto.document.classification).toBe('PERSONAL_DATA');
    expect(visto.extraction!.extracted_text).toContain('Registro de la Propiedad');

    // Quien no lee identidad NO obtiene el texto por ninguna vía.
    expect((await http().get(ruta(d.id, v.id)).set(as(AUDITOR))).status).toBe(403);
    const ficha = await http().get(`${api(orgA)}/documents/${d.id}`).set(as(AUDITOR));
    if (ficha.status === 200) {
      expect(JSON.stringify(ficha.body)).not.toContain('Registro de la Propiedad');
    }
  });

  it('DOS FUENTES VECINAS: el mapa de una no valida a la otra, y se rechaza entero', async () => {
    const bytes = readFileSync(join(__dirname, 'fixtures/dos-fuentes-vecinas.pdf'));
    const d = await subir(ADMIN, bytes, 'DELIVERY_SUPPORT', 'dos-fuentes.pdf');
    const r = (await extraer(ADMIN, d.id, d.versions[0].id).expect(201)).body as Vista;
    expect(r.extraction!.status).toBe('TEXTO_NO_INTERPRETABLE');
    expect(r.extraction!.extracted_text).toBeNull();
    expect(r.fields).toEqual([]);
    // La nota dice CUÁNTAS de cuántas: una de dos, no «todas».
    expect(r.extraction!.note).toMatch(/1 de sus 2 fuente\(s\) compuesta\(s\)/);
  });

  it('ACCESO DENEGADO: subir no autoriza a extraer, y sin identidad no se ve contenido personal', async () => {
    // Un documento de DATOS PERSONALES subido por el técnico, sobre SU productor asignado…
    const d = await subir(TEC, pdfConTexto(CERTIFICADO), 'LAND_TENURE', 'tenencia.pdf', 'application/pdf', productorDelTecnico);
    const v = d.versions[0];
    // …que él mismo NO puede extraer: subir un archivo no autoriza a procesar sus datos.
    const intento = await extraer(TEC, d.id, v.id);
    expect(intento.status).toBe(403);

    // Y quien no lee identidad no ve el contenido, ni extraído ni por extraer.
    expect((await http().get(ruta(d.id, v.id)).set(as(AUDITOR))).status).toBe(403);

    // CONTROL autorizado: el admin, que lee identidad y tiene el permiso, sí lo extrae.
    const r = (await extraer(ADMIN, d.id, v.id).expect(201)).body as Vista;
    expect(r.extraction!.status).toBe('EXTRAIDA');
    expect(r.document.classification).toBe('PERSONAL_DATA');
  });

  it('PERMISOS DEL DESTINO: proponer no es confirmar', async () => {
    const d = await subir(ADMIN, pdfConTexto(CERTIFICADO));
    const v = d.versions[0];
    // El gestor (MANAGER) extrae…
    const r = (await extraer(GESTOR, d.id, v.id).expect(201)).body as Vista;
    expect(r.can_review).toBe(false);
    const f = r.fields.find((x) => x.field_code === 'ISSUER')!;
    // …pero NO confirma: eso es revisión.
    const intento = await http().post(`${ruta(d.id, v.id)}/fields/${f.id}/review`).set(as(GESTOR))
      .send({ operation_id: randomUUID(), decision: 'CONFIRMADO' });
    expect(intento.status).toBe(403);
    // CONTROL autorizado: el admin sí.
    const admin = await ver(ADMIN, d.id, v.id);
    expect(admin.can_review).toBe(true);
    await http().post(`${ruta(d.id, v.id)}/fields/${f.id}/review`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), decision: 'CONFIRMADO' }).expect(201);
  });

  it('IDEMPOTENCIA y FECHAS: repetir la operación no duplica; una fecha ambigua no se acepta', async () => {
    const d = await subir(ADMIN, pdfConTexto(CERTIFICADO));
    const v = d.versions[0];
    const op = randomUUID();
    await http().post(ruta(d.id, v.id)).set(as(ADMIN)).send({ operation_id: op }).expect(201);
    await http().post(ruta(d.id, v.id)).set(as(ADMIN)).send({ operation_id: op }).expect(201);
    const r = await ver(ADMIN, d.id, v.id);
    expect(r.history).toHaveLength(1);

    const f = r.fields.find((x) => x.field_code === 'ISSUED_AT')!;
    const malFormato = await http().post(`${ruta(d.id, v.id)}/fields/${f.id}/review`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), decision: 'CONFIRMADO', confirmed_value: '03/04/2026' });
    expect(malFormato.status).toBe(422);
    expect(malFormato.body.error.code).toBe('DATE_FORMAT');
  });

  it('EXTRAER DE NUEVO conserva lo anterior: el historial crece, no se pisa', async () => {
    const d = await subir(ADMIN, pdfConTexto(CERTIFICADO));
    const v = d.versions[0];
    await extraer(ADMIN, d.id, v.id).expect(201);
    await extraer(ADMIN, d.id, v.id).expect(201);
    const r = await ver(ADMIN, d.id, v.id);
    expect(r.history).toHaveLength(2);
    expect(r.history[0].run_number).toBe(2);
    expect(r.extraction!.run_number).toBe(2);
  });

  it('NO TOCA el dominio: ni documentos, ni evidencias, ni expedientes', async () => {
    const d = await subir(ADMIN, pdfConTexto(CERTIFICADO));
    const v = d.versions[0];
    const antes = await sql<{ n: number }>`SELECT (SELECT count(*) FROM documents) + (SELECT count(*) FROM document_versions) + (SELECT count(*) FROM evidence) + (SELECT count(*) FROM domain_events) AS n`.execute(h.db);
    await extraer(ADMIN, d.id, v.id).expect(201);
    const despues = await sql<{ n: number }>`SELECT (SELECT count(*) FROM documents) + (SELECT count(*) FROM document_versions) + (SELECT count(*) FROM evidence) + (SELECT count(*) FROM domain_events) AS n`.execute(h.db);
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
    // Pero sí queda en auditoría.
    const aud = await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'document.extracted'`.execute(h.db);
    expect(aud.rows[0].n).toBeGreaterThan(0);
  });
});
