import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { PiiCipher } from '../crypto/pii';
import { webhookConsumer } from '../integration/webhooks';
import { organizationEventStatsConsumer, type EventConsumer } from './events';
import { producerStatusCountsConsumer } from '../producers/producers';
import { riskReevaluationConsumer } from '../mitigations/mitigations';

// Registro de consumidores de producción. La API lo usa para crear entregas en el outbox y el worker
// para procesarlas: ambos deben compartir esta lista.
// risk-reevaluation (P0-021): reevalúa el lote tras una mitigación verificada.
export const PRODUCTION_CONSUMERS: EventConsumer[] = [organizationEventStatsConsumer, producerStatusCountsConsumer, riskReevaluationConsumer];

/**
 * P1-008: la lista de producción **con** el envío a destinos externos. La API la usa para crear las entregas
 * del outbox y el worker para procesarlas: **ambos deben ver el mismo consumidor**, o se crearían entregas
 * que nadie procesa —o al revés—.
 */
export function consumidoresDeProduccion(db: Kysely<Database>, cipher: PiiCipher): EventConsumer[] {
  return [...PRODUCTION_CONSUMERS, webhookConsumer(db, cipher)];
}
