import { sql, type Kysely } from 'kysely';

// A-01 (ampliación autorizada 2026-10-20) — Captura de campo desde la web con alcance propio (RF-48).
//
// QUÉ FALTABA
// El rol PRODUCER existía sin ningún permiso y sin ningún vínculo con su productor: «Recursos propios» (docs/07) no tenía
// de dónde salir. El técnico ya tiene su alcance por asignación (`producers.assigned_membership_id`); el productor
// necesita el equivalente PROPIO, y no puede reutilizar la asignación: son dos relaciones distintas (quién gestiona al
// productor y quién ES el productor) y un mismo productor puede tener ambas.
//
// QUÉ SE AÑADE
//   · `producers.self_membership_id`: la membresía de la persona que ES ese productor. Como mucho UNA por productor y
//     un productor por membresía (índices únicos parciales). No concede nada por sí sola: los permisos `*_own` del rol
//     PRODUCER son los que actúan, y solo sobre el productor vinculado.
//   · El vínculo se administra de forma explícita y auditable (caso de uso `link-membership`, con motivo, versión del
//     productor y evento). No hay vinculación por correo ni por nombre.
//
// QUÉ NO SE TOCA
//   · El historial (`producer_versions`) conserva el cambio como versión LINK_SELF; nada se edita ni se borra.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE producers ADD COLUMN self_membership_id uuid REFERENCES memberships(id)`.execute(db);
  // Un productor tiene a lo sumo una persona que lo es; una persona (membresía) es a lo sumo un productor.
  await sql`CREATE UNIQUE INDEX producers_self_membership_uq ON producers (self_membership_id) WHERE self_membership_id IS NOT NULL`.execute(db);
  // La membresía y el productor deben ser de la misma organización: se comprueba al vincular, y esta restricción lo
  // impide también si alguien escribe directamente.
  await sql`
    CREATE FUNCTION producers_self_membership_same_org() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.self_membership_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM memberships m WHERE m.id = NEW.self_membership_id AND m.organization_id = NEW.organization_id) THEN
        RAISE EXCEPTION 'producers.self_membership_id debe ser una membresía de la misma organización';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER producers_self_membership_same_org BEFORE INSERT OR UPDATE OF self_membership_id ON producers
    FOR EACH ROW EXECUTE FUNCTION producers_self_membership_same_org()`.execute(db);

  // Evidencias del recorrido de campo (foto, croquis, acta): hasta ahora solo había tipos de tenencia o de entrega. Es un
  // tipo OPERATIVO (no dato personal por naturaleza) con titular parcela o productor; el alcance sigue siendo el del titular.
  // El catálogo es de solo lectura frente a UPDATE/DELETE, pero admite altas por migración.
  await sql`
    INSERT INTO document_types (code, label, allowed_owner_types, classification, source) VALUES
      ('FIELD_EVIDENCE', 'Evidencia del recorrido de campo (foto, croquis o acta)', ARRAY['plot','producer'], 'OPERATIONAL', 'A-01 (2026-10-20): evidencia adjunta al recorrido de campo web')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // El tipo de documento no se retira si ya hay documentos de ese tipo (el catálogo es de solo lectura).
  await sql`DROP TRIGGER IF EXISTS producers_self_membership_same_org ON producers`.execute(db);
  await sql`DROP FUNCTION IF EXISTS producers_self_membership_same_org()`.execute(db);
  await sql`DROP INDEX IF EXISTS producers_self_membership_uq`.execute(db);
  await sql`ALTER TABLE producers DROP COLUMN IF EXISTS self_membership_id`.execute(db);
}
