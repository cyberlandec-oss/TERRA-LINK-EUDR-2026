import { Kysely, sql } from 'kysely';

// Guarda técnica de `risk_rule_sets.regulatory_profile` (D-07.5(b)).
//
// Hasta ahora la columna era texto libre y el requisito RISK_CATALOG_APPROVED pasaba a MET con cualquier valor no
// nulo. Desde esta migración el valor **solo puede ser una referencia** a una versión de `legal_profile_versions`
// que esté PUBLICADA, con alcance COMPLETO y cuya última decisión de revisión sea REVIEWED. Es la misma condición que
// ya exige LEGAL_PROFILE: no se inventa una definición nueva de «perfil suficiente».
//
// NO fija ningún valor (todas las versiones siguen en NULL), NO añade ninguna API para fijarlo y NO decide la opción
// b-1/b-2/b-3 de D-07.5(b): solo impide que una etiqueta o una versión sin revisar quede escrita como aprobación.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION risk_rule_sets_regulatory_profile_guard() RETURNS trigger AS $$
    DECLARE v legal_profile_versions%ROWTYPE; last_decision text;
    BEGIN
      IF NEW.regulatory_profile IS NULL THEN RETURN NEW; END IF;
      SELECT * INTO v FROM legal_profile_versions WHERE version = NEW.regulatory_profile;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'regulatory_profile debe ser una versión existente de legal_profile_versions (recibido: %).', left(NEW.regulatory_profile, 40);
      END IF;
      IF v.technical_status <> 'PUBLISHED' OR v.scope <> 'COMPLETE' THEN
        RAISE EXCEPTION 'regulatory_profile % no es un perfil PUBLICADO y de alcance COMPLETO.', NEW.regulatory_profile;
      END IF;
      SELECT decision INTO last_decision FROM legal_profile_reviews WHERE version = NEW.regulatory_profile ORDER BY decided_at DESC, id DESC LIMIT 1;
      IF last_decision IS DISTINCT FROM 'REVIEWED' THEN
        RAISE EXCEPTION 'regulatory_profile % no tiene una revisión jurídica vigente (REVIEWED).', NEW.regulatory_profile;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`
    CREATE TRIGGER risk_rule_sets_regulatory_profile_guard
    BEFORE INSERT OR UPDATE OF regulatory_profile ON risk_rule_sets
    FOR EACH ROW EXECUTE FUNCTION risk_rule_sets_regulatory_profile_guard()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS risk_rule_sets_regulatory_profile_guard ON risk_rule_sets`.execute(db);
  await sql`DROP FUNCTION IF EXISTS risk_rule_sets_regulatory_profile_guard()`.execute(db);
}
