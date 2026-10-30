# Contratos API de partida

Base: S1 §§50–54. Todas las rutas aquí son propuestas para un proyecto nuevo, no endpoints probados. Conservar versión/prefijos reales y documentar equivalencia. TECH-001 debe producir OpenAPI JSON/YAML validada con schemas, seguridad, responses y operation IDs; este Markdown no sustituye ese artefacto ejecutable.

## Convenciones

REST `/api/v1`; autenticación del repositorio; tenant derivado de membresía y contexto validado. Listas paginadas con límites y orden estable; filtros whitelist. ISO 8601 UTC; decimales string/unidad. Mutaciones críticas requieren clave idempotente. Update usa `expected_version` o ETag documentado; rechazo 409/412 consistente según convención elegida. No enviar relaciones cruzadas sin validar.

| Grupo | Rutas propuestas | Permiso conceptual |
| --- | --- | --- |
| Identidad | `GET /me`, `GET /me/permissions`, `POST /organizations`, `POST /organizations/{id}/memberships` | organization/membership |
| Productores | `POST /producers`, `GET /producers`, `GET /producers/{id}`, `PATCH /producers/{id}` | producer:create/read/update_draft |
| Parcelas | `POST /plots`, `GET /plots/{id}`, `POST /plots/{id}/geometry-versions`, `POST /plots/{id}/geometry/validate`, `GET /plots/{id}/geojson` | plot:create/read/correct |
| Entregas/recepción | `POST /deliveries`, `GET /deliveries/{id}`, `POST /receptions`, `POST /receptions/{id}/confirm` | delivery:create/read; reception:confirm |
| Calidad | `POST /quality-samples`, `POST /quality-samples/{id}/results` | quality:analyze |
| Lotes/proceso | `GET /lots/{id}`, `POST /lots`, `POST /processing-runs`, `POST /processing-runs/{id}/close` | lot/process |
| Inventario | `GET /inventory`, `POST /stock-movements`, `POST /stock-adjustments` | stock:read/adjust |
| Grafo | `GET /traceability/{entity_type}/{id}?direction=both` | permiso de recurso raíz y cada nodo |
| Documentos | `POST /documents/uploads`, `POST /documents/{id}/finalize`, `GET /documents/{id}/download` | upload/read/download |
| Evidencia | `POST /evidence`, `POST /evidence/{id}/links`, `POST /evidence/{id}/verify` | evidence:link/verify |
| Riesgo | `POST /risk/assessments`, `GET /risk/assessments/{id}`, `POST /risk/assessments/{id}/recalculate` | risk:assess/read/recalculate |
| Mitigación | `POST /mitigations`, `POST /mitigations/{id}/evidence`, `POST /mitigations/{id}/verify`, `POST /mitigations/{id}/reject` | mitigation según acción |
| Riesgo (implementado, P0-020 + D-07) | `GET /risk/lots`, `GET /risk/lots/{lotId}`, `POST /risk/lots/{lotId}/evaluations`, `GET /risk/evaluations/{id}`, `POST /risk/evaluations/{id}/reviews`, `GET\|POST /risk/rule-sets/adoptions` | `risk:read` / `risk:evaluate` / `risk:review`; adoptar exige `risk:approve_rules` (hoy solo `ORG_ADMIN`). La evaluación devuelve `rules` con **tres hechos distintos**: `global_publication` (publicación global), `adopted_by_organization` (adopción de esa organización, D-07.1) y `regulatory_profile` (perfil jurídico, D-07.5: **hoy `null` en todas las versiones**). `risk_result` lleva `severity` **siempre junto a `severity_coverage`**, y `conclusion` sigue `UNDETERMINED` por `CHECK` |
| Diligencia | `POST /dd-cases`, `GET /dd-cases/{id}/readiness`, `POST /dd-cases/{id}/approve`, `POST /dd-cases/{id}/packages` | dd:read/approve_package/export_package |
| Diligencia (implementado P0-022) | `GET/POST /dd-cases`, `GET /dd-cases/{id}`, `POST /dd-cases/{id}/snapshots`, `GET /dd-snapshots/{id}`, `POST /dd-snapshots/{id}/reviews` (START_REVIEW/RETURN/APPROVE), `POST /dd-snapshots/{id}/exports` (INTERNAL_REVIEW/DD_PACKAGE), `GET /dd-exports/{id}/download` | dd:read/manage/approve_package/export_package |
| Embarque | `POST /shipments`, `POST /shipments/{id}/reserve`, `GET /shipments/{id}/preflight`, `POST /shipments/{id}/dispatch` | shipment según acción |
| Embarques (implementado, P0-029) | `GET\|POST /buyers`; `GET /shipments/options`; `GET\|POST /shipments`; `GET /shipments/{id}`; `POST /shipments/{id}/items`, `/items/{itemId}/remove`, `/reserve`, `/reservations/{rid}/release`, `/dispatch`, `/cancel`; `GET /shipments/{id}/preflight` | `shipment:read` / `shipment:manage` / `stock:reserve` / `shipment:dispatch`; despacho bloqueado por la compuerta SHIPMENT_DISPATCH (D-34) |
| Reportes — indicadores (implementado, P0-030) | `GET /reports/indicators?from=&to=` → metadatos (catálogo `2026-10-15.1`, período y a qué se aplica, `time_basis` con límites inclusivos/fecha civil/`as_of` en UTC, alcance, privacidad, interpretación, `status_legend` y `coverage` de cobertura histórica) + `indicators[]` con `code`, `kind` (STATE/ACTIVITY/BALANCE_AT), `unit`, `status` (**OK / NO_DENOMINATOR / UNKNOWN / CRITERION_UNDEFINED / RESTRICTED**), `value`, `numerator`, `denominator`, `observed` (conteos observables aunque el indicador no lo sea), `date_basis`, `definition`, `reason` y `catalog` (`S1_60` o `TERRA_LINK` para las **extensiones declaradas**, hoy solo `risk_critical`); `GET /reports/indicators/export` (CSV `TL_REPORT_CSV 0.1`, con `X-Content-Sha256` y registro en auditoría) | `report:read`; exportar exige `report:export`, revalidado al descargar. **Cada indicador exige además el permiso de su dominio**: sin él sale `RESTRICTED`, sin valor ni conteo |
| Reportes por entidad y GeoJSON (implementado, P0-030; S1 §97) | `GET /reports/entities` (catálogo con `requires`, `available` y `missing` por reporte), `GET /reports/entities/{kind}` con `kind` = `producers｜plots｜lots｜risk｜traceability｜dd` → `columns[]`, `rows[]`, `totals[]`, `notes[]`, `total_rows`, `returned_rows`, `truncated` (máx. 500 filas; los totales cubren el conjunto completo), `GET /reports/entities/{kind}/export` (CSV con totales en la cabecera) y `GET /reports/entities/plots/geojson` (`FeatureCollection` RFC 7946 con miembro ajeno `terra_link`: conteos, omitidos, `regulatory_profile` PENDING/D-05 y cobertura) | `report:read` + **todos** los permisos del dominio del reporte (faltar uno deniega el reporte entero, no entrega una versión parcial); exportar exige `report:export`; el GeoJSON exige además `plot:read` y `plot:read_geometry` |
| Satélite (implementado, P0-028; S1 §52/§54) | Bajo `/api/v1/organizations/{orgId}`: `GET satellite/providers` (registro con selección, licencia, coste, cobertura, límites y **qué datos saldrían del equipo**); `GET plots/{plotId}/satellite` (estado del análisis, trabajos con procedencia, `can_request` y límites); `POST plots/{plotId}/satellite/analyses` (`operation_id`, `operation` = `FOREST_COVER｜DEFORESTATION_ALERTS｜HISTORICAL_ANALYSIS`, `period_start?`, `period_end?`, `plot_version_id?`) → **aceptación**, nunca resultado; `GET satellite/analyses/{jobId}`; `POST satellite/analyses/{jobId}/cancel` | `satellite:read`; encargar exige `satellite:request` **y** `plot:read_geometry` (saca la geometría exacta del equipo) y el alcance de la parcela. Sin proveedor seleccionado responde `409 SATELLITE_PROVIDER_NOT_SELECTED` (D-09); con un adaptador **solo de desarrollo** o con las llamadas reales deshabilitadas, `409 SATELLITE_REQUESTS_NOT_AUTHORIZED` con el motivo exacto. `GET satellite/providers` distingue `SELECTED`, `SELECTED_FOR_DEVELOPMENT` y `NOT_SELECTED`, e informa `live_calls_enabled`. **Entre organizaciones (2026-10-30, `decisiones/P0-028-SATELITE-ENTRE-ORGANIZACIONES.md`)**: propietaria `POST|GET plots/{plotId}/satellite/authorizations` y `POST satellite/authorizations/{authId}/revoke` (`satellite:authorize`); destinataria `GET satellite/authorized-plots[/{authId}]`, `POST satellite/authorized-plots/{authId}/analyses`, `GET|POST satellite/authorized-analyses/{jobId}[/cancel|/original|/indicators.csv]`; ambas `GET satellite/analyses/{jobId}/indicators.csv` (sin geometría). Ajeno = 404; revocada/vencida = 403 `SATELLITE_AUTHORIZATION_REVOKED|EXPIRED`; la descarga original exige `can_download` otorgado por la propietaria y `satellite:request`; el worker revalida la autorización antes de enviar la geometría |
| Importación | `POST /imports`, `POST /imports/{id}/mapping`, `GET /imports/{id}/preview`, `POST /imports/{id}/commit` | permiso de importación y de cada entidad |
| Mi trabajo (implementado, P0-027 + **P1-003**) | `GET /api/v1/organizations/{orgId}/my-work?queue=&assignee=&status=` → `queues{mine,supervision}`, `filters`, `rows[]` (`code`, `queue`, `entity`, `reason`, `impact`, `assignee`, `due_date`, `due_state`, `priority`, `priority_rule`, `status`, `evidence_required`, `action`) y `tasks[]` agrupadas (`count`, `items[]`, `list_href`) | membresía activa; cada tarea exige el permiso de su acción y cuenta solo dentro de su alcance. Los filtros se aplican **en el backend** y **no amplían** el alcance; `queue`/`assignee` inválidos → 400. **Solo lectura**: no hay forma de completar una tarea desde aquí |
| Puesta en marcha y madurez (implementado, **P1-004**) | `GET /api/v1/organizations/{orgId}/onboarding` → `criterion` (D-49, versión y estado), `level{reached,name,basis}`, `levels[]` con sus `signals[]` (`state`, `evidence{count,scope,as_of,note}`, `source`), `steps[]` del asistente, `blockers{missing_data,not_implemented,undecided}`, `freshness` y `disclaimer` | membresía activa (`organization:read`). El **estado** de cada señal es de la organización; el **número** se acota al alcance del lector y se omite sin permiso. **Solo lectura**: no hay forma de marcar un paso. La madurez **no levanta compuertas** ni concede acceso |
| Intercambio con registro externo (implementado, **P1-006**) | `GET /exchange/format` · `GET|POST /exchange/agreements` · `POST /exchange/agreements/{id}/decisions` · `POST /exchange/export` (xlsx) · `POST /exchange/reconcile` (multipart) · `GET /exchange/acts[/{id}]` · `POST /exchange/differences/{id}/decisions` | `exchange:manage` registra y retira; `exchange:use` exporta, concilia y resuelve. **`VERIFY` exige el permiso de PLATAFORMA `exchange:verify`**: una organización no comprueba su propio canal (RF-37). Sin acuerdo **verificado y vigente**, exportar y conciliar responden **409 `EXCHANGE_CHANNEL_NOT_VERIFIED`**. **No hay llamada de red a ningún registro externo**: el intercambio es por archivo. **Conciliar no escribe** en datos operativos |
| Simulación de preparación (implementado, **P1-009**) | `GET /api/v1/organizations/{orgId}/simulations/lots/{lotId}?assume=COD1,COD2` → `inputs` (lote, recuentos, versión de reglas, evaluación de riesgo, perfil jurídico y fecha), `real` (requisitos, resumen con porcentaje, comprobaciones de despacho y causas), `scenario` (supuestos aplicados y rechazados) y `projected` (`still_blocked` con su clase) | `dd:read`. **Solo lectura**: no existe `POST` ni `PATCH` (404) y no se guarda ningún escenario. Usa `evaluateRequirements()` y las comprobaciones de lote del preflight; lo que depende de un embarque se declara **no simulado**. **El porcentaje no decide**: con cualquier causa abierta el veredicto es `NO EXPORTABLE`. **No habilita READY ni el despacho.** Las referencias con códigos de parcelas y entregas solo viajan a quien puede leer esos recursos |
| Presupuesto de preparación (implementado, **P1-010**) | `GET|POST /cost/parameters` · `POST /cost/estimates/preview` · `POST|GET /cost/estimates` · `GET /cost/estimates/{id}[/download]` | `cost:manage` registra versiones de parámetro; `cost:read` consulta y estima. Importes **declarados por la organización** (D-51), **USD**, con vigencia y versión; **nada precargado**. Cantidades **declaradas y marcadas como estimadas**; lo observado viaja **aparte, con su fecha**. Un concepto sin importe o sin cantidad **no suma cero**: el total se marca **incompleto**. Denominadores por **productor distinto del grafo de origen** y por **tonelada del peso físico del ledger**; sin denominador válido, **`NO_CALCULABLE`**. Las dos tablas son **append-only**: cambiar una tarifa **no reescribe** una estimación guardada |
| Histórico temporal y alertas (implementado, **P1-011**) | `GET /api/v1/organizations/{orgId}/plots/{plotId}/timeline` → `periods` (por año, con `SIN_REGISTROS` rotulado), `comparable`, `alerts`, `restricted_sections` y `change_log_href`; `GET …/plots/{plotId}/timeline/compare?from=&to=` → `from`/`to`, `changed`, `comparable` y `limitations`; `GET /api/v1/organizations/{orgId}/temporal-alerts` → `alerts` con **problema, impacto, causa (`kind`+`id`) y acción** | `organization:read` más el permiso de cada dominio: sin `satellite:read`, `risk:read` o `evidence:read` esas entradas **no se incluyen y la sección se declara ausente**; `plot:read_assigned` limita a las parcelas asignadas y lo ajeno es **404**. **No hay tabla nueva**: la línea reúne `plot_history` —el mismo registro que publica `GET …/plots/{id}/history`, que sigue intacto—, `plot_versions`, `satellite_jobs`, `evidence` y las evaluaciones de riesgo. **Solo lectura**: no existe `POST`, `PATCH` ni `DELETE` sobre alertas (404) y leerlas no cambia nada. Las tres fechas (`occurred_at`, `recorded_at`, `evaluated_at`) van **separadas** y la ausente se declara en `dates_note`. Comparar una versión consigo misma es **422** |
| Importación (implementado, P0-026) | Bajo `/api/v1/organizations/{orgId}/imports`: `GET templates` (plantillas y si el rol puede usarlas), `GET templates/{producers,products,plots,deliveries,lots}` y `.xlsx` (lotes: con hoja `recepciones_disponibles`), `POST` (multipart `file`, `operation_id`, `template` = `PRODUCTORES_V1` \| `PRODUCTOS_V1` \| `PARCELAS_V1` \| `ENTREGAS_V1` \| `LOTES_V1`), `GET`, `GET {id}`, `POST {id}/mapping`, `GET {id}/preview` (filas con `effects` cuando hay movimientos), `POST {id}/commit` (`operation_id`, `plan_hash`), `POST {id}/discard`, `GET {id}/report` | `import:manage` + permisos y alcance de la entidad (productos `product:manage`; parcelas alta/edición; entregas `delivery:create`/`_assigned`; lotes `lot:create` y alcance de entregas) revalidados al confirmar |
| Superficie declarada (implementado) | `POST /api/v1/organizations/{orgId}/plots/{id}/declared-area` (`expected_version`, `area_declared_ha`, `notes?`); `geometry-versions` con método `DECLARED` usa el mismo caso de uso | `plot:update` o `plot:update_assigned` con alcance; conserva la geometría vigente |
| Sync | `GET /sync/bootstrap`, `POST /sync/push`, `GET /sync/pull?cursor=...` | alcance asignado y permisos por operación |
| Jobs/reportes | `GET /jobs/{id}`, `POST /reports`, `GET /reports/{id}/download` | recurso y exportación |
| Compartición P1 | `POST /share-grants`, `POST /share-grants/{id}/revoke` | share:grant/revoke |

