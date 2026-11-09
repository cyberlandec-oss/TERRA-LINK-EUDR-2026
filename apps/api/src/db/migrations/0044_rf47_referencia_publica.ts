import { Kysely, sql } from 'kysely';

// RF-47 — Referencia pública por entidad (`public_reference`). Contrato adoptado como **provisional para el
// desarrollo local** el 2026-10-16. Contrato y decisiones: `docs/decisiones/RF-47-REFERENCIA-PUBLICA.md`.
//
// QUÉ SE ADOPTA
// Las cinco decisiones D-47.1 a D-47.5, con la emisión **automática** (no bajo demanda). Son **decisiones de
// diseño**, no conclusiones obligadas por la fuente: S1 §49 dice «cada una podrá tener `public_reference`» y
// «nunca exponer directamente IDs internos», y no fija ámbito, formato, emisión ni resolución.
//
// POR QUÉ UN REGISTRO CENTRAL Y NO UNA COLUMNA POR TABLA
// Dos razones, y las dos son del contrato:
//   1. **Unicidad entre tipos.** Si las seis entidades se resuelven por la misma ruta, un `UNIQUE` independiente
//      en cada tabla NO impide que una parcela y un lote reciban la misma referencia: cada restricción solo
//      mira su propia tabla. La unicidad efectiva exige un espacio de nombres único, y eso es esta tabla, donde
//      `reference` es la clave primaria.
//   2. **La instantánea no se puede tocar.** `dd_snapshots` tiene `content`, `content_hash`, `section_hashes` y
//      `manifest`. Escribir la referencia dentro de `content` cambiaría su hash y rompería lo que la
//      instantánea acredita. Guardándola fuera, el contenido histórico, el manifiesto y el hash quedan
//      **intactos**: la referencia es metadato *sobre* la instantánea, no parte de ella.
//
// Los códigos operativos (`producer_code`, `plot_code`, `delivery_code`, `lot_code`, `shipment_code`,
// `case_number`) **se conservan tal cual** y ninguna API existente cambia. La referencia pública es un valor
// nuevo que convive con ellos; no los sustituye ni se deriva de ellos.
//
// QUÉ NO HACE ESTA MIGRACIÓN
// - **No publica nada.** Emitir una referencia crea un identificador; no expone el recurso ni concede acceso.
//   La publicación por audiencias, los QR y las concesiones externas son **RF-33 / P1-002** y siguen fuera.
// - **No amplía permisos.** No crea permisos nuevos. `BUYER` y `PRODUCER` siguen sin permisos (`catalog.ts`), y
//   `SUPER_ADMIN` sigue sin acceso a datos de organización: D-04 sigue pendiente y no hay bypass global.
// - No habilita `READY`, ni despacho, ni cambia la conclusión regulatoria. D-34 sigue sin adoptar.

type Tipo = 'PRODUCER' | 'PLOT' | 'DELIVERY' | 'LOT' | 'SHIPMENT' | 'DD_SNAPSHOT';

/** Tabla de origen de cada tipo, para los disparadores y la incorporación. Toda lleva `id` y `organization_id`. */
const FUENTES: Array<{ tipo: Tipo; tabla: string }> = [
  { tipo: 'PRODUCER', tabla: 'producers' },
  { tipo: 'PLOT', tabla: 'plots' },
  { tipo: 'DELIVERY', tabla: 'deliveries' },
  { tipo: 'LOT', tabla: 'lots' },
  { tipo: 'SHIPMENT', tabla: 'shipments' },
  { tipo: 'DD_SNAPSHOT', tabla: 'dd_snapshots' },
];

