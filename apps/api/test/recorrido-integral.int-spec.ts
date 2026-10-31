import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// RECORRIDO INTEGRAL de la cadena (preparación de P0-031; QA-07 y QA-12 de docs/16), contra PostgreSQL/PostGIS
// reales en la base aislada `*_test` y con datos **SINTÉTICOS**.
//
// Qué es esto y qué NO es:
// - Es una comprobación **de extremo a extremo** de hasta dónde llega hoy la cadena
//   productor → parcela → entrega → recepción → lote → procesamiento → inventario → riesgo → mitigación →
//   expediente → embarque, y **dónde se detiene exactamente y por qué**.
// - **No es el piloto P0-031**: no hay operadores reales, ni dataset de piloto, ni Android real, ni restauración de
//   respaldo. Prepararlo y ejecutarlo no lo inicia ni lo completa.
// - Un **bloqueo correcto** demuestra que la compuerta funciona. **No demuestra la operación que impide**: que el
//   despacho se rechace no acredita que un despacho vaya a funcionar cuando se desbloquee.
describeDb('Recorrido integral de la cadena (preparación P0-031, datos sintéticos)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const ADMIN = 'admin-a@test.local';
  const REC = 'recepcion@test.local';
  const CAL = 'calidad@test.local';
  const TRAZ = 'trazabilidad@test.local';
  const EUDR = 'eudr@test.local';
  const EUDR2 = 'eudr2@test.local';
  const EXP = 'exportacion@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const A = () => base(orgA);
  const today = new Date().toISOString().slice(0, 10);
  const now = () => new Date().toISOString();
  const op = () => randomUUID();
  /** Las cantidades son decimales con unidad; se comparan por valor, no por su formato textual. */
  const kg = (q: { value: string; unit: string }) => ({ valor: Number(q.value), unit: q.unit });
  const saldos = (q: Record<string, string>) => Object.fromEntries(Object.entries(q).filter(([k]) => ['physical', 'reserved', 'available', 'dispatched'].includes(k)).map(([k, v]) => [k, Number(v)]));

  const ctx: Record<string, string> = {};
  /** Lo que el recorrido va demostrando, para que el informe no dependa de la memoria de nadie. */
  const demostrado: Array<{ transicion: string; resultado: string }> = [];
  const bloqueado: Array<{ transicion: string; codigo: string; decision: string }> = [];
  const anota = (transicion: string, resultado: string) => demostrado.push({ transicion, resultado });
  const corta = (transicion: string, codigo: string, decision: string) => bloqueado.push({ transicion, codigo, decision });

  async function join(o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }

  beforeAll(async () => {
    h = await setupHarness();
    // El embarque abre una conexión propia contra la API (igual que en shipments.int-spec): el servidor debe escuchar.
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Recorrido A', ADMIN);
    orgB = await mk('Coop Recorrido B', 'admin-b@test.local');
    for (const [e, r] of [[REC, 'RECEPTION_OPERATOR'], [CAL, 'QUALITY_OPERATOR'], [TRAZ, 'TRACEABILITY_MANAGER'], [EUDR, 'EUDR_MANAGER'], [EUDR2, 'EUDR_MANAGER'], [EXP, 'EXPORT_MANAGER'], ['auditor@test.local', 'AUDITOR']] as const) {
      await join(orgA, e, r);
    }
  }, 120_000);
  afterAll(async () => {
    // El recorrido deja por escrito su propio alcance: qué quedó demostrado y dónde se detuvo.
    console.log(`Recorrido integral · transiciones demostradas: ${demostrado.length}; bloqueos comprobados: ${bloqueado.length}\n` +
      demostrado.map((d) => `  OK      ${d.transicion}: ${d.resultado}`).join('\n') + '\n' +
      bloqueado.map((b) => `  BLOQUEO ${b.transicion}: ${b.codigo} → ${b.decision}`).join('\n'));
    await h?.close();
  });

  // ---------------------------------------------------------------- 1. productor → parcela → geometría

  it('productor → parcela → versión geométrica → evaluación GIS técnica', async () => {
    ctx.producer = (await http().post(`${A()}/producers`).set(as(ADMIN))
      .send({ producer_code: 'RI-1', legal_name: 'Asociación Sintética Uno' }).expect(201)).body.id;
    ctx.plot = (await http().post(`${A()}/plots`).set(as(ADMIN))
      .send({ producer_id: ctx.producer, plot_code: 'RI-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    const square = { type: 'Polygon', coordinates: [[[-79.5, -1], [-79.49, -1], [-79.49, -0.99], [-79.5, -0.99], [-79.5, -1]]] };
    const v = (await http().post(`${A()}/plots/${ctx.plot}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: square }).expect(201)).body.version;
    expect(v).toMatchObject({ geometry_type: 'POLYGON', validation_status: 'NOT_VALIDATED' });
    const ev = (await http().post(`${A()}/plots/${ctx.plot}/gis-evaluations`).set(as(ADMIN)).send({ operation_id: op() }).expect(201)).body.evaluation;
    // La evaluación es TÉCNICA: su estado no es conformidad, y el perfil de destino no se evalúa (D-05).
    expect(ev.status_scope).toBe('TECHNICAL');
    expect(ev.destination_profile.status).toBe('NOT_EVALUATED');
    anota('productor → parcela → geometría', `parcela con polígono y evaluación técnica ${ev.status}; el perfil de destino es otro dictamen`);

    // D-05.A (2026-10-15): el PERFIL TÉCNICO de destino ya se evalúa, con regla propia y versionada aparte.
    // Es un dictamen distinto del técnico y aquí se recorren los dos.
    const perfil = (await http().post(`${A()}/plots/${ctx.plot}/geo-profile/evaluations`).set(as(ADMIN)).send({ operation_id: op() }).expect(201)).body.evaluation;
    expect(perfil.profile.id).toBe('EUDR_GEO_V1');
    expect(perfil.status).toBe('MEETS_PROFILE');
    expect(perfil.exportable).toBe(true);
    // Y dice, en el propio resultado, que eso NO es conformidad.
    expect(perfil.source.verification).toBe('DOCUMENTED_NOT_TESTED_AGAINST_SERVICE');
    expect(perfil.disclaimer).toMatch(/NO es conformidad EUDR/i);
    anota('geometría → perfil técnico de destino', `${perfil.status} con ${perfil.profile.id}@${perfil.profile.version}, contra la documentación fechada del destino (servicio ${perfil.source.service_version}, documento v${perfil.source.document_version}); comprobado en documentación, NO contra el servicio real`);
    // Lo que sigue bloqueado NO es el formato: es a quién obliga la norma y qué significa el resultado.
    corta('perfil técnico → conclusión regulatoria', 'LEGAL_APPLICABILITY_NOT_DECIDED', 'D-05.B (qué actor es cada usuario y qué acredita el perfil)');
  });

  // ---------------------------------------------------------------- 2. entrega → recepción → calidad

  it('entrega con origen → recepción con pesaje → muestra y decisión de calidad', async () => {
    ctx.producto = (await http().post(`${A()}/products`).set(as(ADMIN))
      .send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    ctx.fermentado = (await http().post(`${A()}/products`).set(as(ADMIN))
      .send({ code: 'CACAO_FERMENTADO', name: 'Cacao fermentado', product_state: 'CACAO_FERMENTADO', unit: 'KG' }).expect(201)).body.id;
    ctx.seco = (await http().post(`${A()}/products`).set(as(ADMIN))
      .send({ code: 'CACAO_SECO', name: 'Cacao seco', product_state: 'CACAO_SECO', unit: 'KG' }).expect(201)).body.id;
    ctx.centro = (await http().post(`${A()}/locations`).set(as(ADMIN))
      .send({ code: 'C1', name: 'Centro de acopio sintético', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;

    const d = (await http().post(`${A()}/deliveries`).set(as(ADMIN)).send({
      operation_id: op(), producer_id: ctx.producer, product_id: ctx.producto, delivery_date: today,
      quantity_declared: '500', unit: 'KG', origins: [{ plot_id: ctx.plot }], register: true,
    }).expect(201)).body.delivery;
    ctx.delivery = d.id;

    const rec = (await http().post(`${A()}/deliveries/${d.id}/receptions`).set(as(REC)).send({
      operation_id: op(), location_id: ctx.centro, received_at: now(),
      weighing: { method: 'Báscula sintética', quantity: '480', unit: 'KG', weighed_on: today },
      quality_sample: { sample_reference: 'M-RI-1', result: { method: 'Prueba de corte (sintética)', measurements: [{ parameter: 'MOISTURE', value: '7.2', unit: '%' }] } },
    }).expect(201)).body;
    ctx.reception = rec.reception_id;
    const vista = (await http().get(`${A()}/deliveries/${d.id}`).set(as(ADMIN)).expect(200)).body;
    const r0 = vista.receptions[0];
    // Declarado y recibido son cantidades distintas y se conservan por separado; la calidad nace pendiente.
    expect(kg(vista.quantity_declared)).toEqual({ valor: 500, unit: 'KG' });
    expect(kg(r0.quantity_received)).toEqual({ valor: 480, unit: 'KG' });
    expect(r0.quality.status).toBe('PENDING_EVALUATION');

    const muestra = r0.quality.samples[0].id;
    const liberada = (await http().post(`${A()}/deliveries/${d.id}/receptions/${ctx.reception}/quality-samples/${muestra}/results`).set(as(CAL))
      .send({ operation_id: op(), method: 'Prueba de corte', decision: 'RELEASED', limits_version: 'LIMITES-SINTETICOS-1' }).expect(201)).body;
    const quality = liberada.delivery.receptions[0].quality;
    expect(quality.status).toBe('RELEASED');
    expect(quality.note).toMatch(/No es liberación jurídica/);
    anota('entrega → recepción → calidad', '500 kg declarados y 480 recibidos conservados por separado; calidad liberada por decisión humana (no jurídica)');

    // Cierre de la entrega con diferencia (D-33, adoptada el 2026-10-15). Hasta esa fecha este tramo se anotaba como
    // bloqueo «SIN_POLITICA_DE_CIERRE». Ahora se recorre de verdad: faltan 20 kg respecto de lo declarado y el cierre
    // EXIGE motivo, cosa que se comprueba antes de darlo.
    const sinMotivo = await http().post(`${A()}/deliveries/${d.id}/close`).set(as(ADMIN))
      .send({ operation_id: op(), expected_version: vista.row_version }).expect(422);
    expect(sinMotivo.body.error.details.map((x: { field: string }) => x.field)).toEqual(expect.arrayContaining(['reason']));
    // Y quien solo confirma recepciones no puede cerrar con diferencia: afirmar una pérdida no es rutina de recepción.
    await http().post(`${A()}/deliveries/${d.id}/close`).set(as(REC))
      .send({ operation_id: op(), expected_version: vista.row_version, reason: 'Intento sin delivery:correct.' }).expect(403);

    await http().post(`${A()}/deliveries/${d.id}/close`).set(as(ADMIN)).send({
      operation_id: op(), expected_version: vista.row_version,
      reason: 'Merma de transporte verificada en el centro de acopio (dato sintético del recorrido).',
    }).expect(200);
    const cierre = (await http().get(`${A()}/deliveries/${d.id}`).set(as(ADMIN)).expect(200)).body;
    expect(cierre.totals.closure.status).toBe('CLOSED');
    expect(cierre.status).toBe('CLOSED');
    // La diferencia es declarado − recibido: positiva significa que faltó material respecto de lo declarado.
    expect(kg(cierre.totals.closure.current.difference)).toEqual({ valor: 20, unit: 'KG' });
    expect(cierre.totals.closure.justifications[0].reason).toMatch(/Merma de transporte/);
    // Una entrega cerrada no admite recepciones nuevas y no hay transición de reapertura.
    await http().post(`${A()}/deliveries/${d.id}/receptions`).set(as(REC)).send({
      operation_id: op(), location_id: ctx.centro, received_at: now(),
      weighing: { method: 'Báscula sintética', quantity: '20', unit: 'KG', weighed_on: today },
    }).expect(409);
    expect(cierre.actions.receive).toBe(false);
    // Las cifras declarada y recibida siguen intactas: cerrar explica la diferencia, no la corrige.
    expect(kg(cierre.quantity_declared)).toEqual({ valor: 500, unit: 'KG' });
    expect(kg(cierre.totals.received)).toEqual({ valor: 480, unit: 'KG' });
    anota('recepción → cierre de entrega con diferencia', '500 declarados − 480 recibidos = 20 kg faltantes; motivo obligatorio y delivery:correct exigido (D-33); sin reapertura ni ajuste de lo declarado; recepción posterior rechazada');
  });

  // ---------------------------------------------------------------- 3. lote → proceso → inventario

  it('recepción → lote → fermentación cerrada con merma → inventario conciliado', async () => {
    ctx.lote = (await http().post(`${A()}/lots`).set(as(ADMIN))
      .send({ operation_id: op(), inputs: [{ reception_id: ctx.reception, quantity: '480' }] }).expect(201)).body.lot.id;
    const hub = (await http().get(`${A()}/lots/${ctx.lote}`).set(as(ADMIN)).expect(200)).body;
    expect(hub.origin.status).toBe('COMPLETE');
    expect(saldos(hub.quantities)).toMatchObject({ physical: 480, reserved: 0, available: 480 });

    const run = (await http().post(`${A()}/process-runs`).set(as(TRAZ))
      .send({ operation_id: op(), process_type: 'FERMENTATION', output_product_id: ctx.fermentado }).expect(201)).body.run;
    await http().post(`${A()}/process-runs/${run.id}/start`).set(as(TRAZ))
      .send({ operation_id: op(), started_at: now(), inputs: [{ lot_id: ctx.lote, quantity: '480' }] }).expect(200);
    const cerrado = (await http().post(`${A()}/process-runs/${run.id}/close`).set(as(TRAZ))
      .send({ operation_id: op(), closed_at: new Date(Date.now() + 1000).toISOString(), outputs: [{ quantity: '430' }], loss_quantity: '50' }).expect(200)).body;
    ctx.loteFermentado = cerrado.run.outputs[0].lot_id;

    // Conservación: 480 consumidos = 430 producidos + 50 de merma documentada.
    const origen = (await http().get(`${A()}/lots/${ctx.lote}`).set(as(ADMIN)).expect(200)).body;
    const salida = (await http().get(`${A()}/lots/${ctx.loteFermentado}`).set(as(ADMIN)).expect(200)).body;
    expect(Number(origen.quantities.physical)).toBe(0);
    expect(saldos(salida.quantities)).toMatchObject({ physical: 430, available: 430 });
    expect(salida.origin.status).toBe('COMPLETE');

    const conciliacion = (await http().get(`${A()}/inventory/reconciliation`).set(as(ADMIN)).expect(200)).body;
    expect(conciliacion.differences).toHaveLength(0);
    anota('lote → proceso → inventario', '480 kg consumidos = 430 producidos + 50 de merma; ledger conciliado sin diferencias');
  });

  // Hasta el 2026-10-15 este tramo se cortaba: el cierre del secado estaba bloqueado por una decisión pendiente
  // (D-32, unidad de humedad). Adoptada D-32, el corte desaparece y el recorrido lo atraviesa de verdad. Lo que
  // sigue exigido es el DATO: sin humedad medida no se cierra, y eso se comprueba aquí antes de cerrar.
  it('fermentación → secado: sin la humedad no cierra; con la medición en %BH sí, y el balance se conserva', async () => {
    const run = (await http().post(`${A()}/process-runs`).set(as(TRAZ))
      .send({ operation_id: op(), process_type: 'DRYING', output_product_id: ctx.seco }).expect(201)).body.run;
    await http().post(`${A()}/process-runs/${run.id}/start`).set(as(TRAZ))
      .send({ operation_id: op(), started_at: now(), inputs: [{ lot_id: ctx.loteFermentado, quantity: '100' }] }).expect(200);
    const cierre = await http().post(`${A()}/process-runs/${run.id}/close`).set(as(TRAZ))
      .send({ operation_id: op(), closed_at: new Date(Date.now() + 1000).toISOString(), outputs: [{ quantity: '90' }], loss_quantity: '10' }).expect(422);
    expect(cierre.body.error.details.map((x: { field: string }) => x.field)).toEqual(expect.arrayContaining(['DRYING_MOISTURE']));
    // El material sigue reservado mientras el proceso está abierto: el bloqueo no «pierde» inventario.
    const reservado = (await http().get(`${A()}/lots/${ctx.loteFermentado}`).set(as(ADMIN)).expect(200)).body;
    expect(saldos(reservado.quantities)).toMatchObject({ physical: 430, reserved: 100, available: 330 });

    const cerrado = (await http().post(`${A()}/process-runs/${run.id}/close`).set(as(TRAZ)).send({
      operation_id: op(), closed_at: new Date(Date.now() + 2000).toISOString(), outputs: [{ quantity: '90' }], loss_quantity: '10',
      moisture: { value: '7.2', unit: '%BH', method: 'Medidor portátil (dato sintético del recorrido)' },
    }).expect(200)).body.run;
    expect(cerrado.status).toBe('CLOSED');
    expect(cerrado.moisture).toMatchObject({ unit: '%BH', display: '7.2' });
    expect(cerrado.moisture.method).toMatch(/Medidor portátil/);
    // Conservación: 100 consumidos = 90 de salida + 10 de merma declarada. La humedad no convierte masas.
    const consumido = (await http().get(`${A()}/lots/${ctx.loteFermentado}`).set(as(ADMIN)).expect(200)).body;
    expect(saldos(consumido.quantities)).toMatchObject({ physical: 330, reserved: 0, available: 330 });
    const seco = (await http().get(`${A()}/lots/${cerrado.outputs[0].lot_id}`).set(as(ADMIN)).expect(200)).body;
    expect(saldos(seco.quantities)).toMatchObject({ physical: 90, available: 90 });
    expect(seco.origin.status).toBe('COMPLETE'); // el origen sobrevive a la segunda transformación
    const conciliacion = (await http().get(`${A()}/inventory/reconciliation`).set(as(ADMIN)).expect(200)).body;
    expect(conciliacion.differences).toHaveLength(0);
    anota('fermentación → secado cerrado', '100 kg consumidos = 90 de salida + 10 de merma; humedad 7,2 %BH con método y responsable (D-32); origen conservado y ledger conciliado');
  });

  // ---------------------------------------------------------------- 4. riesgo → mitigación

  it('lote → evaluación de riesgo: resultado técnico sí, severidad y conclusión NO', async () => {
    const e = (await http().post(`${A()}/risk/lots/${ctx.loteFermentado}/evaluations`).set(as(EUDR)).send({ operation_id: op() }).expect(201)).body.evaluation;
    ctx.evaluacion = e.id;
    expect(e.rules).toMatchObject({ adopted_by_organization: false, regulatory_profile: null });
    expect(e.risk_result).toMatchObject({ severity: 'NOT_ASSESSED', conclusion: 'UNDETERMINED' });
    const noEvaluables = e.factors.filter((f: { result: string }) => f.result === 'NOT_EVALUABLE').map((f: { code: string }) => f.code);
    expect(noEvaluables).toEqual(expect.arrayContaining(['GEOLOCATION_PROFILE', 'SATELLITE_COVERAGE_UNKNOWN']));
    anota('lote → riesgo', `resultado técnico ${e.technical_result.status} con el catálogo ${e.rules.version} publicado pero NO adoptado y sin perfil jurídico; severidad NOT_ASSESSED y conclusión UNDETERMINED por diseño`);
    corta('riesgo → severidad y conclusión', 'RULE_SET_NOT_ADOPTED_NOR_UNDER_LEGAL_PROFILE', 'D-07.1 (adoptar el catálogo en la organización) + D-07.5/D-07.6 (perfil jurídico y quién concluye)');
    corta('riesgo → factor satelital', 'SATELLITE_COVERAGE_UNKNOWN', 'D-09 parte B (uso real del proveedor)');
  });

  it('riesgo → mitigación: una causa que depende de una decisión ajena no se mitiga', async () => {
    const mid = (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.id').where('u.email', '=', EUDR2).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;
    const rechazo = await http().post(`${A()}/mitigations`).set(as(EUDR)).send({
      operation_id: op(), evaluation_id: ctx.evaluacion, factor_code: 'SATELLITE_COVERAGE_UNKNOWN',
      title: 'Intento sobre una causa no accionable', acceptance_criteria: 'No procede',
      assignee_membership_id: mid, due_date: '2026-12-31',
    });
    expect(rechazo.status).toBe(422);
    expect(rechazo.body.error.code).toBe('CAUSE_NOT_ACTIONABLE');
    anota('riesgo → mitigación', 'una causa que depende de una decisión ajena no se mitiga: no se simula su resolución');
  });

  // ---------------------------------------------------------------- 5. expediente

  it('lote → expediente: instantánea con requisitos reales; READY inalcanzable y aprobar bloqueado', async () => {
    const c = (await http().post(`${A()}/dd-cases`).set(as(EUDR)).send({ operation_id: op(), lot_id: ctx.loteFermentado, scope_note: 'Expediente sintético del recorrido' }).expect(201)).body.case;
    const s = (await http().post(`${A()}/dd-cases/${c.id}/snapshots`).set(as(EUDR)).send({ operation_id: op() }).expect(201)).body.snapshot;
    expect(s.readiness.effective).toBe('BLOCKED');
    const porCodigo = Object.fromEntries((s.requirements as Array<{ code: string; status: string }>).map((r) => [r.code, r.status]));
    // Lo que el recorrido SÍ cumple y lo que depende de decisiones ajenas, sin rebajar ninguno.
    expect(porCodigo.QUANTITIES_CONSISTENT).toBe('MET');
    expect(porCodigo.ORIGIN_DECLARED).toBe('MET');
    expect(porCodigo.GEOLOCATION_PROFILE).toBe('NOT_EVALUABLE');
    expect(porCodigo.DEFORESTATION_ANALYSIS).toBe('NOT_EVALUABLE');
    // Aprobar exige pasar antes por revisión; y aun así los requisitos no evaluables lo impiden.
    await http().post(`${A()}/dd-snapshots/${s.id}/reviews`).set(as(EUDR2)).send({ operation_id: op(), action: 'START_REVIEW', reason: 'Revisión del recorrido' }).expect(201);
    const aprobar = await http().post(`${A()}/dd-snapshots/${s.id}/reviews`).set(as(EUDR2)).send({ operation_id: op(), action: 'APPROVE', reason: 'Intento del recorrido' }).expect(409);
    expect(aprobar.body.error.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['GEOLOCATION_PROFILE', 'DEFORESTATION_ANALYSIS']));
    anota('lote → expediente', `instantánea con cantidades y origen CUMPLIDOS; readiness ${s.readiness.effective}`);
    corta('expediente → READY y paquete DD', aprobar.body.error.code, 'D-05.B y D-09 parte B (requisitos no evaluables; el perfil TÉCNICO ya no es el bloqueo)');
  });

  // ---------------------------------------------------------------- 6. embarque

  it('lote → embarque: reserva real en el ledger; el despacho se detiene en su compuerta', async () => {
    const buyer = (await http().post(`${A()}/buyers`).set(as(EXP)).send({ operation_id: op(), code: 'IMP-RI-1', name: 'Importador Sintético', country: 'NL' }).expect(201)).body.buyer.id;
    const s = (await http().post(`${A()}/shipments`).set(as(EXP)).send({ operation_id: op(), buyer_id: buyer, destination_country: 'NL', destination_place: 'Rotterdam', origin_location_id: ctx.centro }).expect(201)).body.shipment;
    const item = (await http().post(`${A()}/shipments/${s.id}/items`).set(as(EXP)).send({ expected_version: s.row_version, lot_id: ctx.loteFermentado, quantity: '200' }).expect(201)).body.shipment.items[0];
    await http().post(`${A()}/shipments/${s.id}/reserve`).set(as(EXP)).send({ operation_id: op(), item_id: item.id }).expect(201);

    // Reservar NO reduce la existencia física: solo compromete.
    const lote = (await http().get(`${A()}/lots/${ctx.loteFermentado}`).set(as(ADMIN)).expect(200)).body;
    expect(saldos(lote.quantities)).toMatchObject({ physical: 330, reserved: 200, available: 130 }); // 430 − 100 consumidos por el secado

    const pre = (await http().get(`${A()}/shipments/${s.id}/preflight`).set(as(EXP)).expect(200)).body;
    expect(pre.allowed).toBe(false);
    const fallan = (pre.checks as Array<{ code: string; status: string }>).filter((c) => c.status !== 'OK').map((c) => c.code);
    // Lo que el recorrido SÍ deja listo frente a lo que depende de decisiones: ítems, reserva y origen pasan.
    const estado = (code: string) => (pre.checks as Array<{ code: string; status: string }>).find((c) => c.code === code)?.status;
    expect({ items: estado('ITEMS'), reserva: estado('RESERVATION'), origen: estado('ORIGIN') }).toEqual({ items: 'OK', reserva: 'OK', origen: 'OK' });
    expect(fallan.length).toBeGreaterThan(0);
    const d = await http().post(`${A()}/shipments/${s.id}/dispatch`).set(as(EXP)).send({ operation_id: op(), expected_version: (await http().get(`${A()}/shipments/${s.id}`).set(as(EXP)).expect(200)).body.row_version }).expect(409);
    expect(d.body.error.code).toBe('DISPATCH_BLOCKED');
    // El bloqueo no consume: el inventario queda exactamente como estaba.
    const despues = (await http().get(`${A()}/lots/${ctx.loteFermentado}`).set(as(ADMIN)).expect(200)).body;
    expect(saldos(despues.quantities)).toMatchObject({ physical: 330, reserved: 200, dispatched: 0 });
    anota('lote → embarque', 'reserva real en el ledger sin reducir existencia; preflight con sus comprobaciones fallidas visibles');
    corta('embarque → despacho', d.body.error.code, `D-34 y requisitos del preflight (${fallan.join(', ')})`);
  });

  // ---------------------------------------------------------------- 7. recorrido inverso y aislamiento

  it('recorrido inverso: del lote de salida hasta el productor y la parcela, sin perder trazas', async () => {
    const hub = (await http().get(`${A()}/lots/${ctx.loteFermentado}`).set(as(ADMIN)).expect(200)).body;
    const upstream = JSON.stringify(hub.upstream);
    expect(upstream).toContain('RI-1');        // productor de origen
    expect(upstream).toContain('RI-1-P1');     // parcela de origen
    expect(hub.produced_by).toMatchObject({ process_type: 'FERMENTATION' });
    expect(hub.shipments.length).toBeGreaterThan(0);
    anota('recorrido inverso', 'del lote de salida se llega al proceso, al lote de origen, a la entrega, al productor y a la parcela');
  });

  it('aislamiento: la otra organización no ve ni referencia nada de este recorrido', async () => {
    const B = base(orgB);
    await http().get(`${A()}/lots/${ctx.loteFermentado}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${B}/lots/${ctx.loteFermentado}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${A()}/producers/${ctx.producer}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${A()}/plots/${ctx.plot}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${A()}/deliveries/${ctx.delivery}`).set(as('admin-b@test.local')).expect(404);
    // Y tampoco puede usar sus identificadores como referencia dentro de su propia organización.
    const pB = (await http().post(`${B}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'RB-1', legal_name: 'Otra asociación' }).expect(201)).body.id;
    expect(pB).toBeTruthy();
    // Una referencia ajena no es válida aquí. El servidor responde «no existe para ti» (404) o «referencia inválida»
    // (422) según el recurso; lo que nunca ocurre es que la acepte.
    for (const res of [
      await http().post(`${B}/plots`).set(as('admin-b@test.local')).send({ producer_id: ctx.producer, plot_code: 'X-1', crop: 'Cacao' }),
      await http().post(`${B}/lots`).set(as('admin-b@test.local')).send({ operation_id: op(), inputs: [{ reception_id: ctx.reception, quantity: '1' }] }),
    ]) expect([404, 422]).toContain(res.status);
    anota('aislamiento entre organizaciones', 'la organización ajena no lee ni referencia productor, parcela, entrega, recepción ni lote del recorrido');
  });
});
