import { Kysely, sql } from 'kysely';

// Superficie declarada que conserva la geometría vigente (adopción para desarrollo local, 2026-10-12;
// docs/decisiones/SUPERFICIE-DECLARADA-CONSERVA-GEOMETRIA.md).
// - plot_versions.geometry_origin_version_id: la versión NO es una captura; copia la geometría (y sus datos de captura:
//   método, fecha, precisión) de la versión en la que se capturó. Apunta siempre a la versión de origen de la captura
//   (no a la intermedia), en la misma organización y parcela. Solo existe si hay geometría copiada.
// - Las versiones siguen siendo append-only (trigger de 0008); nada de lo anterior cambia.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE plot_versions ADD COLUMN geometry_origin_version_id uuid`.execute(db);
  await sql`ALTER TABLE plot_versions ADD CONSTRAINT plot_versions_geometry_origin_fk FOREIGN KEY (organization_id, geometry_origin_version_id) REFERENCES plot_versions (organization_id, id)`.execute(db);
  await sql`ALTER TABLE plot_versions ADD CONSTRAINT plot_versions_geometry_origin_has_geometry CHECK (geometry_origin_version_id IS NULL OR geometry IS NOT NULL)`.execute(db);
  // La versión de origen pertenece a la misma parcela y su geometría es idéntica (hash), comprobado al insertar.
  await sql`
    CREATE FUNCTION plot_versions_origin_check() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE o record;
    BEGIN
      IF NEW.geometry_origin_version_id IS NULL THEN RETURN NEW; END IF;
      SELECT plot_id, geometry_hash, geometry_origin_version_id INTO o FROM plot_versions
        WHERE id = NEW.geometry_origin_version_id AND organization_id = NEW.organization_id;
      IF o.plot_id IS DISTINCT FROM NEW.plot_id THEN RAISE EXCEPTION 'plot_versions: la geometría de origen es de otra parcela'; END IF;
      IF o.geometry_hash IS DISTINCT FROM NEW.geometry_hash THEN RAISE EXCEPTION 'plot_versions: la geometría copiada no coincide con la de origen'; END IF;
      IF o.geometry_origin_version_id IS NOT NULL THEN RAISE EXCEPTION 'plot_versions: el origen debe ser la versión capturada, no una copia'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER plot_versions_origin_check BEFORE INSERT ON plot_versions FOR EACH ROW EXECUTE FUNCTION plot_versions_origin_check()`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('0033 no es reversible: conserva versiones que copian geometría');
}
