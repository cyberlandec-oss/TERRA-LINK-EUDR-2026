import {
  Controller,
  Get,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  Res,
  OnApplicationShutdown,
  Injectable,
  type DynamicModule,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import type { NextFunction, Response } from 'express';
import Redis from 'ioredis';
import { type Kysely } from 'kysely';
import { APP_CONFIG, type AppConfig } from './config';
import { DB } from './db/database';
import type { Database } from './db/schema';
import { ErrorFilter } from './common/errors';
import { AuditService } from './audit/audit.service';
import { AuditController, AuditQueryService } from './audit/audit-query';
import { ReportsController } from './reports/reports';
import { EntityReportsController } from './reports/reports-entities';
import { DeliveriesController, DeliveriesService } from './deliveries/deliveries';
import { LotsController, LotsService } from './lots/lots';
import { InventoryController, InventoryService } from './inventory/inventory';
import { RiskController, RiskService } from './risk/risk';
import { RiskProfileLinkController, RiskProfileLinkService } from './risk/risk-profile-link';
import { RiskConclusionController, RiskConclusionService } from './risk/risk-conclusion';
import { LegalProfileReviewController, LegalProfileReviewService } from './legal/legal-profile-review';
import { GeoConfigOrgController, GeoConfigPlatformController, GeoConfigService } from './geo/geo-config';
import { MitigationsController, MitigationsService } from './mitigations/mitigations';
import { DdController, DdService } from './dd/dd';
import { ShipmentsController, ShipmentsService } from './shipments/shipments';
import { BlockingTransferDispatchGate, CustodyTransfersController, CustodyTransfersService, TRANSFER_DISPATCH_GATE } from './custody/custody-transfers';
import { SatelliteController, SatelliteService } from './satellite/satellite';
import { SyncController, SyncService } from './sync/sync';
import { ImportsController, ImportsService } from './imports/imports';
import { MyWorkController, MyWorkService } from './work/my-work';
import { OnboardingController, OnboardingService } from './onboarding/onboarding';
import { ExchangeController, ExchangeService } from './exchange/exchange';
import { SimulationController, SimulationService } from './simulation/simulation';
import { CostController, CostService } from './cost/cost';
import { HistoryController, HistoryService } from './history/history';
import { EconomicsController, EconomicsService } from './economics/economics';
import { AnalyticsController, AnalyticsService } from './analytics/analytics';
import { ExtractionController, ExtractionService } from './extraction/extraction';
import { LimitsController, LimitsService } from './limits/limits';
import { WebhookController, WebhookService } from './integration/webhooks';
import { PlatformCostController, PlatformCostService } from './cost/platform-cost';
import { SsoController, SsoService } from './auth/sso';
import { AuthController, AuthGuard, CurrentUser, Public, type AuthUser, type AuthedRequest } from './auth/auth';
import { AuthorizationService } from './authz/authorization.service';
import { PLATFORM_PERMISSIONS, RBAC_CATALOG_VERSION, ROLE_PERMISSIONS } from './authz/catalog';
import { CatalogController, OrganizationsController, OrganizationsService } from './organizations/organizations';
import { InvitationsController, MembersController, MembersService, UsersController } from './members/members';
import { EVENT_STORE, EventStore } from './events/events';
import { ProducersController, ProducersService } from './producers/producers';
import { ProducerMatchingController, ProducerMatchingService } from './producers/matching';
import { PlotsController, PlotsService } from './plots/plots';
import { PlotProductionCountryController, PlotProductionCountryService } from './plots/production-country';
import { PolygonDraftsController, PolygonDraftsService } from './plots/polygon-drafts';
import { PII_CIPHER, PiiCipher } from './crypto/pii';
import { OBJECT_STORE, S3ObjectStore, type ObjectStore } from './storage/object-store';
import { GeometryImportsController, GeometryImportsService } from './plots/geometry-imports';
import { GisEvaluationController, GisEvaluationService } from './plots/gis-evaluation';
import { GeoProfileController, GeoProfileService } from './plots/geo-profile';
import { ProductsController, ProductsService } from './products/products';
import { CteController, CteService } from './traceability/cte';
import { KdeController, KdeService } from './traceability/kde';
import { PublicReferencesController, PublicReferencesService } from './traceability/public-references';
import { AccessGrantsController, AccessGrantsService, GrantedController } from './authz/access-grants';
import { OperationsAlertsController, OperationsAlertsService, OperationsOrgAlertsController, evaluarDependencias } from './operations/alerts';
import { ObservabilityController, ObservabilityInterceptor, VersionController } from './observability/observability';
import { LegalAssessmentsController, LegalProfileController, LegalProfileService } from './legal/legal-profile';
import { PlatformElevationController, PlatformElevationService } from './authz/platform-elevation';
import { EventHistoryController, EventHistoryService } from './events/event-history';
import { DocumentsController, DocumentsService } from './documents/documents';
import { EvidenceController, EvidenceService } from './evidence/evidence';
import { ClamdScanner, MALWARE_SCANNER, type MalwareScanner } from './storage/scanner';
import { consumidoresDeProduccion } from './events/consumers';
import { LOGIN_RATE_LIMITER, LoginRateLimiter, REDIS, RedisAttemptStore } from './auth/login-rate-limit';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  // Readiness: estado por dependencia (sin detalles internos). 503 si falla una dependencia NÚCLEO (base, esquema,
  // Redis). El escáner antimalware es una capacidad: si está caído la API sigue atendiendo (las subidas se aceptan y
  // quedan «análisis pendiente», nunca limpias) y la respuesta es 200 con status «degraded», checks.scanner
  // «unavailable» y capabilities.document_analysis «UNAVAILABLE». No se informa todo como sano.
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    // Fuente ÚNICA compartida con los avisos operativos (RNF-10): si divergieran, uno de los dos mentiría.
    const dep = await evaluarDependencias(this.db, this.redis, this.scanner);
    const checks = { database: dep.database, schema: dep.schema, redis: dep.redis };
    const ok = Object.values(checks).every((c) => c === 'ok');
    const scannerOk = dep.scanner === 'ok';
    if (!ok) res.status(503);
    return {
      status: !ok ? 'unavailable' : scannerOk ? 'ok' : 'degraded',
      checks: { ...checks, scanner: scannerOk ? 'ok' : 'unavailable' },
      capabilities: { document_analysis: scannerOk ? 'AVAILABLE' : 'UNAVAILABLE' },
      migration: dep.migration,
      ...(scannerOk ? {} : { note: 'Escáner antimalware no disponible: los archivos nuevos quedan con análisis pendiente y no se habilitan; el resto de la API funciona.' }),
    };
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('api/v1/me')
class MeController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'first_name', 'last_name', 'platform_role'])
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    return { ...u, rbac_catalog_version: RBAC_CATALOG_VERSION };
  }

  // Catálogo efectivo: permisos por organización con membresía activa (cada org por separado; un rol
  // en una organización nunca aparece ni cuenta en otra) y permisos de plataforma.
  @Get('permissions')
  async permissions(@CurrentUser() user: AuthUser) {
    const memberships = await this.db
      .selectFrom('memberships')
      .select('organization_id')
      .where('user_id', '=', user.id)
      .where('status', '=', 'ACTIVE')
      .execute();
    const organizations = [];
    for (const m of memberships) {
      const ctx = await this.authz.tenantContext(user, m.organization_id);
      if (ctx) {
        organizations.push({
          organization_id: ctx.organizationId,
          organization_status: ctx.organizationStatus,
          roles: ctx.roles.sort(),
          permissions: ctx.permissions,
        });
      }
    }
    return {
      rbac_catalog_version: RBAC_CATALOG_VERSION,
      platform_permissions: user.platformRole === 'SUPER_ADMIN' ? PLATFORM_PERMISSIONS.SUPER_ADMIN : [],
      organizations,
    };
  }
}

