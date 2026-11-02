import { sql, type Kysely } from 'kysely';

// P1-008 — Integración ERP/API por webhooks (RF-39; `docs/18:209`).
//
// QUÉ EXIGEN LOS CRITERIOS
//   · **RF-39** (`docs/03:55`, tabla de evolución, columna **Restricción**): «**Idempotencia y tenant**».
//   · **P1-008** (`docs/18:209`, aceptación mínima): «**Firma/idempotencia/tenant/mapping**; **referencia de
//     paquete/submission exacta**».
//
// QUÉ SE REUTILIZA, Y QUÉ FALTABA
// El bus de eventos ya existe y es bueno: `domain_events` como origen, `event_deliveries` con **reintentos,
// arrendamiento, cola muerta y reencolado manual**, y `consumer_receipts` para no procesar dos veces. Lo que
// faltaba es **salir de la aplicación**: un destino configurado por la organización, una **firma** que el
// receptor pueda verificar, y el **resultado de cada intento** consultable.
//
// Por eso **no se construye otra cola**: el envío es un **consumidor más** del bus (`webhook`), y hereda sus
// reintentos y su cola muerta. Estas tablas solo añaden **el destino** y **el resultado por intento**.
//
// SECRETO
// El secreto de firma se guarda **cifrado** con el mismo mecanismo que los datos personales (AES-256-GCM con
// AAD propia), **nunca se devuelve** por la API y solo se muestra su **huella**. Se entrega **una vez**, al
// crearlo: si se pierde, se rota generando otra versión.
//
// TENANT
// Un destino pertenece a **una** organización y solo recibe **sus** eventos. La clave ajena lo ata, y el
// consumidor filtra por `organization_id` del evento: no hay forma de suscribirse a lo ajeno.
//
// APPEND-ONLY
// Cambiar un destino es **registrar otra versión**; revocarlo también. Nada se edita ni se borra, así que el
// historial de a quién se envió qué, con qué configuración, queda completo.

const APPEND_ONLY = ['webhook_destinations', 'webhook_attempts'];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE webhook_destinations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      -- Nombre estable del destino dentro de la organización. Sus versiones comparten código.
      code text NOT NULL CHECK (length(btrim(code)) BETWEEN 2 AND 60),
      version integer NOT NULL CHECK (version >= 1),
      url text NOT NULL,
      -- Secreto de firma CIFRADO. Nunca se publica; de él solo sale la huella.
      secret_cipher text NOT NULL,
      secret_fingerprint char(16) NOT NULL,
      -- Tipos de evento suscritos. Vacío = ninguno; no existe el comodín silencioso.
      event_types text[] NOT NULL CHECK (cardinality(event_types) > 0),
      active boolean NOT NULL DEFAULT true,
      -- Motivo obligatorio al cambiar o revocar: la versión 1 no lo lleva.
      reason text,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT webhook_destination_operation_unique UNIQUE (organization_id, operation_id),
      CONSTRAINT webhook_destination_version_unique UNIQUE (organization_id, code, version),
      CONSTRAINT webhook_destination_reason_shape CHECK (
        (version = 1 AND reason IS NULL) OR (version > 1 AND reason IS NOT NULL AND length(btrim(reason)) > 0))
    )`.execute(db);
  await sql`CREATE INDEX webhook_destinations_org_idx ON webhook_destinations (organization_id, code, version DESC)`.execute(db);

  await sql`
    CREATE TABLE webhook_attempts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      destination_id uuid NOT NULL REFERENCES webhook_destinations(id),
      event_id uuid NOT NULL REFERENCES domain_events(event_id),
      -- Identificador de entrega: lo que el receptor usa para descartar duplicados.
      delivery_id text NOT NULL,
      attempt integer NOT NULL CHECK (attempt >= 1),
      status text NOT NULL CHECK (status IN ('ENTREGADO', 'RECHAZADO', 'ERROR_DE_RED', 'OMITIDO')),
      http_status integer,
      -- Qué respondió el receptor, acotado: no se guarda una respuesta entera.
      response_excerpt text,
      error text,
      duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
      sent_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT webhook_attempt_unique UNIQUE (destination_id, event_id, attempt)
    )`.execute(db);
  await sql`CREATE INDEX webhook_attempts_dest_idx ON webhook_attempts (destination_id, sent_at DESC)`.execute(db);
  await sql`CREATE INDEX webhook_attempts_event_idx ON webhook_attempts (event_id)`.execute(db);
  // Un destino no repite una entrega ya lograda: así el reintento del bus no duplica envíos.
  await sql`CREATE UNIQUE INDEX webhook_attempts_entregado_unico ON webhook_attempts (destination_id, event_id) WHERE status = 'ENTREGADO'`.execute(db);

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
