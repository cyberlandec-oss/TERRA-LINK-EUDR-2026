import { Kysely, Migrator, PostgresDialect, type Migration, type MigrationProvider } from 'kysely';
import type { LogEvent } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema';
import * as m0001 from './migrations/0001_identity_organizations';
import * as m0002 from './migrations/0002_invitations_sessions';
import * as m0003 from './migrations/0003_organization_types';
import * as m0004 from './migrations/0004_domain_events_outbox';
import * as m0005 from './migrations/0005_producers';
import * as m0006 from './migrations/0006_producer_identity_encryption';
import * as m0007 from './migrations/0007_producer_match_reviews';
import * as m0008 from './migrations/0008_plots';
import * as m0009 from './migrations/0009_location_samples';
import * as m0010 from './migrations/0010_polygon_drafts';
import * as m0011 from './migrations/0011_geometry_imports';
import * as m0012 from './migrations/0012_gis_evaluations_cleanup';
import * as m0013 from './migrations/0013_gis_comparison_scope';
import * as m0014 from './migrations/0014_products';
import * as m0015 from './migrations/0015_cte_catalog';
import * as m0016 from './migrations/0016_kde_catalog';
import * as m0017 from './migrations/0017_event_corrections_delivery_fencing';
import * as m0018 from './migrations/0018_documents';
import * as m0019 from './migrations/0019_evidence';
import * as m0020 from './migrations/0020_audit_query';
import * as m0021 from './migrations/0021_deliveries';
import * as m0022 from './migrations/0022_quality_limits_reference';
import * as m0023 from './migrations/0023_lots_processes';
import * as m0024 from './migrations/0024_inventory_ledger';
import * as m0025 from './migrations/0025_risk';
import * as m0026 from './migrations/0026_mitigations';
import * as m0027 from './migrations/0027_dd_cases';
import * as m0028 from './migrations/0028_mitigation_corrections';
import * as m0029 from './migrations/0029_sync';
import * as m0030 from './migrations/0030_imports';
import * as m0031 from './migrations/0031_import_products';
import * as m0032 from './migrations/0032_import_plots';
import * as m0033 from './migrations/0033_declared_area_keeps_geometry';
import * as m0034 from './migrations/0034_import_deliveries';
import * as m0035 from './migrations/0035_import_references';
import * as m0036 from './migrations/0036_import_lots';
import * as m0037 from './migrations/0037_shipments';
import * as m0038 from './migrations/0038_satellite';
import * as m0039 from './migrations/0039_satellite_whisp_development';
import * as m0040 from './migrations/0040_d32_humedad_d33_cierre_entregas';
import * as m0041 from './migrations/0041_eudr_geo_profile';
import * as m0042 from './migrations/0042_d07_mecanismos';
import * as m0043 from './migrations/0043_catalogo_riesgo_1_0_0';
import * as m0044 from './migrations/0044_rf47_referencia_publica';
import * as m0045 from './migrations/0045_d34a_compuerta_despacho';
import * as m0046 from './migrations/0046_p0003_concesiones_externas';
import * as m0047 from './migrations/0047_d04_elevacion_supervisada';
import * as m0048 from './migrations/0048_d04_elevacion_por_sesion';
import * as m0049 from './migrations/0049_p1005_perfil_juridico';
import * as m0050 from './migrations/0050_p1006_intercambio_guia';
import * as m0051 from './migrations/0051_p1010_presupuesto_preparacion';
import * as m0052 from './migrations/0052_p1012_precio_prima_pagos';
import * as m0053 from './migrations/0053_p1013_extraccion_asistida';
import * as m0054 from './migrations/0054_p1013_texto_no_interpretable';
import * as m0055 from './migrations/0055_p1008_integracion_webhooks';
import * as m0056 from './migrations/0056_p1015_coste_plataforma_sso';
import * as m0057 from './migrations/0057_a01_alcance_propio_productor';
import * as m0058 from './migrations/0058_a03_traspaso_custodia';
import * as m0059 from './migrations/0059_catalogo_riesgo_perfil_referencia';
import * as m0060 from './migrations/0060_p1005_perfil_0_2_0_borrador';
import * as m0061 from './migrations/0061_d075b_vinculacion_catalogo_perfil';
import * as m0062 from './migrations/0062_p1005_acto_revision_perfil';
import * as m0063 from './migrations/0063_geo_configuracion_reglas_versionadas';
import * as m0064 from './migrations/0064_d076_conclusion_humana';
import * as m0065 from './migrations/0065_d076_carencias_conclusion_favorable';
import * as m0066 from './migrations/0066_tipos_documentales_ambiente_trabajo_terceros';
import * as m0067 from './migrations/0067_satellite_progreso_reanudacion_cancelacion';
import * as m0068 from './migrations/0068_satellite_envio_incierto';
import * as m0069 from './migrations/0069_poligono_vertices_procedencia_y_captura';
import * as m0070 from './migrations/0070_sync_referencias_locales';
import * as m0071 from './migrations/0071_sync_referencias_entregas';
import * as m0072 from './migrations/0072_satellite_autorizacion_entre_organizaciones';
import * as m0073 from './migrations/0073_concesion_soportes_instantanea';
import * as m0074 from './migrations/0074_concesion_geometrias_instantanea';

