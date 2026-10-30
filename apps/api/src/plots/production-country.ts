import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateIf } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { PlotsService } from './plots';

// País de producción de una PARCELA de origen: declaración explícita, versionada y de solo añadir (migración 0075).
// No se deduce de la organización, del comprador ni del destino, y no se rellena «Ecuador». Corregir es declarar de nuevo; la anterior queda intacta.
// `country: null` es «declarado como desconocido» (alguien responsable dejó constancia); sin filas es «sin declarar».

export class DeclareProductionCountryDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'Número de la declaración vigente que esta reemplaza (0 si aún no hay ninguna). Evita pisar la declaración de otra persona.' })
  @IsInt() @Min(0) expected_declaration_number!: number;
  @ApiProperty({ nullable: true, description: 'Código ISO 3166-1 alfa-2 en mayúsculas (p. ej. EC) o null para «declarado como desconocido».' })
  @ValidateIf((o: DeclareProductionCountryDto) => o.country !== null) @IsString() @Matches(/^[A-Z]{2}$/, { message: 'país: dos letras mayúsculas (ISO 3166-1 alfa-2) o null' })
  country!: string | null;
  @ApiPropertyOptional({ description: 'Fundamento o aclaración de la declaración (no es un documento).' })
  @IsOptional() @IsString() @Length(3, 500) note?: string;
}

type Fila = { declaration_number: number; country: string | null; note: string | null; declared_at: string; declared_by: string; first_name: string | null; last_name: string | null };

const vista = (f: Fila) => ({
  declaration_number: f.declaration_number,
  state: f.country ? 'DECLARED' as const : 'DECLARED_UNKNOWN' as const,
  country: f.country, note: f.note, declared_at: f.declared_at,
  declared_by: `${f.first_name ?? ''} ${f.last_name ?? ''}`.trim() || 'Miembro',
});

@Injectable()
export class PlotProductionCountryService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly plots: PlotsService,
  ) {}

  private async filas(db: Kysely<Database>, orgId: string, plotId: string) {
    return (await sql<Fila>`
      SELECT d.declaration_number, d.country, d.note, d.declared_at::text, d.declared_by, u.first_name, u.last_name
      FROM plot_production_declarations d JOIN users u ON u.id = d.declared_by
      WHERE d.organization_id = ${orgId} AND d.plot_id = ${plotId} ORDER BY d.declaration_number DESC`.execute(db)).rows;
  }

  /** Declaración vigente e historial. Mismo alcance que leer la parcela (fuera de alcance = 404). */
  async ver(user: AuthUser, orgId: string, plotId: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    const plot = await this.plots.load(this.db, ctx, plotId, 'read');
    const filas = await this.filas(this.db, orgId, plotId);
    return {
      plot_id: plotId, plot_code: plot.plot_code,
      current: filas[0] ? vista(filas[0]) : { state: 'NOT_DECLARED' as const, declaration_number: 0, country: null },
      history: filas.map(vista),
      note: 'El país de producción es una declaración de la organización; Terra Link no lo deduce de la organización, del comprador ni del destino y no lo verifica.',
    };
  }

  async declarar(user: AuthUser, orgId: string, plotId: string, dto: DeclareProductionCountryDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    const puede = ['plot:update', 'plot:update_assigned', 'plot:update_own'].some((p) => ctx.permissions.includes(p as never));
    if (!puede) throw forbidden();
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const previa = await this.db.selectFrom('plot_production_declarations').select(['plot_id', 'country']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (previa) {
      if (previa.plot_id !== plotId || (previa.country ?? null) !== (dto.country ?? null)) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, ...(await this.ver(user, orgId, plotId)) };
    }
    await this.db.transaction().execute(async (trx) => {
      const plot = await this.plots.load(trx, ctx, plotId, 'update', true);
      if (plot.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja.');
      const vigente = (await this.filas(trx as unknown as Kysely<Database>, orgId, plotId))[0];
      const actual = vigente?.declaration_number ?? 0;
      if (actual !== dto.expected_declaration_number) throw conflict('VERSION_CONFLICT', 'Otra persona declaró el país de esta parcela. Recarga para ver la declaración vigente.');
      if (vigente && (vigente.country ?? null) === (dto.country ?? null)) throw conflict('NO_CHANGE', 'Esa declaración ya es la vigente.');
      const id = randomUUID();
      await sql`
        INSERT INTO plot_production_declarations (id, organization_id, plot_id, declaration_number, country, note, declared_by, operation_id)
        VALUES (${id}, ${orgId}, ${plotId}, ${actual + 1}, ${dto.country}, ${dto.note?.trim() ?? null}, ${user.id}, ${dto.operation_id})`.execute(trx);
      await this.events.append(trx, {
        organizationId: orgId, eventType: 'PlotProductionCountryDeclared', schemaVersion: 1, aggregateType: 'PLOT_PRODUCTION_DECLARATION', aggregateId: plotId,
        aggregateVersion: actual + 1, actorId: user.id, correlationId: requestId,
        payload: { plot_id: plotId, declaration_number: actual + 1, country: dto.country, supersedes: actual || null },
      });
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'plot.declare_production_country', entityType: 'plot', entityId: plotId, requestId, result: 'SUCCESS',
        after: { declaration_number: actual + 1, country: dto.country, supersedes: actual || null } });
    }).catch((e) => {
      if ((e as { constraint?: string }).constraint === 'plot_prod_decl_version_uq') throw conflict('VERSION_CONFLICT', 'Otra persona declaró el país de esta parcela. Recarga para ver la declaración vigente.');
      if ((e as { constraint?: string }).constraint === 'plot_prod_decl_operacion_uq') throw new AppError(409, 'OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó.');
      throw e;
    });
    return { replayed: false, ...(await this.ver(user, orgId, plotId)) };
  }
}

@ApiTags('Parcelas')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/plots/:plotId/production-country')
export class PlotProductionCountryController {
  constructor(private readonly service: PlotProductionCountryService) {}

  @Get()
  @ApiOperation({ summary: 'País de producción declarado de la parcela, con su historial', description: 'Mismo alcance que leer la parcela. «Sin declarar» y «declarado como desconocido» son estados distintos.' })
  ver(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('plotId', ParseUUIDPipe) p: string) {
    return this.service.ver(u, o, p);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Declarar (o corregir) el país de producción de la parcela', description: 'Solo se añade: una corrección es una declaración nueva y la anterior se conserva. Mismo alcance que editar la parcela. No se rellena automáticamente.' })
  declarar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('plotId', ParseUUIDPipe) p: string, @Body() dto: DeclareProductionCountryDto, @Req() req: AuthedRequest) {
    return this.service.declarar(u, o, p, dto, req.requestId);
  }
}
