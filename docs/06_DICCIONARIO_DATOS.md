# Diccionario de datos propuesto

Base: S1 §§10–48. Alcance: contratos mínimos para el MVP y extensiones de soporte; no DDL listo para aplicar. Campos existentes deben mapearse durante TECH-001. `R`: requerido; `C`: condicional; `O`: opcional. Un dato ausente se registra como ausente y no se completa con valores inventados.

## Convenciones comunes

| Campo | Tipo propuesto | Regla |
| --- | --- | --- |
| id | UUID | R, PK; generado offline cuando aplique |
| organization_id | UUID FK | R en datos operativos; obtenido del contexto autorizado |
| created_at / updated_at | timestamptz | R, reloj servidor en UTC |
| created_by / updated_by | UUID | R o identidad de servicio; actor verificable |
| row_version | bigint | R, concurrencia optimista |
| deleted_at / deleted_by / deletion_reason | timestamp/UUID/text | C para baja lógica; no borrado de historia |
| data_status | enum | `UNKNOWN/MISSING/NOT_VALIDATED/LEGACY/VERIFIED`, si aplica |
| public_reference | text | C para QR; no concede permiso ni vuelve público el objeto |

Cantidades `numeric(20,6)` y dinero `numeric(20,4)` son propuestas de precisión, a confirmar con volúmenes y monedas reales. API transmite decimales como string, unidad y moneda explícitas. Índices deben responder a queries reales y límites por tenant.

## Identidad, actores y catálogo

| Entidad | Campos mínimos adicionales | Restricciones |
| --- | --- | --- |
| organizations | name R; legal_name C; organization_type R; tax_id C; country R; province/canton/parish O; status R | Registro empresarial y tenant no se confunden |
| users | first_name/last_name R; email R; phone O; status R; last_login_at O; external_subject C | Normalizar email; no guardar secreto OIDC |
| memberships | user_id R; organization_id R; status R | Único usuario/organización; reactivación auditada |
| roles/permissions | code R; description R; permission resource/action R | Catálogo versionado; role_assignment a membresía |
| producers | producer_code R; first_name/last_name o legal_name R; document_type/number C; phone O; community y división territorial O; status R | Único código por tenant; identidad cifrada/restringida |
| counterparties | name R; actor_type R; official_reference O; country O; linked_organization_id O | Contraparte externa no implica tenant ni integración |
| locations | code/name/type R; coordinates O; official_reference O | Centro/acopio/bodega; no duplicar parcela |
| products | code/name/product_type/unit R; scientific_name/variety O; status R | Cacao baba/fermentado/seco/clasificado; no conversión implícita |

## GIS y producción

| Entidad | Campos mínimos adicionales | Restricciones |
| --- | --- | --- |
| plots | producer_id R; plot_code R; name O; current_version_id C; crop R; variety O; status R | Código único por tenant; FK productor mismo tenant |
| plot_versions | plot_id R; geometry C; geometry_type C; area_declared_ha O; area_calculated_ha C; survey_method R; surveyed_at C; validation_status R; validation_rule_version R; accuracy_m O; previous_version_id O | SRID 4326 para persistencia; punto no tiene superficie calculada |
| gps_samples | plot_version_id R; longitude/latitude R; captured_at R; horizontal_accuracy_m O; device_reference O | Precisión desconocida permanece null; muestras originales conservadas |
| production_records | plot_id R; product_id R; period_start/end R; quantity_estimated O; quantity_actual O; unit R | Estimación no crea inventario; cantidades y periodos no negativos |
| satellite_jobs/results | plot_version_id R; provider R; job_status R; dataset/version/date/method C; resolution/confidence C; raw_object_key C | C al completar; resultado ligado a geometría exacta |

## Operaciones y custodia

