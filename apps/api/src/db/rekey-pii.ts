import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { PiiCipher, normalizeDocumentNumber, parsePiiConfig, producerAad, versionAad } from '../crypto/pii';
import { createDb } from './database';
import type { Database } from './schema';

// D-43 — Recodificación de los datos personales cifrados y reindexado del índice ciego.
//
// Qué hace, en UNA transacción:
//   1. `producers.*_enc`      → descifra con la clave de su token y vuelve a cifrar con la ACTIVA.
//   2. `producer_versions`    → lo mismo dentro de `snapshot`. Es append-only: la transacción desactiva el
//                               trigger y lo vuelve a activar, como ya hizo la migración `0006` para retirar
//                               texto plano. Cambia la REPRESENTACIÓN, no el contenido.
//   3. `document_number_bidx` → se recalcula con `PII_INDEX_KEY`, a partir del número descifrado.
//
// Por qué todo junto y no en dos pasos: dejar el sistema con datos recodificados y un índice calculado con la
// clave anterior —o al revés— produce búsquedas que no encuentran y duplicados que no se detectan. Es un estado
// peor que no haber empezado, así que o entra todo o no entra nada.
//
// **Qué NO hace**: no guarda, imprime ni persiste ningún valor personal, **ni un hash de él**. La igualdad del
// contenido se comprueba EN MEMORIA comparando el texto descifrado antes y después; lo único que sale de aquí
// son conteos y resultados. Un hash de una cédula es una vía más para confirmarla por fuerza bruta: exactamente
// el problema que el índice ciego ya plantea, y no se añade otra.

const CAMPOS = ['document_type', 'document_number', 'phone', 'address'] as const;

export interface ResultadoRecodificacion {
  modo: 'ENSAYO' | 'APLICADO';
  clave_activa: string;
  productores: { filas: number; campos_recodificados: number; contenido_igual: number; contenido_distinto: number };
  historial: { filas: number; campos_recodificados: number; contenido_igual: number; contenido_distinto: number; metadatos_intactos: boolean };
  indice: { recalculados: number; sin_documento: number };
  claves_en_uso_despues: string[];
  errores: string[];
}

/** Igualdad en tiempo constante de dos textos, sin exponerlos. */
function igual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Huella NO reversible de los metadatos de una fila de historial: todo menos los campos cifrados. Sirve para
 * demostrar que autoría, fechas, orden y el resto del snapshot no cambiaron. No incluye ningún dato personal:
 * los campos `*_enc` se excluyen **antes** de calcularla.
 */
function huellaMetadatos(fila: { id: string; organization_id: string; producer_id: string; version: string; change_type: string; changed_fields: string[] | null; reason: string | null; changed_by: string | null; changed_at: Date | string; snapshot: Record<string, unknown> }): string {
  const resto = Object.fromEntries(Object.entries(fila.snapshot).filter(([k]) => !CAMPOS.some((c) => k === `${c}_enc`)));
  const material = JSON.stringify([
    fila.id, fila.organization_id, fila.producer_id, String(fila.version), fila.change_type,
    fila.changed_fields, fila.reason, fila.changed_by, new Date(fila.changed_at).toISOString(),
    Object.keys(resto).sort().map((k) => [k, resto[k]]),
  ]);
  // Clave fija y pública: esto no protege nada, solo compara. No se aplica a datos personales.
  return createHmac('sha256', 'terra-link|d43|metadatos').update(material).digest('hex');
}

