import { sql, type Kysely } from 'kysely';

// P1-012 — Precio, prima y pagos informados (RF-43; S3 §32).
//
// QUÉ PREGUNTA RESPONDE, Y QUÉ NO
// S3 §32 dice que la mayoría de plataformas responde «¿dónde está el cacao?» y que Terra Link debería añadir
// **«¿cuánto recibió el productor?»**, enumerando precio, prima, calidad, volumen, frecuencia y **pagos**.
// Eso es lo que se registra aquí, y nada más:
//
//   · **no es el presupuesto de preparación de P1-010**: aquel es lo que le cuesta a la organización cumplir
//     EUDR; este es el dinero de la **operación comercial con el productor**. Son tablas distintas a propósito;
//   · **un precio registrado no demuestra que se haya pagado**: por eso el pago es **otra** tabla, y lo que
//     guarda es un pago **informado**, nunca una transferencia. Terra Link **no mueve dinero**;
//   · **no se precarga ningún precio de mercado, tarifa ni prima**, y **no se consulta ningún servicio externo**;
//   · **una prima ausente no es cero**: se distingue «no declarada» de «declarada con importe cero»;
//   · **una prima no se deduce** de la calidad, de la trazabilidad ni de la conformidad: si no se declaró con
//     su **fundamento**, no existe. El CHECK `economics_premium_shape` lo impone en la base, no solo en el código.
//
// SOBRE LA ENTREGA QUE YA EXISTE
// No se crea un registro paralelo de la operación: el dato económico **cuelga de la entrega** (`deliveries`),
// que ya tiene productor, producto, fecha, cantidad y unidad. Lo que falta es solo el dinero y su procedencia.
//
// UNIDADES Y MONEDA, SIN CONVERSIONES
// El precio guarda **su** moneda y **su** unidad (`USD` por `KG`, por ejemplo), y la base guarda **su** cantidad
// y **su** unidad. Si no coinciden, el importe es **no calculable** y se dice: nunca se convierte en silencio.
//
// APPEND-ONLY
// Nada se edita. Corregir es **insertar otra versión** con su motivo y un puntero a la que corrige. El
// historial completo queda, y el pasado no se reescribe.

const APPEND_ONLY = ['delivery_economics', 'delivery_payments'];