| Entidad | Campos mínimos adicionales | Restricciones |
| --- | --- | --- |
| deliveries | delivery_code R; producer_id/supplier_id R según flujo; product_id R; delivery_date R; quantity_declared R; unit R; production_period C; notes O | Peso declarado separado de recepción |
| delivery_origins | delivery_id R; plot_id C; plot_version_id C; origin_quantity R; origin_status R | Cantidades no exceden entrega; origen faltante explícito |
| receptions | delivery_id R; location_id R; quantity_received R; received_at/receiver_id R; status R; difference_reason C | Distinguir parcial/completa; idempotencia de confirmación |
| quality_samples/results | reception_id o lot_id R; sampled_at/by R; moisture O; fermentation O; impurities O; method/unit/limits_version C; decision R | Si libera, justificar con parámetros vigentes; una muestra no reduce peso sola |
| lots | lot_code R; product_id R; operational_status R; created_quantity C | Cantidad disponible es proyección de ledger, no campo libre editable |
| lot_inputs/origin_edges | destination_id R; source_type/id R; source_quantity R; unit R; event_id R | DAG; tenant y unidad compatibles |
| process_runs | process_type R; location_id R; status R; started_at C; closed_at C; loss_quantity C; loss_reason C | Al cerrar: inputs = outputs + pérdidas contabilizadas |
| process_inputs/outputs | run_id R; lot_id R; quantity R; unit R | Consumir y materializar una vez; outputs trazan todos los inputs |
| stock_entries | lot_id/location_id R; movement_type R; signed_quantity R; unit R; event_id R; effective_at R; recorded_at R; correction_of O | Ledger append-only; débito y crédito enlazados en traslado |
| reservations | lot_id R; shipment_id R; quantity R; status R; expires_at O | Bloquear exceso de reserva con transacción |
| shipments/items | shipment_code/buyer/destination/status R; lot_id/quantity/unit R por item; **`shipment_items.dd_package_export_id` C** (condición escrita abajo); **`dispatch_at` C** (condición de estado, abajo) | Reservar → liberar → despachar; no debitar dos veces |


### Las dos condiciones del despacho, escritas (D-34.A, 2026-10-16)

Hasta el 2026-10-16 estos dos campos estaban marcados `C` **sin condición escrita**, y la compuerta
`SHIPMENT_DISPATCH` respondía `BLOCKED_PENDING_DECISION`. D-34.A las escribe. Es una **política operativa de
producto**, no la afirmación de que todo movimiento esté jurídicamente sujeto a lo mismo.

**1. Acreditación de diligencia — `shipment_items.dd_package_export_id`**

> **Obligatoria para CADA ítem al despachar.** Debe referenciar un `dd_exports` de tipo **`DD_PACKAGE`** del
> expediente **del lote de ese ítem** y de la **misma organización**, con instantánea **aprobada**, `readiness`
> **`READY`**, **vigente** (sin cambios posteriores) y cuyo contenido **cubra el vínculo concreto** —embarque,
> ítem, lote, reserva y cantidad— que se despacha.

- **Un borrador interno (`INTERNAL_REVIEW`) no la satisface.**
- Un paquete **del lote correcto pero de otro contexto de embarque** tampoco: la instantánea acreditaría otro
  vínculo.
- La columna única `shipments.dd_package_id` **queda retirada**: un embarque lleva N lotes y no hay un único
  paquete que la justifique. **No se mantienen dos fuentes de acreditación.**
- Se escribe al despachar y **no se reemplaza ni se retira**: es la evidencia histórica de qué paquete respaldó
  ese ítem, distinta de su vigencia para una operación futura.
- Garantías: FK de dos columnas (tenant) **más** disparador de correspondencia con el lote y el tipo. Una FK por
  organización **no demuestra correspondencia con el lote**.

**2. Sello del despacho — `shipments.dispatch_at`**

> **Obligatorio al quedar `DISPATCHED` y ausente antes.** Lo sella el **servidor** dentro de la transacción de
> despacho; **ningún DTO lo acepta** del cliente.

Que lo genere el servidor **no impide que sea condicional**: son ejes distintos —quién aporta el valor y cuándo
debe existir—. La condición de estado la impone el `CHECK shipments_dispatch_at_state`, y la del sello completo
—quién y con qué operación— el `CHECK shipments_dispatch_stamp`.

**Vínculo previo (`SHIPMENT_LINK`)**: se satisface **antes** del despacho con un ítem que tenga reserva activa.
No exige que la mercancía haya salido; exigirlo crearía una dependencia circular que ninguna fuente impone
(S1 §44 enumera el contenido del paquete y **no** incluye embarque ni despacho).

**Nada de esto habilita `READY`** ni cambia requisito regulatorio alguno: la conclusión sigue `UNDETERMINED`.
Catálogo KDE **1.7.0**. Contrato: `docs/decisiones/D-34-PROPUESTA.md`.

## Documentos, evidencia, riesgo y DD

