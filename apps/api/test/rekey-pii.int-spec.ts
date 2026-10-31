import { createHmac, randomBytes } from 'crypto';
import { sql } from 'kysely';
import { normalizeDocumentNumber } from '../src/crypto/pii';
import { recodificar } from '../src/db/rekey-pii';
import { describeDb, setupHarness } from './helpers';

// D-43 — Recodificación de datos personales y reindexado del índice ciego, contra PostgreSQL real.
//
// Lo que se fija aquí es lo que hace peligrosa la operación: que el contenido sobreviva intacto, que el
// historial append-only conserve autoría, fechas y orden, que la búsqueda y los duplicados sigan funcionando,
// que el índice recalculado sea el que se espera, que un fallo revierta TODO y que la protección append-only
// quede activa al terminar.
//
// **Nunca se persiste ni se imprime un valor personal ni un hash de él.** Lo que se compara sale de la API, en
// memoria, dentro de la prueba, y se descarta al terminar.
//
// La aplicación se levanta con el llavero COMPLETO (`k1` y `k2`) y `k1` activa: así puede leer lo recodificado
// sin reiniciarse. En la intervención real el orden es otro —parar, recodificar, arrancar con la configuración
// nueva— y eso se demuestra aparte, sobre una copia aislada.
describeDb('D-43 recodificación de identidad y reindexado (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let productorA = '';
  let ajenoB = '';
  const ADMIN_A = 'admin-a@test.local';
  const ADMIN_B = 'admin-b@test.local';
  const DOC = '1712345678';
  const PHONE = '+593 99 111 2233';
  const ADDRESS = 'Recinto La Mina, km 12';
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);
  const idx1 = randomBytes(32);
  const idx2 = randomBytes(32);
  const b64 = (b: Buffer) => b.toString('base64');

  const api = (o: string) => `/api/v1/organizations/${o}/producers`;
  const crear = (o: string, actor: string, body: Record<string, unknown>) => h.http().post(api(o)).set(h.as(actor)).send(body);
  /** El mismo cálculo que hace el producto, reproducido aquí para comprobar el índice sin confiar en el código probado. */
  const indiceEsperado = (org: string, doc: string, key: Buffer) =>
    createHmac('sha256', key).update(`${org}|DOC|${normalizeDocumentNumber(doc)}`).digest('hex');

  beforeAll(async () => {
    process.env.PII_KEYS = `k1:${b64(k1)},k2:${b64(k2)}`;
    process.env.PII_ACTIVE_KEY_ID = 'k1';
    process.env.PII_INDEX_KEY = b64(idx1);
    h = await setupHarness({ pii: { keys: { k1, k2 }, activeKeyId: 'k1', indexKey: idx1 } });
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN_A);
    await h.user(ADMIN_B);
    const mk = async (name: string, admin: string) => (await h.http().post('/api/v1/organizations').set(h.as('super@test.local'))
      .send({ name, organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Org recodificación A', ADMIN_A);
    orgB = await mk('Org recodificación B', ADMIN_B);

    // Un productor con identidad completa y una edición: así hay historial con texto cifrado que recodificar.
    productorA = (await crear(orgA, ADMIN_A, { producer_code: 'RK-1', first_name: 'Ana', last_name: 'Vera', document_type: 'CEDULA', document_number: DOC, phone: PHONE, address: ADDRESS }).expect(201)).body.id;
    await h.http().patch(`${api(orgA)}/${productorA}`).set(h.as(ADMIN_A)).send({ expected_version: 1, phone: '+593 98 000 0000' }).expect(200);
    // Uno sin documento: sobrevive sin índice.
    await crear(orgA, ADMIN_A, { producer_code: 'RK-2', legal_name: 'Finca sin documento' }).expect(201);
    // Y uno en OTRA organización con el MISMO documento: el índice debe separarlos.
    ajenoB = (await crear(orgB, ADMIN_B, { producer_code: 'RK-B', first_name: 'Otro', last_name: 'Ajeno', document_type: 'CEDULA', document_number: DOC }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('recodifica contenido, historial e índice sin alterar lo que el historial acredita', async () => {
    // Estado observable ANTES, leído por la API (nunca de la base).
    const antes = (await h.http().get(`${api(orgA)}/${productorA}`).set(h.as(ADMIN_A)).expect(200)).body;
    const histAntes = (await h.http().get(`${api(orgA)}/${productorA}/history`).set(h.as(ADMIN_A)).expect(200)).body as Array<Record<string, unknown>>;
    const metaAntes = (await sql<{ id: string; version: string; change_type: string; changed_by: string | null; changed_at: string; reason: string | null }>`
      SELECT id, version::text, change_type, changed_by, changed_at::text, reason FROM producer_versions ORDER BY producer_id, version`.execute(h.db)).rows;
    const kidsAntes = (await sql<{ kid: string }>`SELECT DISTINCT split_part(document_number_enc, '.', 2) AS kid FROM producers WHERE document_number_enc IS NOT NULL`.execute(h.db)).rows;
    expect(kidsAntes.map((k) => k.kid)).toEqual(['k1']);

    process.env.PII_ACTIVE_KEY_ID = 'k2';
    const r = await recodificar(h.db, true);

    expect(r).toMatchObject({ modo: 'APLICADO', clave_activa: 'k2', errores: [] });
    expect(r.productores.contenido_distinto).toBe(0);
    expect(r.historial.contenido_distinto).toBe(0);
    expect(r.historial.metadatos_intactos).toBe(true);
    expect(r.historial.filas).toBeGreaterThan(0);
    expect(r.indice.recalculados).toBe(2); // los dos con documento, uno por organización
    expect(r.indice.sin_documento).toBe(1);
    expect(r.claves_en_uso_despues.every((x) => x.startsWith('k2:'))).toBe(true);

    // ---- 1) contenido descifrado idéntico
    const despues = (await h.http().get(`${api(orgA)}/${productorA}`).set(h.as(ADMIN_A)).expect(200)).body;
    expect(despues).toMatchObject({ document_number: antes.document_number, phone: antes.phone, address: antes.address, document_type: antes.document_type });

    // ---- 2) el historial acredita lo mismo: contenido, autoría, fechas y orden
    const histDespues = (await h.http().get(`${api(orgA)}/${productorA}/history`).set(h.as(ADMIN_A)).expect(200)).body as Array<Record<string, unknown>>;
    expect(histDespues).toEqual(histAntes);
    const metaDespues = (await sql<{ id: string; version: string; change_type: string; changed_by: string | null; changed_at: string; reason: string | null }>`
      SELECT id, version::text, change_type, changed_by, changed_at::text, reason FROM producer_versions ORDER BY producer_id, version`.execute(h.db)).rows;
    expect(metaDespues).toEqual(metaAntes);

    // ---- 3) búsqueda y duplicados, con el índice ya recalculado
    const buscado = (await h.http().get(`${api(orgA)}?q=171-234.5678`).set(h.as(ADMIN_A)).expect(200)).body;
    expect(((buscado.items ?? buscado) as Array<{ id: string }>).map((x) => x.id)).toContain(productorA);
    const dup = (await crear(orgA, ADMIN_A, { producer_code: 'RK-3', first_name: 'Ana', last_name: 'Vera', document_type: 'CEDULA', document_number: DOC }).expect(201)).body.id;
    const casos = (await h.http().get(`/api/v1/organizations/${orgA}/producer-match-reviews?status=ALL`).set(h.as(ADMIN_A)).expect(200)).body as Array<{ producer_a?: { id: string }; producer_b?: { id: string } }>;
    const pares = casos.map((c) => [c.producer_a?.id, c.producer_b?.id]);
    expect(pares.some((par) => par.includes(dup) && par.includes(productorA))).toBe(true);

    // ---- 4) aislamiento entre organizaciones: el mismo documento NO cruza
    expect(pares.flat()).not.toContain(ajenoB);
    const bidx = (await sql<{ organization_id: string; document_number_bidx: string }>`
      SELECT organization_id, document_number_bidx FROM producers WHERE document_number_bidx IS NOT NULL`.execute(h.db)).rows;
    const deA = [...new Set(bidx.filter((x) => x.organization_id === orgA).map((x) => x.document_number_bidx))];
    const deB = [...new Set(bidx.filter((x) => x.organization_id === orgB).map((x) => x.document_number_bidx))];
    expect(deA).toHaveLength(1); // los de A comparten documento, luego comparten índice
    expect(deA[0]).not.toBe(deB[0]); // el de B, mismo documento, índice distinto: lleva la organización
    expect(deA[0]).toBe(indiceEsperado(orgA, DOC, idx1)); // y es exactamente el que toca

    // ---- 5) la protección append-only quedó restaurada, y muerde
    const trg = (await sql<{ enabled: string }>`SELECT tgenabled AS enabled FROM pg_trigger WHERE tgname = 'producer_versions_no_mutation'`.execute(h.db)).rows[0];
    expect(trg.enabled).not.toBe('D');
    await expect(sql`UPDATE producer_versions SET reason = 'intento' WHERE id = ${metaDespues[0].id}`.execute(h.db)).rejects.toThrow();

    // ---- 6) huella de la operación, sin valores
    const log = (await sql<{ reason: string; after: Record<string, unknown> }>`SELECT reason, after FROM audit_logs WHERE action = 'pii.rekeyed' ORDER BY occurred_at DESC LIMIT 1`.execute(h.db)).rows[0];
    expect(log.reason).toMatch(/D-43/);
    expect(log.after).toMatchObject({ clave_activa: 'k2' });
    for (const v of [DOC, PHONE, ADDRESS]) expect(JSON.stringify(log)).not.toContain(v);
  });

  it('rotar la clave de índice recalcula TODOS los índices y ninguno conserva el valor anterior', async () => {
    const antes = (await sql<{ id: string; organization_id: string; document_number_bidx: string }>`
      SELECT id, organization_id, document_number_bidx FROM producers WHERE document_number_bidx IS NOT NULL ORDER BY id`.execute(h.db)).rows;
    expect(antes.length).toBeGreaterThan(0);

    process.env.PII_INDEX_KEY = b64(idx2);
    const r = await recodificar(h.db, true);
    expect(r.errores).toEqual([]);
    expect(r.indice.recalculados).toBe(antes.length);

    const despues = (await sql<{ id: string; organization_id: string; document_number_bidx: string }>`
      SELECT id, organization_id, document_number_bidx FROM producers WHERE document_number_bidx IS NOT NULL ORDER BY id`.execute(h.db)).rows;
    expect(despues).toHaveLength(antes.length);
    for (const [i, fila] of despues.entries()) {
      expect(fila.document_number_bidx).not.toBe(antes[i].document_number_bidx); // ninguno se queda atrás
      expect(fila.document_number_bidx).toBe(indiceEsperado(fila.organization_id, DOC, idx2)); // y es el nuevo
    }
    // La igualdad por organización se conserva: los de A siguen coincidiendo entre sí y no con los de B.
    const deA = [...new Set(despues.filter((x) => x.organization_id === orgA).map((x) => x.document_number_bidx))];
    const deB = [...new Set(despues.filter((x) => x.organization_id === orgB).map((x) => x.document_number_bidx))];
    expect(deA).toHaveLength(1);
    expect(deA[0]).not.toBe(deB[0]);
    // El `CHECK` de consistencia sigue satisfecho: nunca un cifrado sin índice ni al revés.
    const inconsistentes = (await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM producers WHERE (document_number_enc IS NULL) <> (document_number_bidx IS NULL)`.execute(h.db)).rows[0].n;
    expect(inconsistentes).toBe('0');

    process.env.PII_INDEX_KEY = b64(idx1); // se deja como estaba para no arrastrar estado a otras pruebas
  });

  // Una clave activa inexistente se rechaza ANTES de abrir la transacción: `recodificar` llama a
  // `parsePiiConfig` en su primera línea y esa función exige que la activa esté en el llavero. Es una
  // propiedad que conviene fijar —no se empieza a escribir con una configuración inservible— pero
  // **no demuestra reversión a mitad de operación**: no llega a escribirse nada que revertir.
  // La reversión de verdad se prueba en el caso siguiente.
  it('una clave activa inexistente se rechaza antes de tocar nada (comprobación previa, no reversión)', async () => {
    const antes = (await sql<{ id: string; document_number_enc: string; document_number_bidx: string }>`
      SELECT id, document_number_enc, document_number_bidx FROM producers WHERE document_number_enc IS NOT NULL ORDER BY id`.execute(h.db)).rows;
    const versAntes = (await sql<{ id: string; snapshot: Record<string, unknown> }>`SELECT id, snapshot FROM producer_versions ORDER BY id`.execute(h.db)).rows;

    process.env.PII_ACTIVE_KEY_ID = 'k9';
    // El mensaje acredita que el rechazo es de configuración, previo al recorrido de filas.
    await expect(recodificar(h.db, true)).rejects.toThrow('PII_ACTIVE_KEY_ID no está en PII_KEYS');
    process.env.PII_ACTIVE_KEY_ID = 'k2';

    expect((await sql<{ id: string; document_number_enc: string; document_number_bidx: string }>`
      SELECT id, document_number_enc, document_number_bidx FROM producers WHERE document_number_enc IS NOT NULL ORDER BY id`.execute(h.db)).rows).toEqual(antes);
    expect((await sql<{ id: string; snapshot: Record<string, unknown> }>`SELECT id, snapshot FROM producer_versions ORDER BY id`.execute(h.db)).rows).toEqual(versAntes);
    const trg = (await sql<{ enabled: string }>`SELECT tgenabled AS enabled FROM pg_trigger WHERE tgname = 'producer_versions_no_mutation'`.execute(h.db)).rows[0];
    expect(trg.enabled).not.toBe('D'); // no se queda desactivado tras el fallo
  });

  // Reversión REAL a mitad de operación: el fallo se induce en el INSERT de la auditoría de éxito, que
  // `recodificar` hace al final de la transacción, ya con productores e historial reescritos y con el
  // trigger append-only desactivado y vuelto a activar. El mensaje de la excepción lleva el recuento de
  // tokens de la clave nueva observado DENTRO de la transacción: sobrevive al rollback y prueba que las
  // escrituras ya estaban hechas cuando se produjo el fallo.
  it('un fallo DESPUÉS de escribir datos e historial revierte cifrados, índices y auditoría, y deja el trigger activo', async () => {
    // 1) Partir de `k1` en todo: así cualquier token `k2` que se observe durante la transacción solo
    //    puede venir de esta operación, y no de un estado anterior.
    process.env.PII_ACTIVE_KEY_ID = 'k1';
    expect((await recodificar(h.db, true)).errores).toEqual([]);

    const antes = (await sql<{ id: string; document_type_enc: string | null; document_number_enc: string | null; phone_enc: string | null; address_enc: string | null; document_number_bidx: string | null }>`
      SELECT id, document_type_enc, document_number_enc, phone_enc, address_enc, document_number_bidx FROM producers ORDER BY id`.execute(h.db)).rows;
    const versAntes = (await sql<{ id: string; snapshot: Record<string, unknown>; changed_by: string | null; changed_at: string; reason: string | null }>`
      SELECT id, snapshot, changed_by, changed_at::text, reason FROM producer_versions ORDER BY producer_id, version`.execute(h.db)).rows;
    const auditoriasAntes = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM audit_logs WHERE action = 'pii.rekeyed'`.execute(h.db)).rows[0].n;
    // Punto de partida comprobado: ni un solo token de la clave nueva.
    expect(antes.filter((p) => p.document_number_enc?.split('.')[1] === 'k2')).toEqual([]);

    // 2) Inyectar el fallo en la auditoría de éxito (último paso antes del commit).
    await sql`CREATE OR REPLACE FUNCTION tl_test_fallo_tras_escribir() RETURNS trigger AS $$
      DECLARE prod_k2 int; hist_k2 int;
      BEGIN
        SELECT count(*) INTO prod_k2 FROM producers WHERE split_part(document_number_enc, '.', 2) = 'k2';
        SELECT count(*) INTO hist_k2 FROM producer_versions WHERE split_part(snapshot->>'document_number_enc', '.', 2) = 'k2';
        RAISE EXCEPTION 'FALLO_INDUCIDO productores_k2=% historial_k2=%', prod_k2, hist_k2;
      END $$ LANGUAGE plpgsql`.execute(h.db);
    await sql`CREATE TRIGGER tl_test_fallo BEFORE INSERT ON audit_logs FOR EACH ROW
      WHEN (NEW.action = 'pii.rekeyed') EXECUTE FUNCTION tl_test_fallo_tras_escribir()`.execute(h.db);

    // 3) Recodificar a `k2`: escribe productores e historial y revienta antes del commit.
    let mensaje = '';
    try {
      process.env.PII_ACTIVE_KEY_ID = 'k2';
      await recodificar(h.db, true);
      throw new Error('la recodificación debía fallar y no falló');
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e);
    } finally {
      await sql`DROP TRIGGER IF EXISTS tl_test_fallo ON audit_logs`.execute(h.db);
      await sql`DROP FUNCTION IF EXISTS tl_test_fallo_tras_escribir()`.execute(h.db);
    }

    // 4) El fallo ocurrió DESPUÉS de escribir: el recuento visto dentro de la transacción lo acredita.
    expect(mensaje).toMatch(/FALLO_INDUCIDO/);
    const visto = /productores_k2=(\d+) historial_k2=(\d+)/.exec(mensaje);
    expect(visto).not.toBeNull();
    expect(Number(visto![1])).toBeGreaterThan(0); // productores ya reescritos con la clave nueva
    expect(Number(visto![2])).toBeGreaterThan(0); // historial también

    // 5) Y sin embargo, nada quedó: cifrados e índices vuelven a ser exactamente los de antes.
    expect((await sql<{ id: string; document_type_enc: string | null; document_number_enc: string | null; phone_enc: string | null; address_enc: string | null; document_number_bidx: string | null }>`
      SELECT id, document_type_enc, document_number_enc, phone_enc, address_enc, document_number_bidx FROM producers ORDER BY id`.execute(h.db)).rows).toEqual(antes);
    expect((await sql<{ id: string; snapshot: Record<string, unknown>; changed_by: string | null; changed_at: string; reason: string | null }>`
      SELECT id, snapshot, changed_by, changed_at::text, reason FROM producer_versions ORDER BY producer_id, version`.execute(h.db)).rows).toEqual(versAntes);
    // Ninguna auditoría de ÉXITO: la operación no se acredita como hecha.
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM audit_logs WHERE action = 'pii.rekeyed'`.execute(h.db)).rows[0].n).toBe(auditoriasAntes);

    // 6) El trigger append-only quedó activo, y muerde de verdad.
    const trg = (await sql<{ enabled: string }>`SELECT tgenabled AS enabled FROM pg_trigger WHERE tgname = 'producer_versions_no_mutation'`.execute(h.db)).rows[0];
    expect(trg.enabled).toBe('O');
    await expect(sql`UPDATE producer_versions SET reason = 'intento' WHERE id = ${versAntes[0].id}`.execute(h.db)).rejects.toThrow();

    // 7) Dejar el entorno como lo encontró el resto de la suite: todo en `k2`.
    process.env.PII_ACTIVE_KEY_ID = 'k2';
    expect((await recodificar(h.db, true)).errores).toEqual([]);
  });

  it('el ensayo no escribe nada, y ningún resultado publica datos personales', async () => {
    const huellas = async () => (await sql<{ n: string }>`SELECT count(*)::text AS n FROM audit_logs WHERE action = 'pii.rekeyed'`.execute(h.db)).rows[0].n;
    const antes = await huellas();
    const r = await recodificar(h.db, false);
    expect(r.modo).toBe('ENSAYO');
    expect(r.errores).toEqual([]);
    expect(await huellas()).toBe(antes); // no escribió

    const texto = JSON.stringify(r);
    for (const valor of [DOC, PHONE, ADDRESS, '+593', 'Ana', 'Vera']) expect(texto).not.toContain(valor);
    expect(Object.keys(r).sort()).toEqual(['clave_activa', 'claves_en_uso_despues', 'errores', 'historial', 'indice', 'modo', 'productores']);
  });
});
