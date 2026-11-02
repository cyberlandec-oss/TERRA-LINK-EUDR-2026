import {
  Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { conflict, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { PII_CIPHER, PiiCipher, normalizeDocumentType, producerAad } from '../crypto/pii';

// P0-005 — revisión asistida de posibles duplicados (RF-05).
// Regla documentada (backlog P0-005, doc 07/15): coincidencia de identidad = mismo tipo y número de
// documento normalizados dentro de la misma organización. Otras heurísticas (nombre, ubicación) no
// tienen regla aprobada (D-22) y no se aplican.
// Detectar nunca fusiona ni modifica productores: abre un caso PENDING para un responsable con
// producer:review_duplicates. Resolver tampoco modifica productores; la fusión no tiene contrato.

export type MatchRule = 'IDENTITY_DOCUMENT';

@Injectable()
export class ProducerMatchingService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(PII_CIPHER) private readonly cipher: PiiCipher,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Busca coincidencias del productor indicado y abre casos nuevos (idempotente: un par ya revisado no
   * se reabre). Corre dentro de la transacción del alta/edición. Devuelve el número de casos pendientes.
   */
  async detect(trx: Transaction<Database>, orgId: string, producerId: string, actorId: string, requestId?: string): Promise<number> {
    const me = await trx.selectFrom('producers').select(['id', 'document_type_enc', 'document_number_bidx'])
      .where('organization_id', '=', orgId).where('id', '=', producerId).executeTakeFirstOrThrow();
    if (!me.document_number_bidx || !me.document_type_enc) return 0;
    const myType = normalizeDocumentType(this.cipher.decrypt(me.document_type_enc, producerAad(orgId, me.id, 'document_type')));
    const others = await trx.selectFrom('producers').select(['id', 'document_type_enc'])
      .where('organization_id', '=', orgId)
      .where('document_number_bidx', '=', me.document_number_bidx)
      .where('id', '!=', producerId)
      .execute();
    for (const o of others) {
      if (!o.document_type_enc) continue;
      const type = normalizeDocumentType(this.cipher.decrypt(o.document_type_enc, producerAad(orgId, o.id, 'document_type')));
      if (type !== myType) continue; // mismo número con otro tipo de documento no es la misma identidad
      const [a, b] = [producerId, o.id].sort();
      const inserted = await trx
        .insertInto('producer_match_reviews')
        .values({ organization_id: orgId, producer_a_id: a, producer_b_id: b, rule_code: 'IDENTITY_DOCUMENT', status: 'PENDING', detected_by: actorId })
        .onConflict((oc) => oc.columns(['organization_id', 'producer_a_id', 'producer_b_id', 'rule_code']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted) {
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: actorId, action: 'producer_match.detect', entityType: 'producer_match_review',
          entityId: inserted.id, requestId, result: 'SUCCESS', after: { rule_code: 'IDENTITY_DOCUMENT', producer_a_id: a, producer_b_id: b },
        });
      }
    }
    const pending = await trx.selectFrom('producer_match_reviews').select(sql<number>`count(*)::int`.as('n'))
      .where('organization_id', '=', orgId).where('status', '=', 'PENDING')
      .where((eb) => eb.or([eb('producer_a_id', '=', producerId), eb('producer_b_id', '=', producerId)]))
      .executeTakeFirstOrThrow();
    return pending.n;
  }

  private async summaryOf(orgId: string, ids: string[], identity: boolean) {
    const rows = await this.db.selectFrom('producers')
      .select(['id', 'producer_code', 'first_name', 'last_name', 'legal_name', 'community', 'parish', 'status', 'document_type_enc', 'document_number_enc'])
      .where('organization_id', '=', orgId).where('id', 'in', ids).execute();
    return new Map(rows.map((p) => [p.id, {
      id: p.id,
      producer_code: p.producer_code,
      display_name: p.legal_name ?? [p.first_name, p.last_name].filter(Boolean).join(' '),
      community: p.community,
      parish: p.parish,
      status: p.status,
      ...(identity ? {
        document_type: this.cipher.decryptNullable(p.document_type_enc, producerAad(orgId, p.id, 'document_type')),
        document_number: this.cipher.decryptNullable(p.document_number_enc, producerAad(orgId, p.id, 'document_number')),
      } : {}),
    }]));
  }

  async list(user: AuthUser, orgId: string, status: 'PENDING' | 'NOT_DUPLICATE' | 'DUPLICATE_CONFIRMED' | 'ALL') {
    const ctx = await this.authz.require(user, orgId, 'producer:review_duplicates', { mutation: false });
    let q = this.db.selectFrom('producer_match_reviews').selectAll().where('organization_id', '=', orgId);
    if (status !== 'ALL') q = q.where('status', '=', status);
    const reviews = await q.orderBy('detected_at', 'desc').orderBy('id').limit(200).execute();
    const identity = ctx.permissions.includes('producer:read_identity');
    const producers = reviews.length
      ? await this.summaryOf(orgId, [...new Set(reviews.flatMap((r) => [r.producer_a_id, r.producer_b_id]))], identity)
      : new Map();
    return reviews.map((r) => ({
      id: r.id, rule_code: r.rule_code, status: r.status, detected_at: r.detected_at, resolved_at: r.resolved_at,
      resolution_note: r.resolution_note, row_version: Number(r.row_version), identity_visible: identity,
      producer_a: producers.get(r.producer_a_id), producer_b: producers.get(r.producer_b_id),
    }));
  }

  async resolve(user: AuthUser, orgId: string, id: string, decision: 'NOT_DUPLICATE' | 'DUPLICATE_CONFIRMED', note: string, expectedVersion: number, requestId?: string) {
    await this.authz.require(user, orgId, 'producer:review_duplicates', { mutation: true });
    return this.db.transaction().execute(async (trx) => {
      const r = await trx.selectFrom('producer_match_reviews').selectAll()
        .where('organization_id', '=', orgId).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!r) throw notFound();
      if (r.status !== 'PENDING') throw conflict('INVALID_TRANSITION', 'Este caso ya fue resuelto.');
      if (Number(r.row_version) !== expectedVersion) throw conflict('VERSION_CONFLICT', 'Otra persona actualizó este caso. Recarga.');
      // Solo cambia el caso: los productores quedan intactos (sin fusión ni baja automática).
      const after = await trx.updateTable('producer_match_reviews')
        .set({ status: decision, resolved_at: new Date(), resolved_by: user.id, resolution_note: note, row_version: sql`row_version + 1` })
        .where('id', '=', id).where('organization_id', '=', orgId)
        .returningAll().executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'producer_match.resolve', entityType: 'producer_match_review',
        entityId: id, requestId, result: 'SUCCESS', reason: note, before: { status: 'PENDING' }, after: { status: decision },
      });
      return { id: after.id, status: after.status, row_version: Number(after.row_version) };
    });
  }
}

class ListQuery {
  @IsOptional() @IsIn(['PENDING', 'NOT_DUPLICATE', 'DUPLICATE_CONFIRMED', 'ALL']) status?: 'PENDING' | 'NOT_DUPLICATE' | 'DUPLICATE_CONFIRMED' | 'ALL';
}

class ResolveDto {
  @ApiProperty({ enum: ['NOT_DUPLICATE', 'DUPLICATE_CONFIRMED'] }) @IsIn(['NOT_DUPLICATE', 'DUPLICATE_CONFIRMED']) decision!: 'NOT_DUPLICATE' | 'DUPLICATE_CONFIRMED';
  @ApiProperty() @IsString() @Length(3, 500) note!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
}

@ApiTags('producers')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/producer-match-reviews')
export class ProducerMatchingController {
  constructor(private readonly service: ProducerMatchingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: ListQuery) {
    return this.service.list(user, orgId, q.status ?? 'PENDING');
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDto, @Req() req: AuthedRequest) {
    return this.service.resolve(user, orgId, id, dto.decision, dto.note, dto.expected_version, req.requestId);
  }
}