| Entidad | Campos mínimos adicionales | Restricciones |
| --- | --- | --- |
| documents | document_type R; owner_type/id R; status R; current_version_id C | Referencia autorizada; visibilidad explícita |
| document_versions | document_id R; object_key/file_name/mime_type/size_bytes/checksum R; issued_at/expires_at O; uploaded_by R; scan_status R | SHA-256; objeto privado; no reemplazar bytes de una versión |
| evidence | evidence_type/claim/source/status R; valid_from/to C; confidence O; reviewer C | No inferir veracidad del checksum |
| evidence_sources/links | evidence_id R; source_version_id C; entity_type/id R; relationship_type R | `SUPPORTS/CONTRADICTS/BASED_ON`; misma organización o grant probado |
| rule_sets/rules | version R; effective_from R; source_reference R; approval_status R; condition/action/explanation R | Reglas jurídicas no aprobadas no activan conclusiones |
| risk_assessments | subject_type/id R; severity R; workflow_status R; score O; rule_set_version R; input_snapshot_hash R; evaluated_at R; legal_conclusion R | Score null si inputs insuficientes; snapshot inmutable |
| risk_factors | assessment_id R; category/code/value R; weight/score O; explanation R; evidence_required R | Mantener discrepancias y motivos, no solo un total |
| mitigation_actions | assessment_id R; action_type/description/assignee/due_date/status R; evidence_id C; verified_by/at C | Responsable con acceso; separación de ejecución y revisión |
| legal_requirements | jurisdiction/topic R; applicability_rule R; required_evidence R; authoritative_source/version R; approved_by C | Validación legal previa a activación |
| dd_cases | reference/operator/status R; subject_scope R; started_at R; reviewed_by/at C | Expediente independiente de envío oficial |
| dd_packages/items | case_id R; snapshot_version/hash R; object_key R; generated_at/by R; manifest R; referenced_version R por item | `READY` solo para snapshot validado; descarga auditada |
| dds_submissions | package_id R; environment R; official_reference C; submission_status R; receipt_key C; submitted_by/at C | Sin referencia real, no marcar presentación aceptada |

## Soporte transversal

| Entidad | Campos mínimos | Regla |
| --- | --- | --- |
| traceability_events | event_id/org/type/schema_version/actor/occurred_at/recorded_at/aggregate_id/version/payload | Append-only, unique aggregate version |
| audit_logs | org/actor/action/entity/time/request_id/result; before/after C | Redactar PII/secretos, no guardar tokens |
| outbox/jobs | event_id/org/type/payload/status/attempts/next_attempt_at | Reintento e idempotencia; DLQ tras política agotada |
| sync_operations | org/device/operation_id/payload_hash/base_version/status/result | Clave única tenant/operation_id; resultado reutilizable |
| import_batches/rows | org/file_hash/mapping/status/row_errors/imported_refs | Preview no crea entidades; commit reproducible |
| import_batches / import_rows | 0030–0032, 0034, 0036 | P0-026. Lote: plantilla `PRODUCTORES_V1`, estado UPLOADED → MAPPED → COMMITTED / DISCARDED (terminales, trigger), SHA-256/tamaño/nombre del archivo (el original no se guarda), encabezados, mapeo, `plan_hash`, resumen, `operation_id` y `commit_operation_id` idempotentes. Filas: celdas cifradas (AAD organización/lote/fila; se eliminan al descartar), resultado CREATED/UPDATED/UNCHANGED, productor, producto (0031), parcela (0032), entrega (0034) o lote (0036, varias filas = varias entradas); FK compuestas mismo tenant, como mucho una y nombres de campos cambiados. Errores por fila: calculados en la vista previa, no persistidos |
| share_grants | owner_org/recipient/scope/fields/expires_at/revoked_at | Revocación aplica a nuevas consultas y URLs temporales |
| tasks/notifications | org/source/assignee/due_date/status/action_reference | Si derivable del dominio, proyectar en vez de duplicar estado |

## Calidad y privacidad

Completitud, validez, consistencia, unicidad y vigencia son resultados separados con denominador y regla. Evitar un campo de «confidence» global sin método. Campos personales y geometrías exactas exigen clasificación de acceso; una exportación debe aplicar la misma política que la consulta.

## Esquema implementado (contraste con el repositorio, 2026-10-10)

