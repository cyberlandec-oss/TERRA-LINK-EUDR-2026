import { Kysely, sql } from 'kysely';

// P0-022 Diligencia y paquete (RF-22, QA-12). Contrato: docs/13 §Ciclo del expediente, §Paquete y §Presentación oficial.
// - Expediente (dd_cases) por sujeto LOTE de la organización (uno por lote en este MVP).
// - Instantáneas (dd_snapshots) INMUTABLES: contenido capturado en una transacción consistente, manifest de versiones,
//   hashes por sección y del contenido, resultado de los guards por requisito y readiness calculada. Un cambio relevante
//   no las modifica: la vista compara con el estado actual y la marca desactualizada (STALE).
// - Revisión autorizada (dd_reviews): iniciar, devolver con motivo o aprobar; aprobar exige readiness READY vigente.
// - Exportaciones (dd_exports): INTERNAL_REVIEW (borrador interno, cualquier instantánea) o DD_PACKAGE (exige instantánea
//   aprobada y vigente). Descargar nunca es presentar una DDS: la presentación oficial es otra dimensión (no implementada).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE dd_cases (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      case_number text NOT NULL,
      subject_type text NOT NULL CHECK (subject_type IN ('LOT')),
      subject_id uuid NOT NULL,
      scope_note text NOT NULL CHECK (length(btrim(scope_note)) BETWEEN 3 AND 1000),
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT dd_cases_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT dd_cases_number_uq UNIQUE (organization_id, case_number),
      CONSTRAINT dd_cases_subject_uq UNIQUE (organization_id, subject_type, subject_id),
      CONSTRAINT dd_cases_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT dd_cases_lot_fk FOREIGN KEY (organization_id, subject_id) REFERENCES lots(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE dd_snapshots (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      snapshot_number integer NOT NULL CHECK (snapshot_number > 0),
      content jsonb NOT NULL,
      content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
      section_hashes jsonb NOT NULL,
      manifest jsonb NOT NULL,
      requirements jsonb NOT NULL,
      readiness text NOT NULL CHECK (readiness IN ('BLOCKED','IN_PROGRESS','READY')),
      captured_by uuid NOT NULL REFERENCES users(id),
      captured_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT dd_snapshots_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT dd_snapshots_number_uq UNIQUE (case_id, snapshot_number),
      CONSTRAINT dd_snapshots_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT dd_snapshots_case_fk FOREIGN KEY (organization_id, case_id) REFERENCES dd_cases(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE dd_reviews (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      snapshot_id uuid NOT NULL,
      action text NOT NULL CHECK (action IN ('START_REVIEW','RETURN','APPROVE')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
      reviewer_id uuid NOT NULL REFERENCES users(id),
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT dd_reviews_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT dd_reviews_snapshot_fk FOREIGN KEY (organization_id, snapshot_id) REFERENCES dd_snapshots(organization_id, id)
    )`.execute(db);
  // Una sola aprobación por instantánea (concurrencia: una gana).
  await sql`CREATE UNIQUE INDEX dd_reviews_one_approval ON dd_reviews (snapshot_id) WHERE action = 'APPROVE'`.execute(db);
  await sql`
    CREATE TABLE dd_exports (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      snapshot_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('INTERNAL_REVIEW','DD_PACKAGE')),
      redaction_profile jsonb NOT NULL,
      package_hash text NOT NULL CHECK (package_hash ~ '^[0-9a-f]{64}$'),
      size_bytes integer NOT NULL CHECK (size_bytes > 0),
      exported_by uuid NOT NULL REFERENCES users(id),
      exported_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT dd_exports_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT dd_exports_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT dd_exports_snapshot_fk FOREIGN KEY (organization_id, snapshot_id) REFERENCES dd_snapshots(organization_id, id)
    )`.execute(db);
  for (const t of ['dd_cases', 'dd_snapshots', 'dd_reviews', 'dd_exports']) {
    await sql.raw(`CREATE FUNCTION ${t}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${t} es append-only'; END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${t}_no_mutation BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['dd_exports', 'dd_reviews', 'dd_snapshots', 'dd_cases']) {
    await sql.raw(`DROP TABLE IF EXISTS ${t}`).execute(db);
    await sql.raw(`DROP FUNCTION IF EXISTS ${t}_append_only()`).execute(db);
  }
}
