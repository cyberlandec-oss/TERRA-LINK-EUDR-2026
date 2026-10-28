import type { ColumnType, Generated } from 'kysely';

// Tipos de las tablas según las migraciones de src/db/migrations.
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export type UserStatus = 'ACTIVE' | 'INACTIVE';
export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED';
export type MembershipStatus = 'ACTIVE' | 'INACTIVE';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  first_name: string;
  last_name: string;
  password_hash: string | null;
  status: UserStatus;
  platform_role: 'SUPER_ADMIN' | null;
  last_login_at: Timestamp | null;
  token_version: Generated<number>;
  email_verified_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  legal_name: string | null;
  organization_type: string;
  tax_id: string | null;
  country: string;
  province: string | null;
  canton: string | null;
  parish: string | null;
  status: OrganizationStatus;
  status_reason: string | null;
  row_version: Generated<string>;
  created_at: Timestamp;
  created_by: string;
  updated_at: Timestamp;
  updated_by: string;
}

export interface MembershipsTable {
  id: Generated<string>;
  organization_id: string;
  user_id: string;
  status: MembershipStatus;
  status_reason: string | null;
  created_at: Timestamp;
  created_by: string;
  updated_at: Timestamp;
  updated_by: string;
}

export interface RolesTable {
  code: string;
  scope: 'PLATFORM' | 'ORGANIZATION';
  description: string;
}

export interface RoleAssignmentsTable {
  id: Generated<string>;
  organization_id: string;
  membership_id: string;
  role_code: string;
  created_at: Timestamp;
  created_by: string;
}