| Tabla real | Migración | Diferencias con la propuesta |
| --- | --- | --- |
| users, organizations, memberships, roles, role_assignments, audit_logs | 0001, 0002 | `users.platform_role` para SUPER_ADMIN; `token_version`; `email_verified_at` (nunca lo marca una invitación); `role_assignments` con FK compuesta por tenant |
| invitations | 0002 | Solo hash del token; una pendiente por correo y organización |
| organization_types | 0003 | Catálogo provisional D-18 |
| domain_events, event_deliveries, consumer_receipts | 0004 | Envolvente del doc 08; outbox por consumidor |
| producers | 0005, 0006 | Campos de S1 §12. **Identidad cifrada**: `document_type_enc`, `document_number_enc`, `phone_enc`, `address_enc` (AES-256-GCM, AAD por registro) + `document_number_bidx` (índice ciego). Sin texto plano en tabla ni historial. `assigned_membership_id` con FK compuesta. Baja lógica `deleted_*` |
| producer_versions | 0005, 0006 | Historial append-only; identidad cifrada por versión |
| producer_status_counts, organization_event_stats | 0004, 0005 | Proyecciones alimentadas por eventos |
| producer_match_reviews | 0007 | Revisión asistida de duplicados (P0-005) |
| plots, plot_versions, plot_history | 0008 | P0-006: geometría PostGIS 4326 inmutable por versión; superficie declarada y calculada separadas |
| location_samples (equivale a `gps_samples`) | 0009 | P0-007: coordenadas originales, fuente `BROWSER_GEOLOCATION`, `captured_at` del dispositivo, `received_at` del servidor, precisión en m o NULL explícito, `operation_id` idempotente. Sin `device_reference` (no hay contrato de dispositivo). Append-only |
| polygon_drafts | 0010 | P0-008: borrador de polígono **en el servidor** (no offline). Un solo OPEN por parcela; OPEN → CONFIRMED (`confirmed_version_id`, FK compuesta) o CANCELLED; `row_version` para concurrencia entre pestañas |
| draft_vertices | 0010 | P0-008: cada muestra adquirida (lon/lat originales, `BROWSER_GEOLOCATION`, `captured_at`, `received_at`, precisión o NULL, `operation_id` idempotente, `acquisition_seq` = orden explícito). Append-only |
| geometry_imports | 0011 | P0-009: importación GeoJSON. Original en S3 privado (`object_key`), `sha256` calculado en el servidor, tamaño, nombre, perfil, geometría analizada (PostGIS, clasificada como geometría exacta), validez técnica y motivo sin coordenadas, `analysis` (advertencias y conteos, sin coordenadas), `operation_id` (análisis) y `confirm_operation_id` (confirmación) idempotentes. ANALYZED → CONFIRMED / DISCARDED; original y análisis inmutables (trigger) |
| plot_versions.source_import_id | 0011 | Referencia (FK compuesta, mismo tenant, única) al original importado; solo con `survey_method = FILE_IMPORT`. Versiones anteriores sin cambios (NULL) |
| gis_evaluations | 0012 | P0-010: evaluación técnica inmutable de una versión (regla, versión, parámetros, estado, comprobaciones, calidad de captura, perfil de destino no evaluado, `error_location` protegida, huella del conjunto comparado, actor, fecha, `operation_id`). Append-only |
| gis_evaluation_comparisons | 0012 | Versiones de otras parcelas relacionadas (EQUAL/OVERLAP/TOUCH, mismo hash sí/no, superficie compartida m²). Append-only |
| object_deletions | 0012 | Tareas de borrado del almacenamiento privado (DISCARDED u ORPHAN): estado, intentos, código de error controlado, próxima ejecución y lease |
| product_states | 0014 | Catálogo de SISTEMA de estados/presentaciones del cacao definidos en las fuentes (S1 §17, doc 06): CACAO_BABA, CACAO_FERMENTADO, CACAO_SECO, CACAO_CLASIFICADO. Solo lectura (cambia con migración) |
| measurement_units | 0014 | Catálogo de SISTEMA de unidades con dimensión. Las fuentes solo definen KG (masa). Sin conversiones (D-32). Solo lectura |
| products | 0014 | P0-011: catálogo por ORGANIZACIÓN. `code` único por organización (mayúsculas, 2–40); `name`; `product_state` y `unit` (FK a catálogos de sistema); `scientific_name`/`variety` opcionales; ACTIVE/INACTIVE con motivo; `row_version`. Código, estado y unidad **inmutables** (trigger); sin borrado |
| product_versions | 0014 | Historial append-only por versión (alta, edición, desactivación, activación) con instantánea y motivo |
| gis_evaluations.comparison_scope / scope_membership_id | 0013 | Alcance efectivo de comparación de cada evaluación (ORGANIZATION o EVALUATOR_ASSIGNED) |
| evidence_claim_types | 0019 | P0-019: catálogo de sistema con afirmaciones de docs/12 cuya entidad existe: PLOT_FIELD_CAPTURED (parcela), LAND_TENURE_DOCUMENTED (productor/parcela), con su limitación |
| evidence | 0019 | Afirmación sobre una entidad existente del mismo tenant (trigger): tipo, entidad, estado DRAFT/SUBMITTED/VERIFIED/REJECTED/REVOKED (vencida = `valid_to` pasado), vigencia, `row_version`, `operation_id`. Afirmación y entidad inmutables; sin borrado |
| evidence_sources | 0019 | Soporte = versión EXACTA de documento (FK compuesta) con relación SUPPORTS/CONTRADICTS/BASED_ON, nota, autor, fecha, `operation_id`. Append-only |
| evidence_source_withdrawals | 0019 | Retirada de un soporte con motivo y responsable (historia conservada). Append-only |
| evidence_decisions | 0019 | Envío, verificación, rechazo, revocación y reapertura con motivo, responsable, estado anterior/nuevo, reconocimiento de contradicciones e instantánea de soportes. Append-only |
| document_types | 0018 | P0-018: catálogo de sistema con los tipos que nombran las fuentes: LAND_TENURE (tenencia; PERSONAL_DATA) y DELIVERY_SUPPORT (soporte de entrega; OPERATIONAL); titulares admitidos |
| documents | 0018 | Documento de la organización: tipo, titular (producer/plot del mismo tenant, trigger; `delivery` reservado para P0-012), título, versión vigente, `row_version`. Tipo y titular inmutables; sin borrado |
| document_versions | 0018 | Versión inmutable: objeto privado en S3, nombre, MIME real (PDF/JPEG/PNG), tamaño, SHA-256 del servidor, emisor, emisión, vencimiento, versión previa, `operation_id`. Append-only |
| document_version_scans | 0018 | Resultados del análisis antimalware por versión (CLEAN/INFECTED/FAILED, motor, firma, código de error). Append-only |
| document_version_reviews | 0018 | Revisión humana por versión (ACCEPTED/REJECTED, motivo, revisor). No se hereda. Append-only |
| document_links | 0018 | Vinculación «adjunto a» con producer/plot del mismo tenant (trigger). Las relaciones probatorias son de P0-019. Append-only |
| domain_events.correction_of_event_id / correction_reason | 0017 | P0-015: corrección de un evento EXISTENTE de la misma organización y agregado (FK compuesta + trigger), posterior al corregido, motivo obligatorio (3–500), sin autorreferencia; un evento se corrige una vez (índice único) → cadena lineal |
| event_deliveries.lease_token / manual_requeues | 0017 | Fencing del arrendamiento: solo el reclamo con el token vigente confirma o registra el fallo; reprocesos manuales contados. `last_error` guarda solo códigos |
| event_delivery_attempts | 0017 | Historial append-only de intentos por entrega: DONE, DUPLICATE, FAILED, DEAD, LEASE_LOST, MANUAL_REQUEUE (actor y motivo), código de error |
| consumer_receipts | 0004, 0017 | Recibos de consumo idempotente; desde 0017 no admiten UPDATE ni DELETE |
| kde_catalog_releases | 0016 | P0-014: versiones publicadas del catálogo de datos mínimos (auditoría de cada cambio). Append-only |
| kde_definitions | 0016 | Dato mínimo `code@version` ligado a la versión EXACTA de un hito (`cte_definition_id`): entidad y campo del contrato, tipo, unidad/dimensión (en `validation`), obligatoriedad REQUIRED/CONDITIONAL/OPTIONAL, condición y validación en un **esquema cerrado** (sin código ejecutable), roles responsables, fuente y diferencia con el modelo. Inmutable |
| kde_definition_retirements | 0016 | Retirada o sustitución de un KDE con motivo; sigue resoluble para consultar historia. Append-only |
| cte_catalog_releases | 0015 | P0-013: versiones publicadas del catálogo de sistema de hitos (versión, fuente, notas, fecha). Registro de auditoría de cada cambio permitido. Append-only |
| cte_definitions | 0015 | Hito crítico: `code` + `version` (referencia estable `CODE@n`), nombre, descripción, etapa (ORIGIN/INTERNAL/OUTBOUND), fuente, versión de catálogo, `supersedes_id`. Inmutable |
| cte_definition_retirements | 0015 | Retirada o sustitución de una definición en una versión del catálogo, con motivo; la definición sigue resoluble. Append-only |
| cte_operation_links | 0015 | Operación que genera el hito y evento emitido; `integration_status` INTEGRATED solo si existen; si no, PENDING con historia prevista. Append-only |
| draft_vertex_exclusions | 0010 | P0-008: «deshacer» excluye un vértice sin borrar ni alterar la muestra. Composición vigente = vértices no excluidos por `acquisition_seq`. Append-only |