// Las migraciones se registran explícitamente (orden por nombre). Nunca editar una ya publicada.
const MIGRATIONS: Record<string, Migration> = {
  '0001_identity_organizations': m0001,
  '0002_invitations_sessions': m0002,
  '0003_organization_types': m0003,
  '0004_domain_events_outbox': m0004,
  '0005_producers': m0005,
  '0006_producer_identity_encryption': m0006,
  '0007_producer_match_reviews': m0007,
  '0008_plots': m0008,
  '0009_location_samples': m0009,
  '0010_polygon_drafts': m0010,
  '0011_geometry_imports': m0011,
  '0012_gis_evaluations_cleanup': m0012,
  '0013_gis_comparison_scope': m0013,
  '0014_products': m0014,
  '0015_cte_catalog': m0015,
  '0016_kde_catalog': m0016,
  '0017_event_corrections_delivery_fencing': m0017,
  '0018_documents': m0018,
  '0019_evidence': m0019,
  '0020_audit_query': m0020,
  '0021_deliveries': m0021,
  '0022_quality_limits_reference': m0022,
  '0023_lots_processes': m0023,
  '0024_inventory_ledger': m0024,
  '0025_risk': m0025,
  '0026_mitigations': m0026,
  '0027_dd_cases': m0027,
  '0028_mitigation_corrections': m0028,
  '0029_sync': m0029,
  '0030_imports': m0030,
  '0031_import_products': m0031,
  '0032_import_plots': m0032,
  '0033_declared_area_keeps_geometry': m0033,
  '0034_import_deliveries': m0034,
  '0035_import_references': m0035,
  '0036_import_lots': m0036,
  '0037_shipments': m0037,
  '0038_satellite': m0038,
  '0039_satellite_whisp_development': m0039,
  '0040_d32_humedad_d33_cierre_entregas': m0040,
  '0041_eudr_geo_profile': m0041,
  '0042_d07_mecanismos': m0042,
  '0043_catalogo_riesgo_1_0_0': m0043,
  '0044_rf47_referencia_publica': m0044,
  '0045_d34a_compuerta_despacho': m0045,
  '0046_p0003_concesiones_externas': m0046,
  '0047_d04_elevacion_supervisada': m0047,
  '0048_d04_elevacion_por_sesion': m0048,
  '0049_p1005_perfil_juridico': m0049,
  '0050_p1006_intercambio_guia': m0050,
  '0051_p1010_presupuesto_preparacion': m0051,
  '0052_p1012_precio_prima_pagos': m0052,
  '0053_p1013_extraccion_asistida': m0053,
  '0054_p1013_texto_no_interpretable': m0054,
  '0055_p1008_integracion_webhooks': m0055,
  '0056_p1015_coste_plataforma_sso': m0056,
  '0057_a01_alcance_propio_productor': m0057,
  '0058_a03_traspaso_custodia': m0058,
  '0059_catalogo_riesgo_perfil_referencia': m0059,
  '0060_p1005_perfil_0_2_0_borrador': m0060,
  '0061_d075b_vinculacion_catalogo_perfil': m0061,
  '0062_p1005_acto_revision_perfil': m0062,
  '0063_geo_configuracion_reglas_versionadas': m0063,
  '0064_d076_conclusion_humana': m0064,
  '0065_d076_carencias_conclusion_favorable': m0065,
  '0066_tipos_documentales_ambiente_trabajo_terceros': m0066,
  '0067_satellite_progreso_reanudacion_cancelacion': m0067,
  '0068_satellite_envio_incierto': m0068,
  '0069_poligono_vertices_procedencia_y_captura': m0069,
  '0070_sync_referencias_locales': m0070,
  '0071_sync_referencias_entregas': m0071,
  '0072_satellite_autorizacion_entre_organizaciones': m0072,
  '0073_concesion_soportes_instantanea': m0073,
  '0074_concesion_geometrias_instantanea': m0074,
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRATIONS;
  }
}

/** Opciones de sesión de cada conexión (ver createDb). */
export const PG_SESSION_OPTIONS = { options: '-c client_min_messages=warning' };

/**
 * `onQuery` recibe TODAS las consultas (RNF-13: métricas y tramos de traza); `onSlowQuery`, solo las lentas.
 * A ambos se les pasa `e.query.sql`, que es el SQL **parametrizado**: los valores viajan aparte, en
 * `e.query.parameters`, y **no se tocan aquí**. Quien consuma el texto lo reduce además a verbo y tabla.
 */
export function createDb(
  connectionString: string,
  onSlowQuery?: (sqlText: string, ms: number) => void,
  slowMs = 1000,
  onQuery?: (sqlText: string, ms: number) => void,
): Kysely<Database> {
  return new Kysely<Database>({
    ...(onSlowQuery || onQuery
      ? {
          log: (e: LogEvent) => {
            const ms = Math.round(e.queryDurationMillis);
            const texto = e.query.sql.replace(/\s+/g, ' ').slice(0, 200);
            // La instrumentación nunca puede tumbar una consulta que ya salió bien.
            if (onQuery) { try { onQuery(texto, ms); } catch { /* instrumentación opcional */ } }
            if (onSlowQuery && e.queryDurationMillis >= slowMs) onSlowQuery(texto, ms);
          },
        }
      : {}),
    // client_min_messages=warning: PostGIS emite NOTICE con coordenadas (p. ej. ST_IsValid ante una
    // autointersección). Sin esto llegarían al cliente; además se usa ST_IsValidDetail, que no emite NOTICE.
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 10, ...PG_SESSION_OPTIONS }) }),
  });
}

export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** Migra hasta una versión concreta (pruebas de migración sobre datos existentes). */
export async function migrateTo(db: Kysely<Database>, name: string): Promise<void> {
  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });
  const { error } = await migrator.migrateTo(name);
  if (error) throw error;
}

export const LATEST_MIGRATION = Object.keys(MIGRATIONS).sort().at(-1)!;
export const DB = Symbol('DB');
