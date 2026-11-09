import { sql, type Kysely } from 'kysely';

// D — Referencias locales de entidades creadas sin conexión.
//
// Un productor o una parcela que el teléfono crea sin red no tiene identificador definitivo hasta que el servidor la acepta.
// El teléfono le da una referencia LOCAL estable (UUID propio, que viaja como `entity_id` de la operación de alta) y sus
// dependientes (parcela, ubicación, vértices, fotos, entregas) la citan como `*_local_ref`. Al aceptar el alta, el servidor
// guarda aquí la correspondencia. Se resuelve SOLO por esta tabla: nunca por nombre, proximidad ni coincidencias ambiguas, y
// únicamente para la misma organización y el mismo usuario que la creó.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE sync_entity_refs (
      organization_id uuid NOT NULL REFERENCES organizations(id),
      user_id uuid NOT NULL REFERENCES users(id),
      local_ref uuid NOT NULL,
      entity_type text NOT NULL CHECK (entity_type IN ('PRODUCER', 'PLOT')),
      server_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      device_id uuid NOT NULL,
      -- versión de la parcela que produjo el alta (base esperada para la primera captura que dependa de ella)
      produced_row_version bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, user_id, local_ref)
    )`.execute(db);
  await sql`CREATE INDEX sync_entity_refs_server_idx ON sync_entity_refs (organization_id, entity_type, server_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE sync_entity_refs`.execute(db);
}