Clasificación de la identidad del productor: documento, teléfono y dirección se cifran y solo se devuelven con `producer:read_identity`. Nombre, razón social y ubicación administrativa quedan en claro porque la operación los necesita para buscar e identificar; su exposición se controla por permisos de lectura.

| Tabla (P0-012) | Migración | Notas |
| --- | --- | --- |
| locations | 0021 | Centro/bodega/otro con código único por organización; sin coordenadas; desactivar conserva historia |
| deliveries | 0021 | Borrador → registrada (inmutable; trigger). Periodo de cosecha: precisión declarada (`DAY`/`MONTH`/`UNKNOWN`) + límites derivados marcados como derivados (CHECK de forma). Cantidad `numeric(20,6)` KG. Código `ENT-AAAA-NNNNN` por organización |
| delivery_origins | 0021 | Parcelas del mismo productor (trigger); cantidad por origen opcional (no se inventa); solo editable en borrador |
| delivery_supports / delivery_support_withdrawals | 0021 | Versión exacta de documento del mismo tenant; varios; retirar = fila aparte; append-only |
| delivery_corrections | 0021 | Instantánea de los campos corregibles con motivo y eventos enlazados; el original queda en `deliveries` |
| receptions | 0021 | Recepción física (receptor = membresía de la sesión, centro, momento con zona, cantidad del pesaje). Append-only; parciales permitidas |
| weighings | 0021 | Pesaje (método, valor KG, fecha, responsable); el corregido enlaza el anterior (`corrects_weighing_id`) |
| reception_adjustments | 0021 | Corrección de peso con cantidad anterior/nueva, motivo y eventos; no reescribe la recepción |
| quality_samples / quality_results / quality_measurements | 0021 | Muestra (durante la recepción o después del pesaje), resultado con decisión PENDING/RELEASED/REJECTED (liberar exige versión de límites; rechazar, motivo), mediciones con unidad explícita |
| gate_evaluations | 0021 | Resultado de la compuerta de cada transición (códigos, sin valores); append-only |
| kde_transition_gates | 0021 | Catálogo de sistema de compuertas por transición, versionado |

