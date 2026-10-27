import { Kysely, sql } from 'kysely';

// D-18 (PROVISIONAL, ratificación pendiente): catálogo de tipos de organización.
// El tipo describe al actor comercial de la cadena y NO concede permisos: la autorización sale solo
// de membresías y roles (authz/catalog.ts). Cambios del catálogo = nueva migración.
const TYPES: Array<[string, string, number]> = [
  ['ASSOCIATION', 'Asociación de productores', 10],
  ['COOPERATIVE', 'Cooperativa', 20],
  ['COLLECTOR', 'Acopiador / centro de acopio', 30],
  ['PROCESSOR', 'Procesador / industria', 40],
  ['EXPORTER', 'Exportador', 50],
  ['IMPORTER', 'Importador', 60],
  ['MANUFACTURER', 'Fabricante / retail', 70],
  ['OTHER', 'Otro', 90],
];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE organization_types (
      code text PRIMARY KEY CHECK (code ~ '^[A-Z_]{2,40}$'),
      label_es text NOT NULL,
      status text NOT NULL CHECK (status IN ('PROVISIONAL','RATIFIED','LEGACY','RETIRED')),
      sort_order integer NOT NULL
    )`.execute(db);
  for (const [code, label, order] of TYPES) {
    await sql`INSERT INTO organization_types (code, label_es, status, sort_order) VALUES (${code}, ${label}, 'PROVISIONAL', ${order})`.execute(db);
  }
  // Códigos ya usados fuera del catálogo se conservan como LEGACY: no se reescribe ningún registro.
  await sql`
    INSERT INTO organization_types (code, label_es, status, sort_order)
    SELECT DISTINCT o.organization_type, o.organization_type, 'LEGACY', 999
    FROM organizations o
    WHERE NOT EXISTS (SELECT 1 FROM organization_types t WHERE t.code = o.organization_type)`.execute(db);
  await sql`
    ALTER TABLE organizations ADD CONSTRAINT organizations_type_fk
    FOREIGN KEY (organization_type) REFERENCES organization_types(code)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE organizations DROP CONSTRAINT organizations_type_fk`.execute(db);
  await sql`DROP TABLE organization_types`.execute(db);
}