export async function recodificar(db: Kysely<Database>, aplicar: boolean): Promise<ResultadoRecodificacion> {
  const cfg = parsePiiConfig(process.env);
  if (!cfg) throw new Error('Definir PII_KEYS, PII_ACTIVE_KEY_ID y PII_INDEX_KEY antes de recodificar.');
  const cipher = new PiiCipher(cfg);
  const r: ResultadoRecodificacion = {
    modo: aplicar ? 'APLICADO' : 'ENSAYO', clave_activa: cfg.activeKeyId,
    productores: { filas: 0, campos_recodificados: 0, contenido_igual: 0, contenido_distinto: 0 },
    historial: { filas: 0, campos_recodificados: 0, contenido_igual: 0, contenido_distinto: 0, metadatos_intactos: true },
    indice: { recalculados: 0, sin_documento: 0 }, claves_en_uso_despues: [], errores: [],
  };

  await db.transaction().execute(async (trx: Transaction<Database>) => {
    // ---------------------------------------------------------------- 1) productores
    const prod = (await sql<{ id: string; organization_id: string; document_type_enc: string | null; document_number_enc: string | null; phone_enc: string | null; address_enc: string | null }>`
      SELECT id, organization_id, document_type_enc, document_number_enc, phone_enc, address_enc
      FROM producers ORDER BY id FOR UPDATE`.execute(trx)).rows;

    for (const p of prod) {
      const antes: Record<string, string | null> = {};
      const nuevos: Record<string, string | null> = {};
      let tocada = false;
      for (const campo of CAMPOS) {
        const token = p[`${campo}_enc` as const] as string | null;
        if (token == null) { nuevos[campo] = null; antes[campo] = null; continue; }
        const aad = producerAad(p.organization_id, p.id, campo);
        const claro = cipher.decrypt(token, aad);
        antes[campo] = claro;
        const reciclado = cipher.encrypt(claro, aad);
        // Comprobación en memoria: lo que se va a guardar descifra al MISMO texto.
        if (!igual(cipher.decrypt(reciclado, aad), claro)) {
          r.productores.contenido_distinto++;
          r.errores.push(`productor ${p.id}: el contenido no coincide tras recodificar ${campo}`);
          throw new Error('Contenido distinto tras recodificar: se revierte todo.');
        }
        r.productores.contenido_igual++;
        r.productores.campos_recodificados++;
        nuevos[campo] = reciclado;
        tocada = true;
      }
      // Índice ciego: se recalcula del número en claro, con la clave de índice vigente.
      const doc = antes.document_number;
      const bidx = doc == null ? null : cipher.blindIndex(p.organization_id, 'DOC', normalizeDocumentNumber(doc));
      if (doc == null) r.indice.sin_documento++; else r.indice.recalculados++;

      if (tocada) r.productores.filas++;
      if (aplicar && (tocada || bidx !== null)) {
        await sql`UPDATE producers SET document_type_enc = ${nuevos.document_type}, document_number_enc = ${nuevos.document_number},
          phone_enc = ${nuevos.phone}, address_enc = ${nuevos.address}, document_number_bidx = ${bidx} WHERE id = ${p.id}`.execute(trx);
      }
    }

    // ---------------------------------------------------------------- 2) historial (append-only)
    const vers = (await sql<{ id: string; organization_id: string; producer_id: string; version: string; change_type: string; changed_fields: string[] | null; reason: string | null; changed_by: string | null; changed_at: Date; snapshot: Record<string, unknown> }>`
      SELECT id, organization_id, producer_id, version::text, change_type, changed_fields, reason, changed_by, changed_at, snapshot
      FROM producer_versions ORDER BY producer_id, version`.execute(trx)).rows;

    if (aplicar) await sql`ALTER TABLE producer_versions DISABLE TRIGGER producer_versions_no_mutation`.execute(trx);
    try {
      for (const v of vers) {
        const huellaAntes = huellaMetadatos(v);
        const snap: Record<string, unknown> = { ...v.snapshot };
        let tocada = false;
        for (const campo of CAMPOS) {
          const token = snap[`${campo}_enc`] as string | null | undefined;
          if (token == null) continue;
          const aad = versionAad(v.organization_id, v.producer_id, v.version, campo);
          const claro = cipher.decrypt(token, aad);
          const reciclado = cipher.encrypt(claro, aad);
          if (!igual(cipher.decrypt(reciclado, aad), claro)) {
            r.historial.contenido_distinto++;
            r.errores.push(`versión ${v.id}: el contenido no coincide tras recodificar ${campo}`);
            throw new Error('Contenido distinto tras recodificar el historial: se revierte todo.');
          }
          r.historial.contenido_igual++;
          r.historial.campos_recodificados++;
          snap[`${campo}_enc`] = reciclado;
          tocada = true;
        }
        if (!tocada) continue;
        r.historial.filas++;
        // Metadatos: la huella NO cubre los campos cifrados, así que debe ser idéntica.
        if (huellaMetadatos({ ...v, snapshot: snap }) !== huellaAntes) {
          r.historial.metadatos_intactos = false;
          r.errores.push(`versión ${v.id}: cambiaron metadatos del historial`);
          throw new Error('Metadatos del historial alterados: se revierte todo.');
        }
        if (aplicar) await sql`UPDATE producer_versions SET snapshot = ${JSON.stringify(snap)}::jsonb WHERE id = ${v.id}`.execute(trx);
      }
    } finally {
      if (aplicar) await sql`ALTER TABLE producer_versions ENABLE TRIGGER producer_versions_no_mutation`.execute(trx);
    }

    // ---------------------------------------------------------------- 3) comprobación final dentro de la transacción
    const kids = (await sql<{ kid: string | null; n: string }>`
      SELECT split_part(t, '.', 2) AS kid, count(*)::text AS n FROM (
        SELECT unnest(ARRAY[document_type_enc, document_number_enc, phone_enc, address_enc]) AS t FROM producers
        UNION ALL
        SELECT jsonb_extract_path_text(snapshot, k) FROM producer_versions,
          unnest(ARRAY['document_type_enc','document_number_enc','phone_enc','address_enc']) AS k
      ) z WHERE t IS NOT NULL GROUP BY 1 ORDER BY 1`.execute(trx)).rows;
    r.claves_en_uso_despues = kids.map((k) => `${k.kid}:${k.n}`);

    if (aplicar) {
      const otras = kids.filter((k) => k.kid !== cfg.activeKeyId);
      if (otras.length) {
        r.errores.push(`quedan tokens con otra clave: ${otras.map((o) => o.kid).join(', ')}`);
        throw new Error('Quedan datos sin recodificar: se revierte todo.');
      }
      // La protección append-only debe quedar activa.
      const trg = (await sql<{ enabled: string }>`
        SELECT tgenabled AS enabled FROM pg_trigger WHERE tgname = 'producer_versions_no_mutation'`.execute(trx)).rows[0];
      if (!trg || trg.enabled === 'D') {
        r.errores.push('el trigger append-only quedó desactivado');
        throw new Error('Protección append-only no restaurada: se revierte todo.');
      }
      await sql`INSERT INTO audit_logs (id, organization_id, actor_user_id, action, entity_type, entity_id, result, reason, after)
        VALUES (${randomUUID()}, NULL, NULL, 'pii.rekeyed', 'pii_key', NULL, 'SUCCESS',
                'D-43: recodificación a la clave activa y reindexado del índice ciego; contenido, autoría y fechas sin cambios',
                ${JSON.stringify({ clave_activa: cfg.activeKeyId, productores: r.productores.filas, versiones: r.historial.filas, indices: r.indice.recalculados })}::jsonb)`.execute(trx);
    }
  });

  return r;
}

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Definir DATABASE_URL');
  const db = createDb(url);
  try {
    const r = await recodificar(db, aplicar);
    console.log(JSON.stringify(r, null, 2));
    if (r.errores.length) process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

if (process.argv[1]?.includes('rekey-pii')) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : 'Error desconocido'); process.exitCode = 1; });
}