| Tabla (P0-016) | Migración | Notas |
| --- | --- | --- |
| lots | 0023 | Código LOT-AAAA-NNNNN; producto; origen COMPLETE/INCOMPLETE; fuente RECEPTIONS o PROCESS_OUTPUT (cerrado a entradas); solo cambian estado y versión |
| lot_inputs / lot_input_releases | 0023 | Asignación recepción → lote con pesaje vigente y versión usados; trigger: suma activa ≤ peso vigente y sin mezclar origen; liberar solo sin reservas ni consumo |
| process_runs | 0023 | FERMENTATION/DRYING; DRAFT → RUNNING → CLOSED · CANCELLED (trigger de transiciones); pérdida explícita; humedad con unidad no definida |
| process_inputs | 0023 | Reserva (RUNNING) → consumo (CLOSED) → liberada (CANCELLED); trigger: no supera la cantidad del lote |
| process_outputs / lot_edges | 0023 | Salidas como lotes nuevos; aristas padre → hijo con control de ciclos en toda inserción; append-only |
| reception_adjustments (trigger nuevo) | 0023 | Rechaza corregir una recepción con asignaciones activas (D-39.2) |

| Tabla (P0-017) | Migración | Notas |
| --- | --- | --- |
| stock_movements | 0024 | Cabecera: tipo, fuente original (`source_type`/`source_id`, único por tipo → incorporación idempotente), `operation_id`, actor, motivo (obligatorio en merma y ajuste), pérdida de proceso; append-only |
| stock_entries | 0024 | Líneas firmadas por tenedor (recepción **o** lote), ubicación (o pendiente = NULL) y cubeta PHYSICAL/RESERVED; trigger diferido: físico ≥ 0, reservado ≥ 0, reservado ≤ físico; append-only. Equivale a `stock_entries` de docs/06 extendido con la recepción como tenedor |
| process_inputs.location_id | 0024 | Centro donde se reservó la entrada |
| Triggers de cantidad de P0-016 | 0024 | Reemplazados por el ledger (una sola fuente de disponibilidad) |
| plot_versions.geometry_origin_version_id | 0033 | Versión que COPIA la geometría (superficie declarada actualizada; adopción para desarrollo local 2026-10-12): apunta a la versión capturada de origen (misma parcela, mismo hash, comprobado por trigger). No es una captura nueva. NULL en capturas y en versiones solo declaradas |
| import_references | 0035, 0036 | Referencia de importación de una fila sin código asignado (no es dato de negocio): única por organización y plantilla (`ENTREGAS_V1`, `LOTES_V1`), exactamente una entidad (entrega o lote), lote y fila de origen, `origin` FILE_REFERENCE o LEGACY_CONTENT_FINGERPRINT (borradores importados antes de 0035). Append-only |
| platform_tariffs | 0056 | Tarifa declarada de uso de la plataforma: USD por organización y mes, versión, vigencia, sintética/acordada, origen. Append-only; sin tarifas precargadas |
| platform_cost_estimates | 0056 | Estimación por período explícito: líneas por mes, consumo observado, conceptos sin valorar, `inputs_hash` para reproducirla; total nulo si no hay tarifa. Append-only |
| identity_links | 0056 | Identidad federada vinculada a una cuenta por emisor+sujeto (índice único mientras esté activa); el correo declarado es informativo |
| sso_flows | 0056 | Inicio de sesión federado en curso (hash del state, nonce, verificador PKCE, destino); de un solo uso y con vencimiento |
| revoked_sessions | 0056 | Sesiones cerradas por `jti`; el resto de sesiones de la cuenta no se tocan |
| producers.self_membership_id | 0057 | A-01. Membresía (rol Productor) vinculada de forma explícita a este productor; única por membresía (`producers_self_membership_uq`) y de la misma organización (disparador `producers_self_membership_same_org`). Nulo = sin vínculo = sin acceso propio. Cada cambio queda en `producer_versions` (`LINK_SELF`) y en la auditoría |
| document_types.ENVIRONMENTAL_SUPPORT / LABOR_SUPPORT / THIRD_PARTY_RIGHTS_SUPPORT | 0066 | AJ-03. Tipos que **solo clasifican** soportes ambiental (OPERATIONAL), laboral y de derechos de terceros (PERSONAL_DATA); titulares parcela/productor; no son obligatorios ni evidencia aprobada |
| document_types.FIELD_EVIDENCE | 0057 | A-01. Tipo de documento «Evidencia de recorrido de campo» (fotos, croquis, actas) adjuntable a la parcela; subir no aprueba |
| org_partnerships | 0058 | A-03. Vínculo bilateral entre dos organizaciones (PENDING/ACTIVE/REVOKED); código solo como huella; un ACTIVO por pareja sin importar quién propuso |
| custody_transfers | 0058 | A-03. Traspaso de custodia: organizaciones, lote y centro de la emisora, producto y centro de la receptora, cantidad y unidad (KG), instantánea de origen (jsonb) con huella, estado y cierre. No cambian organizaciones, lote, cantidad, unidad ni proyección |
| custody_transfer_steps | 0058 | A-03. Pasos **append-only** (oferta, aceptación, salida, recepción, sobrante, rechazos, faltante, pérdida confirmada…); de aquí se deriva el tránsito; un disparador diferido impide tránsito negativo |
| custody_discrepancies | 0058 | A-03. Faltante o sobrante con cantidad, motivo y estado (OPEN/RESOLVED); no se borra; una resuelta no cambia |
| custody_lot_links | 0058 | A-03. Linaje entre lote de la emisora y lote de la receptora, con ambos `organization_id`; append-only |
| lots.source = CUSTODY_TRANSFER | 0058 | A-03. Lote nacido de un traspaso: sin recepciones ni proceso, cerrado a entradas y siempre con origen INCOMPLETO |
| stock_movements.movement_type | 0058 | A-03. Nuevos tipos `CUSTODY_RESERVE`, `CUSTODY_RESERVE_RELEASE`, `CUSTODY_OUT`, `CUSTODY_IN`, `CUSTODY_RETURN` (el origen de CUSTODY_IN y CUSTODY_RETURN es el paso, porque el ledger admite un movimiento por tipo y origen) |

