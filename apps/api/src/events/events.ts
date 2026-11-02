import { randomUUID } from 'crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { Database, DomainEventsTable } from '../db/schema';

// Eventos de dominio (doc 08, ADR-0003). Tablas de estado + eventos inmutables, sin event sourcing.
//
// Relación con la auditoría (`audit_logs`): la auditoría responde «quién hizo qué» (incluye accesos
// denegados, logins y cambios administrativos); los eventos expresan hechos de dominio para que otros
// componentes reaccionen. Ambos se escriben en la misma transacción que el cambio. Los payloads de
// eventos llevan identificadores y datos operativos mínimos: nunca nombres, documentos ni contactos.

export type DomainEvent = Selectable<DomainEventsTable>;
type Db = Kysely<Database> | Transaction<Database>;

export interface NewEvent {
  organizationId: string;
  eventType: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  actorId: string | null;
  occurredAt?: Date;
  correlationId?: string | null;
  causationId?: string | null;
  operationId?: string | null;
  /** Corrección (P0-015): evento corregido de la misma organización y agregado, con motivo obligatorio. */
  correctionOf?: { eventId: string; reason: string } | null;
  payload: Record<string, unknown>;
}

/** Consumidor de eventos. `handle` corre dentro de la transacción que registra el recibo. */
export interface EventConsumer {
  name: string;
  /** Tipos de evento a los que se suscribe, o '*' para todos. */
  eventTypes: string[] | '*';
  handle(trx: Transaction<Database>, event: DomainEvent): Promise<void>;
}

export class EventStore {
  constructor(private readonly consumers: EventConsumer[]) {}

  /**
   * Agrega un evento y sus entregas pendientes (outbox) con el MISMO `trx` que el cambio de dominio:
   * si la transacción se revierte, no queda evento ni entrega.
   */
  async append(trx: Transaction<Database>, e: NewEvent): Promise<DomainEvent> {
    const event = await trx
      .insertInto('domain_events')
      .values({
        event_id: randomUUID(),
        organization_id: e.organizationId,
        event_type: e.eventType,
        schema_version: e.schemaVersion,
        aggregate_type: e.aggregateType,
        aggregate_id: e.aggregateId,
        aggregate_version: String(e.aggregateVersion),
        actor_id: e.actorId,
        occurred_at: e.occurredAt ?? new Date(),
        correlation_id: e.correlationId ?? null,
        causation_id: e.causationId ?? null,
        operation_id: e.operationId ?? null,
        correction_of_event_id: e.correctionOf?.eventId ?? null,
        correction_reason: e.correctionOf?.reason ?? null,
        payload: JSON.stringify(e.payload),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const subscribers = this.consumers.filter((c) => c.eventTypes === '*' || c.eventTypes.includes(e.eventType));
    if (subscribers.length) {
      await trx
        .insertInto('event_deliveries')
        .values(subscribers.map((c) => ({ event_id: event.event_id, consumer: c.name, status: 'PENDING' as const })))
        .execute();
    }
    return event;
  }

  /** Historial de un agregado en orden de versión (solo de esa organización). */
  history(db: Db, organizationId: string, aggregateType: string, aggregateId: string) {
    return db
      .selectFrom('domain_events')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('aggregate_type', '=', aggregateType)
      .where('aggregate_id', '=', aggregateId)
      .orderBy('aggregate_version')
      .execute();
  }
}

/** Proyección real: conteo de eventos por organización y tipo. Idempotente gracias al recibo. */
export const organizationEventStatsConsumer: EventConsumer = {
  name: 'organization-event-stats',
  eventTypes: '*',
  async handle(trx, event) {
    await trx
      .insertInto('organization_event_stats')
      .values({ organization_id: event.organization_id, event_type: event.event_type, event_count: '1', last_event_at: event.recorded_at })
      .onConflict((oc) =>
        oc.columns(['organization_id', 'event_type']).doUpdateSet({
          event_count: sql`organization_event_stats.event_count + 1`,
          last_event_at: sql`greatest(organization_event_stats.last_event_at, excluded.last_event_at)`,
        }),
      )
      .execute();
  },
};

export const EVENT_STORE = Symbol('EVENT_STORE');
