import { Kysely, sql } from 'kysely';

// Bloque 1: marco técnico de gobernanza. No inventa una base jurídica ni responsables:
// los conserva como PENDING hasta que exista una aprobación explícita y auditable.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE legal_governance_versions (
      version text PRIMARY KEY CHECK (version ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'),
      jurisdiction text NOT NULL CHECK (jurisdiction = 'EC'),
      status text NOT NULL CHECK (status IN ('DRAFT','APPROVED','RETIRED')),
      effective_from date NOT NULL,
      effective_to date,
      source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
      source_sha256 text CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
      purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 10 AND 2000),
      created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 3 AND 200),
      created_at timestamptz NOT NULL DEFAULT now(),
      approved_by uuid REFERENCES users(id),
      approved_at timestamptz,
      approval_basis text,
      CONSTRAINT legal_governance_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
      CONSTRAINT legal_governance_approval CHECK (
        status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_basis IS NOT NULL AND length(btrim(approval_basis)) >= 10)
      )
    )`.execute(db);

  await sql`
    CREATE TABLE legal_governance_controls (
      version text NOT NULL REFERENCES legal_governance_versions(version),
      code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,79}$'),
      kind text NOT NULL CHECK (kind IN ('APPLICABILITY','RETENTION','LEGAL_BASIS','RESPONSIBILITY')),
      title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
      status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','EXPIRED')),
      value_text text,
      source_reference text NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 3 AND 500),
      responsible_role text,
      notes text NOT NULL CHECK (length(btrim(notes)) BETWEEN 3 AND 2000),
      PRIMARY KEY (version, code)
    )`.execute(db);

  await sql`CREATE INDEX legal_governance_versions_effective_idx ON legal_governance_versions (jurisdiction, effective_from DESC)`.execute(db);
  await sql`CREATE INDEX legal_governance_controls_kind_idx ON legal_governance_controls (version, kind, status)`.execute(db);

  await sql`
    INSERT INTO legal_governance_versions (version, jurisdiction, status, effective_from, source_url, purpose, created_by)
    VALUES ('1.0.0', 'EC', 'DRAFT', CURRENT_DATE, 'https://eur-lex.europa.eu/eli/reg/2023/1115/2026-09-18/eng/pdf',
      'Marco técnico inicial de aplicabilidad, conservación, base jurídica y responsabilidades. Requiere aprobación explícita antes de afectar expedientes.', 'Terra Link')
  `.execute(db);
  await sql`
    INSERT INTO legal_governance_controls (version, code, kind, title, status, value_text, source_reference, responsible_role, notes) VALUES
      ('1.0.0', 'EUDR_DDS_RECORD_RETENTION', 'RETENTION', 'Conservación de documentación y declaraciones EUDR', 'PENDING', '5 años', 'Reglamento (UE) 2023/1115, arts. 4(3) y 12(5)', NULL, 'Valor derivado de la fuente oficial; no se activa hasta aprobar el marco y su alcance operativo.'),
      ('1.0.0', 'EUDR_APPLICABILITY_SCOPE', 'APPLICABILITY', 'Aplicabilidad por operador, producto y operación', 'PENDING', NULL, 'Reglamento (UE) 2023/1115, arts. 3, 4, 5, 7 y Anexo I', NULL, 'Debe ser resuelto por producto y rol jurídico; ausencia o vencimiento bloquea cualquier conclusión favorable.'),
      ('1.0.0', 'PERSONAL_DATA_LEGAL_BASIS', 'LEGAL_BASIS', 'Base jurídica para tratamiento de datos personales', 'PENDING', NULL, 'Aprobación jurídica local pendiente; no se sustituye por un valor por defecto', NULL, 'El sistema conserva el estado pendiente y no infiere consentimiento, contrato ni obligación legal.'),
      ('1.0.0', 'ACTOR_RESPONSIBILITIES', 'RESPONSIBILITY', 'Responsabilidades de operador, comprador y revisores', 'PENDING', NULL, 'Reglamento (UE) 2023/1115, arts. 4, 8, 10, 11 y 12', NULL, 'Los responsables y facultades deben ser aprobados por producto y jurídico antes de habilitar conclusiones.'),
      ('1.0.0', 'ANNUAL_SYSTEM_REVIEW', 'RESPONSIBILITY', 'Revisión periódica del sistema de diligencia debida', 'PENDING', 'Al menos anual', 'Reglamento (UE) 2023/1115, art. 12(2)', NULL, 'La periodicidad normativa queda registrada como referencia; el calendario operativo requiere aprobación.'),
      ('1.0.0', 'RISK_CONCLUSION_AUTHORITY', 'RESPONSIBILITY', 'Autoridad para registrar conclusión de riesgo', 'PENDING', NULL, 'Decisión interna D-07.6 y Reglamento (UE) 2023/1115, arts. 4, 8, 10 y 11', 'EUDR_MANAGER', 'El rol técnico no convierte por sí solo a una persona en autoridad jurídica; la configuración aprobada será obligatoria.' )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS legal_governance_controls`.execute(db);
  await sql`DROP TABLE IF EXISTS legal_governance_versions`.execute(db);
}