## Semántica de `organizations.country` (comprobada el 2026-10-21 contra su captura y su uso)
**Es ambiguo y así se declara.** No significa «país de establecimiento jurídico», «país de producción» ni «criterio de aplicabilidad». Lo que consta en el código:
| Aspecto | Hecho comprobado |
| --- | --- |
| **Captura** | Lo fija **solo** quien crea la organización (`POST /organizations`, plataforma/`SUPER_ADMIN`). El campo del formulario se rotula **«País (código ISO de 2 letras)»**, **sin definir a qué país se refiere** y con `EC` **precargado** (`apps/web/app/organizaciones/page.tsx`). Validación: dos letras mayúsculas (`^[A-Z]{2}$`), **no** se comprueba contra el catálogo ISO 3166 |
| **Cambio** | **No se puede modificar**: no figura en el DTO de actualización (`UpdateOrganizationDto`). Si se capturó mal, no hay forma de corregirlo con la API actual |
| **Uso** | Solo se **devuelve** en las respuestas y se **muestra** («tipo · país · versión») en la ficha de la organización. **Ninguna regla, perfil, evaluación, exportación ni compuerta lo lee.** En los datos DEMO sintéticos se asigna `DE` al tipo `IMPORTER` y `EC` al resto |
| **No relacionado** | `buyers.country` (país del comprador **declarado**) y `shipments.destination_country` (destino **declarado**) son campos distintos; `plots` guarda provincia/cantón/parroquia, no país; `ProducerCountry` no se emite (reportes) por no existir país de producción |
**Consecuencias:** (a) **no se usa automáticamente** como país de producción, de establecimiento ni como criterio de aplicabilidad (hecho F1 de `docs/decisiones/D-05B-FICHA-REVISION-2026-10-21.md`); (b) **reutilizar** este campo para un uso regulatorio exige antes **definir su significado** y permitir corregirlo (decisión pendiente, parte de Q1/Q3); (c) no se crea un campo nuevo mientras el existente pueda reutilizarse con un significado definido.

