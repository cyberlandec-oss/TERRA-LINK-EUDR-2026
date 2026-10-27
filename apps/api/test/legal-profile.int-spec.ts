import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { describeDb, setupHarness, PASSWORD } from './helpers';
import { coberturaDeSujetos, perfilDeOrganizacion } from '../src/legal/legal-profile';

// P1-005 — Perfil jurídico revisable: **el mecanismo**, no la aprobación.
//
// Lo que esta suite tiene que dejar demostrado:
//   · que un perfil **PARCIAL o sin revisión jurídica NO satisface `LEGAL_PROFILE`**;
//   · que **aplicabilidad, evidencia y resultado** son ejes distintos y la base impide mezclarlos;
//   · que **desconocido no es cumplido** y que **aplicable sin evidencia queda pendiente**, no infracción;
//   · aislamiento por organización y por recurso, permisos, concurrencia, reversión e historia conservada;
//   · que una **versión documental sustituida** no cambia la evidencia ya vinculada.
//
// Cualquier aprobación jurídica que aparezca aquí es **fixture sintética escrita directamente en la base**:
// no existe endpoint que la produzca, y eso es deliberado.

describeDb('P1-005 perfil jurídico revisable', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = '';
  let orgB = '';
  let parcelaA = '';
  let parcelaB = '';
  let parcelaTecnico = '';
  let evaluacion = '';
  let versionDocA = '';
  let versionDocB = '';

  const ADMIN_A = 'legal-admin-a@test.local';
  const ADMIN_B = 'legal-admin-b@test.local';
  const EUDR = 'legal-eudr-a@test.local';        // dd:manage, dd:read, risk:review — NO risk:approve_rules
  const AUDITOR = 'legal-auditor-a@test.local';  // dd:read — sin dd:manage ni risk:review
  const TEC = 'legal-tecnico-a@test.local';      // alcance ASIGNADO

  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;

  async function join(org: string, email: string, role: string, admin: string) {
    const inv = await http().post(`${base(org)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }

  const membresia = async (email: string, org: string) => (await h.db.selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id').select('m.id')
    .where('u.email', '=', email).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;

  /** Productor + parcela reales. `asignarA` deja el productor asignado a esa membresía (alcance). */
  async function crearParcela(org: string, admin: string, codigo: string, asignarA?: string) {
    const p = await http().post(`${base(org)}/producers`).set(as(admin))
      .send({ producer_code: `LG-${codigo}-${randomUUID().slice(0, 6)}`, legal_name: `Finca ${codigo}` }).expect(201);
    if (asignarA) {
      await http().put(`${base(org)}/producers/${p.body.id}/assignment`).set(as(admin))
        .send({ expected_version: p.body.row_version, membership_id: await membresia(asignarA, org) }).expect(200);
    }
    const plot = await http().post(`${base(org)}/plots`).set(as(admin))
      .send({ producer_id: p.body.id, plot_code: `LG-${codigo}-${randomUUID().slice(0, 6)}`, crop: 'Cacao' }).expect(201);
    return { productor: p.body.id as string, parcela: plot.body.id as string };
  }

  /** Documento con una versión, como evidencia. Fixture sintética sobre el módulo documental REAL. */
  async function documentoConVersion(org: string, productor: string, creador: string, numero = 1, docId?: string) {
    const doc = docId ?? randomUUID();
    if (!docId) {
      await sql`INSERT INTO documents (id, organization_id, document_type, owner_type, owner_id, title, created_by)
        VALUES (${doc}, ${org}, 'LAND_TENURE', 'producer', ${productor}, 'Soporte de tenencia (fixture)', ${creador})`.execute(h.db);
    }
    const ver = randomUUID();
    await sql`INSERT INTO document_versions (id, organization_id, document_id, version_number, object_key, file_name, mime_type, size_bytes, sha256, operation_id, uploaded_by)
      VALUES (${ver}, ${org}, ${doc}, ${numero}, ${`legal/${ver}`}, ${`tenencia-v${numero}.pdf`}, 'application/pdf', 10, ${String(numero).repeat(64).slice(0, 64)}, ${randomUUID()}, ${creador})`.execute(h.db);
    return { doc, ver };
  }

  const adoptar = (org: string, actor: string, decision: 'ADOPT' | 'WITHDRAW' = 'ADOPT') =>
    http().post(`${base(org)}/legal-profile/adoptions`).set(as(actor))
      .send({ operation_id: randomUUID(), version: '0.1.0', decision, reason: 'Prueba de adopción' });

  const preparar = (org: string, actor: string, plot: string) =>
    http().post(`${base(org)}/legal-assessments`).set(as(actor)).send({ operation_id: randomUUID(), plot_id: plot });

  const revisar = (org: string, actor: string, ev: string, item: string, cuerpo: Record<string, unknown>) =>
    http().put(`${base(org)}/legal-assessments/${ev}/items/${item}`).set(as(actor)).send(cuerpo);

  const items = async (org: string, actor: string, ev: string) =>
    (await http().get(`${base(org)}/legal-assessments/${ev}`).set(as(actor)).expect(200)).body;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('legal-super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN_A);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('legal-super@test.local'))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id as string;
    orgA = await mk('Coop Legal A', ADMIN_A);
    orgB = await mk('Coop Legal B', ADMIN_B);
    await join(orgA, EUDR, 'EUDR_MANAGER', ADMIN_A);
    await join(orgA, AUDITOR, 'AUDITOR', ADMIN_A);
    await join(orgA, TEC, 'FIELD_TECHNICIAN', ADMIN_A);

    const a = await crearParcela(orgA, ADMIN_A, 'A');
    parcelaA = a.parcela;
    const t = await crearParcela(orgA, ADMIN_A, 'T', TEC);
    parcelaTecnico = t.parcela;
    const b = await crearParcela(orgB, ADMIN_B, 'B');
    parcelaB = b.parcela;

    const adminAId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${ADMIN_A}`.execute(h.db)).rows[0].id;
    const adminBId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${ADMIN_B}`.execute(h.db)).rows[0].id;
    versionDocA = (await documentoConVersion(orgA, a.productor, adminAId)).ver;
    versionDocB = (await documentoConVersion(orgB, b.productor, adminBId)).ver;
  });
  afterAll(async () => h?.close());

  // ---------------------------------------------------------------- catálogo y alcance declarado

  it('el catálogo declara el alcance PARCIAL, lo que falta, y que las reglas son CANDIDATAS', async () => {
    const r = await http().get(`${base(orgA)}/legal-profile/catalog`).set(as(ADMIN_A)).expect(200);
    const v = r.body.versions.find((x: { version: string }) => x.version === '0.1.0');
    expect(v.scope).toBe('PARTIAL');
    expect(v.legal_review_status).toBe('PENDING');
    expect(v.pending_matters).toEqual(expect.arrayContaining(['LABOUR', 'TAX', 'FPIC']));
    expect(v.rules.length).toBeGreaterThanOrEqual(4);
    expect(v.rules.every((x: { review_status: string }) => x.review_status === 'DRAFT')).toBe(true);
    // Las tres cosas que no son lo mismo, separadas en el dato.
    expect(v.sources.every((s: { document_obtained: boolean }) => s.document_obtained)).toBe(true);
    expect(v.sources.every((s: { legal_validity_reviewed: boolean }) => s.legal_validity_reviewed === false)).toBe(true);
    // Las fuentes identifican la copia: huella, índice de PDF y página impresa.
    const ro29 = v.sources.find((s: { code: string }) => s.code === 'VIVIENDA-29');
    expect(ro29.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ro29.printed_page).toBe('33-34');
  });

  // ---------------------------------------------------------------- permisos (reutilizados)

  it('adoptar exige `risk:approve_rules`: el responsable EUDR no puede, el administrador sí', async () => {
    await adoptar(orgA, EUDR).expect(403);
    await adoptar(orgA, ADMIN_A).expect(201);   // CONTROL autorizado
    const estado = await perfilDeOrganizacion(h.db, orgA);
    expect(estado).toMatchObject({ version: '0.1.0', scope: 'PARTIAL', legal_review_status: 'PENDING', adopted: true });
  });

  it('preparar exige `dd:manage`; consultar exige `dd:read`', async () => {
    await preparar(orgA, AUDITOR, parcelaA).expect(403);          // auditor no prepara
    const r = await preparar(orgA, EUDR, parcelaA).expect(201);   // CONTROL
    evaluacion = r.body.id;
    await http().get(`${base(orgA)}/legal-assessments/${evaluacion}`).set(as(AUDITOR)).expect(200); // sí consulta
  });

  it('sin perfil adoptado no se prepara nada', async () => {
    await preparar(orgB, ADMIN_B, parcelaB).expect(422);
  });

  // ---------------------------------------------------------------- estado de partida honesto

  it('al preparar, todo queda en aplicabilidad DESCONOCIDA y resultado NO EVALUABLE', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    expect(b.items.length).toBeGreaterThanOrEqual(4);
    expect(b.items.every((i: { applicability: string }) => i.applicability === 'UNKNOWN')).toBe(true);
    expect(b.items.every((i: { result: string }) => i.result === 'NOT_EVALUABLE')).toBe(true);
    expect(b.items.every((i: { evidence_version_id: string | null }) => i.evidence_version_id === null)).toBe(true);
    // Y el resumen dice por qué esto no acredita nada.
    expect(b.summary.satisfies_legal_profile).toBe(false);
    expect(b.summary.why).toMatch(/tampoco requisito satisfecho/);
    expect(b.profile).toMatchObject({ scope: 'PARTIAL', legal_review_status: 'PENDING' });
  });

  // ---------------------------------------------------------------- los tres ejes

  it('aplicabilidad DESCONOCIDA no puede estar satisfecha ni incumplida', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items[0];
    for (const result of ['SATISFIED', 'NOT_SATISFIED', 'PENDING']) {
      await revisar(orgA, EUDR, evaluacion, it.id, {
        applicability: 'UNKNOWN', result, change_note: 'intento incoherente', expected_version: it.row_version,
      }).expect(422);
    }
    // Y sí admite la única lectura honesta.
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'UNKNOWN', result: 'NOT_EVALUABLE', applicability_reason: 'No se sabe si el predio está en el supuesto',
      change_note: 'se deja declarado como no evaluable', expected_version: it.row_version,
    }).expect(200);
  });

  it('APLICABLE sin evidencia queda PENDIENTE: ni satisfecha, ni por sí sola una infracción', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items[1];
    // No se puede declarar satisfecha sin evidencia…
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', result: 'SATISFIED', reason: 'porque sí', change_note: 'intento', expected_version: it.row_version,
    }).expect(422);
    // …ni concluir nada que no sea pendiente.
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', result: 'NOT_EVALUABLE', change_note: 'intento', expected_version: it.row_version,
    }).expect(422);
    const ok = await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', result: 'PENDING', applicability_reason: 'El predio está en el supuesto',
      change_note: 'aplicable, falta evidencia', expected_version: it.row_version,
    }).expect(200);
    expect(ok.body.result).toBe('PENDING');
  });

  it('declarar SATISFECHA exige evidencia admisible JUSTIFICADA, revisor y motivo', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items.find((i: { result: string }) => i.result === 'PENDING');
    // Con evidencia pero sin justificar su admisibilidad: no.
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', evidence_version_id: versionDocA, evidence_origin: 'OFFICIAL_DOCUMENT',
      result: 'SATISFIED', reason: 'tiene título', change_note: 'sin justificar admisibilidad', expected_version: it.row_version,
    }).expect(422);
    // Con la justificación por requisito: sí, y queda el revisor registrado.
    const ok = await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', evidence_version_id: versionDocA, evidence_origin: 'OFFICIAL_DOCUMENT',
      evidence_justification: 'Acto de adjudicación emitido por la autoridad agraria; cubre el Art. 59 reformado',
      result: 'SATISFIED', reason: 'Evidencia suficiente para este requisito', change_note: 'revisado',
      expected_version: it.row_version,
    }).expect(200);
    expect(ok.body.result).toBe('SATISFIED');
    const tras = await items(orgA, EUDR, evaluacion);
    const guardado = tras.items.find((i: { id: string }) => i.id === it.id);
    expect(guardado.reviewer_id).toBeTruthy();
    expect(guardado.evidence_admissibility).toBe('JUSTIFIED');
    expect(guardado.evidence_origin).toBe('OFFICIAL_DOCUMENT');
  });

  it('la procedencia de la evidencia se distingue: una declaración del productor no es un documento oficial', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items.find((i: { result: string }) => i.result === 'NOT_EVALUABLE');
    const r = await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', evidence_version_id: versionDocA, evidence_origin: 'PRODUCER_DECLARATION',
      evidence_justification: 'Declaración del productor; se admite para revisión, no acredita autenticidad',
      result: 'PENDING', change_note: 'declaración aportada', expected_version: it.row_version,
    }).expect(200);
    expect(r.body.result).toBe('PENDING');
    const tras = await items(orgA, EUDR, evaluacion);
    expect(tras.items.find((i: { id: string }) => i.id === it.id).evidence_origin).toBe('PRODUCER_DECLARATION');
  });

  // ---------------------------------------------------------------- aislamiento

  it('la evidencia tiene que ser de la MISMA organización', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items[0];
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', evidence_version_id: versionDocB, evidence_origin: 'OFFICIAL_DOCUMENT',
      evidence_justification: 'documento de otra organización', result: 'PENDING',
      change_note: 'intento de cruce', expected_version: it.row_version,
    }).expect(422);
  });

  it('otra organización no ve la evaluación, ni inventando el identificador', async () => {
    await http().get(`${base(orgB)}/legal-assessments/${evaluacion}`).set(as(ADMIN_B)).expect(404);
    await http().get(`${base(orgA)}/legal-assessments/${evaluacion}`).set(as(ADMIN_B)).expect(404);
    await http().get(`${base(orgA)}/legal-assessments/${randomUUID()}`).set(as(ADMIN_A)).expect(404);
  });

  it('el técnico de campo no accede: no tiene `dd:read` ni `dd:manage`', async () => {
    // Se prepara una evaluación sobre la parcela que SÍ tiene asignada, para que el caso no pase por ausencia
    // de datos: aun así queda fuera, porque el permiso es anterior al alcance.
    const suya = (await preparar(orgA, EUDR, parcelaTecnico).expect(201)).body.id;
    await http().get(`${base(orgA)}/legal-assessments/${suya}`).set(as(TEC)).expect(403);
    await preparar(orgA, TEC, parcelaTecnico).expect(403);
    // CONTROL autorizado sobre la MISMA evaluación: quien sí tiene el permiso entra.
    await http().get(`${base(orgA)}/legal-assessments/${suya}`).set(as(AUDITOR)).expect(200);
  });

  it('el alcance por recurso está aplicado aunque hoy ningún rol lo active en esta ruta', async () => {
    // `ver()` y `revisar()` pasan por `plots.load()`, que es la autorización REAL de Parcelas. Hoy los tres
    // roles con `dd:read` (ORG_ADMIN, EUDR_MANAGER, AUDITOR) tienen además `plot:read` de organización, así
    // que no hay rol que llegue aquí con alcance asignado. La defensa se deja puesta igualmente, y lo que sí
    // se puede comprobar es que una parcela de OTRA organización no se cuela por este camino.
    const ajena = await preparar(orgB, ADMIN_B, parcelaA).expect(404);
    expect(ajena.status).toBe(404);
  });

  // ---------------------------------------------------------------- concurrencia, reversión e historia

  it('concurrencia: una revisión con versión obsoleta no pisa la de otra persona', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items[2];
    const vieja = it.row_version;
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'NOT_APPLICABLE', result: 'NOT_APPLICABLE', applicability_reason: 'El predio no está en el supuesto',
      change_note: 'primera', expected_version: vieja,
    }).expect(200);
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', result: 'PENDING', change_note: 'segunda con versión vieja', expected_version: vieja,
    }).expect(409);
  });

  it('reversión: se puede volver atrás, y la historia conserva TODOS los estados', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items.find((i: { result: string }) => i.result === 'SATISFIED');
    // Se revierte a pendiente: la evidencia se retira.
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', result: 'PENDING', change_note: 'se retira la evidencia: no corresponde al predio',
      expected_version: it.row_version,
    }).expect(200);
    const tras = await items(orgA, EUDR, evaluacion);
    const ahora = tras.items.find((i: { id: string }) => i.id === it.id);
    expect(ahora.result).toBe('PENDING');
    expect(ahora.evidence_version_id).toBeNull();

    const hist = (await http().get(`${base(orgA)}/legal-assessments/${evaluacion}/items/${it.id}/history`).set(as(AUDITOR)).expect(200)).body;
    const resultados = hist.history.map((x: { result: string }) => x.result);
    expect(resultados).toContain('SATISFIED');   // el estado anterior NO se pierde
    expect(resultados).toContain('PENDING');
    expect(hist.history.length).toBeGreaterThanOrEqual(2);
  });

  it('la historia es append-only: no se puede reescribir ni borrar', async () => {
    const fila = (await sql<{ id: string }>`SELECT id FROM legal_assessment_item_history LIMIT 1`.execute(h.db)).rows[0];
    await expect(sql`UPDATE legal_assessment_item_history SET result = 'SATISFIED' WHERE id = ${fila.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM legal_assessment_item_history WHERE id = ${fila.id}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('una versión documental SUSTITUIDA no cambia la evidencia ya vinculada', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items[3];
    const adminAId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${ADMIN_A}`.execute(h.db)).rows[0].id;
    const prod = (await sql<{ owner_id: string }>`SELECT owner_id FROM documents WHERE organization_id = ${orgA} LIMIT 1`.execute(h.db)).rows[0].owner_id;
    const d1 = await documentoConVersion(orgA, prod, adminAId, 1);
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', evidence_version_id: d1.ver, evidence_origin: 'OFFICIAL_DOCUMENT',
      evidence_justification: 'Versión 1 del soporte', result: 'PENDING', change_note: 'vinculada v1',
      expected_version: it.row_version,
    }).expect(200);
    // Llega una versión 2 del MISMO documento: la evidencia vinculada sigue siendo la v1, exacta.
    const d2 = await documentoConVersion(orgA, prod, adminAId, 2, d1.doc);
    const tras = await items(orgA, EUDR, evaluacion);
    const guardado = tras.items.find((i: { id: string }) => i.id === it.id);
    expect(guardado.evidence_version_id).toBe(d1.ver);
    expect(guardado.evidence_version_id).not.toBe(d2.ver);
  });

  // ---------------------------------------------------------------- el criterio que importa

  it('un perfil PARCIAL y sin revisión jurídica NO satisface LEGAL_PROFILE', async () => {
    const estado = await perfilDeOrganizacion(h.db, orgA);
    expect(estado).toMatchObject({ scope: 'PARTIAL', legal_review_status: 'PENDING' });
    // No hay endpoint que produzca una revisión jurídica: el catálogo sigue sin ninguna.
    const n = await sql<{ n: string }>`SELECT count(*)::text AS n FROM legal_profile_reviews`.execute(h.db);
    expect(Number(n.rows[0].n)).toBe(0);
  });

  it('FIXTURE SINTÉTICA: ni siquiera una revisión jurídica vuelve suficiente un perfil PARCIAL', async () => {
    const revisor = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${ADMIN_A}`.execute(h.db)).rows[0].id;
    // Se escribe DIRECTAMENTE en la base: no existe endpoint, y así debe seguir hasta que haya una decisión.
    const rid = randomUUID();
    await h.db.transaction().execute(async (trx) => {
      await sql`INSERT INTO legal_profile_reviews (id, version, decision, reviewer_id, reviewer_name, reviewer_capacity, reviewed_on, basis, operation_id)
        VALUES (${rid}, ${'0.1.0'}, ${'REVIEWED'}, ${revisor}, 'Persona sintética de prueba', 'FIXTURE SINTÉTICA DE PRUEBA', CURRENT_DATE, 'Fixture sintética: no acredita ninguna revisión jurídica real', ${randomUUID()})`.execute(trx);
      await sql`INSERT INTO legal_profile_review_supports (id, review_id, version, kind, citation) VALUES (${randomUUID()}, ${rid}, ${'0.1.0'}, 'CITATION', 'Cita sintética de prueba')`.execute(trx);
    });
    const estado = await perfilDeOrganizacion(h.db, orgA);
    expect(estado?.legal_review_status).toBe('REVIEWED');
    // Y aun así sigue siendo PARCIAL: el alcance no se arregla revisando.
    expect(estado?.scope).toBe('PARTIAL');
    expect(estado?.pending_matters.length).toBeGreaterThan(0);
  });

  it('la revisión jurídica exige responsable identificado y fundamento: la base lo impone', async () => {
    await expect(sql`INSERT INTO legal_profile_reviews (id, version, decision, reviewer_id, reviewer_name, reviewer_capacity, reviewed_on, basis, operation_id)
      VALUES (${randomUUID()}, '0.1.0', 'REVIEWED', NULL, 'Persona', 'x', CURRENT_DATE, 'y', ${randomUUID()})`.execute(h.db)).rejects.toThrow();
  });

  // ---------------------------------------------------------------- cobertura del SUJETO

  it('la evidencia de OTRO sujeto se rechaza al escribirla', async () => {
    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items[0];
    // Documento de OTRO productor de la MISMA organización: es válido y no acredita esta parcela.
    const otro = await crearParcela(orgA, ADMIN_A, 'OTRO');
    const adminAId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${ADMIN_A}`.execute(h.db)).rows[0].id;
    const ajeno = await documentoConVersion(orgA, otro.productor, adminAId);
    const r = await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', evidence_version_id: ajeno.ver, evidence_origin: 'OFFICIAL_DOCUMENT',
      evidence_justification: 'documento de otro productor', result: 'PENDING',
      change_note: 'intento con evidencia ajena', expected_version: it.row_version,
    }).expect(422);
    expect(r.body.error.code).toBe('EVIDENCE_FOREIGN_SUBJECT');
  });

  it('COBERTURA: un sujeto sin resolver no acredita, aunque el catálogo fuese completo y revisado', async () => {
    const cob = await coberturaDeSujetos(h.db, orgA, [parcelaA]);
    expect(cob).toHaveLength(1);
    expect(cob[0].assessed_version).toBe('0.1.0');
    // Quedan obligaciones sin resolver: eso es lo que impide acreditar, no el estado del catálogo.
    expect(cob[0].unresolved.length).toBeGreaterThan(0);
    expect(cob[0].foreign_evidence).toEqual([]);
  });

  it('COBERTURA: sustituir la versión documental usada deja la evidencia DESACTUALIZADA', async () => {
    const adminAId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${ADMIN_A}`.execute(h.db)).rows[0].id;
    const prod = (await sql<{ producer_id: string }>`SELECT producer_id FROM plots WHERE id = ${parcelaA}`.execute(h.db)).rows[0].producer_id;
    const d1 = await documentoConVersion(orgA, prod, adminAId, 1);
    // El documento apunta a su versión vigente, como hace el módulo documental.
    await sql`UPDATE documents SET current_version_id = ${d1.ver} WHERE id = ${d1.doc}`.execute(h.db);

    const b = await items(orgA, EUDR, evaluacion);
    const it = b.items.find((i: { evidence_version_id: string | null }) => i.evidence_version_id === null)!;
    await revisar(orgA, EUDR, evaluacion, it.id, {
      applicability: 'APPLICABLE', evidence_version_id: d1.ver, evidence_origin: 'OFFICIAL_DOCUMENT',
      evidence_justification: 'Versión 1 del soporte de tenencia', result: 'PENDING',
      change_note: 'vinculada v1', expected_version: it.row_version,
    }).expect(200);
    const antes = await coberturaDeSujetos(h.db, orgA, [parcelaA]);
    expect(antes[0].stale_evidence).not.toContain(it.rule_code);

    // Llega la versión 2 del MISMO documento: la evidencia vinculada queda desactualizada.
    const d2 = await documentoConVersion(orgA, prod, adminAId, 2, d1.doc);
    await sql`UPDATE documents SET current_version_id = ${d2.ver} WHERE id = ${d1.doc}`.execute(h.db);
    const despues = await coberturaDeSujetos(h.db, orgA, [parcelaA]);
    expect(despues[0].stale_evidence).toContain(it.rule_code);
    // Y la evidencia histórica NO se pierde: sigue siendo la v1 exacta la que se vinculó.
    const tras = await items(orgA, EUDR, evaluacion);
    expect(tras.items.find((i: { id: string }) => i.id === it.id).evidence_version_id).toBe(d1.ver);
  });

  it('COBERTURA: una parcela sin evaluación no se presume resuelta', async () => {
    const otra = await crearParcela(orgA, ADMIN_A, 'SINEV');
    const cob = await coberturaDeSujetos(h.db, orgA, [otra.parcela]);
    expect(cob[0].assessed_version).toBeNull();
    expect(cob[0].unresolved).toEqual([]);   // no hay ítems: la ausencia no se rellena con nada
  });

  it('retirar el perfil deja a la organización sin perfil adoptado', async () => {
    await adoptar(orgA, ADMIN_A, 'WITHDRAW').expect(201);
    expect(await perfilDeOrganizacion(h.db, orgA)).toBeNull();
    // Y la adopción anterior se conserva: es append-only, no un UPDATE de estado.
    const n = await sql<{ n: string }>`SELECT count(*)::text AS n FROM legal_profile_adoptions WHERE organization_id = ${orgA}`.execute(h.db);
    expect(Number(n.rows[0].n)).toBeGreaterThanOrEqual(2);
  });
});