export async function up(db: Kysely<unknown>): Promise<void> {
  // ---------------------------------------------------------------- precio y prima de una entrega
  await sql`
    CREATE TABLE delivery_economics (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      delivery_id uuid NOT NULL REFERENCES deliveries(id),
      -- Versión del dato dentro de la entrega. La 1 es el registro; de la 2 en adelante son correcciones.
      record_number integer NOT NULL CHECK (record_number >= 1),
      corrects_record_id uuid REFERENCES delivery_economics(id),
      reason text,

      -- PRECIO. Los tres van juntos o no va ninguno: un importe sin moneda ni unidad no significa nada.
      price_amount numeric(18,6) CHECK (price_amount > 0),
      price_currency char(3),
      price_unit text,

      -- BASE del precio: sobre qué cantidad se aplica, declarada explícitamente por quien registra.
      -- No se elige por el sistema ni se deduce: se declara, y queda la cantidad que se vio al declararla.
      basis_kind text NOT NULL CHECK (basis_kind IN ('CANTIDAD_DECLARADA_EN_ENTREGA', 'CANTIDAD_RECIBIDA', 'SIN_BASE_DECLARADA')),
      basis_quantity numeric(18,6) CHECK (basis_quantity > 0),
      basis_unit text,

      -- PRIMA. Si hay importe, hay tipo y hay FUNDAMENTO declarado. Sin fundamento no se registra una prima.
      premium_amount numeric(18,6) CHECK (premium_amount >= 0),
      premium_kind text CHECK (premium_kind IN ('POR_UNIDAD', 'IMPORTE_FIJO')),
      premium_currency char(3),
      premium_unit text,
      premium_grounds text,

      -- PROCEDENCIA del dato: quién lo afirma y sobre qué apoyo. Un documento es opcional, pero si se cita
      -- tiene que existir y ser de la misma organización.
      source text NOT NULL CHECK (source IN ('DECLARADO_POR_LA_ORGANIZACION', 'DECLARADO_POR_EL_PRODUCTOR', 'ACTA_O_DOCUMENTO')),
      source_note text,
      source_document_id uuid REFERENCES documents(id),
      -- Fecha a la que corresponde el dato económico. Distinta de cuándo se registró (created_at).
      agreed_on date,

      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,

      CONSTRAINT economics_operation_unique UNIQUE (organization_id, operation_id),
      CONSTRAINT economics_record_unique UNIQUE (delivery_id, record_number),
      -- Precio: los tres campos o ninguno.
      CONSTRAINT economics_price_shape CHECK (
        (price_amount IS NULL AND price_currency IS NULL AND price_unit IS NULL)
        OR (price_amount IS NOT NULL AND price_currency IS NOT NULL AND price_unit IS NOT NULL)),
      -- Base: con cantidad hay unidad, y sin base declarada no hay ni cantidad ni unidad.
      CONSTRAINT economics_basis_shape CHECK (
        (basis_kind = 'SIN_BASE_DECLARADA' AND basis_quantity IS NULL AND basis_unit IS NULL)
        OR (basis_kind <> 'SIN_BASE_DECLARADA' AND basis_quantity IS NOT NULL AND basis_unit IS NOT NULL)),
      -- Prima: importe ⇒ tipo, moneda y FUNDAMENTO. Y si es por unidad, su unidad.
      CONSTRAINT economics_premium_shape CHECK (
        (premium_amount IS NULL AND premium_kind IS NULL AND premium_currency IS NULL AND premium_unit IS NULL AND premium_grounds IS NULL)
        OR (premium_amount IS NOT NULL AND premium_kind IS NOT NULL AND premium_currency IS NOT NULL
            AND premium_grounds IS NOT NULL AND length(btrim(premium_grounds)) > 0
            AND ((premium_kind = 'POR_UNIDAD' AND premium_unit IS NOT NULL)
                 OR (premium_kind = 'IMPORTE_FIJO' AND premium_unit IS NULL)))),
      -- Algo tiene que traer: un registro económico vacío no es un dato.
      CONSTRAINT economics_not_empty CHECK (price_amount IS NOT NULL OR premium_amount IS NOT NULL),
      -- La primera versión no corrige nada; de la segunda en adelante, motivo y referencia obligatorios.
      CONSTRAINT economics_correction_shape CHECK (
        (record_number = 1 AND corrects_record_id IS NULL AND reason IS NULL)
        OR (record_number > 1 AND corrects_record_id IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0))
    )`.execute(db);
  await sql`CREATE INDEX delivery_economics_delivery_idx ON delivery_economics (delivery_id, record_number DESC)`.execute(db);
  await sql`CREATE INDEX delivery_economics_org_idx ON delivery_economics (organization_id, created_at DESC)`.execute(db);

  // ---------------------------------------------------------------- pagos INFORMADOS (jamás ejecutados)
  await sql`
    CREATE TABLE delivery_payments (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      delivery_id uuid NOT NULL REFERENCES deliveries(id),
      payment_number integer NOT NULL CHECK (payment_number >= 1),
      corrects_payment_id uuid REFERENCES delivery_payments(id),
      reason text,

      amount numeric(18,6) NOT NULL CHECK (amount > 0),
      currency char(3) NOT NULL,
      -- Fecha que declara quien informa el pago. Terra Link no la observa.
      paid_on date NOT NULL,
      -- Medio y referencia tal como se declaran. Son texto: no se valida contra ningún banco ni pasarela.
      method_declared text NOT NULL,
      reference_declared text,

      informed_by uuid NOT NULL REFERENCES users(id),
      informed_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,

      CONSTRAINT payments_operation_unique UNIQUE (organization_id, operation_id),
      CONSTRAINT payments_number_unique UNIQUE (delivery_id, payment_number),
      CONSTRAINT payments_correction_shape CHECK (
        (corrects_payment_id IS NULL AND reason IS NULL)
        OR (corrects_payment_id IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0))
    )`.execute(db);
  await sql`CREATE INDEX delivery_payments_delivery_idx ON delivery_payments (delivery_id, payment_number DESC)`.execute(db);

  for (const t of APPEND_ONLY) {
    await sql.raw(`
      CREATE FUNCTION ${t}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '${t}: append-only; corrige con un registro nuevo';
      END $$`).execute(db);
    await sql.raw(`
      CREATE TRIGGER ${t}_append_only BEFORE UPDATE OR DELETE ON ${t}
      FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [...APPEND_ONLY].reverse()) {
    await sql.raw(`DROP TABLE IF EXISTS ${t} CASCADE`).execute(db);
    await sql.raw(`DROP FUNCTION IF EXISTS ${t}_append_only()`).execute(db);
  }
}