## `legal_profile_reviews` y `legal_profile_review_supports` (P1-005, migración 0062; 2026-10-22)

| Campo | Significado | Observaciones |
| --- | --- | --- |
| `reviewer_name` | **Persona revisora declarada** | Declaración al registrar; puede no tener cuenta. Filas anteriores a `0062` (ninguna real): `No declarado (anterior a 0062)` |
| `reviewer_capacity` | Cargo o capacidad declarada | Existente desde `0049` |
| `reviewed_on` | Fecha declarada de la revisión | No futura; distinta de `decided_at` (cuándo se registró) |
| `reviewer_id` | **Usuario que registra el acto** (SUPER_ADMIN) **desde `0062`** | Antes de `0062` su comentario lo describía como «responsable identificado»; **no existía ningún registro real** (comprobado en el entorno operativo y sus respaldos), y un eventual dato anterior conserva su sentido histórico, reconocible por el relleno de `reviewer_name` |
| `basis` | Fundamento | 10–2000 caracteres |
| `decision` | `REVIEWED`, `OBJECTED`, `WITHDRAWN` | La **vigente** es la última por `decided_at`; las anteriores se conservan |
| `legal_profile_review_supports` | Soportes de una revisión | `kind` = `PROFILE_SOURCE` (FK compuesta a una fuente de la **misma versión**) o `CITATION` (cita, `url` https y `file_sha256` opcionales). Una revisión `REVIEWED` exige ≥1 soporte (restricción diferida). Append-only |

## Configuración de reglas de geolocalización (migración 0063; 2026-10-22)

`geo_requirement_configs` (versión, perfil técnico `EUDR_GEO_V1` y su versión, alcance, autor/origen) · `geo_requirement_config_sources` (cita, url https, huella) · `geo_requirement_config_rules` (`kind`: `GEO_TECH_PROFILE`/`PRODUCTION_PERIOD`/`PRODUCTION_COUNTRY`; `status`: `ACTIVE` solo para el primero, `CANDIDATE` con `pending_questions`) · `geo_requirement_config_reviews` (+ `_review_supports`: persona revisora declarada, `recorded_by` = quien registra, `applicable_organizations` = alcance de aplicabilidad declarado, vacío = ninguna) · `geo_requirement_config_adoptions` (por organización). Todo append-only. La revisión es **de esta configuración**, independiente de `legal_profile_reviews`.
