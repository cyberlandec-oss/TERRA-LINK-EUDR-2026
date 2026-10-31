import { sql, type Kysely } from 'kysely';

// Recorrido Productor → exportadora: una organización distinta de la propietaria puede encargar el análisis satelital de PARCELAS CONCRETAS.
//
// - La parcela conserva su organización y autoría: no se copia ni se reasigna. El trabajo sigue en el tenant de la parcela (`organization_id`).
// - `satellite_plot_authorizations` es un acto de la organización PROPIETARIA: parcela concreta, organización destinataria, vencimiento obligatorio,
//   `can_download` opcional (la respuesta original contiene la geometría enviada), revocable. Los términos no se editan; una revocada no se reactiva.
//   No es una concesión de lectura (`access_grants`): no da acceso a la parcela, a su geometría ni a su productor.
// - El trabajo conserva quién lo solicitó (`requesting_organization_id`, de la que sale la credencial del proveedor) y con qué autorización.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE satellite_plot_authorizations (
      id                       uuid PRIMARY KEY,
      organization_id          uuid NOT NULL REFERENCES organizations(id),
      plot_id                  uuid NOT NULL,
      grantee_organization_id  uuid NOT NULL REFERENCES organizations(id),
      can_download             boolean NOT NULL DEFAULT false,
      expires_at               timestamptz NOT NULL,
      reason                   text NOT NULL,
      granted_by               uuid NOT NULL REFERENCES users(id),
      operation_id             uuid NOT NULL,
      created_at               timestamptz NOT NULL DEFAULT now(),
      revoked_at               timestamptz,
      revoked_by               uuid REFERENCES users(id),
      revoke_reason            text,
      CONSTRAINT satellite_plot_authz_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots(organization_id, id),
      CONSTRAINT satellite_plot_authz_otra_org CHECK (grantee_organization_id <> organization_id),
      CONSTRAINT satellite_plot_authz_vencimiento CHECK (expires_at > created_at),
      CONSTRAINT satellite_plot_authz_revocacion CHECK (
        (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR
        (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL)),
      CONSTRAINT satellite_plot_authz_operacion_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX satellite_plot_authz_activa_uq ON satellite_plot_authorizations (organization_id, plot_id, grantee_organization_id) WHERE revoked_at IS NULL`.execute(db);
  await sql`CREATE INDEX satellite_plot_authz_destino_idx ON satellite_plot_authorizations (grantee_organization_id) WHERE revoked_at IS NULL`.execute(db);

  await sql`
    CREATE FUNCTION satellite_plot_authz_terminos_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.plot_id IS DISTINCT FROM OLD.plot_id
         OR NEW.grantee_organization_id IS DISTINCT FROM OLD.grantee_organization_id OR NEW.can_download IS DISTINCT FROM OLD.can_download
         OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.granted_by IS DISTINCT FROM OLD.granted_by THEN
        RAISE EXCEPTION 'los terminos de una autorizacion satelital no se editan; revoca y autoriza otra';
      END IF;
      IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
        RAISE EXCEPTION 'una autorizacion satelital revocada no se reactiva';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER satellite_plot_authz_inmutable BEFORE UPDATE ON satellite_plot_authorizations FOR EACH ROW EXECUTE FUNCTION satellite_plot_authz_terminos_inmutables()`.execute(db);

  await sql`ALTER TABLE satellite_jobs ADD COLUMN requesting_organization_id uuid REFERENCES organizations(id)`.execute(db);
  await sql`ALTER TABLE satellite_jobs ADD COLUMN authorization_id uuid REFERENCES satellite_plot_authorizations(id)`.execute(db);
  // Rellenar la columna nueva en los trabajos existentes (todos propios): el disparador de transiciones prohíbe tocar un trabajo terminado, así que se
  // suspende SOLO durante este UPDATE (dentro de la misma transacción) y se restablece de inmediato. No cambia ningún otro campo.
  await sql`ALTER TABLE satellite_jobs DISABLE TRIGGER satellite_jobs_no_rewrite`.execute(db);
  await sql`UPDATE satellite_jobs SET requesting_organization_id = organization_id`.execute(db);
  await sql`ALTER TABLE satellite_jobs ENABLE TRIGGER satellite_jobs_no_rewrite`.execute(db);
  await sql`ALTER TABLE satellite_jobs ALTER COLUMN requesting_organization_id SET NOT NULL`.execute(db);
  // Solicitud propia ⇔ sin autorización; solicitud de otra organización ⇔ con autorización.
  await sql`ALTER TABLE satellite_jobs ADD CONSTRAINT satellite_jobs_solicitante_autorizacion CHECK ((requesting_organization_id = organization_id) = (authorization_id IS NULL))`.execute(db);
  await sql`
    CREATE FUNCTION satellite_job_autorizacion_coherente() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      -- Un encargo sin solicitante declarado es de la propia organización propietaria (así se creaban antes de esta migración).
      IF NEW.requesting_organization_id IS NULL THEN NEW.requesting_organization_id := NEW.organization_id; END IF;
      IF NEW.authorization_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM satellite_plot_authorizations a
         WHERE a.id = NEW.authorization_id AND a.organization_id = NEW.organization_id AND a.plot_id = NEW.plot_id
           AND a.grantee_organization_id = NEW.requesting_organization_id) THEN
        RAISE EXCEPTION 'la autorizacion no corresponde a la parcela y a la organizacion solicitante del trabajo';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER satellite_job_autorizacion BEFORE INSERT ON satellite_jobs FOR EACH ROW EXECUTE FUNCTION satellite_job_autorizacion_coherente()`.execute(db);
  await sql`CREATE INDEX satellite_jobs_solicitante_idx ON satellite_jobs (requesting_organization_id, requested_at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX satellite_jobs_solicitante_idx`.execute(db);
  await sql`DROP TRIGGER satellite_job_autorizacion ON satellite_jobs`.execute(db);
  await sql`DROP FUNCTION satellite_job_autorizacion_coherente`.execute(db);
  await sql`ALTER TABLE satellite_jobs DROP CONSTRAINT satellite_jobs_solicitante_autorizacion`.execute(db);
  await sql`ALTER TABLE satellite_jobs DROP COLUMN authorization_id`.execute(db);
  await sql`ALTER TABLE satellite_jobs DROP COLUMN requesting_organization_id`.execute(db);
  await sql`DROP TRIGGER satellite_plot_authz_inmutable ON satellite_plot_authorizations`.execute(db);
  await sql`DROP FUNCTION satellite_plot_authz_terminos_inmutables`.execute(db);
  await sql`DROP TABLE satellite_plot_authorizations`.execute(db);
}