@ApiTags('rbac')
@ApiBearerAuth()
@Controller('api/v1/rbac')
class RbacController {
  // Matriz rol → permisos del catálogo vigente (no contiene datos de ninguna organización).
  @Get('roles')
  roles() {
    return {
      rbac_catalog_version: RBAC_CATALOG_VERSION,
      organization_roles: Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({ role, permissions })),
      platform_roles: [{ role: 'SUPER_ADMIN', permissions: PLATFORM_PERMISSIONS.SUPER_ADMIN }],
    };
  }
}

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

@Injectable()
class ObjectStoreLifecycle implements OnApplicationShutdown {
  constructor(@Inject(OBJECT_STORE) private readonly store: ObjectStore) {}
  onApplicationShutdown(): void {
    this.store.close();
  }
}

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig, db: Kysely<Database>): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController, VersionController, ObservabilityController, OperationsAlertsController, OperationsOrgAlertsController,
        RiskConclusionController, GeoConfigPlatformController, GeoConfigOrgController, RiskProfileLinkController, LegalProfileReviewController, LegalProfileController, LegalAssessmentsController, AuthController, MeController, OrganizationsController, CatalogController, RbacController,
        MembersController, InvitationsController, UsersController, ProducersController, ProducerMatchingController, PlotsController, PlotProductionCountryController, PolygonDraftsController, GeometryImportsController, GisEvaluationController, GeoProfileController, ProductsController, CteController, KdeController, PublicReferencesController, AccessGrantsController, GrantedController, PlatformElevationController, EventHistoryController, DocumentsController, EvidenceController, AuditController, DeliveriesController, LotsController, InventoryController, RiskController, MitigationsController, DdController, SyncController, ImportsController, MyWorkController, OnboardingController, ExchangeController, SimulationController, CostController, HistoryController, EconomicsController, AnalyticsController, ExtractionController, LimitsController, PlatformCostController, SsoController, WebhookController, ShipmentsController, CustodyTransfersController, SatelliteController, ReportsController, EntityReportsController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: DB, useValue: db },
        {
          provide: REDIS,
          // Fail-closed: si Redis no responde, el login devuelve error en vez de omitir el límite.
          useFactory: () => new Redis(config.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 1500 }),
        },
        {
          provide: LOGIN_RATE_LIMITER,
          inject: [REDIS],
          useFactory: (redis: Redis) => new LoginRateLimiter(new RedisAttemptStore(redis, config.redisKeyPrefix), config.loginRateLimit),
        },
        RedisLifecycle,
        ObjectStoreLifecycle,
        {
          provide: EVENT_STORE,
          inject: [DB, PII_CIPHER],
          useFactory: (db: Kysely<Database>, cipher: PiiCipher) => new EventStore(consumidoresDeProduccion(db, cipher)),
        },
        MembersService,
        ProducersService,
        ProducerMatchingService,
        PlotsService,
        PlotProductionCountryService,
        PolygonDraftsService,
        { provide: PII_CIPHER, useValue: new PiiCipher(config.pii) },
        { provide: OBJECT_STORE, useValue: new S3ObjectStore(config.objectStore) },
        GeometryImportsService,
        GisEvaluationService,
        GeoProfileService,
        ProductsService,
        CteService,
        KdeService,
        PublicReferencesService,
        AccessGrantsService,
        OperationsAlertsService,
        LegalProfileService,
        PlatformElevationService,
        EventHistoryService,
        DocumentsService,
        EvidenceService,
        { provide: MALWARE_SCANNER, useValue: new ClamdScanner(config.scanner.host, config.scanner.port, config.scanner.timeoutMs) },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        // RNF-13: una métrica y una traza por petición, con la ruta saneada al patrón.
        { provide: APP_INTERCEPTOR, useClass: ObservabilityInterceptor },
        AuditService,
        AuditQueryService,
        DeliveriesService,
        LotsService,
        InventoryService,
        RiskService, RiskProfileLinkService, LegalProfileReviewService, GeoConfigService, RiskConclusionService,
        MitigationsService,
        DdService,
        ShipmentsService,
        CustodyTransfersService,
        { provide: TRANSFER_DISPATCH_GATE, useClass: BlockingTransferDispatchGate },
        SatelliteService,
        SyncService,
        ImportsService,
        MyWorkService,
        OnboardingService,
        ExchangeService,
        SimulationService,
        CostService,
        HistoryService,
        EconomicsService,
        AnalyticsService,
        ExtractionService,
        LimitsService,
        WebhookService,
        PlatformCostService,
        SsoService,
        AuthorizationService,
        OrganizationsService,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: AuthedRequest, res: Response, next: NextFunction) => {
        const incoming = req.headers['x-request-id'];
        req.requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', req.requestId);
        next();
      })
      .forRoutes('*path');
  }
}
