import { Kysely, sql } from 'kysely';

// P0-011 Productos (RF-11). Contrato: docs/06 §products y S1 §17.
// - product_states: catálogo de SISTEMA de estados/presentaciones del cacao definidos en las fuentes
//   (S1 §17, doc 06): CACAO_BABA, CACAO_FERMENTADO, CACAO_SECO, CACAO_CLASIFICADO. Solo lectura.
// - measurement_units: catálogo de SISTEMA de unidades. Las fuentes solo definen KG (masa). Sin
//   conversiones: ningún factor está definido en el contrato (D-32).
// - products: catálogo de cada ORGANIZACIÓN (S1: organization_id). Código único por organización.
//   Código, estado/presentación y unidad son INMUTABLES desde la creación (trigger): cambiarlos alteraría
//   el significado de operaciones históricas; se crea otro producto. Nombre, nombre científico y variedad
//   se editan con historial (product_versions, append-only). Sin borrado: baja lógica (INACTIVE).
// - Una transformación entre estados (p. ej. fermentar) NO es una edición del catálogo: requiere proceso,
//   evento y rendimiento (P0-016/017).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE product_states (
      code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
      label text NOT NULL,
      sort_order integer NOT NULL,
      source text NOT NULL
    )`.execute(db);
  await sql`
    INSERT INTO product_states (code, label, sort_order, source) VALUES
      ('CACAO_BABA', 'Cacao en baba', 1, 'S1 §17; docs/06 products'),
      ('CACAO_FERMENTADO', 'Cacao fermentado', 2, 'S1 §17; docs/06 products'),
      ('CACAO_SECO', 'Cacao seco', 3, 'S1 §17; docs/06 products'),
      ('CACAO_CLASIFICADO', 'Cacao clasificado', 4, 'S1 §17; docs/06 products')`.execute(db);

  await sql`
    CREATE TABLE measurement_units (
      code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{0,15}$'),
      label text NOT NULL,
      symbol text NOT NULL,
      dimension text NOT NULL CHECK (dimension IN ('MASS')),
      source text NOT NULL
    )`.execute(db);
  await sql`INSERT INTO measurement_units (code, label, symbol, dimension, source) VALUES ('KG', 'Kilogramo', 'kg', 'MASS', 'S1 §19–20; docs/09 (unit KG)')`.execute(db);

  for (const table of ['product_states', 'measurement_units']) {
    await sql.raw(`
      CREATE FUNCTION ${table}_read_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '${table} es un catálogo de sistema: se cambia con migración';
      END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${table}_no_mutation BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_read_only()`).execute(db);
  }

  await sql`
    CREATE TABLE products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
      name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
      product_state text NOT NULL REFERENCES product_states(code),
      unit text NOT NULL REFERENCES measurement_units(code),
      scientific_name text CHECK (scientific_name IS NULL OR length(btrim(scientific_name)) BETWEEN 1 AND 120),
      variety text CHECK (variety IS NULL OR length(btrim(variety)) BETWEEN 1 AND 120),
      status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
      status_reason text,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid NOT NULL REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid NOT NULL REFERENCES users(id),
      CONSTRAINT products_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT products_code_uq UNIQUE (organization_id, code),
      CONSTRAINT products_status_reason CHECK ((status = 'INACTIVE') = (status_reason IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX products_org_status_idx ON products (organization_id, status, code)`.execute(db);
  await sql`
    CREATE FUNCTION products_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'products no admite borrado: usar baja lógica'; END IF;
      IF NEW.code IS DISTINCT FROM OLD.code OR NEW.product_state IS DISTINCT FROM OLD.product_state
         OR NEW.unit IS DISTINCT FROM OLD.unit OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'products: código, estado/presentación y unidad son inmutables';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER products_guard BEFORE UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION products_guard()`.execute(db);

  await sql`
    CREATE TABLE product_versions (
      product_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      version bigint NOT NULL,
      change_type text NOT NULL CHECK (change_type IN ('CREATED','UPDATED','DEACTIVATED','ACTIVATED')),
      changed_fields text[] NOT NULL,
      snapshot jsonb NOT NULL,
      reason text,
      changed_by uuid NOT NULL REFERENCES users(id),
      changed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (product_id, version),
      CONSTRAINT product_versions_product_fk FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION product_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'product_versions es append-only';
    END $$`.execute(db);
  await sql`CREATE TRIGGER product_versions_no_mutation BEFORE UPDATE OR DELETE ON product_versions FOR EACH ROW EXECUTE FUNCTION product_versions_append_only()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE product_versions`.execute(db);
  await sql`DROP FUNCTION product_versions_append_only`.execute(db);
  await sql`DROP TABLE products`.execute(db);
  await sql`DROP FUNCTION products_guard`.execute(db);
  await sql`DROP TABLE measurement_units`.execute(db);
  await sql`DROP FUNCTION measurement_units_read_only`.execute(db);
  await sql`DROP TABLE product_states`.execute(db);
  await sql`DROP FUNCTION product_states_read_only`.execute(db);
}