export async function up(db: Kysely<unknown>): Promise<void> {
  // `pgcrypto` es extensión «trusted» en PostgreSQL 13+: la puede crear el dueño de la base, sin superusuario.
  // Se usa solo por `gen_random_bytes`, para que la referencia venga de un generador criptográfico y no de una
  // secuencia ni de ningún dato de la fila.
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  // Referencia opaca: 24 hexadecimales = 96 bits de aleatoriedad. No es secuencial, no lleva el tipo de
  // entidad, no se deriva de códigos operativos ni de identidad, y no permite tantear valores contiguos.
  await sql`
    CREATE FUNCTION public_reference_new() RETURNS text LANGUAGE sql VOLATILE AS $$
      SELECT encode(gen_random_bytes(12), 'hex')
    $$`.execute(db);

  await sql`
    CREATE TABLE public_references (
      reference       text PRIMARY KEY,
      entity_type     text NOT NULL CHECK (entity_type IN ('PRODUCER','PLOT','DELIVERY','LOT','SHIPMENT','DD_SNAPSHOT')),
      entity_id       uuid NOT NULL,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      created_at      timestamptz NOT NULL DEFAULT now(),
      -- Una sola referencia por entidad: no se emiten dos para la misma, y una instantánea anterior nunca
      -- pasa a representar otra nueva.
      CONSTRAINT public_references_entity_uq UNIQUE (entity_type, entity_id)
    )`.execute(db);
  // La referencia se resuelve sin contexto de organización, pero el filtro por tenant sigue siendo obligatorio
  // al comprobar el acceso: este índice sirve a esa comprobación.
  await sql`CREATE INDEX public_references_org_idx ON public_references (organization_id, entity_type)`.execute(db);

  // Append-only: la referencia **no se edita y no se reutiliza**. Sin UPDATE no puede reapuntarse a otra
  // entidad; sin DELETE no puede liberarse para que otra la reciba.
  await sql`
    CREATE FUNCTION public_references_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'public_references es append-only: una referencia no se edita ni se reutiliza';
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER public_references_no_mutation BEFORE UPDATE OR DELETE ON public_references
    FOR EACH ROW EXECUTE FUNCTION public_references_append_only()`.execute(db);

  // Emisión automática: un disparador por tabla de origen. Al estar en la base, cubre **todas** las vías de
  // alta —API, semillas, importación, pruebas— sin que ninguna tenga que acordarse de emitirla.
  // `ON CONFLICT DO NOTHING` la hace idempotente: reintentar una alta nunca produce una segunda referencia.
  await sql`
    CREATE FUNCTION public_reference_emit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO public_references (reference, entity_type, entity_id, organization_id)
      VALUES (public_reference_new(), TG_ARGV[0], NEW.id, NEW.organization_id)
      ON CONFLICT (entity_type, entity_id) DO NOTHING;
      RETURN NULL;
    END $$`.execute(db);

  for (const { tipo, tabla } of FUENTES) {
    await sql`
      CREATE TRIGGER ${sql.raw(`${tabla}_public_reference`)} AFTER INSERT ON ${sql.raw(tabla)}
      FOR EACH ROW EXECUTE FUNCTION public_reference_emit(${sql.raw(`'${tipo}'`)})`.execute(db);

    // Incorporación de los registros existentes, en la misma transacción de la migración. Idempotente por el
    // `ON CONFLICT`: si la migración se repitiera sobre datos ya incorporados, no duplicaría ninguna.
    await sql`
      INSERT INTO public_references (reference, entity_type, entity_id, organization_id)
      SELECT public_reference_new(), ${tipo}, t.id, t.organization_id FROM ${sql.raw(tabla)} t
      ON CONFLICT (entity_type, entity_id) DO NOTHING`.execute(db);
  }

  // Comprobación dentro de la propia migración: toda fila existente quedó incorporada.
  for (const { tipo, tabla } of FUENTES) {
    await sql`
      DO $$
      DECLARE faltan bigint;
      BEGIN
        SELECT count(*) INTO faltan FROM ${sql.raw(tabla)} t
          WHERE NOT EXISTS (SELECT 1 FROM public_references r WHERE r.entity_type = ${sql.raw(`'${tipo}'`)} AND r.entity_id = t.id);
        IF faltan > 0 THEN
          RAISE EXCEPTION 'RF-47: quedaron % filas de % sin referencia publica', faltan, ${sql.raw(`'${tabla}'`)};
        END IF;
      END $$`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const { tabla } of FUENTES) {
    await sql`DROP TRIGGER ${sql.raw(`${tabla}_public_reference`)} ON ${sql.raw(tabla)}`.execute(db);
  }
  await sql`DROP FUNCTION public_reference_emit`.execute(db);
  await sql`DROP TRIGGER public_references_no_mutation ON public_references`.execute(db);
  await sql`DROP FUNCTION public_references_append_only`.execute(db);
  await sql`DROP TABLE public_references`.execute(db);
  await sql`DROP FUNCTION public_reference_new`.execute(db);
  // `pgcrypto` no se retira: puede haberla creado o necesitarla otra cosa.
}