export interface AuditLogsTable {
  id: Generated<string>;
  organization_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
  before: unknown | null;
  after: unknown | null;
  reason: string | null;
  occurred_at: Timestamp;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED';

export interface InvitationsTable {
  id: Generated<string>;
  organization_id: string;
  email: string;
  role_code: string;
  token_hash: string;
  status: InvitationStatus;
  expires_at: Timestamp;
  created_at: Timestamp;
  created_by: string;
  accepted_at: Timestamp | null;
  accepted_by: string | null;
  revoked_at: Timestamp | null;
  revoked_by: string | null;
}

export interface OrganizationTypesTable {
  code: string;
  label_es: string;
  status: 'PROVISIONAL' | 'RATIFIED' | 'LEGACY' | 'RETIRED';
  sort_order: number;
}

export interface DomainEventsTable {
  event_id: string;
  organization_id: string;
  event_type: string;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: string;
  actor_id: string | null;
  occurred_at: Timestamp;
  recorded_at: Timestamp;
  correlation_id: string | null;
  causation_id: string | null;
  operation_id: string | null;
  payload: unknown;
  correction_of_event_id: Generated<string | null>;
  correction_reason: Generated<string | null>;
}

export interface EventDeliveriesTable {
  event_id: string;
  consumer: string;
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'DONE' | 'DEAD';
  attempts: Generated<number>;
  next_attempt_at: Timestamp;
  locked_by: string | null;
  locked_until: Timestamp | null;
  last_error: string | null;
  delivered_at: Timestamp | null;
  created_at: Timestamp;
  lease_token: string | null;
  manual_requeues: Generated<number>;
}

export interface ConsumerReceiptsTable {
  consumer: string;
  event_id: string;
  processed_at: Timestamp;
}

export interface OrganizationEventStatsTable {
  organization_id: string;
  event_type: string;
  event_count: string;
  last_event_at: Timestamp;
}

export type ProducerStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';

export interface ProducersTable {
  id: Generated<string>;
  organization_id: string;
  producer_code: string;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  // Identidad cifrada (crypto/pii.ts); nunca en texto plano.
  document_type_enc: string | null;
  document_number_enc: string | null;
  phone_enc: string | null;
  address_enc: string | null;
  document_number_bidx: string | null;
  community: string | null;
  province: string | null;
  canton: string | null;
  parish: string | null;
  status: ProducerStatus;
  assigned_membership_id: string | null;
  /** A-01: membresía de la persona que ES este productor (alcance propio). Distinto de la asignación del técnico. */
  self_membership_id: string | null;
  row_version: Generated<string>;
  created_at: Timestamp;
  created_by: string;
  updated_at: Timestamp;
  updated_by: string;
  deleted_at: Timestamp | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

export interface ProducerVersionsTable {
  id: Generated<string>;
  organization_id: string;
  producer_id: string;
  version: string;
  change_type: string;
  changed_fields: string[];
  snapshot: unknown;
  reason: string | null;
  changed_by: string;
  changed_at: Timestamp;
}

export interface ProducerStatusCountsTable {
  organization_id: string;
  status: ProducerStatus;
  producer_count: string;
}

export interface ProducerMatchReviewsTable {
  id: Generated<string>;
  organization_id: string;
  producer_a_id: string;
  producer_b_id: string;
  rule_code: 'IDENTITY_DOCUMENT';
  status: 'PENDING' | 'NOT_DUPLICATE' | 'DUPLICATE_CONFIRMED';
  detected_at: Timestamp;
  detected_by: string;
  resolved_at: Timestamp | null;
  resolved_by: string | null;
  resolution_note: string | null;
  row_version: Generated<string>;
}

export type PlotStatus = 'ACTIVE' | 'INACTIVE';

export interface PlotsTable {
  id: string;
  organization_id: string;
  producer_id: string;
  plot_code: string;
  name: string | null;
  crop: string;
  variety: string | null;
  land_use: string | null;
  province: string | null;
  canton: string | null;
  parish: string | null;
  status: PlotStatus;
  current_version_id: string | null;
  row_version: Generated<string>;
  created_at: Timestamp;
  created_by: string;
  updated_at: Timestamp;
  updated_by: string;
  deleted_at: Timestamp | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

export interface PlotVersionsTable {
  id: string;
  organization_id: string;
  plot_id: string;
  version_number: number;
  geometry: unknown | null;
  geometry_type: 'POINT' | 'POLYGON' | 'MULTIPOLYGON' | null;
  geometry_hash: string | null;
  area_declared_ha: string | null;
  area_calculated_ha: string | null;
  survey_method: 'DECLARED' | 'MANUAL_COORDINATES' | 'BROWSER_GEOLOCATION' | 'DEVICE_LOCATION_SERVICE' | 'GPS_POINT' | 'GPS_POLYGON' | 'FILE_IMPORT';
  surveyed_at: Timestamp | null;
  accuracy_m: string | null;
  validation_status: 'NOT_VALIDATED' | 'VALID' | 'WARNING' | 'INVALID' | 'REVIEW_REQUIRED';
  validation_rule_version: string;
  previous_version_id: string | null;
  notes: string | null;
  created_at: Timestamp;
  created_by: string;
  source_import_id: Generated<string | null>;
  geometry_origin_version_id: Generated<string | null>;
}

export interface PlotHistoryTable {
  id: Generated<string>;
  organization_id: string;
  plot_id: string;
  row_version: string;
  change_type: string;
  changed_fields: string[];
  snapshot: unknown;
  reason: string | null;
  changed_by: string;
  changed_at: Timestamp;
}

export interface LocationSamplesTable {
  id: string;
  organization_id: string;
  plot_id: string;
  plot_version_id: string;
  source: 'BROWSER_GEOLOCATION' | 'DEVICE_LOCATION_SERVICE';
  provider_detail: string | null;
  mocked: boolean | null;
  device_id: string | null;
  longitude: number;
  latitude: number;
  horizontal_accuracy_m: number | null;
  captured_at: Timestamp;
  received_at: Timestamp;
  operation_id: string;
  payload_hash: string;
  created_by: string;
}

export interface PolygonDraftsTable {
  id: string;
  organization_id: string;
  plot_id: string;
  status: 'OPEN' | 'CONFIRMED' | 'CANCELLED';
  row_version: Generated<string>;
  confirmed_version_id: string | null;
  created_at: Timestamp;
  created_by: string;
  updated_at: Timestamp;
  updated_by: string;
  closed_at: Timestamp | null;
  closed_by: string | null;
  // 0069: captura móvil de la que nació el borrador (null si se abrió desde la web).
  origin_capture_id: string | null;
  origin_device_id: string | null;
}

export interface DraftVerticesTable {
  id: string;
  organization_id: string;
  draft_id: string;
  acquisition_seq: number;
  source: 'BROWSER_GEOLOCATION' | 'DEVICE_LOCATION_SERVICE';
  longitude: number;
  latitude: number;
  horizontal_accuracy_m: number | null;
  captured_at: Timestamp;
  received_at: Timestamp;
  operation_id: string;
  payload_hash: string;
  created_by: string;
  // 0069: procedencia real de la adquisición (solo vértices del dispositivo).
  provider_detail: string | null;
  mocked: boolean | null;
  device_id: string | null;
}

export interface DraftVertexExclusionsTable {
  vertex_id: string;
  organization_id: string;
  excluded_at: Timestamp;
  excluded_by: string;
}

export interface GeometryImportsTable {
  id: string;
  organization_id: string;
  plot_id: string;
  status: 'ANALYZED' | 'CONFIRMED' | 'DISCARDED';
  object_key: string;
  sha256: string;
  byte_size: number;
  original_filename: string | null;
  media_type: string;
  profile_version: string;
  geometry: unknown;
  geometry_type: 'POLYGON' | 'MULTIPOLYGON';
  technically_valid: boolean;
  validity_reason: string | null;
  analysis: unknown;
  operation_id: string;
  confirm_operation_id: string | null;
  confirmed_version_id: string | null;
  row_version: Generated<string>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  created_by: string;
  closed_at: Timestamp | null;
  closed_by: string | null;
}

export interface ObjectDeletionsTable {
  object_key: string;
  reason: 'DISCARDED' | 'ORPHAN';
  status: 'PENDING' | 'FAILED' | 'DONE' | 'SKIPPED_REFERENCED';
  attempts: Generated<number>;
  last_error_code: string | null;
  next_attempt_at: ColumnType<Date, Date | string | undefined, Date | string>;
  leased_by: string | null;
  lease_until: Timestamp | null;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  completed_at: Timestamp | null;
}

export interface GeoProfileEvaluationsTable {
  id: string;
  organization_id: string;
  plot_id: string;
  plot_version_id: string;
  geometry_hash: string | null;
  profile_id: string;
  profile_version: string;
  source_service_version: string;
  source_document_version: string;
  source_page_date: ColumnType<string, string, string>;
  parameters: unknown;
  status: 'MEETS_PROFILE' | 'DOES_NOT_MEET' | 'REVIEW_REQUIRED' | 'NOT_EVALUABLE';
  checks: unknown;
  area_basis: 'CALCULATED' | 'DECLARED' | 'NONE';
  area_value_ha: string | null;
  exportable: boolean;
  operation_id: string;
  evaluated_by: string;
  evaluated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface GisEvaluationsTable {
  id: string;
  organization_id: string;
  plot_id: string;
  plot_version_id: string;
  geometry_hash: string | null;
  rule_id: string;
  rule_version: string;
  parameters: unknown;
  status: 'VALID' | 'WARNING' | 'INVALID' | 'REVIEW_REQUIRED';
  checks: unknown;
  capture_quality: unknown;
  destination_profile: unknown;
  error_location: unknown;
  compared_set_hash: string;
  compared_count: number;
  operation_id: string;
  evaluated_by: string;
  comparison_scope: Generated<'ORGANIZATION' | 'EVALUATOR_ASSIGNED'>;
  scope_membership_id: string | null;
  evaluated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface GisEvaluationComparisonsTable {
  evaluation_id: string;
  organization_id: string;
  compared_plot_id: string;
  compared_version_id: string;
  compared_geometry_hash: string;
  relation: 'EQUAL' | 'OVERLAP' | 'TOUCH';
  same_hash: boolean;
  shared_area_m2: string | null;
}

export interface ProductStatesTable { code: string; label: string; sort_order: number; source: string }
export interface MeasurementUnitsTable { code: string; label: string; symbol: string; dimension: 'MASS'; source: string }
export interface DeliveryEconomicsTable {
  id: string; organization_id: string; delivery_id: string; record_number: number; corrects_record_id: string | null; reason: string | null;
  price_amount: string | null; price_currency: string | null; price_unit: string | null;
  basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA' | 'CANTIDAD_RECIBIDA' | 'SIN_BASE_DECLARADA'; basis_quantity: string | null; basis_unit: string | null;
  premium_amount: string | null; premium_kind: 'POR_UNIDAD' | 'IMPORTE_FIJO' | null; premium_currency: string | null; premium_unit: string | null; premium_grounds: string | null;
  source: 'DECLARADO_POR_LA_ORGANIZACION' | 'DECLARADO_POR_EL_PRODUCTOR' | 'ACTA_O_DOCUMENTO'; source_note: string | null; source_document_id: string | null; agreed_on: string | null;
  created_by: string; created_at: Generated<Timestamp>; operation_id: string;
}
export interface DeliveryPaymentsTable {
  id: string; organization_id: string; delivery_id: string; payment_number: number; corrects_payment_id: string | null; reason: string | null;
  amount: string; currency: string; paid_on: string; method_declared: string; reference_declared: string | null;
  informed_by: string; informed_at: Generated<Timestamp>; operation_id: string;
}
export interface ProductsTable {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  product_state: string;
  unit: string;
  scientific_name: string | null;
  variety: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  status_reason: string | null;
  row_version: Generated<string>;
  created_at: Timestamp;
  created_by: string;
  updated_at: Timestamp;
  updated_by: string;
}
export interface ProductVersionsTable {
  product_id: string;
  organization_id: string;
  version: string;
  change_type: 'CREATED' | 'UPDATED' | 'DEACTIVATED' | 'ACTIVATED';
  changed_fields: string[];
  snapshot: unknown;
  reason: string | null;
  changed_by: string;
  changed_at: Timestamp;
}

export interface EventDeliveryAttemptsTable {
  id: Generated<string>;
  event_id: string;
  consumer: string;
  attempt: number;
  worker_id: string | null;
  lease_token: string | null;
  outcome: 'DONE' | 'DUPLICATE' | 'FAILED' | 'DEAD' | 'LEASE_LOST' | 'MANUAL_REQUEUE';
  error_code: string | null;
  actor_id: string | null;
  reason: string | null;
  recorded_at: Generated<Timestamp>;
}

export interface DocumentTypesTable { code: string; label: string; allowed_owner_types: string[]; classification: 'OPERATIONAL' | 'PERSONAL_DATA'; source: string }
export interface DocumentsTable {
  id: string; organization_id: string; document_type: string; owner_type: string; owner_id: string; title: string;
  current_version_id: string | null; row_version: Generated<string>; created_by: string; created_at: Generated<Timestamp>;
}
export interface DocumentVersionsTable {
  id: string; organization_id: string; document_id: string; version_number: number; object_key: string; file_name: string; mime_type: string;
  size_bytes: number; sha256: string; issuer: string | null; issued_at: string | null; expires_at: string | null; previous_version_id: string | null;
  operation_id: string; uploaded_by: string; uploaded_at: Generated<Timestamp>;
}
export interface DocumentVersionScansTable {
  id: Generated<string>; organization_id: string; version_id: string; result: 'CLEAN' | 'INFECTED' | 'FAILED'; engine: string;
  signature: string | null; error_code: string | null; scanned_at: Generated<Timestamp>;
}
export interface WebhookDestinationsTable {
  id: string; organization_id: string; code: string; version: number; url: string;
  secret_cipher: string; secret_fingerprint: string; event_types: string[]; active: boolean;
  reason: string | null; created_by: string; created_at: Generated<Timestamp>; operation_id: string;
}
export interface WebhookAttemptsTable {
  id: string; organization_id: string; destination_id: string; event_id: string; delivery_id: string;
  attempt: number; status: 'ENTREGADO' | 'RECHAZADO' | 'ERROR_DE_RED' | 'OMITIDO';
  http_status: number | null; response_excerpt: string | null; error: string | null;
  duration_ms: number | null; sent_at: Generated<Timestamp>;
}
export interface PlatformTariffsTable {
  id: string; organization_id: string; code: Generated<string>; version: number; currency: 'USD'; unit: 'ORGANIZACION_MES';
  monthly_fee: string; valid_from: string; valid_to: string | null; synthetic: boolean; label: string; source: string;
  reason: string | null; created_by: string; created_at: Generated<Timestamp>; operation_id: string;
}
export interface PlatformCostEstimatesTable {
  id: string; organization_id: string; period_start: string; period_end: string;
  status: 'ESTIMADO' | 'PARCIAL' | 'SIN_TARIFA'; currency: 'USD'; total: string | null;
  lines: unknown; consumption: unknown; pending_concepts: unknown; inputs_hash: string;
  computed_by: string; computed_at: Generated<Timestamp>; operation_id: string;
}
export interface IdentityLinksTable {
  id: string; user_id: string; issuer: string; subject: string; email_claim: string | null;
  created_at: Generated<Timestamp>; last_login_at: Timestamp | null; unlinked_at: Timestamp | null;
}
export interface SsoFlowsTable {
  state_hash: string; mode: 'LOGIN' | 'LINK'; user_id: string | null; nonce: string; code_verifier: string;
  redirect_uri: string; expires_at: Timestamp; created_at: Generated<Timestamp>;
}
export interface RevokedSessionsTable { jti: string; user_id: string; revoked_at: Generated<Timestamp>; }
export interface DocumentExtractionsTable {
  id: string; organization_id: string; version_id: string; run_number: number;
  status: 'EXTRAIDA' | 'SIN_TEXTO' | 'TEXTO_NO_INTERPRETABLE' | 'FORMATO_NO_SOPORTADO' | 'FALLIDA';
  engine: string; engine_version: string; source_sha256: string; text_chars: number; pages: number | null;
  extracted_text: string | null; note: string; extracted_by: string; extracted_at: Generated<Timestamp>; operation_id: string;
}
export interface DocumentExtractionFieldsTable {
  id: string; organization_id: string; extraction_id: string; field_code: 'ISSUER' | 'ISSUED_AT' | 'EXPIRES_AT';
  suggested_value: string | null; basis: 'ETIQUETA_EXPLICITA' | 'PATRON_UNICO' | 'PATRON_AMBIGUO';
  confidence: 'ALTA' | 'MEDIA' | 'BAJA'; source_excerpt: string | null; source_offset: number | null; candidates: unknown;
}
export interface DocumentExtractionDecisionsTable {
  id: string; organization_id: string; field_id: string; decision: 'CONFIRMADO' | 'DESCARTADO';
  confirmed_value: string | null; reason: string | null; decided_by: string; decided_at: Generated<Timestamp>; operation_id: string;
}
export interface DocumentVersionReviewsTable {
  id: Generated<string>; organization_id: string; version_id: string; decision: 'ACCEPTED' | 'REJECTED'; reason: string; reviewer_id: string; reviewed_at: Generated<Timestamp>;
}
export interface DocumentLinksTable { document_id: string; organization_id: string; entity_type: string; entity_id: string; created_by: string; created_at: Generated<Timestamp> }

export interface EvidenceClaimTypesTable { code: string; label: string; entity_types: string[]; limitation: string; source: string }
export interface EvidenceTable {
  id: string; organization_id: string; claim_type: string; entity_type: string; entity_id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'REVOKED'; valid_from: string | null; valid_to: string | null;
  row_version: Generated<string>; operation_id: string; created_by: string; created_at: Generated<Timestamp>;
}
export interface EvidenceSourcesTable {
  id: string; organization_id: string; evidence_id: string; document_version_id: string; relationship: 'SUPPORTS' | 'CONTRADICTS' | 'BASED_ON';
  note: string | null; operation_id: string; added_by: string; added_at: Generated<Timestamp>;
}
export interface EvidenceSourceWithdrawalsTable { source_id: string; organization_id: string; reason: string; withdrawn_by: string; withdrawn_at: Generated<Timestamp> }
export interface EvidenceDecisionsTable {
  id: Generated<string>; organization_id: string; evidence_id: string; action: 'SUBMIT' | 'VERIFY' | 'REJECT' | 'REVOKE' | 'REOPEN';
  from_status: string; to_status: string; reason: string; sources_snapshot: unknown; contradictions_acknowledged: Generated<boolean>;
  actor_id: string; decided_at: Generated<Timestamp>;
}

// P0-012 Entregas y recepción
export interface LocationsTable { id: string; organization_id: string; code: string; name: string; location_type: 'COLLECTION_CENTER' | 'WAREHOUSE' | 'OTHER'; status: 'ACTIVE' | 'INACTIVE'; row_version: Generated<string>; created_by: string; created_at: Generated<Timestamp> }
export interface DeliveriesTable {
  id: string; organization_id: string; delivery_code: string; status: 'DRAFT' | 'REGISTERED' | 'CLOSED'; producer_id: string; product_id: string | null; location_id: string | null;
  delivery_date: string | null; quantity_declared: string | null; unit: string | null; harvest_precision: 'DAY' | 'MONTH' | 'UNKNOWN' | null; harvest_start: string | null; harvest_end: string | null;
  harvest_derived_start: string | null; harvest_derived_end: string | null; notes: string | null; created_by: string; registered_by: string | null; registered_at: Timestamp | null;
  operation_id: string; row_version: Generated<string>; created_at: Generated<Timestamp>; updated_at: Generated<Timestamp>;
}
export interface DeliveryOriginsTable { id: string; organization_id: string; delivery_id: string; plot_id: string; origin_quantity: string | null; created_at: Generated<Timestamp> }
export interface DeliverySupportsTable { id: string; organization_id: string; delivery_id: string; document_id: string; document_version_id: string; support_kind: string; added_by: string; added_at: Generated<Timestamp>; operation_id: string }
export interface DeliverySupportWithdrawalsTable { support_id: string; organization_id: string; reason: string; withdrawn_by: string; withdrawn_at: Generated<Timestamp> }
export interface DeliveryCorrectionsTable {
  id: string; organization_id: string; delivery_id: string; correction_number: number; corrected_event_id: string; correction_event_id: string; reason: string; changed_fields: string[];
  delivery_date: string; quantity_declared: string; harvest_precision: string | null; harvest_start: string | null; harvest_end: string | null; harvest_derived_start: string | null; harvest_derived_end: string | null;
  notes: string | null; created_by: string; created_at: Generated<Timestamp>; operation_id: string;
}
export interface ReceptionsTable {
  id: string; organization_id: string; delivery_id: string; location_id: string; receiver_membership_id: string; receiver_user_id: string; received_at: Timestamp;
  quantity_received: string; unit: string; notes: string | null; operation_id: string; created_at: Generated<Timestamp>;
}
export interface WeighingsTable {
  id: string; organization_id: string; reception_id: string; method: string; quantity: string; unit: string; weighed_on: string; responsible_membership_id: string; responsible_user_id: string;
  corrects_weighing_id: string | null; created_at: Generated<Timestamp>;
}
export interface ReceptionAdjustmentsTable {
  id: string; organization_id: string; reception_id: string; adjustment_number: number; weighing_id: string; previous_quantity: string; new_quantity: string; reason: string;
  corrected_event_id: string; correction_event_id: string; created_by: string; created_at: Generated<Timestamp>; operation_id: string;
}
export interface QualitySamplesTable { id: string; organization_id: string; reception_id: string; moment: 'DURING_RECEPTION' | 'AFTER_WEIGHING'; sample_reference: string | null; sampled_at: Timestamp; sampled_by_membership_id: string; sampled_by: string; operation_id: string; created_at: Generated<Timestamp> }
export interface QualityResultsTable {
  id: string; organization_id: string; sample_id: string; method: string; decision: 'PENDING' | 'RELEASED' | 'REJECTED'; limits_version: string | null; decision_reason: string | null;
  recorded_by_membership_id: string; recorded_by: string; recorded_at: Generated<Timestamp>; operation_id: string;
}
export interface QualityMeasurementsTable { id: string; organization_id: string; result_id: string; parameter: 'MOISTURE' | 'FERMENTATION' | 'IMPURITIES'; value: string; unit: string }
export interface GateEvaluationsTable { id: string; organization_id: string; entity_type: 'delivery' | 'reception' | 'quality_result' | 'process_run' | 'stock_movement' | 'shipment'; entity_id: string; transition: string; release_version: string; allowed: boolean; result: unknown; evaluated_by: string; evaluated_at: Generated<Timestamp> }

// P0-016 Lotes y procesos
export interface ProcessRunsTable {
  id: string; organization_id: string; run_code: string; process_type: 'FERMENTATION' | 'DRYING'; status: 'DRAFT' | 'RUNNING' | 'CLOSED' | 'CANCELLED'; output_product_id: string;
  started_at: Timestamp | null; closed_at: Timestamp | null; loss_quantity: string | null; moisture_value: string | null; moisture_unit: string | null; moisture_method: string | null; moisture_measured_by: string | null; notes: string | null; cancel_reason: string | null;
  created_by: string; operation_id: string; start_operation_id: string | null; close_operation_id: string | null; cancel_operation_id: string | null; row_version: Generated<string>; created_at: Generated<Timestamp>;
}
export interface LotsTable {
  id: string; organization_id: string; lot_code: string; product_id: string; unit: string; source: 'RECEPTIONS' | 'PROCESS_OUTPUT' | 'CUSTODY_TRANSFER'; status: 'OPEN' | 'CLOSED_FOR_INPUT';
  origin_status: 'COMPLETE' | 'INCOMPLETE'; process_run_id: string | null; output_quantity: string | null; created_by: string; operation_id: string; row_version: Generated<string>; created_at: Generated<Timestamp>;
}
export interface LotInputsTable { id: string; organization_id: string; lot_id: string; reception_id: string; weighing_id: string; reception_version: number; quantity: string; unit: string; origin_known: boolean; assigned_by: string; assigned_at: Generated<Timestamp>; operation_id: string }
export interface LotInputReleasesTable { input_id: string; organization_id: string; reason: string; released_by: string; released_at: Generated<Timestamp>; operation_id: string }
export interface ProcessInputsTable { id: string; organization_id: string; run_id: string; lot_id: string; lot_version: string; quantity: string; unit: string; location_id: string | null }
export interface LotEdgesTable { id: string; organization_id: string; parent_lot_id: string; child_lot_id: string; run_id: string; quantity: string; unit: string }
export interface ProcessOutputsTable { id: string; organization_id: string; run_id: string; lot_id: string; quantity: string; unit: string }

// P0-017 ledger
export interface StockMovementsTable { id: string; organization_id: string; movement_type: string; source_type: string | null; source_id: string | null; operation_id: string | null; actor_id: string | null; reason: string | null; process_loss: string | null; reference: unknown; recorded_at: Generated<Timestamp> }
export interface StockEntriesTable { id: string; organization_id: string; movement_id: string; reception_id: string | null; lot_id: string | null; location_id: string | null; bucket: 'PHYSICAL' | 'RESERVED'; signed_quantity: string; unit: string }

// P0-029 embarques
export interface BuyersTable { id: string; organization_id: string; code: string; name: string; country: string; status: Generated<'ACTIVE' | 'INACTIVE'>; created_by: string; operation_id: string; row_version: Generated<string>; created_at: Generated<Timestamp> }
export interface ShipmentsTable {
  id: string; organization_id: string; shipment_code: string; status: 'DRAFT' | 'DISPATCHED' | 'CANCELLED'; buyer_id: string; destination_country: string; destination_place: string | null; origin_location_id: string;
  notes: string | null; dispatch_at: Timestamp | null; dispatched_by: string | null; dispatch_operation_id: string | null; cancel_reason: string | null;
  created_by: string; operation_id: string; row_version: Generated<string>; created_at: Generated<Timestamp>;
}
// D-34.A.2: la acreditación de diligencia vive POR ÍTEM, que es donde está la cardinalidad real (un embarque
// lleva N lotes, cada uno con su expediente y su export). Se escribe al despachar y no se reemplaza después:
// es la evidencia histórica de qué paquete respaldó ese ítem, distinta de su vigencia para una operación futura.
export interface ShipmentItemsTable { id: string; organization_id: string; shipment_id: string; lot_id: string; quantity: string; unit: string; dd_package_export_id: string | null; created_by: string; created_at: Generated<Timestamp> }
export interface ShipmentReservationsTable {
  id: string; organization_id: string; shipment_id: string; item_id: string; lot_id: string; location_id: string; quantity: string; unit: string; status: 'ACTIVE' | 'RELEASED' | 'CONSUMED';
  reserve_movement_id: string; end_movement_id: string | null; release_reason: string | null; created_by: string; created_at: Generated<Timestamp>; ended_at: Timestamp | null; operation_id: string;
}


// A-03 traspaso de custodia (migración 0058)
export interface OrgPartnershipsTable {
  id: string; requester_org_id: string; counterpart_org_id: string | null; code_hash: string; status: 'PENDING' | 'ACTIVE' | 'REVOKED'; expires_at: Timestamp;
  created_by: string; confirmed_by: string | null; confirmed_at: Timestamp | null; revoked_by: string | null; revoked_by_org: string | null; revoked_at: Timestamp | null; revoke_reason: string | null;
  operation_id: string; created_at: Generated<Timestamp>;
}
export type CustodyStatus = 'OFFERED' | 'ACCEPTED' | 'IN_TRANSIT' | 'WITH_DISCREPANCY' | 'CLOSED' | 'REJECTED' | 'CANCELLED';
export interface CustodyTransfersTable {
  id: string; transfer_code: string; partnership_id: string; sender_org_id: string; receiver_org_id: string; status: CustodyStatus;
  sender_lot_id: string; sender_location_id: string; receiver_location_id: string | null; receiver_product_id: string | null; receiver_lot_id: string | null;
  quantity: string; unit: 'KG'; returns_transfer_id: string | null; origin_projection: unknown; origin_projection_hash: string; note: string | null;
  closure: 'COMPLETE' | 'WITH_DIFFERENCES' | null; reject_reason: string | null; cancel_reason: string | null; offered_by: string; offer_operation_id: string;
  row_version: Generated<string>; created_at: Generated<Timestamp>; updated_at: Generated<Timestamp>;
}
export type CustodyStep = 'OFFER' | 'ACCEPT' | 'REJECT_OFFER' | 'CANCEL' | 'DISPATCH' | 'RECEIPT' | 'OVERAGE_RECORDED' | 'REJECT_TRANSIT' | 'DECLARE_SHORTAGE' | 'LOSS_CONFIRMED' | 'OVERAGE_CONFIRMED' | 'OVERAGE_WITHDRAWN' | 'SHORTAGE_REOPENED';
export interface CustodyTransferStepsTable {
  id: string; transfer_id: string; actor_org_id: string; actor_user_id: string; step: CustodyStep; quantity: string | null; reason: string | null; detail: unknown;
  movement_id: string | null; operation_id: string; created_at: Generated<Timestamp>;
}
export interface CustodyDiscrepanciesTable {
  id: string; transfer_id: string; kind: 'SHORTAGE' | 'OVERAGE'; quantity: string; status: 'OPEN' | 'RESOLVED'; resolution: 'LOSS_CONFIRMED' | 'OVERAGE_CONFIRMED' | 'OVERAGE_WITHDRAWN' | 'SHORTAGE_REOPENED' | null;
  reason: string; recorded_by_org: string; recorded_by: string; created_at: Generated<Timestamp>; resolved_by_org: string | null; resolved_by: string | null; resolved_at: Timestamp | null; resolution_reason: string | null;
}
export interface CustodyLotLinksTable {
  id: string; transfer_id: string; step_id: string; parent_org_id: string; parent_lot_id: string; child_org_id: string; child_lot_id: string; quantity: string; unit: 'KG'; created_at: Generated<Timestamp>;
}

// P0-020 riesgo
// P1-005 — Perfil jurídico revisable (migración 0049). El catálogo es de plataforma y sus filas son
// inmutables; la adopción, la revisión jurídica y el historial son append-only.
export interface LegalProfileVersionsTable {
  version: string; jurisdiction: 'EC'; scope: 'PARTIAL' | 'COMPLETE'; scope_note: string;
  covered_matters: string[]; pending_matters: string[];
  technical_status: 'DRAFT' | 'PUBLISHED';
  /** Texto, no usuario: es un catálogo de sistema sembrado por la migración. */
  published_by: string; published_at: Generated<Timestamp>; reason: string;
}
export interface LegalProfileReviewsTable {
  id: string; version: string; decision: 'REVIEWED' | 'OBJECTED' | 'WITHDRAWN';
  reviewer_id: string; reviewer_capacity: string; basis: string;
  /** Persona revisora DECLARADA; `reviewer_id` es quien REGISTRÓ el acto (0062). */
  reviewer_name: string; reviewed_on: string;
  decided_at: Generated<Timestamp>; operation_id: string;
}
export interface LegalProfileSourcesTable {
  version: string; code: string; title: string; authority: string; publication: string; publication_date: string;
  url: string; file_sha256: string; pdf_page_index: number | null; printed_page: string | null;
  document_obtained: boolean; text_contrasted: boolean; legal_validity_reviewed: boolean;
  modifications_found: string; gaps: string;
}
export interface LegalProfileRulesTable {
  version: string; code: string; matter: string; source_code: string; article: string; subject: string;
  applicability_condition: string; evidence_required: string; product_can_check: string;
  needs_legal_review: boolean; review_status: 'DRAFT' | 'REVIEWED'; gaps: string;
}
export interface BudgetParametersTable {
  id: string; organization_id: string;
  concept: 'GEOREFERENCIACION' | 'VALIDACION' | 'DOCUMENTACION' | 'ANALISIS_SATELITAL' | 'ADMINISTRACION';
  unit: string; validation_kind: string | null; amount: string; currency: 'USD';
  valid_from: string; valid_to: string | null; version: number; note: string | null;
  created_by: string; created_at: Generated<Timestamp>; operation_id: string;
}
export interface CostEstimatesTable {
  id: string; organization_id: string; scope_kind: 'LOT'; scope_id: string; currency: 'USD';
  total_known: string; complete: boolean;
  parameters: unknown; quantities: unknown; denominators: unknown; lines: unknown; observed: unknown;
  created_by: string; created_at: Generated<Timestamp>; operation_id: string;
}
export interface ExchangeAgreementsTable {
  id: string; organization_id: string; counterpart: 'GUIA_AGROCALIDAD'; reference: string; scope: string;
  valid_from: string; valid_to: string | null; document_version_id: string | null;
  created_by: string; created_at: Generated<Timestamp>; operation_id: string;
}
export interface ExchangeAgreementDecisionsTable {
  id: string; organization_id: string; agreement_id: string; decision: 'VERIFY' | 'WITHDRAW';
  reason: string; decided_by: string; decided_at: Generated<Timestamp>; operation_id: string;
}
export interface ExchangeActsTable {
  id: string; organization_id: string; agreement_id: string; kind: 'EXPORT' | 'RECONCILE';
  format_version: string; row_count: number; content_hash: string; summary: unknown;
  performed_by: string; performed_at: Generated<Timestamp>; operation_id: string;
}
export interface ExchangeDifferencesTable {
  id: string; organization_id: string; act_id: string; external_key: string; entity_type: 'PRODUCER';
  entity_id: string | null; kind: 'ONLY_EXTERNAL' | 'ONLY_OURS' | 'FIELD_DIFFERS';
  field: string | null; external_value: string | null; our_value: string | null; created_at: Generated<Timestamp>;
}
export interface ExchangeDifferenceDecisionsTable {
  id: string; organization_id: string; difference_id: string;
  decision: 'ACCEPT_EXTERNAL' | 'KEEP_OURS' | 'NEEDS_REVIEW';
  reason: string; decided_by: string; decided_at: Generated<Timestamp>; operation_id: string;
}
export interface LegalProfileAdoptionsTable {
  id: string; organization_id: string; version: string; decision: 'ADOPT' | 'WITHDRAW';
  reason: string; decided_by: string; decided_at: Generated<Timestamp>; operation_id: string;
}
export interface LegalAssessmentsTable {
  id: string; organization_id: string; subject_type: 'PLOT'; subject_id: string; version: string;
  status: 'OPEN' | 'CLOSED'; created_by: string; created_at: Generated<Timestamp>;
  closed_at: Timestamp | null; operation_id: string;
}
export type Applicability = 'UNKNOWN' | 'APPLICABLE' | 'NOT_APPLICABLE';
export type ItemResult = 'PENDING' | 'SATISFIED' | 'NOT_SATISFIED' | 'NOT_EVALUABLE' | 'NOT_APPLICABLE';
export interface LegalAssessmentItemsTable {
  id: string; organization_id: string; assessment_id: string; version: string; rule_code: string;
  applicability: Applicability; applicability_reason: string | null;
  evidence_version_id: string | null; evidence_origin: 'OFFICIAL_DOCUMENT' | 'PRODUCER_DECLARATION' | null;
  evidence_admissibility: 'NOT_JUSTIFIED' | 'JUSTIFIED'; evidence_justification: string | null;
  result: ItemResult; reviewer_id: string | null; reviewed_at: Timestamp | null; reason: string | null;
  cartographic_indication: 'NONE' | 'INDICATION' | 'NOT_ASSESSED';
  cartographic_source: string | null; cartographic_note: string | null;
  row_version: Generated<string>; updated_at: Generated<Timestamp>;
}
export interface LegalAssessmentItemHistoryTable {
  id: string; organization_id: string; item_id: string; row_version: string;
  applicability: string; evidence_version_id: string | null; evidence_origin: string | null;
  evidence_admissibility: string; result: string; reviewer_id: string | null; reason: string | null;
  cartographic_indication: string; changed_by: string; changed_at: Generated<Timestamp>; change_note: string;
}

export interface RiskRuleSetAdoptionsTable {
  id: string;
  organization_id: string;
  rule_set_version: string;
  decision: 'ADOPT' | 'WITHDRAW';
  reason: string;
  decided_by: string;
  decided_at: ColumnType<Date, Date | string | undefined, Date | string>;
  operation_id: string;
}

export interface RiskEvaluationsTable {
  id: string; organization_id: string; subject_type: 'LOT'; subject_id: string; evaluation_number: number; rule_set_version: string; parameters: unknown; snapshot: unknown; snapshot_hash: string;
  factors: unknown; categories: unknown; technical_result: string; severity: string; conclusion: string; evaluated_by: string; evaluated_at: Generated<Timestamp>; operation_id: string; trigger: unknown | null;
  /** Cobertura de la severidad: sin ella, una severidad se lee como si la evaluación hubiera sido completa. */
  severity_coverage: unknown | null;
  /** Adopción que respalda la severidad. Sin adopción no hay severidad (CHECK estructural). */
  severity_adoption_id: string | null;
}
export interface RiskReviewsTable { id: string; organization_id: string; evaluation_id: string; action: 'START_REVIEW' | 'RESOLVE'; reason: string; reviewer_id: string; reviewed_at: Generated<Timestamp>; operation_id: string }

// P0-021 mitigaciones
export interface MitigationActionsTable {
  id: string; organization_id: string; evaluation_id: string; factor_code: string; subject_type: 'LOT'; subject_id: string; title: string; acceptance_criteria: string; evidence_required: string;
  assignee_membership_id: string; due_date: string; status: 'OPEN' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'REOPENED'; created_by: string; created_at: Generated<Timestamp>; operation_id: string; row_version: Generated<string>;
}
export interface MitigationSupportsTable { id: string; organization_id: string; action_id: string; submission_number: number; document_version_id: string | null; evidence_id: string | null; evidence_version: string | null; added_by: string; added_at: Generated<Timestamp>; operation_id: string }
export interface MitigationSubmissionsTable { id: string; organization_id: string; action_id: string; submission_number: number; note: string; submitted_by: string; submitted_at: Generated<Timestamp>; operation_id: string }
// P0-022 expediente de debida diligencia
// P0-024 sync
export interface DevicesTable { id: string; organization_id: string; user_id: string; client_device_id: string; platform: 'ANDROID' | 'IOS' | 'OTHER'; label: string; status: 'ACTIVE' | 'REVOKED'; registered_at: Generated<Timestamp>; revoked_at: Timestamp | null; revoked_by: string | null; revoke_reason: string | null }
export interface SyncOperationsTable { id: string; organization_id: string; operation_id: string; operation_type: string; entity_id: string; content_hash: string; depends_on: unknown; base_version: string | null; captured_at: Timestamp; resolves_operation_id: string | null; status: 'ACCEPTED' | 'REJECTED' | 'CONFLICT'; result: unknown; user_id: string; device_id: string; received_at: Generated<Timestamp> }
export interface SyncEntityRefsTable { organization_id: string; user_id: string; local_ref: string; entity_type: 'PRODUCER' | 'PLOT'; server_id: string; operation_id: string; device_id: string; produced_row_version: string | null; created_at: Generated<Timestamp> }
export interface SyncCursorsTable { id: string; organization_id: string; user_id: string; device_id: string; scope: 'PLOTS'; visible: unknown; issued_at: Generated<Timestamp>; expires_at: Timestamp }
export interface SyncAttachmentUploadsTable { operation_id: string; organization_id: string; document_id: string; version_id: string; sha256: string; uploaded_by: string; device_id: string; uploaded_at: Generated<Timestamp> }
export interface DeliveryClosuresTable {
  id: string; organization_id: string; delivery_id: string; justification_number: number; kind: 'CLOSE' | 'REJUSTIFY';
  declared_quantity: string; received_quantity: string; difference: string; reason: string | null;
  justified_by: string; justified_at: Generated<Timestamp>; operation_id: string;
}
export interface DdCasesTable { id: string; organization_id: string; case_number: string; subject_type: 'LOT'; subject_id: string; scope_note: string; created_by: string; created_at: Generated<Timestamp>; operation_id: string }
export interface DdSnapshotsTable { id: string; organization_id: string; case_id: string; snapshot_number: number; content: unknown; content_hash: string; section_hashes: unknown; manifest: unknown; requirements: unknown; readiness: 'BLOCKED' | 'IN_PROGRESS' | 'READY'; captured_by: string; captured_at: Generated<Timestamp>; operation_id: string }
export interface DdReviewsTable { id: string; organization_id: string; snapshot_id: string; action: 'START_REVIEW' | 'RETURN' | 'APPROVE'; reason: string; reviewer_id: string; reviewed_at: Generated<Timestamp>; operation_id: string }
// P0-028 análisis satelital
export type SatelliteProviderKind = 'EXTERNAL_HTTP' | 'SYNTHETIC_FIXTURE';
export type SatelliteOperation = 'FOREST_COVER' | 'DEFORESTATION_ALERTS' | 'HISTORICAL_ANALYSIS';
export type SatelliteJobStatus = 'REQUESTED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type SatelliteOutcome =
  | 'RESULT_AVAILABLE' | 'NO_PROVIDER_SELECTED' | 'LIVE_CALLS_DISABLED' | 'NO_COVERAGE' | 'TIMEOUT' | 'RATE_LIMITED'
  | 'PROVIDER_ERROR' | 'EGRESS_BLOCKED' | 'GEOMETRY_UNSUPPORTED' | 'SUPERSEDED_GEOMETRY' | 'CANCELLED';
export interface SatelliteProvidersTable {
  code: string; name: string; kind: SatelliteProviderKind;
  selection_status: 'PROPOSED' | 'SELECTED_FOR_DEVELOPMENT' | 'SELECTED' | 'TEST_ONLY' | 'RETIRED';
  allowed_hosts: string[]; supported_operations: string[]; docs_url: string; license: string; cost_note: string; coverage_note: string; limits_note: string;
  data_sent_note: string; source: string; selected_by: string | null; decision_reference: string | null; registered_at: Generated<Timestamp>;
}
export interface SatelliteJobsTable {
  id: string; organization_id: string; plot_id: string; plot_version_id: string; geometry_hash: string;
  geometry_type: 'POINT' | 'POLYGON' | 'MULTIPOLYGON'; provider_code: string; provider_kind: SatelliteProviderKind;
  adapter_contract_version: string; operation: SatelliteOperation; period_start: string | null; period_end: string | null; request_fingerprint: string;
  status: SatelliteJobStatus; outcome: SatelliteOutcome | null; attempts: Generated<number>; locked_by: string | null;
  locked_until: Timestamp | null; lease_token: string | null; next_attempt_at: ColumnType<Date, Date | string | undefined, Date | string>; last_error_code: string | null;
  requested_by: string; requested_at: Generated<Timestamp>; finished_at: Timestamp | null; operation_id: string;
  // 0067: trabajo en el proveedor, avance declarado y cancelación pedida.
  provider_job_ref: string | null; provider_progress_percent: number | null; provider_progress_note: string | null; provider_progress_at: Timestamp | null;
  cancel_requested_at: Timestamp | null; cancel_requested_by: string | null; cancel_reason: string | null;
  // 0068: instante en que se empezó a enviar al proveedor (envío incierto si no hay `provider_job_ref`).
  provider_submit_started_at: Timestamp | null;
}
export interface SatelliteResultsTable {
  id: string; organization_id: string; job_id: string; provider_code: string; is_synthetic: boolean;
  dataset: string | null; dataset_version: string | null; analysis_date: Timestamp | null; resolution_m: string | null;
  method: string | null; coverage_status: 'COVERED' | 'PARTIAL' | 'NOT_COVERED' | 'UNKNOWN'; coverage_note: string;
  confidence: string | null; limitations: string; indicators: unknown; raw_object_key: string | null; raw_sha256: string | null;
  conclusion: Generated<'NOT_EVALUATED'>; recorded_at: Generated<Timestamp>;
}
export interface SatelliteCredentialsTable {
  organization_id: string; provider_code: string; secret_ciphertext: string; created_by: string;
  created_at: Generated<Timestamp>; rotated_at: Timestamp | null;
}
// RF-47 — Referencia pública por entidad. Espacio de nombres ÚNICO entre todos los tipos que comparten la ruta
// de resolución: `reference` es la clave primaria, así que una parcela y un lote no pueden coincidir. Vive
// fuera de las entidades a propósito: añadir una referencia a una instantánea no toca su contenido, su
// manifiesto ni su hash. Append-only: no se edita ni se reutiliza para otra entidad.
export type PublicReferenceEntity = 'PRODUCER' | 'PLOT' | 'DELIVERY' | 'LOT' | 'SHIPMENT' | 'DD_SNAPSHOT';
// P0-003 — Concesión externa: acto del DUEÑO de los datos sobre instancias concretas. No crea membresía ni
// asigna roles. Vencimiento obligatorio, revocación inmediata y términos inmutables (disparadores en 0046).
export interface AccessGrantsTable {
  id: string; organization_id: string; grantee_user_id: string;
  resource_type: 'LOT' | 'SHIPMENT' | 'DD_SNAPSHOT'; resource_id: string;
  can_read: boolean; can_download: boolean; expires_at: Timestamp; reason: string;
  granted_by: string; operation_id: string; created_at: Generated<Timestamp>;
  revoked_at: Timestamp | null; revoked_by: string | null; revoke_reason: string | null;
}
// D-04 — Elevación de plataforma supervisada: la pide SUPER_ADMIN, la aprueba un ORG_ADMIN distinto de la
// organización afectada, dura 15 minutos como máximo y solo habilita un catálogo cerrado de acciones de
// lectura. No crea membresía ni asigna roles (migración 0047).
export interface PlatformElevationsTable {
  id: string; organization_id: string; requested_by: string; purpose: string; reason: string; scope_note: string;
  actions: string[]; duration_seconds: number;
  /** `jti` de la sesión solicitante: distingue sesiones simultáneas, que `token_version` no distingue. */
  session_id: string | null;
  /** Versión de sesión de la CUENTA: protección adicional para la invalidación global. */
  session_token_version: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'ENDED' | 'EXPIRED';
  approved_by: string | null; approved_at: Timestamp | null; expires_at: Timestamp | null;
  rejected_at: Timestamp | null; reject_reason: string | null;
  revoked_at: Timestamp | null; revoked_by: string | null; revoke_reason: string | null;
  ended_at: Timestamp | null; operation_id: string; created_at: Generated<Timestamp>;
}
export interface PublicReferencesTable { reference: string; entity_type: PublicReferenceEntity; entity_id: string; organization_id: string; created_at: Generated<Timestamp> }
export interface DdExportsTable { id: string; organization_id: string; snapshot_id: string; kind: 'INTERNAL_REVIEW' | 'DD_PACKAGE'; redaction_profile: unknown; package_hash: string; size_bytes: number; exported_by: string; exported_at: Generated<Timestamp>; operation_id: string }
export interface MitigationDecisionsTable { id: string; organization_id: string; action_id: string; submission_number: number; decision: 'VERIFIED' | 'REJECTED'; reason: string; decided_by: string; decided_at: Generated<Timestamp>; operation_id: string; criterion_met: boolean | null }
export interface MitigationCorrectionsTable { id: string; organization_id: string; action_id: string; decision_id: string; submission_number: number; support_accepted: boolean; criterion_met: boolean; reason: string; corrected_by: string; corrected_at: Generated<Timestamp>; operation_id: string }

export interface ImportBatchesTable {
  id: string;
  organization_id: string;
  template: 'PRODUCTORES_V1' | 'PRODUCTOS_V1' | 'PARCELAS_V1' | 'ENTREGAS_V1' | 'LOTES_V1';
  status: 'UPLOADED' | 'MAPPED' | 'COMMITTED' | 'DISCARDED';
  sha256: string;
  byte_size: number;
  original_filename: string | null;
  sheet_name: string;
  headers: unknown;
  row_count: number;
  mapping: unknown | null;
  plan_hash: string | null;
  summary: unknown | null;
  operation_id: string;
  commit_operation_id: string | null;
  created_by: string;
  created_at: Generated<Timestamp>;
  mapped_by: string | null;
  mapped_at: Timestamp | null;
  closed_by: string | null;
  closed_at: Timestamp | null;
  row_version: Generated<string>;
}

export interface ImportRowsTable {
  organization_id: string;
  batch_id: string;
  row_number: number;
  cells_enc: string | null;
  result_action: 'CREATED' | 'UPDATED' | 'UNCHANGED' | null;
  producer_id: string | null;
  product_id: Generated<string | null>;
  plot_id: Generated<string | null>;
  delivery_id: Generated<string | null>;
  lot_id: Generated<string | null>;
  changed_fields: string[] | null;
}

export interface ImportReferencesTable {
  id: Generated<string>;
  organization_id: string;
  template: 'ENTREGAS_V1' | 'LOTES_V1';
  reference: string;
  origin: 'FILE_REFERENCE' | 'LEGACY_CONTENT_FINGERPRINT';
  delivery_id: string | null;
  lot_id: Generated<string | null>;
  batch_id: string;
  row_number: number;
  created_by: string;
  created_at: Generated<Timestamp>;
}

export interface Database {
  evidence_claim_types: EvidenceClaimTypesTable;
  evidence: EvidenceTable;
  evidence_sources: EvidenceSourcesTable;
  evidence_source_withdrawals: EvidenceSourceWithdrawalsTable;
  evidence_decisions: EvidenceDecisionsTable;
  document_types: DocumentTypesTable;
  documents: DocumentsTable;
  document_versions: DocumentVersionsTable;
  document_version_scans: DocumentVersionScansTable;
  document_version_reviews: DocumentVersionReviewsTable;
  document_links: DocumentLinksTable;
  event_delivery_attempts: EventDeliveryAttemptsTable;
  product_states: ProductStatesTable;
  measurement_units: MeasurementUnitsTable;
  products: ProductsTable;
  product_versions: ProductVersionsTable;
  object_deletions: ObjectDeletionsTable;
  geo_profile_evaluations: GeoProfileEvaluationsTable;
  gis_evaluations: GisEvaluationsTable;
  gis_evaluation_comparisons: GisEvaluationComparisonsTable;
  geometry_imports: GeometryImportsTable;
  import_batches: ImportBatchesTable;
  import_rows: ImportRowsTable;
  import_references: ImportReferencesTable;
  polygon_drafts: PolygonDraftsTable;
  draft_vertices: DraftVerticesTable;
  draft_vertex_exclusions: DraftVertexExclusionsTable;
  location_samples: LocationSamplesTable;
  plots: PlotsTable;
  plot_versions: PlotVersionsTable;
  plot_history: PlotHistoryTable;
  producer_match_reviews: ProducerMatchReviewsTable;
  producers: ProducersTable;
  producer_versions: ProducerVersionsTable;
  producer_status_counts: ProducerStatusCountsTable;
  domain_events: DomainEventsTable;
  event_deliveries: EventDeliveriesTable;
  consumer_receipts: ConsumerReceiptsTable;
  organization_event_stats: OrganizationEventStatsTable;
  organization_types: OrganizationTypesTable;
  invitations: InvitationsTable;
  users: UsersTable;
  organizations: OrganizationsTable;
  memberships: MembershipsTable;
  roles: RolesTable;
  role_assignments: RoleAssignmentsTable;
  audit_logs: AuditLogsTable;
  locations: LocationsTable;
  deliveries: DeliveriesTable;
  delivery_origins: DeliveryOriginsTable;
  delivery_supports: DeliverySupportsTable;
  delivery_support_withdrawals: DeliverySupportWithdrawalsTable;
  delivery_corrections: DeliveryCorrectionsTable;
  receptions: ReceptionsTable;
  weighings: WeighingsTable;
  reception_adjustments: ReceptionAdjustmentsTable;
  quality_samples: QualitySamplesTable;
  quality_results: QualityResultsTable;
  quality_measurements: QualityMeasurementsTable;
  gate_evaluations: GateEvaluationsTable;
  process_runs: ProcessRunsTable;
  lots: LotsTable;
  buyers: BuyersTable;
  shipments: ShipmentsTable;
  shipment_items: ShipmentItemsTable;
  shipment_reservations: ShipmentReservationsTable;
  lot_inputs: LotInputsTable;
  lot_input_releases: LotInputReleasesTable;
  process_inputs: ProcessInputsTable;
  lot_edges: LotEdgesTable;
  process_outputs: ProcessOutputsTable;
  stock_movements: StockMovementsTable;
  stock_entries: StockEntriesTable;
  legal_profile_versions: LegalProfileVersionsTable;
  legal_profile_reviews: LegalProfileReviewsTable;
  legal_profile_sources: LegalProfileSourcesTable;
  legal_profile_rules: LegalProfileRulesTable;
  webhook_destinations: WebhookDestinationsTable;
  webhook_attempts: WebhookAttemptsTable;
  platform_tariffs: PlatformTariffsTable;
  platform_cost_estimates: PlatformCostEstimatesTable;
  identity_links: IdentityLinksTable;
  sso_flows: SsoFlowsTable;
  revoked_sessions: RevokedSessionsTable;
  document_extractions: DocumentExtractionsTable;
  document_extraction_fields: DocumentExtractionFieldsTable;
  document_extraction_decisions: DocumentExtractionDecisionsTable;
  delivery_economics: DeliveryEconomicsTable;
  delivery_payments: DeliveryPaymentsTable;
  budget_parameters: BudgetParametersTable;
  cost_estimates: CostEstimatesTable;
  exchange_agreements: ExchangeAgreementsTable;
  exchange_agreement_decisions: ExchangeAgreementDecisionsTable;
  exchange_acts: ExchangeActsTable;
  exchange_differences: ExchangeDifferencesTable;
  exchange_difference_decisions: ExchangeDifferenceDecisionsTable;
  legal_profile_adoptions: LegalProfileAdoptionsTable;
  legal_assessments: LegalAssessmentsTable;
  legal_assessment_items: LegalAssessmentItemsTable;
  legal_assessment_item_history: LegalAssessmentItemHistoryTable;
  risk_rule_set_adoptions: RiskRuleSetAdoptionsTable;
  risk_evaluations: RiskEvaluationsTable;
  risk_reviews: RiskReviewsTable;
  mitigation_actions: MitigationActionsTable;
  mitigation_supports: MitigationSupportsTable;
  mitigation_submissions: MitigationSubmissionsTable;
  mitigation_decisions: MitigationDecisionsTable;
  mitigation_corrections: MitigationCorrectionsTable;
  delivery_closures: DeliveryClosuresTable;
  dd_cases: DdCasesTable;
  devices: DevicesTable;
  sync_operations: SyncOperationsTable;
  sync_entity_refs: SyncEntityRefsTable;
  sync_cursors: SyncCursorsTable;
  sync_attachment_uploads: SyncAttachmentUploadsTable;
  dd_snapshots: DdSnapshotsTable;
  dd_reviews: DdReviewsTable;
  dd_exports: DdExportsTable;
  public_references: PublicReferencesTable;
  access_grants: AccessGrantsTable;
  org_partnerships: OrgPartnershipsTable;
  custody_transfers: CustodyTransfersTable;
  custody_transfer_steps: CustodyTransferStepsTable;
  custody_discrepancies: CustodyDiscrepanciesTable;
  custody_lot_links: CustodyLotLinksTable;
  platform_elevations: PlatformElevationsTable;
  satellite_providers: SatelliteProvidersTable;
  satellite_jobs: SatelliteJobsTable;
  satellite_results: SatelliteResultsTable;
  satellite_credentials: SatelliteCredentialsTable;
}