Cada fila exige schemas de request/response, ejemplo válido y errores, no solo ruta. Las APIs de tarea crítica son casos de uso (confirmar/cerrar/verificar), no PATCH genérico de `status`.

## Crear entrega: request conceptual

```json
{
  "producer_id": "<uuid>",
  "product_id": "<uuid>",
  "plot_id": "<uuid>",
  "plot_version_id": "<uuid>",
  "delivered_at": "2026-10-09T15:00:00Z",
  "quantity_declared": "500.000000",
  "unit": "KG",
  "production_period": {"start": "2026-09-01", "end": "2026-09-30"},
  "operation_id": "<uuid>"
}
```

No incluir tenant manipulable como autoridad. Validar producto, parcela y productor dentro del ámbito; si modelo de orígenes múltiples, sustituir plot por array tipado. Respuesta 201 con id/código/versión y estado; repetir operación idéntica devuelve el resultado original documentado.

## Error normalizado propuesto

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "La cantidad supera el saldo disponible del lote.",
    "request_id": "<uuid>",
    "details": [{"field": "quantity", "reason": "AVAILABLE_QUANTITY_EXCEEDED"}]
  }
}
```

| Estado | Uso |
| --- | --- |
| 400 / 422 | Validación estructural/dominio según convención del repo |
| 401 | Sin autenticación válida |
| 403 | Permiso insuficiente, no «sin datos» |
| 404 | Recurso inexistente o fuera del alcance visible |
| 409 | Conflicto de versión, idempotencia o transición |
| 413 | Payload/archivo excede límite |
| 429 | Límite de uso, retry indicado |
| 202 | Job aceptado con id; no conclusión anticipada |
| 503 | Dependencia necesaria indisponible, sin filtrar credenciales |

## Grafo y readiness

Grafo: raíz, nodos tipados, edges con cantidad/unidad/tipo de relación, direcciones, versiones, límites de profundidad y cursor. Los permisos se aplican antes de serializar; no revelar counts o identidades ocultas. Distinguir truncamiento técnico, ausencia de origen y sección no autorizada.

Readiness: `snapshot_version`, `evaluated_at`, `rule_set_version`, checks con requisito/estado/motivo/evidence_refs, bloqueos y acciones. Los porcentajes son informativos; un requisito crítico bloquea aunque total sea 98%.

## Jobs y descargas

Operaciones largas responden 202 y job autorizado: `PENDING/RUNNING/SUCCEEDED/FAILED`. Resultado de job lleva tenant, versión de entrada y error recuperable. URLs temporales solo tras autorización y estado de escaneo válido. Expiración o revocación nunca se resuelve convirtiendo el objeto en público.

## Sincronización implementada (P0-024)

`POST /devices`, `GET /devices`, `POST /devices/{id}/revoke`, `POST /sync/push`, `GET /sync/pull`, `POST /sync/attachments/{operation_id}/content` (bajo `/api/v1/organizations/{org}`); permisos `sync:use` y `device:manage`. Contrato detallado en docs/11 y en `apps/api/openapi.json`.

## Coste de la plataforma, acceso federado y cierre de sesión (P1-015 / D-54, implementado 2026-10-20)

`GET|POST /organizations/{orgId}/platform-cost/tariffs` (tarifas declaradas, versionadas; USD por organización y mes; motivo obligatorio desde la versión 2; idempotente por `operation_id`), `GET|POST /organizations/{orgId}/platform-cost/estimates` (período explícito en meses calendario, fin excluido, máx. 24; `SIN_TARIFA` / `PARCIAL` / `ESTIMADO`; un mes sin tarifa no vale cero), `GET …/estimates/{id}` y `GET …/estimates/{id}/verify` (reproducción). `GET /organizations/{orgId}/limits?lang=es|en` (textos de los límites en el idioma pedido; el español es la reserva). `GET /auth/sso/config` (público: solo si hay acceso federado), `POST /auth/sso/start` (destino de retorno en lista cerrada; `mode` LOGIN|LINK), `POST /auth/sso/callback` (`code`, `state` e `iss` —RFC 9207—; emite el mismo testigo que el acceso local), `GET /auth/sso/links`, `DELETE /auth/sso/links/{id}`, `POST /auth/logout` (revoca la sesión; devuelve la URL de cierre del proveedor si se entró por él). Errores estables: `SSO_NOT_ENABLED`, `SSO_REDIRECT_NOT_ALLOWED`, `SSO_FLOW_INVALID`, `SSO_PROTOCOL_ERROR`, `SSO_IDENTITY_NOT_LINKED`, `SSO_ACCOUNT_DISABLED`, `SSO_IDENTITY_ALREADY_LINKED`, `SSO_USER_ALREADY_LINKED`, `SSO_TOO_MANY_FLOWS`, `PERIODO_NO_ALINEADO`, `PERIODO_INVALIDO`, `PERIODO_DEMASIADO_LARGO`, `VIGENCIA_INVALIDA`.

## Captura de campo con alcance propio (A-01, implementado 2026-10-20)

- `POST /organizations/{orgId}/plots/{plotId}/geometry-preview` — revisión del servidor **sin guardar** (estructura, topología, superficie
  geodésica, orden `[longitud, latitud]`, procedencia `MANUAL_COORDINATES` con `is_gps_measurement=false`). Requiere captura sobre esa parcela
  (403 para auditor/comprador, 404 fuera de alcance).
- `POST …/plots/{plotId}/geometry-versions` — admite `survey_method = MANUAL_COORDINATES` y un `reason` opcional (obligatorio en la web al
  corregir) que se propaga al historial y a la auditoría. Estructura inválida → 4xx sin versión. Una geometría **técnicamente inválida**
  (p. ej. autointersección) se registra como versión marcada `technically_valid=false` (diseño original de P0-006); su dictamen es de la
  evaluación GIS. Campos de estado enviados por el cliente (`technically_valid`, `status`) se rechazan con 400.
- `PUT …/producers/{producerId}/self-membership` — vincula (`membership_id`) o desvincula (`null`) con `expected_version` y `reason`.
  Errores: `MEMBERSHIP_NOT_FOUND`, `MEMBERSHIP_WITHOUT_PRODUCER_ROLE`, `MEMBERSHIP_ALREADY_LINKED`, `VERSION_CONFLICT`.
- Las lecturas de productor incluyen `is_own`, `can_link_self` y (solo con `producer:link_self`) `self_membership_id`.
- Satélite de ENSAYO: con `SATELLITE_FIXTURE_ENABLED=true` la ficha de `GET …/plots/{plotId}/satellite` declara `ensayo_mode=true` y
  `fixture_scenarios`; `POST …/satellite/analyses` acepta `fixture_scenario` (`RESULT_FINDINGS`, `RESULT_NO_FINDINGS`, `RESULT_PARTIAL`,
  `NO_COVERAGE`, `TIMEOUT`, `RATE_LIMITED`, `PROVIDER_ERROR`, `EGRESS_BLOCKED`, `RESULT_COVERED`). Los trabajos llevan `is_ensayo`/`provider_kind`;
  el resultado es siempre sintético, `conclusion = NOT_EVALUATED`, ligado a `plot_version_id` y `geometry_hash`; no crea evidencia ni evaluación de riesgo.
  Apagado: `ensayo_mode=false`, sin escenarios y `can_request=false`.
- OpenAPI regenerado: 262 rutas (`apps/api/openapi.json`).

### Fotografías y mapa (A-01 final, 2026-10-20)
- `POST /organizations/{orgId}/documents` con `document_type=FIELD_PHOTO`: rechaza con **422 `PHOTO_METADATA_PRESENT`** una imagen con metadatos embebidos (auditado como `document.upload_rejected`);
  con `FIELD_EVIDENCE` rechaza imágenes con **422 `EVIDENCE_IMAGE_USE_FIELD_PHOTO`** (esa clase es para PDF). Mismo contrato para altas y versiones nuevas.
- `GET …/documents/{id}` y `…/versions/{vid}/content`: para `FIELD_PHOTO` el contenido lo entrega `producer:read_identity` **o** `document:read_field_photo_own` con el titular en alcance propio; si no, `CONTENT_RESTRICTED` (403) o 404 fuera de alcance.
- `POST …/plots/{plotId}/polygon-drafts` y `…/geometry-imports` admiten `plot:update_own`.
- Cartografía: no es parte de la API de negocio. Es el servicio local `maps` (`GET /estilo.json`, `/metadata.json`, `/tiles/ecuador.pmtiles` por rangos, `/fonts/{pila}/{rango}.pbf`), sin autenticación porque solo sirve datos públicos de OpenStreetMap y no recibe datos de Terra Link.

### Concesiones: administración web (A-02, 2026-10-21)
- `POST /organizations/{orgId}/access-grants` admite `grantee_email` (correo exacto, sin distinguir mayúsculas) **o** `grantee_user_id` (exactamente uno; si no, 422 `GRANTEE_REQUIRED`). Sin cuenta activa identificable:
  422 `GRANTEE_NOT_AVAILABLE` con el mismo mensaje para «no existe» e «inactiva»; más de 10 fallos por hora y persona → 429 `TOO_MANY_ATTEMPTS`; cada fallo se audita como `grant.recipient_unavailable` con un prefijo de huella, no el correo.
- `GET …/access-grants` añade `resource_label` (código del lote, del embarque o «DD-… · instantánea n»), `created_at`, `granted_by_name`, `revoked_by_name` y `revoke_reason`.
- `GET …/access-grants/shareable?type=LOT|SHIPMENT|DD_SNAPSHOT` → `{ type, available, items:[{id,label,detail}], note }`: solo recursos de la organización que quien consulta puede leer (`available:false` si no tiene la lectura). Requiere `grant:manage`.
- Sin cambios: vencimiento obligatorio y futuro, `POST …/revoke` con motivo, `/granted` para el destinatario.

## Traspaso de custodia entre organizaciones (A-03, 2026-10-21)
Prefijo `/api/v1/organizations/{orgId}`; `orgId` es la organización **que actúa** (debe ser parte del traspaso; si no, 404). Mutaciones idempotentes por `operation_id`; las que cambian un traspaso exigen `expected_version` (409 `VERSION_CONFLICT`). Cantidades: texto decimal en KG.
- Vínculos: `GET partnerships`; `POST partnerships` (devuelve el **código una sola vez**; se guarda solo su huella; caduca en 7 días); `POST partnerships/confirm {code}` (lo confirma la **otra** organización; 404 `PARTNERSHIP_CODE_INVALID` indistinguible entre inexistente, usado o caducado); `POST partnerships/{id}/revoke {reason}` (409 si hay traspasos sin cerrar).
- Traspasos: `GET custody-transfers`, `GET custody-transfers/options`, `GET custody-transfers/lineage/{lotId}`, `GET custody-transfers/{id}` (vista **por lado**), `GET custody-transfers/{id}/preflight` (solo emisora); `POST custody-transfers` (oferta: `partnership_id`, `lot_id`, `location_id`, `quantity`, `note?`, `returns_transfer_id?`).
- Acciones: `POST …/{id}/accept {product_id, location_id}` (receptora), `…/reject {reason}` (receptora, solo oferta), `…/cancel {reason}` (emisora, antes de la salida), `…/dispatch` (emisora), `…/receive {quantity, reason?}` (receptora; el excedente exige `reason` y queda como sobrante pendiente), `…/shortage {quantity, reason}`, `…/reject-in-transit {quantity, reason}`, `…/discrepancies/{id}/resolve {resolution, reason}`.
- Errores propios: 409 `TRANSFER_STATE`, `INSUFFICIENT_AVAILABLE`, `TRANSIT_EXCEEDED`, `PARTNERSHIP_NOT_ACTIVE`, `PARTNERSHIP_ALREADY_ACTIVE`, `PARTNERSHIP_HAS_OPEN_TRANSFERS`, `RETURN_EXCEEDS_RECEIVED`, `RETURN_LOT_MISMATCH`, `DISCREPANCY_RESOLVED`; **409 `TRANSFER_DISPATCH_BLOCKED`** cuando la compuerta no se satisface (hoy, siempre); 403 `WRONG_SIDE`, `CANNOT_SELF_CONFIRM`; 422 `REASON_REQUIRED`, `RESOLUTION_NOT_APPLICABLE`, `PRODUCT_NOT_ELIGIBLE`.
- **No existe** un parámetro, cabecera ni permiso para omitir la compuerta: un cuerpo con campos desconocidos se rechaza (400).
- `GET lots/{id}` añade `custody_origin` (traspaso, emisora, cantidad recibida, instantánea de origen y su huella) para los lotes `source = CUSTODY_TRANSFER`, con `origin.status = INCOMPLETE`.

## Evaluación geográfica técnica actual del expediente (requisito original GEOLOCATION_PROFILE, I1–I4; 2026-10-21)
`GET /api/v1/organizations/{orgId}/dd-cases/{id}/geo-evaluation` — **solo lectura** (permiso `dd:read` y el alcance de organización completa que ya exige el expediente; otra organización → 404; sin permiso → 403). **No evalúa, no recalcula, no emite eventos ni auditoría y no escribe.**
Devuelve `kind: CURRENT_TECHNICAL_GEO_EVALUATION`, `not_snapshot_content: true`, `consulted_at`, `profile {id, version}`, `counts {total, meets_profile, does_not_meet, review_required, not_evaluable, obsolete, absent}`, `pending[] {plot_id, plot_code, kind: ABSENT|OBSOLETE|NOT_EVALUABLE}`
y por parcela `plots[]`: `geometry {version_number, geometry_type}`, `vigencia` (`CURRENT` | `OBSOLETE` | `ABSENT`) con `reason` (`NEVER_EVALUATED`, `NO_GEOMETRY_VERSION`, `GEOMETRY_VERSION_CHANGED`, `PROFILE_VERSION_CHANGED`), `evaluation {status, label, profile, source, evaluated_at, evaluated_version_number, explanation, area}` y `next_action {code, message, can_act}`.
`explanation` y `area` solo se entregan con `plot:read_geometry` (`detail_restricted: true` en caso contrario). `regulatory` recuerda que el requisito `GEOLOCATION_PROFILE` **no cambia** y muestra su estado en la última instantánea.
**Contrato:** esta respuesta **no forma parte** de `DdContent`, de su hash ni de sus secciones; añadirla no modifica ni desactualiza instantáneas. Si el veredicto debe entrar al contenido formal de la instantánea: contrato versionado y transición explícita (no se hace aquí).

## Acto de revisión del perfil jurídico (P1-005, plataforma; 2026-10-22)

| Método y ruta | Permiso | Contrato |
| --- | --- | --- |
| `GET /api/v1/platform/legal-profile/reviews` | `legal_profile:record_review` (plataforma, solo `SUPER_ADMIN`) | Versiones con fuentes, **revisión vigente** (la última), historial (`is_current`), soportes y consecuencia técnica (`link_eligibility`) |
| `POST /api/v1/platform/legal-profile/reviews` | ídem | Registra una revisión **efectiva** e inmutable de una versión exacta. Cuerpo: `operation_id`, `version`, `decision` (`REVIEWED`/`OBJECTED`/`WITHDRAWN`), `reviewer_name`, `reviewer_capacity`, `reviewed_on` (no futura), `basis`, `supports[]`, `expected_current_review_id` (opcional) |

**Tres conceptos distintos:** (1) **persona revisora declarada** = `reviewer_name` + `reviewer_capacity` (+ `reviewed_on`); (2) **usuario que registra el acto** = el de la sesión (columna `reviewer_id` **desde `0062`**; el cuerpo no puede suplantarlo; expuesto como `recorded_by`); (3) **soportes** = fuentes del propio perfil (`PROFILE_SOURCE`, misma versión) o citas (`CITATION`, con `url` https y `file_sha256` opcionales). Errores: `REVIEW_SUPPORT_REQUIRED` (favorable sin soporte), `REVIEW_SUPPORT_INVALID`, `REVIEW_DATE_INVALID`, `NOTHING_TO_WITHDRAW`, `REVIEW_SUPERSEDED` (409), `OPERATION_ID_REUSED` (409), `LEGAL_PROFILE_UNKNOWN` (422). Registrar **no** publica, adopta ni vincula, y **no** es una conclusión jurídica del sistema.

## Configuración versionada de reglas de geolocalización (GEOLOCATION_PROFILE; 2026-10-22)

| Método y ruta | Permiso | Contrato |
| --- | --- | --- |
| `GET /api/v1/platform/geolocation-config/versions` | `geo_config:manage` (plataforma, `SUPER_ADMIN`) | Versiones con reglas, fuentes, revisión vigente, historial, organizaciones declaradas aplicables y `gaps` |
| `POST /api/v1/platform/geolocation-config/versions` | ídem | Prepara una versión **inmutable y sin revisión**: reglas `ACTIVE` solo de tipo `GEO_TECH_PROFILE`; `CANDIDATE` exige `pending_questions`; el perfil técnico debe ser el vigente. Errores: `CONFIG_RULE_NOT_APPLICABLE`, `CONFIG_CANDIDATE_QUESTIONS_REQUIRED`, `CONFIG_RULE_SOURCE_UNKNOWN`, `TECHNICAL_PROFILE_MISMATCH`, `CONFIG_VERSION_EXISTS` (409) |
| `POST /api/v1/platform/geolocation-config/reviews` | ídem | Revisión **de esa configuración** (no la del perfil jurídico): `decision`, `reviewer_name`, `reviewer_capacity`, `reviewed_on`, `basis`, `supports[]` (`CONFIG_SOURCE`/`CITATION`), `applicable_organizations[]` y `applicability_note`. `REVIEWED` exige soporte; `WITHDRAWN` solo sobre una favorable vigente; `REVIEW_SUPERSEDED` (409) |
| `GET /api/v1/organizations/{orgId}/geolocation-config/catalog` | `traceability:read_catalog` | Versiones con su estado, `applies_to_this_organization` (**nunca** lista otras organizaciones) y `gaps` |
| `POST /api/v1/organizations/{orgId}/geolocation-config/adoptions` | `risk:approve_rules` | Adopta/retira (`ALREADY_ADOPTED`/`NOT_ADOPTED` 409). No revisa ni declara aplicable |

`GEOLOCATION_PROFILE` se evalúa con la configuración adoptada; el contenido de la instantánea (`profiles.geolocation_profile`) registra configuración, revisión, aplicabilidad y las evaluaciones del perfil técnico por versión de parcela. Evidencia: `qa/EVIDENCIA_GEOLOCATION_PROFILE_CONFIG_2026-10-22.md`.
