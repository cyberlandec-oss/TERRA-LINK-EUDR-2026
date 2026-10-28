# Backlog ejecutable

Estado inicial para todas las historias: `PENDIENTE_DE_VERIFICAR`. P0-001–026 conservan IDs y temas de S1 §100. Las historias 027–031 hacen explícitas capacidades incluidas en otras secciones de las fuentes. Criterios son propuesta de ingeniería. Antes de implementar, acreditar lo que ya existe y abrir solo gaps.

## TECH-001 — Foundation y auditoría del repositorio

Prioridad P0; sin dependencia de código nuevo. Como equipo, necesito una línea base real para continuar sin recrear módulos ni aplicar un stack desactualizado.

Aceptación: inventario con commit/rama, manifiestos/lockfiles, módulos, migraciones, catálogo RBAC, tests y comandos; comparar con RF; decidir stack/estructura en ADR-0001; mapear documentos a paths reales; ajustar globs de rules; producir ERD/diccionario/OpenAPI ejecutable/CTE-KDE/eventos/riesgo/CI; registrar verificaciones y gaps en estado. Si repo vacío, crear skeleton mínimo validado después de decidir stack. No atribuir implementación a este paquete.

## Historias P0 de la fuente

### P0-001 — Organización
Depende TECH-001. Como ORG_ADMIN, necesito organización activa/configurada.
Aceptación: crear con datos mínimos, selección por membresía, suspensión impide nueva operación autorizada sin borrar historia; usuario A no accede B. RF-01; QA-01/02.

### P0-002 — Usuarios
Depende P0-001. Como administrador, necesito gestionar acceso del equipo.
Aceptación: alta/invitación según auth real, membresía, desactivación y reactivación auditadas; sin credenciales publicadas ni acceso heredado tras baja. RF-02; QA-01.

### P0-003 — RBAC y aislamiento
Depende P0-001/002. Como dueño de datos, necesito mínimo privilegio.
Aceptación: catálogo efectivo, permisos por acción/recurso, checks de FK/jobs/objects; casos A→A y A→B, buyer/grants y superadmin/elevación; UI no sustituye backend. RF-03; QA-02.

### P0-004 — Productor
Depende P0-003. Como técnico, necesito registrar/consultar productor.
Aceptación: crear/buscar/editar con validación, historial y asignación; identidad protegida; baja lógica mantiene entregas/parcela. RF-04; QA-03/13.

### P0-005 — Código y deduplicación
Depende P0-004. Como steward, necesito identificar sin duplicar.
Aceptación: código único por tenant bajo concurrencia; mismos códigos en A/B permitidos según regla; coincidencia de identidad genera revisión sin fusión silenciosa. RF-05; QA-03.

### P0-006 — Parcela
Depende P0-004. Como técnico, necesito vincular productor y parcela.
Aceptación: FK mismo tenant, código/datos, geometría histórica/version actual y permisos; cambiar parcela genera versión y conserva snapshot utilizado. RF-06; QA-04/02.

### P0-007 — Punto GPS
Depende P0-006. Como técnico, necesito capturar ubicación verificable.
Aceptación: coordenadas/método/hora, precisión null explícita, permiso GPS recuperable; punto no calcula área de finca. RF-07; QA-04/08.

### P0-008 — Polígono GPS
Depende P0-006/007. Como técnico, necesito perímetro trazable.
Aceptación: vértices persistentes, cierre/validación, precisiones por muestra y resumen incompleto cuando falten; edición crea versión. RF-08; QA-04/08.

### P0-009 — GeoJSON
Depende P0-006/010. Como trazabilidad, necesito intercambio geográfico.
Aceptación: import/export autorizado, `[lon,lat]`, perfil destino, límites y errores; file import no duplica registros al reintentar. RF-09; QA-04/02.
**2026-10-15: DONE_LOCAL.** El criterio «perfil destino» queda demostrado con **D-05.A** adoptado como perfil
técnico provisional para desarrollo local: exportación con perfil **por productor**, 6 decimales como números,
sin datos personales y con lista de no exportables y motivos. **No acredita** conformidad jurídica (D-05.B) ni
aceptación por el servicio real del destino, que no se ha probado.

### P0-010 — Validación GIS
Depende P0-006. Como responsable de datos, necesito motivos de validez.
Aceptación: geometría/CRS/área/duplicados/cobertura, estados y versión de regla; umbral debajo/igual/encima probado tras aprobar perfil; sin reparación destructiva silenciosa. RF-10; QA-04.
**2026-10-15: DONE_LOCAL.** El criterio «umbral debajo/igual/encima probado tras aprobar perfil» queda demostrado
tras adoptar **D-05.A**: operador estricto, caso exactamente igual admitido con aviso y sin banda, y comparación
sobre el valor almacenado. El perfil es una regla **aparte** (`EUDR_GEO_V1`, tabla propia): `TL_GIS_TECH` y sus
evaluaciones históricas **no se tocan**, y los dos dictámenes se muestran juntos porque pueden discrepar. Sin
reparación: la simulación del truncamiento trabaja sobre una copia. **Pendiente y separado**: D-05.B y la
aceptación por el servicio real.

### P0-011 — Productos
Depende P0-003. Como operador, necesito producto/estado/unidad coherentes.
Aceptación: catálogo de cacao y unidades, códigos por ámbito; transformación cambia estado con evento/rendimiento, no conversión implícita. RF-11; QA-05/06.
Capacidades (2026-10-10): «catálogo y unidades» verificada y disponible para P0-012; «transformación con evento/rendimiento» pendiente y demostrable solo con P0-016 (procesamiento). P0-011 sigue abierta hasta demostrarla.
**2026-10-10: transformación demostrada en P0-016** (fermentación CACAO_BABA → CACAO_FERMENTADO con `ProcessingRunClosed`, rendimiento en masa y sin conversión implícita): P0-011 **DONE_LOCAL**.

### P0-012 — Entrega y recepción
Depende P0-004/006/013/014/015 y de la **capacidad** «catálogo de productos y unidades» de P0-011 (verificada el 2026-10-10; el criterio de transformación de P0-011 no bloquea Entregas). Como recepción, necesito cantidad y origen reales.
Aceptación: entrega declarada, peso recibido, recepción parcial/completa, diferencias con causa, vínculos válidos y quality básica; confirmar repetido no crea doble stock. RF-12; QA-05/06.
Estado (2026-10-10): capacidades demostradas verificadas localmente; **historia abierta** por «diferencias con causa» (requiere política de cierre y tolerancias, D-33). P0-016 puede usar las cantidades ya recibidas sin esperar ese cierre (propuesta sin aprobar en `docs/decisiones/P0-016-017-PROPUESTA-LOTES-INVENTARIO.md`).

**Contraste de los criterios originales (2026-10-15), antes de cerrar la historia:**

| Criterio de aceptación | Dónde se demuestra | Resultado |
| --- | --- | --- |
| Entrega declarada | `test/deliveries.int-spec.ts` (alta, registro y compuerta con sus KDE) | Cumplido |
| Peso recibido | `test/deliveries.int-spec.ts` (pesaje con método, unidad y responsable) | Cumplido |
| Recepción parcial/completa | `test/deliveries.int-spec.ts` + `test/recorrido-integral.int-spec.ts` (500 declarados, 480 recibidos) | Cumplido |
| **Diferencias con causa** | `test/d32-d33.int-spec.ts`: cierre sin diferencia, por debajo y por encima; motivo obligatorio en ambos signos; permisos; aislamiento; doble envío y concurrencia; recepción posterior rechazada; justificación desactualizada con historial conservado | **Cumplido el 2026-10-15** con D-33 adoptada; era el único criterio abierto |
| Vínculos válidos | Compuertas KDE por transición; `test/deliveries.int-spec.ts` | Cumplido |
| Quality básica | Muestras y resultados de calidad, estado separado de la recepción física (D-33, 2026-10-10) | Cumplido |
| Confirmar repetido no crea doble stock | `test/deliveries.int-spec.ts` (confirmación idempotente) y el ledger de P0-017 | Cumplido |

**2026-10-15 — P0-012 DONE_LOCAL**: el criterio «diferencias con causa» queda demostrado con el cierre de entregas (D-33). DONE_LOCAL no acredita producción, uso en campo ni conformidad EUDR. **Lo que no cierra esta historia**: los límites de aceptación de calidad (D-33, pendientes) y la comprobación con operadores reales.

### P0-013 — CTE
Depende TECH-001. Como trazabilidad, necesito hitos definidos.
Aceptación: catálogo versionado de harvest/delivery/reception/weighing/processing/storage/packaging/sale/shipment; hechos operativos mapeados a eventos existentes. RF-13; QA-05.
Nota (2026-10-10): cada historia que implemente una operación (P0-012, P0-016, P0-017, P0-029) debe pasar su vínculo CTE de PENDING a INTEGRATED con una nueva versión del catálogo. HARVEST, PACKAGING y SALE no tienen historia asignada (D-33).

### P0-014 — KDE
Depende P0-013. Como steward, necesito datos mínimos por hito.
Aceptación: definición, validación, condición, responsable y versión; faltantes aparecen como tales e impiden transición aplicable sin inventarlos. RF-14; QA-05.

### P0-015 — Eventos
Depende TECH-001 y de la **capacidad** «autorización dentro del tenant» de P0-003 (verificada). Los criterios abiertos de P0-003 (concesiones externas/grants y elevación de plataforma, D-04) bloquean solo la visibilidad de eventos para terceros con concesión y el acceso de plataforma a eventos. Como auditor, necesito historial causal.
Aceptación: envolvente/versión/tenant/actor/tiempos, append-only, correction_of, outbox atómico y consumo idempotente; evento repetido no duplica efectos. RF-15; QA-05/07/13.

### P0-016 — Lotes y procesos
Depende P0-012/015. Al cerrar un proceso se demuestra el criterio pendiente de P0-011 (transformación con evento y rendimiento) y se integra el vínculo CTE FERMENTATION/DRYING. Como trazabilidad, necesito reconstruir mezclas/transformaciones.
Aceptación: lote con inputs/outputs/run; DAG sin ciclos; origen conservado en salida; cierre atómico y consulta upstream/downstream con cantidades y permisos. RF-16; QA-07.
Contrato propuesto (2026-10-10, sin aprobar): `docs/decisiones/P0-016-017-PROPUESTA-LOTES-INVENTARIO.md` (asignación sin doble uso desde P0-016; ledger completo en P0-017). Decisiones bloqueantes: D-39 (adoptadas para desarrollo local el 2026-10-10).
Estado (2026-10-10): criterios originales demostrados localmente (lote con entradas/salidas/proceso, DAG sin ciclos, origen conservado, cierre atómico, consultas con cantidades y permisos); FERMENTATION integrada. **Historia abierta** por la integración de DRYING (cierre bloqueado hasta definir la unidad de humedad, D-32), que el backlog asocia a P0-016.

**Contraste de los criterios originales (2026-10-15), antes de cerrar la historia:**

| Criterio de aceptación | Dónde se demuestra | Resultado |
| --- | --- | --- |
| Lote con inputs/outputs/run | `test/lots.int-spec.ts` | Cumplido (2026-10-10) |
| DAG sin ciclos | `test/lots.int-spec.ts` (control de ciclos en todo enlace) | Cumplido (2026-10-10) |
| Origen conservado en la salida | `test/lots.int-spec.ts`, `test/recorrido-integral.int-spec.ts` | Cumplido (2026-10-10) |
| Cierre atómico | `test/lots.int-spec.ts` (idempotente, con balance exacto en KG) | Cumplido (2026-10-10) |
| Consulta upstream/downstream con cantidades y permisos | `test/lots.int-spec.ts`, `test/recorrido-integral.int-spec.ts` | Cumplido (2026-10-10) |
| **Vínculo CTE DRYING integrado** | `test/d32-d33.int-spec.ts` y `test/lots.int-spec.ts`: cierre real de un secado con humedad en `%BH`, método y responsable, balance 100 = 60 + 40, evento `ProcessingRunClosed` publicado y `integration_status = INTEGRATED` | **Cumplido el 2026-10-15** con D-32 adoptada; era el único criterio abierto |

DRYING se marca INTEGRATED porque **la operación y su evento están demostrados**, no por publicar el catálogo: el mismo caso de prueba cierra el secado, comprueba el evento y lee el estado del vínculo.

**2026-10-15 — P0-016 DONE_LOCAL**: DONE_LOCAL no acredita producción, Android real ni conformidad EUDR. **Lo que no cierra esta historia**: los límites de aceptación de calidad de la humedad (D-32, pendientes) y las unidades adicionales de peso con sus factores (D-32, pendientes).

### P0-017 — Inventario/balance de masa
Depende P0-016. Como operación, necesito cantidades conservadas.
Aceptación: ledger, merma, traslado, reserva/despacho y ajuste con motivo; 800→750+50 válido, exceso rechazado; prueba concurrente impide doble consumo/saldo negativo. RF-17; QA-06.
Estado (2026-10-10): ledger como única fuente, merma, traslado, ajuste con motivo, 800→750+50 y concurrencia demostrados localmente; STORAGE integrada. **Historia abierta**: «reserva/despacho» requiere embarques (docs/06 `reservations.shipment_id` R) → P0-029. Efectos por operación: `docs/decisiones/P0-017-EFECTOS-LEDGER.md`.

### P0-018 — Documentos
Depende P0-003/025. Como usuario, necesito soportes privados/versionados.
Aceptación: carga/cuotas/checksum/cuarentena/escaneo, vigencia y nueva versión; descarga exige permiso; malware y escáner caído no se aprueban. RF-18; QA-09.

### P0-019 — Evidence graph
Depende P0-018. Como EUDR_MANAGER, necesito saber qué respalda una afirmación.
Aceptación: claim, fuentes/versiones y enlaces tipados; soporta contradicción, revisión/verificación y expiración; nueva versión no hereda aprobación. RF-19; QA-09/10.

### P0-020 — Risk engine
Depende P0-010/016/019. Como EUDR_MANAGER, necesito causas reproducibles.
Aceptación: categorías/factores/reglas/snapshot; separar severidad/proceso/conclusión; faltantes no son score cero; reevaluación crea versión y factor crítico no se diluye. RF-20; QA-10.
Estado (2026-10-10): criterios demostrados localmente con reglas técnicas de docs/13 **no aprobadas** (sin pesos, umbrales ni severidades); conclusión regulatoria UNDETERMINED. Reglas dependientes de D-05, proveedor satelital (P0-028) y mitigaciones (P0-021) quedan no evaluables. Sin mitigaciones ni expediente (P0-021/P0-022).

### P0-021 — Mitigación
Depende P0-020. Como responsable, necesito resolver causa con evidencia.
Aceptación: acción/assignee/plazo/soporte; aportar→verificar/rechazar con motivos y permisos; resolver dispara reevaluación y actualiza pendientes reales. RF-21; QA-11.
Estado (2026-10-10): criterios demostrados localmente. Separación de funciones de docs/13 aplicada (el ejecutor no verifica; sin política de excepción); D-37 (Evidencias) no se modifica. Reevaluación asíncrona por outbox; catálogo de riesgo sigue NO APROBADO y conclusión UNDETERMINED.
Revisión (2026-10-10): la verificación ahora exige declarar el criterio de aceptación; se distinguen soporte aceptado, acción ejecutada y causa. La verificación DEMO anterior se corrigió (soporte aceptado, criterio no cumplido, causa persiste) con la decisión original conservada; la reevaluación separa quién la desencadenó, el worker que la ejecutó y la revisión humana.
Recorrido visual completo (2026-10-10): ejecutor aporta y entrega → segunda persona DEMO (`eudr.cooperativa`, rol EUDR_MANAGER existente) verifica → outbox crea la evaluación 2 → DATA_MISSING_ORIGIN y MATERIAL_OF_UNKNOWN_ORIGIN siguen bloqueantes; conclusión Indeterminada.

### P0-022 — Diligencia y paquete
Depende P0-017/019/020/021. Como EUDR_MANAGER, necesito preparación verificable.
Aceptación: guards por requisito, revisión autorizada, snapshot/manifest, export auditado; cambio relevante invalida readiness actual; export no marca DDS aceptada. RF-22; QA-12.
Estado (2026-10-10): **ABIERTA**. Capacidades independientes implementadas y probadas localmente (expediente, guards, instantánea/manifest, revisión, borrador interno exportado y auditado, desactualización por cambio relevante, redacción). No demostrable todavía: aprobar una preparación READY y exportar `DD_PACKAGE` con datos reales (bloqueados por catálogo de riesgo no aprobado, conclusión UNDETERMINED, perfil jurídico P1-005, D-05, satélite P0-028 y embarques P0-017/P0-029); el generador se probó solo con una fixture sintética.

### P0-023 — Captura offline
Depende P0-004/006/007/008 y auth real. Como técnico, necesito trabajar sin red.
Aceptación: entidad/cola en transacción local; borradores/fotos/GPS sobreviven cierre y reboot; dataset limitado y separación por cuenta; sesión offline definida. RF-23; QA-08.
Estado (2026-10-10): **ABIERTA**. `apps/mobile` (Expo SDK 57): transacción local, recuperación, separación por cuenta/organización, fotos persistentes y fallos de almacenamiento probados en Node con SQLite real; dataset autorizado probado contra la API local. Pendiente obligatorio: ensayo en Android real (cierre, reinicio, fotos, ubicación) y cifrado SQLCipher en build de desarrollo; política de sesión D-40 sin aprobar.
Revisión (2026-10-11): la captura termina al vencer la sesión del servidor (sin ventana de 72 h); build nativo sin cifrado no abre el almacén; Expo Go limitado a fixtures sintéticos (sin cámara ni ubicación reales); fotos dentro de la base y sin metadatos embebidos. Build nativo y ensayo Android bloqueados por espacio en disco (6,3 GB libres). Sigue ABIERTA.

Avance (2026-10-28): captura sin conexión de productor y parcela nuevos (referencia local persistida), vértices de polígono, entrega declarada y fotos sobre entidades locales, con cola en dependencia y corrección de altas rechazadas; pantalla «Altas». **Actualización (2026-10-28, `b995aa3`, APK `0f68196`):** Altas completas (productor sin parcelas, corrección de rechazos, formularios por permisos) y mapa móvil implementados; emulador demostró la cadena de Altas, el mapa con y sin red, adjunto interrumpido, conflicto, cuentas, SQLCipher (`docs/qa/EVIDENCIA_MOVIL_ALTAS_MAPA_2026-10-28.md`). Sigue **ABIERTA**: faltan repetir con este APK persistencia tras cierre forzado, respuesta perdida, ubicación denegada, sesión vencida, almacenamiento lleno y foto con análisis, y, al final, el teléfono físico.

### P0-024 — Sync
Depende P0-023/015. Como técnico, necesito sincronizar sin pérdidas.
Aceptación: operation_id estable, dedup por hash, dependencias/cursor/tombstones, conflictos visibles y adjuntos; servidor revalida tenant/permisos; timeout/retry no duplica inventario. RF-24; QA-08/02.
Estado (2026-10-11): **ABIERTA**. Servidor y motor móvil implementados para `PLOT_LOCATION_SAMPLE_CREATE` y `PLOT_PHOTO_ATTACH`, probados en integración (API real) y con el cliente en Node contra la API local. No demostrado: inventario/entregas (sin operaciones móviles; la protección contra duplicar inventario no se acredita con ubicación y fotos), recorrido en dispositivo Android y resolución de conflictos en la interfaz del dispositivo.

Avance (2026-10-28, SHA `b3e9ca8`, DONE_LOCAL **no** otorgado; sigue **ABIERTA**): operaciones soportadas ahora `PLOT_LOCATION_SAMPLE_CREATE`, `PLOT_PHOTO_ATTACH`, `PLOT_POLYGON_VERTEX_ADD`, `PRODUCER_CREATE`, `PLOT_CREATE`, `DELIVERY_CREATE` con referencias locales resueltas por el servidor (`docs/11`), conflictos consecutivos recuperables y catálogo de referencia en el pull. Probado con PostgreSQL real y con SQLite real en Node; validación raíz APROBADA. **Alcance original (precisión 2026-10-28):** RF-23 pide capturar productores, parcelas, entregas y evidencias offline; RF-24, sync idempotente con dependencias y conflictos visibles; S1 §46 lista las tablas locales `sync_queue, producers, plots, deliveries, products, draft_events, documents_metadata`; §47 los estados `PENDING/UPLOADING/SYNCED/FAILED/CONFLICT`; §48, conflictos nunca resueltos en silencio; S4 §5 (técnico de campo: capturar GPS, editar parcela, agregar evidencia) y §6 (productor: parcela → ubicación → producción → entrega → confirmación). **Ninguna de esas fuentes exige** recepciones, calidad, lotes ni inventario como operaciones móviles: son flujos del servidor y la web (S4 §7, operador de recepción, no pide modo offline), así que **no** son pantallas móviles obligatorias ni un pendiente de P0-024. Lo que sí se conserva: toda operación móvil que genere o consuma stock debe ser idempotente (`operation_id` estable, hash, sin doble stock); hoy ninguna lo hace (`DELIVERY_CREATE` solo declara) y, si una fuente posterior exigiera una operación móvil adicional, deberá citarse con su criterio exacto y probarse con PostgreSQL real antes de incorporarla. **Pendiente real del criterio original:** (1) comprobación en Android (emulador y, al final, teléfono físico): cierre/reapertura, sin red, SQLCipher, permisos, conflictos, respuestas perdidas, almacenamiento; (2) evidencias: hoy son fotos de campo; RF-23 dice «evidencias» sin acotar el tipo y S1 §46 nombra `documents_metadata`: si deben poder capturarse documentos de soporte desde el móvil es una **pregunta abierta al propietario** y no se añade alcance por interpretación; (3) `draft_events` de S1 §46 corresponde a los borradores locales ya implementados. El mapa móvil es parte de la captura de campo (S4 §5, «Capturar GPS»), no de P0-024. Ver `docs/23`.

### P0-025 — Audit trail
Depende P0-003/015. Como auditor, necesito reconstruir quién cambió qué.
Aceptación: creación/corrección/aprobación/rechazo/descarga/export/permisos/risks, metadata/versiones y redacción; lectura/export por alcance. RF-25; QA-13.

### P0-026 — Excel import
Depende P0-004/005/006/011/012 según plantilla. Como asociación, necesito migrar registros.
Aceptación: plantilla/mapeo/preview/errores por fila/commit controlado; IDs no cruzan tenant; reimport no duplica ni borra campos fuera de mapping; legacy/missing explícitos. RF-26; QA-03.
Estado (2026-10-12): **DONE_LOCAL**. Las cinco plantillas de S1 §62 implementadas y verificadas localmente: productores, productos, parcelas (sin geometría), entregas (solo borradores, identidad por código o referencia de importación) y lotes (asignación de recepciones confirmadas vía ledger). Criterios contrastados en `docs/decisiones/P0-026-IMPORTACION-EXCEL.md`. Limitación registrada: solo archivos sintéticos y datos DEMO; sin Excel real de una asociación.

## Cobertura operativa P0 adicional

### P0-027 — Web por rol y Lot Hub
Depende contratos aplicables P0-003/004/006/016/019/020/022. Como operador, necesito completar trabajo desde contexto.
Aceptación: home/menu por permiso, hub y enlaces seguros, estados loading/vacío/403/error separados, formularios conservan datos y acciones tienen efecto de dominio; no métricas falsas. RF-27; QA-14.
Estado (2026-10-12): **DONE_LOCAL** (reabierta y cerrada de nuevo el mismo día: «Parcelas sin ubicación» exige punto o polígono —la superficie declarada no la resuelve— y el aviso de parcelas restringidas depende solo del permiso; `validation-results/2026-10-12T17-51-31-124Z`). «Mi trabajo» con tareas reales por alcance, Lot Hub con evidencias y riesgo/mitigación/expediente por permiso, fuga de parcelas de origen corregida, organización ajena «no disponible», filtros en la URL; matriz de 22 combinaciones cuenta–organización–rol, estados, teclado, 390 px y zoom 200 %. Ver `docs/decisiones/P0-027-WEB-POR-ROL-Y-LOT-HUB.md`. Limitaciones: destino/embarques (P0-029), evidencias por origen (P0-019), BUYER/PRODUCER/SUPER_ADMIN sin acceso implícito.

### P0-028 — Primer proveedor satelital
Depende P0-010/019/020. Como EUDR_MANAGER, necesito resultado con procedencia.
Aceptación: adapter/job, contrato real y coste, credenciales protegidas, dataset/versión/fecha/método/cobertura; timeout/no coverage no generan verde; defensa egress/SSRF probada. RF-28; QA-15.
Estado (2026-10-14): **ABIERTA**. Implementado y probado localmente **sin proveedor**: registro de proveedores sustituibles (S1 §40/§103) con los tres candidatos de la fuente documentados (licencia, coste, cobertura, límites y **qué datos saldrían del equipo**) y **ninguno seleccionado**; trabajo asíncrono por **versión de parcela** (`plot_version_id` + `geometry_hash`) que no bloquea la petición HTTP (S1 §54) y no se traslada a una geometría nueva (`SUPERSEDED_GEOMETRY`); **desenlaces explícitos, ninguno favorable** (`NO_PROVIDER_SELECTED`, `NO_COVERAGE`, `TIMEOUT`, `RATE_LIMITED`, `PROVIDER_ERROR`, `EGRESS_BLOCKED`, `GEOMETRY_UNSUPPORTED`, `SUPERSEDED_GEOMETRY`, `CANCELLED`); procedencia completa append-only (S1 §41) con bytes originales y `conclusion` restringida por esquema a `NOT_EVALUATED`; **defensa de salida** (lista blanca exacta, sin credenciales en URL ni literales IP, DNS comprobado al conectar, redirecciones no seguidas, plazo, tamaño, redacción); permisos `satellite:read`/`satellite:request` con `plot:read_geometry` exigido por sacar coordenadas del equipo; credencial cifrada por organización; ficha de parcela con estado, procedencia y límites. **Bloqueado**: elegir y contratar proveedor (**D-09**), evaluabilidad de la regla `SATELLITE_COVERAGE_UNKNOWN` (**D-07** + catálogo aprobado) y vínculo resultado→evidencia (**D-37**). Lo único que produce resultados hoy es una **fixture sintética** rotulada, que no satisface ningún requisito. QA-15 queda separada en cuatro niveles de evidencia (decisión pura, transporte con servidores controlados, desenlaces con fixture y **proveedor externo real: no ejecutado**), y la tarjeta de la ficha de parcela está **revisada en navegador** por rol, con estados sin proveedor/sin permiso/error, teclado y 390 px. **D-09 parte A adoptada (2026-10-15)**: Whisp implementado como **adaptador de desarrollo** contra el contrato oficial fechado (OpenAPI 2.3.0), con las llamadas reales cerradas por el interruptor `SATELLITE_LIVE_CALLS` y probado solo contra servidores controlados; conserva la incompletitud que declara el proveedor (`unavailable_datasets`) como cobertura **PARCIAL** y, sin incidencias, como **UNKNOWN** (nunca `COVERED`). La integración contra Whisp real sigue **NO EJECUTADA** (parte B). El vínculo resultado→evidencia se registra como **D-42**, separado de D-37. Ver `docs/decisiones/P0-028-SATELITE.md` y `docs/qa/EVIDENCIA_P0-028_2026-10-14.md`.

### P0-029 — Movimientos y embarque
Depende P0-017/022. Como exportación, necesito despacho consistente.
Aceptación: ubicaciones/contraparte/ítems, reserva y saldo concurrentes, preflight/calidad/evidencia/DD, despacho idempotente y grafo destino; sin saltar bloqueos. RF-29; QA-06/12.
Estado (2026-10-14): **ABIERTA**, con `npm run validate` **APROBADA** sobre `ad03b80` (la aprobación acredita las pruebas ejecutadas; no cierra el pendiente funcional). Implementado y probado localmente: comprador y destino declarados, ítems por lote, reserva en el ledger (idempotente, concurrente, sin saldo negativo), liberar/cancelar, preflight completo y destino en el Lot Hub. **Despacho NO demostrado**: bloqueado por D-34 (condición de `dd_package_id`/`dispatch_at`), por la falta de una instantánea DD READY y por calidad pendiente; su mecánica (consumo único, idempotencia) se probó solo con un preflight sintético. Ver `docs/decisiones/P0-029-EMBARQUES.md`.

### P0-030 — Reportes e indicadores
Depende dominios reportados y P0-025. Como gerente, necesito cifras demostrables.
Aceptación: filtro tenant/periodo, denominador/definición, datos reales, export autorizado con snapshot y audit; reporte no filtra PII ni confunde readiness con conformidad. RF-30; QA-13/14.
Estado (2026-10-16, revisión 5): **DONE_LOCAL**. Los tres bloqueos que quedaban se resolvieron o resultaron no ser criterios de la historia: `plots_valid` se calcula desde D-05.A; la distribución por severidad se calcula desde que el catálogo `1.0.0` está publicado y una organización lo adopta, con los **CRÍTICOS en su propio indicador** (`risk_critical`, extensión declarada de Terra Link, no de S1 §60); y el «perfil de destino regulatorio del GeoJSON» **no lo exige ninguna fuente** — S1 §97 dice «GeoJSON export» y S1 §16 pide dos rutas y un formato. La aplicabilidad jurídica es **D-05.B** y se registra en `docs/22`, no como condición de cierre de reportes. Cerrar la historia **no** acredita producción, volumen de piloto ni conformidad EUDR, y nada se ha probado contra el servicio real del destino. Contraste literal en `docs/decisiones/P0-030-CRITERIOS.md` §4.ter. Antes (2026-10-14, revisión 3): **ABIERTA**. Demostrado: los 11 KPI de S1 §60 con cinco estados distintos (`OK` con cero observado, `NO_DENOMINATOR`, `UNKNOWN`, `CRITERION_UNDEFINED`, `RESTRICTED`) y conteos `observed`; los **seis reportes por entidad de S1 §97** con **permiso de cada dominio del que publican datos** (leer productores no autoriza a contar sus parcelas), alcance antes de agregar y totales sobre el conjunto completo; **paginación por cursor** probada con 520 filas y **exportación del conjunto completo** hasta un tope declarado de 20 000; **exportación GeoJSON técnica** reutilizando P0-009; **comparación de actividad** entre períodos por fecha operativa; cobertura histórica corregida; y el **contrato de consistencia** con su alcance exacto (instantánea por petición y por exportación, no entre peticiones). **Ya sin bloqueos propios** (ver arriba). **Sin pendientes de la historia sin bloqueo**: reportes programados y saldo histórico **no los exige ninguna fuente** (búsqueda literal registrada) y el volumen de piloto es P0-031. Ver `docs/decisiones/P0-030-REPORTES.md` y el estado por criterio en `docs/decisiones/P0-030-CRITERIOS.md`.

### P0-031 — Piloto y operación reproducible
Depende P0-001–030 aplicables. Como cliente piloto, necesito operar la cadena sin intervención de desarrollador.
Aceptación: recorrido con dataset/usuarios de piloto, Android real, discrepancias gestionadas, restore DB+objetos y capacitación/manual; hallazgos priorizados y gates pendientes explícitos. RF-31; QA-16/17.

**Preparación (2026-10-21)**: recorrido integral desde la web, por rol, sobre datos DEMO — `docs/qa/RECORRIDO_INTEGRAL_WEB_2026-10-21.md`. Resultado: 15 transiciones, 0 defectos del producto, bloqueos esperados (D-05.B, D-07.5/7.6, D-34), y dos puntos **no definidos** que requieren decisión del producto (traspaso de lotes entre organizaciones; pantalla del propietario para concesiones). **P0-031 sigue NO INICIADA como piloto.**

## Historias P1

| ID | Resultado | Dependencia | Aceptación mínima |
| --- | --- | --- | --- |
| P1-001 | Buyer Portal | P0-022/029, grants | **DONE_LOCAL (2026-10-17)**. Recurso concreto, vencimiento, revocación que bloquea nueva consulta, aislamiento QA-02, portal del destinatario y descarga autorizada sobre **lote, embarque e instantánea**; **los once indicadores de S3 §22.8** como estados (**D-48(A)**); **«período» aclarado** como período de producción (S1 §44) con su precisión declarada. Contraste: `docs/decisiones/CONTRASTE_ACEPTACION_RF32_RF33_2026-10-17.md` |
| P1-002 | QR/pasaporte | P1-001 | **DONE_LOCAL (2026-10-17)**. Referencia opaca sin IDs/PII (verificada por decodificación del QR), audiencias `MEMBER` y `GRANTEE` —las que describen las fuentes—, y «no sustituye DDS» declarado en API, pantalla y archivo. Contraste: `docs/decisiones/CONTRASTE_ACEPTACION_RF32_RF33_2026-10-17.md` |
| P1-003 | My Work ampliado | P0-021/022/027/029 | **DONE_LOCAL (2026-10-18)**. Cola personal/supervisión separadas por la autorización, filtros reales `queue`/`assignee`/`status` en el backend que no amplían el alcance, fila completa de docs/14 con prioridad explicable y sin plazos inventados, la acción resuelve el dominio (recorrido real) y QA-11/QA-14 comprobadas. Evidencia: `docs/qa/EVIDENCIA_P1003_MI_TRABAJO_2026-10-18.md` |
| P1-004 | Onboarding y madurez | P0-026/027 | **DONE_LOCAL (2026-10-18)**. Asistente de 8 pasos derivados del dato real y diagnóstico de los siete niveles de S3 §16 con la evidencia de cada señal; la fuente no fija umbrales, así que la correspondencia señal→nivel es **D-49(A) ADOPTADA (2026-10-18)** como regla provisional de producto, por presencia de evidencias; sin datos no se declara «nivel 0»; se separan dato faltante, capacidad no implementada y decisión pendiente; vigencia probada; alcance y permisos en backend; **no levanta compuertas**. Evidencia: `docs/qa/EVIDENCIA_P1004_PUESTA_EN_MARCHA_2026-10-18.md` |
| P1-005 | Perfil Ecuador legal validado | P0-019/020 | Fuente/requisito/aplicabilidad/documento/regla/version/aprobador; pruebas de vigencia |
| P1-006 | GUIA | Canal verificado, P1-005 | **PARCIAL (2026-10-18)**. Entregado el *fallback* por archivo con **mapeo** declarado (D-50, NO OFICIAL), **conciliación** que no escribe datos operativos, **registro de actos** con huella y **acuerdo de intercambio** cuya verificación es **de plataforma**; sin acuerdo verificado y vigente el canal responde 409. **No cierra** (contraste literal 2026-10-20): RF-37 restringe a «Solo canal/acuerdo comprobados» (`docs/03:53`) y la dependencia es «Canal verificado, P1-005»; el canal es, por tanto, parte del criterio original y no solo condición de activación. Sus dependencias —canal verificado y P1-005— **no se cumplen**, y no hay intercambio real con el registro nacional. Evidencia: `docs/qa/EVIDENCIA_P1006_INTERCAMBIO_2026-10-18.md` |
| P1-007 | EUDR-IS | P0-022, rol/canal verificados | Fixture/ensayo ACCEPTANCE, recibos auténticos, reconciliation ante timeout; permiso separado de producción |
| P1-008 | ERP/API/webhooks | P0-015/029 | **DONE_LOCAL (2026-10-19)** sobre `fb46321` (**APROBADA**, 913 pruebas), demostrado contra un **receptor local** (`integracion.mjs` **26/26**; **ningún destino externo contactado**). **No se construyó otra cola**: el envío es un **consumidor del bus** de P0-015 y hereda reintentos, arrendamiento y cola muerta; la migración **0055** solo añade **destino** y **resultado por intento**, ambos append-only —cambiar o apagar un destino es otra versión **con motivo**—. **Firma** HMAC-SHA256 sobre «&lt;instante&gt;.&lt;cuerpo&gt;» con el **instante dentro de lo firmado**: una entrega capturada no se reutiliza. **Secreto** cifrado con el mecanismo de los datos personales, entregado **una sola vez**, ausente de lista, base en claro, auditoría, pantalla y registros. **Tenant** por el dato: un destino solo recibe eventos de SU organización; ajena = **404 opaco**. **Referencia exacta**: agregado siempre y, en eventos de expediente, **paquete** —caso, instantánea, número y huella— con **`submission = NOT_SUBMITTED`** (descargar no es presentar). **La garantía se publica como es: AL MENOS UNA VEZ.** El emisor no reenvía lo que registró como logrado, pero si el receptor procesa y **la respuesta se pierde**, aquí consta un fallo y el mensaje vuelve: procesar una sola vez es del **receptor**, por `X-Terra-Delivery-Id` —demostrado con un receptor que pierde la respuesta: **2 llegadas, 1 identificador, 1 efecto**—. **Apagar alcanza a los reintentos pendientes.** **Listas paginadas** (`docs/09:7`) en destinos e intentos, con `limit` acotado, `next_cursor` y **orden estable** —instante con el identificador como desempate—: antes devolvía «los últimos 100» sin decirlo, que es un corte invisible, no una página. **Lo que NO hay**: ningún ERP real conectado y **ninguna correspondencia de campos con el esquema de un ERP concreto** —«mapping» se cumple como contrato declarado más catálogo de 24 tipos—. **«Conciliación» NO es criterio de esta historia**: lo es de P1-006 (`docs/18:207`) y P1-007 (`docs/18:208`), y en `docs/15` la tabla de benchmark la asigna a **P1-006**; su única mención en la fila ERP está en la columna *condición de activación*, es decir, lo que haría falta para declarar real una integración con un tercero. Validado sobre `fb46321` (**APROBADA**, 913 pruebas) y demostrado **26/26**. Evidencia: `docs/qa/EVIDENCIA_P1008_INTEGRACION_2026-10-19.md` |
| P1-009 | Simulador de readiness | P0-022/029 | **DONE_LOCAL (2026-10-18)**. Simulación por lote de solo lectura (sin escritura ni escenarios guardados), con entradas y fecha visibles, las mismas reglas que el preflight y el veredicto decidido por las causas: con cualquier causa abierta, `NO EXPORTABLE`. Separa estado real, escenario y lo que seguiría bloqueado (dato / decisión / capacidad). No habilita READY ni el despacho. Evidencia: `docs/qa/EVIDENCIA_P1009_SIMULADOR_2026-10-18.md` |
| P1-010 | Coste de preparación | P0-028/030 | **DONE_LOCAL (2026-10-18)**, con **D-51 adoptada**: importes **declarados** por la organización (no tarifas del producto ni del ejemplo de S3), en USD, versionados y con vigencia; cantidades declaradas y marcadas como estimadas, con lo observado aparte y fechado; ausencia **no es cero**; reparto por productor distinto y por tonelada del peso físico del ledger, o **no calculable**; **reproducible** sobre tablas append-only. Evidencia: `docs/qa/EVIDENCIA_P1010_PRESUPUESTO_2026-10-18.md` |
| P1-011 | Histórico temporal/alertas | P0-006/028 | **DONE_LOCAL (2026-10-18)**: la línea temporal **reutiliza** el registro de cambios ya existente (`plot_history`, el mismo de `GET …/plots/{id}/history`), las versiones de geometría, los trabajos satelitales, la evidencia y las evaluaciones de riesgo — **sin tabla nueva ni migración**. Tres fechas separadas con la ausente **declarada**; años sin registros **rotulados**, nunca interpolados. Comparar publica sus **limitaciones antes del resultado** y advierte que una diferencia **no es mejora ni deterioro**. Cinco alertas **derivadas y de solo lectura** con **problema, impacto, causa trazable y acción** (S4 §20), **sin umbrales ni plazos inventados**. Evidencia: `docs/qa/EVIDENCIA_P1011_HISTORICO_2026-10-18.md` |
| P1-012 | Precio/prima/pagos registrados | P0-012/029 | **DONE_LOCAL (2026-10-18)**: el dinero cuelga de la **entrega existente** (migración **0052**, dos tablas append-only), **sin registro paralelo**. Dato **versionado**: corregir es otra versión **con motivo**, y nada se edita ni se borra. **Moneda y unidad guardadas y nunca convertidas** —lo incompatible queda `NO_CALCULABLE` con su razón—. **Privacidad**: `economics:*` separado de `delivery:*`, técnico de campo sin acceso, auditor de solo lectura, y ni la entrega ni el expediente DD ni el portal del comprador reciben campos nuevos. **Ninguna transferencia**: el pago es **informado** por una persona. **Prima ausente ≠ cero** y **nunca deducida** sin fundamento declarado. **D-52(A) adoptada** el 2026-10-18 en sus tres puntos (base declarada por registro; prima por unidad o fija con fundamento obligatorio; permisos propios de ORG_ADMIN y MANAGER, auditor de solo lectura). Evidencia: `docs/qa/EVIDENCIA_P1012_ECONOMIA_2026-10-18.md` |
| P1-013 | OCR/IA asistida | P0-018/019 | **DONE_LOCAL (2026-10-18)**: **texto extraído**, **valor sugerido** y **dato confirmado por una persona** en **tres tablas append-only** (migración **0053**). **Fuente**: fragmento literal, posición y huella del contenido analizado. **Confianza**: no es un número inventado, es **la regla** —rótulo explícito, patrón único o ambiguo—, con la pareja regla↔confianza impuesta por CHECK. **Revisión** con permiso propio: `document:extract` para proponer, `document:review` para confirmar. **Nada automático** y **nada sale fuera**: el PDF con capa de texto se lee **en local**; lo que **este motor no sabe leer** —imágenes y escaneos— se declara **no soportado** y **no se envía a nadie**. **La falta de OCR es limitación del motor, no una obligación de usar terceros** (los hay locales, p. ej. Tesseract); **no se incorpora aquí**. Evidencia: `docs/qa/EVIDENCIA_P1013_EXTRACCION_2026-10-18.md` |
| P1-014 | Analytics/supplier score | P0-030 | **DONE_LOCAL (2026-10-18)** contra su **aceptación mínima** —«Métricas comerciales separadas de riesgo jurídico, denominadores y permiso»—, que **no pide un score compuesto**: entregados **siete indicadores autodescritos** —qué mide, fórmula, unidad, período, denominador, cobertura, procedencia y límites—, **separados del riesgo jurídico** (ningún indicador usa conclusión, severidad ni resultado técnico), con **permiso propio** `analytics:read` **más el de cada dominio** y descarga con `report:export`. Solo se agrega lo compatible en moneda, unidad, producto y período; lo incompatible **se excluye y se cuenta**. Un **score compuesto no es criterio de cierre**: «supplier score» es el nombre de la capacidad (`docs/03:61`, columna **Capacidad** de la tabla de **evolución**), no su restricción. Si algún día se quiere, exigiría **ponderar** dimensiones con pesos que ninguna fuente fija: queda como **evolución** en **D-53**. Evidencia: `docs/qa/EVIDENCIA_P1014_INDICADORES_2026-10-18.md` |
| P1-015 | Idiomas/SSO/consumo | TECH-001 y piloto | **PARCIAL (actualizada 2026-10-20)**: **D-54 adoptada para desarrollo y demostración local** e implementada y demostrada sobre `4f7e635` — **coste estimado** por organización y período en USD con tarifas declaradas (sin precargar), **SSO OIDC+PKCE con Keycloak real** como proveedor de ensayo, **inglés** como segunda lengua (español fuente) y rechazo al superar límites con explicación (`docs/qa/EVIDENCIA_P1015_COSTE_SSO_IDIOMAS_2026-10-20.md`). **Sigue PARCIAL por un único elemento original: la dependencia «piloto»** (P0-031, no iniciada). Texto original (`03bb2f6:docs/18:157`): dependencia «TECH-001 y piloto» y aceptación «ADR por componente, español conservado y límites/coste/SSO comprobados», cuyos tres puntos están demostrados en local con tarifas sintéticas identificadas y Keycloak de ensayo. **Una tarifa acordada y el proveedor de identidad de un cliente real NO son criterios originales** (ni RF-46 ni esta fila los nombran; S2 lista SSO solo como capacidad del «Nivel 4 — Enterprise»): son configuración comercial de un cliente y, si el piloto la requiere, gates explícitos de P0-031 («hallazgos priorizados y gates pendientes explícitos»); no se añaden como compuertas de P1-015. No se cambió ningún criterio. Si la dependencia «piloto» puede darse por satisfecha por evidencia local (regla de `docs/18` «dependencia satisfecha por evidencia o contrato/mock explícito») es una decisión del propietario del producto, **no tomada**. Estado de 2026-10-18: entregados los **tres ADR por componente** (**0007** multilenguaje, **0008** acceso federado, **0009** consumo/límites/coste), el **español conservado** —idioma declarado y sin claves de traducción— y los **límites comprobados**: 10 publicados con su valor, **procedencia** y **efecto al superarlos**, verificados **superando uno de verdad**. El **consumo** se mide y **no se presenta como coste**. **Faltan «coste» y «SSO» comprobados**, y su condición **sale de los criterios**: no hay tarifa acordada, no hay proveedor de identidad (ya lo decía ADR-0005) y **no hay piloto**, que es dependencia de la historia. Decisiones abiertas en **D-54**, ninguna adoptada. Evidencia: `docs/qa/EVIDENCIA_P1015_LIMITES_2026-10-18.md` |

## Ampliaciones autorizadas (posteriores a la documentación original)

| ID | Resultado | Dependencia | Aceptación mínima |
| --- | --- | --- | --- |
| A-01 | Captura de campo desde la web con alcance propio (RF-48, `docs/03`) | P0-006–010, P0-018, P0-028 | Ver «Ampliación autorizada A-01» en `docs/03`. **Estado (2026-10-20): DONE_LOCAL** sobre `4913dd3` (validación APROBADA `validation-results/2026-10-20T23-04-37-016Z`; `90bf744` y `f86340d` FALLARON, `0caed16` y `6af11a8` aprobaron sin ser el cierre; todo se conserva). Incluye mapa base local y fotografías propias, desplegado, demostrado por roles (27 + 6 + 1 comprobaciones) y con respaldo `…-a01-mapa-fotos-0057` verificado. Evidencia: `docs/qa/EVIDENCIA_A01_CAPTURA_CAMPO_2026-10-20.md`. **No acredita producción, Android real, conformidad EUDR ni satélite real.** No sustituye los criterios con teléfono de P0-023/P0-024, que siguen pendientes |

## P2 fuera del MVP

Marketplace de servicios, red colaborativa de datos/capas, IA asistente avanzada, financiación/seguros, pagos reales, carbono, predicción, blockchain/tokenización y expansión. Cada iniciativa requiere caso de negocio, permiso/privacidad, ADR y requisitos propios; no inferir autorización para implementarlas de su mención en el benchmark.

## Gestión

Estados: `PENDIENTE_DE_VERIFICAR → GAP_CONFIRMADO → READY_FOR_DEV → IN_PROGRESS → IN_REVIEW → VERIFIED`; `BLOCKED` con motivo y siguiente acción. Regla: dependencia satisfecha por evidencia o contrato/mock explícito, no por checkbox. Estimación se hace tras inspeccionar código y equipo; no heredar el calendario ilustrativo como compromiso.

### Corrección de dependencias por capacidad (2026-10-10)

Se detectó un ciclo: P0-012 dependía de P0-011 completa; el criterio de transformación de P0-011 solo se demuestra con P0-016, que depende de P0-012. Fundamento de la corrección: una dependencia expresa la **capacidad** que la historia consumidora necesita. Entregas necesita productos y unidades válidos (verificado), no la transformación. Por eso P0-012 depende de la capacidad «catálogo y unidades» de P0-011, y el criterio de transformación sigue dentro de P0-011, abierto hasta P0-016. No se eliminó ni simuló ningún requisito.

| Capacidad | Historia | Estado | Bloquea a | No bloquea |
| --- | --- | --- | --- | --- |
| Catálogo de productos y unidades | P0-011 | Verificada | — | P0-012 |
| Transformación con evento/rendimiento | P0-011 | Pendiente (demostrable con P0-016) | Cierre de P0-011 | P0-012 |
| Autorización dentro del tenant | P0-003 | Verificada | — | P0-015 (eventos del tenant) |
| Concesiones externas (grants) | P0-003 | Bloqueada (contrato ausente, ADR-0002/P1-001) | Eventos visibles a terceros con concesión (P0-015), P1-001 | Eventos del tenant |
| Elevación de plataforma | P0-003 | Bloqueada (D-04) | Acceso de SUPER_ADMIN a eventos de un tenant | Eventos del tenant |

### Criterio de cierre de la etapa local (desde 2026-10-10)

Estado adicional `DONE_LOCAL`: criterios de la historia cumplidos con evidencia de pruebas locales (`npm run validate` aprobado + suites de la historia) y documentación al día. No requiere GitHub Actions. No equivale a producción ni a conformidad EUDR. Un criterio que dependa de una decisión no tomada o de un contrato inexistente deja la historia abierta solo si ese criterio forma parte de su aceptación; el resto de decisiones provisionales se registran sin bloquear. Estado vigente en docs/23.

**Aclaración de alcance de A-01 (2026-10-21):** roles canónicos y permisos base intactos; A-01 añade capacidades a Productor (parcelas vinculadas), Técnico (asignados), Administrador (su organización) y Gerente (según sus permisos vigentes), sin facultades sobre otros módulos ni sobre satélite, evidencias o riesgo; la web no sustituye el ensayo físico móvil (pospuesto). Detalle y corrección del permiso `producer:link_self` del Gerente: `docs/07`.

## Ampliaciones autorizadas A-02 y A-03 (2026-10-21)

| ID | Resultado | Dependencia | Estado |
| --- | --- | --- | --- |
| A-02 | Administración web de concesiones externas (RF-49, `docs/03`) | P0-003, P1-001 | **DONE_LOCAL (2026-10-21)** sobre `0211a30` (validación APROBADA `2026-10-21T03-04-51-749Z`; `acac9b5` falló dos veces por la preparación de `a01-alcance-propio`, conservado) — evidencia `docs/qa/EVIDENCIA_A02_CONCESIONES_2026-10-21.md`; límite explícito: `/compartido` sigue en español. Distinta de P1-001, que sigue DONE_LOCAL con la aceptación que tenía (portal del destinatario) |
| A-03 | Traspaso de custodia entre organizaciones (RF-50, `docs/03`) | P0-012–017, P0-029, P1-001 | **Núcleo operativo ADOPTADO y desarrollado (2026-10-21)** (`docs/decisiones/A03-TRASPASO-ENTRE-ORGANIZACIONES.md` §0 y §12); **`DONE_LOCAL` (2026-10-21) sobre `d99f40a`** (validación APROBADA `2026-10-21T15-35-07-183Z`; la 1.ª ejecución del mismo SHA, `T04-40-04`, fue FALLIDA por timeouts de preparación y se conserva; causa no identificada) — `docs/qa/EVIDENCIA_A03_TRASPASO_2026-10-21.md`. **Salida real BLOQUEADA** (D4 no adoptada, D-34); **D2 pendiente de revisión competente**. Fuera del conteo 42/60 y 30/44 |

**A-02 — alcance de la entrega**: pantalla `/organizaciones/{id}/concesiones` (menú Administración, solo con `grant:manage`); lista con filtro por estado (activa, vencida, revocada) y la historia de cada concesión; alta guiada en cuatro pasos (recurso, destinatario por correo exacto, alcance y vigencia, revisión y confirmación); revocación con motivo; español e inglés. Cambios de API: correo exacto, `shareable`, lista enriquecida y límite de intentos (ver `docs/09`).
**A-03 — alcance de la entrega**: migración `0058` (cinco tablas, movimientos `CUSTODY_*`, lote `CUSTODY_TRANSFER`), servicio y API de vínculos y traspasos (ver `docs/09`), siete permisos (`docs/07`), eventos y auditoría, pantallas `/traspasos` en español e inglés. **Fuera de alcance**: compraventa (D7), exportación, activación de la salida real (D4), herencia de diligencia (D2), origen completo en la receptora (D3 c), tolerancias (D5 b), conversión de unidades (D8 b).

## Ampliación autorizada A-04 (2026-10-23)

| ID | Resultado | Dependencia | Estado |
| --- | --- | --- | --- |
| A-04 | «Mi ubicación» en la captura geográfica de parcelas (web y móvil): obtener la posición del dispositivo, centrar el mapa y mostrar su precisión; incorporarla solo con una acción explícita | P0-007, P0-008, A-01, P0-023 | **DONE_LOCAL (2026-10-23)** sobre `5f77b72` (validación APROBADA `2026-10-23T03-00-54-744Z`; `353d23e` falló por una carrera del test de productos). Evidencia: `qa/EVIDENCIA_A04_MI_UBICACION_2026-10-23.md`. **Posición EMULADA; teléfono físico pendiente.** |

**A-04 — alcance**: web (mapa de dibujo, polígono por vértices y punto de referencia) y móvil (pantalla de captura). Localizarse **no** guarda ni mueve geometrías ni añade vértices; cada lectura conserva SU precisión y SU hora; una lectura de más de 60 s exige localizarse otra vez; la precisión nunca se inventa ni se atribuye al polígono; ubicación en primer plano y a petición (sin seguimiento ni segundo plano). Sin permisos nuevos ni roles nuevos: aparece solo donde ya hay captura/edición. Sin proveedor cartográfico externo; la app móvil no incluye mapa.

## Ajuste mínimo de producto y documentación (AJ, 2026-10-23)

Fuente: plan de ajuste del propietario (`docs/contexto/`) y contexto funcional de Ecuador; **no son requisitos nuevos**: completan historias originales (UI-22/UX-D08, P0-018, P0-019, P0-027, P1-005).

| ID | Resultado | Historia original | Estado |
| --- | --- | --- | --- |
| AJ-02 + AJ-03 (entrega 1; rotulado A-05 en código y pruebas) | «Mi finca» y aportación documental contextual con guía orientativa, reutilizando el servicio de documentos | UI-22; P0-018/019/027; P1-005 | **DONE_LOCAL** sobre `42f7433` (validación APROBADA `2026-10-23T05-44-49-396Z`); evidencia `qa/EVIDENCIA_A05_MI_FINCA_DOCUMENTOS_2026-10-23.md` |
| AJ-02/AJ-03/AJ-04 (entrega 2) | Entregas propias del productor (solo listado, `delivery:read_own`), textos desactualizados de documentos/entregas y atribución de la revisión humana (sin titularidad por entrega: el modelo vigente es `delivery_supports`) | UI-22; P0-012; P0-018 | **DONE_LOCAL** sobre `53f6e81` (validación APROBADA `2026-10-23T07-56-18-883Z`); evidencia `qa/EVIDENCIA_AJ_ENTREGA2_2026-10-23.md` |
| AJ-01 | Aclaración semántica (orientación / soporte / comprobación técnica / revisión humana) en la documentación vigente (`docs/03`, `07`, `13`, `22`, `UX_UI`) | RF-18/19/36 | **Hecha (2026-10-23)**; solo documentación |
| AJ-04 | Avisos y accesos de roles afectados | RF-27 | **Hecha** en los recorridos intervenidos (entrega 2); no se abrió una reescritura general |

| AJ-03 (tipos documentales) | Soportes ambiental, laboral y de derechos de terceros: tipos que solo clasifican (migración `0066`), guía integrada, recorrido positivo con productor vinculado | RF-18/19/36; P0-018; P1-005 | **DONE_LOCAL** sobre `b83026d` (validación APROBADA `2026-10-23T13-16-46-803Z`; respaldo `_respaldos/2026-10-23-tipos-documentales-0066/`); evidencia `qa/EVIDENCIA_AJ03_TIPOS_DOCUMENTALES_2026-10-23.md` |
| AJ-04 (Legalidad y soportes) | Puerta de entrada documental: aspectos con fuente y fecha, dónde aportar, qué falta y observaciones; perfil técnico en Administración | RF-18/19/36; P0-018 | **DONE_LOCAL** sobre `75b0592` (validación APROBADA `2026-10-23T14-29-27-735Z`); evidencia `qa/EVIDENCIA_AJ04_LEGALIDAD_Y_SOPORTES_2026-10-23.md` |
| AJ-05 (análisis de deforestación) | Adaptador Whisp alineado con 2.3.1, procedencia y valores del proveedor en la parcela, recorrido guardado/consultable con servidor controlado, ensayo real protegido | RF-28; P0-028; QA-15 | **DONE_LOCAL** del mecanismo sobre `90205a8` (validación APROBADA `2026-10-23T15-41-03-942Z`); **prueba real NO EJECUTADA** (falta clave de API y autorización del propietario); evidencia `qa/EVIDENCIA_AJ05_ANALISIS_DEFORESTACION_WHISP_2026-10-23.md` |

### Estado consolidado AJ-03 / AJ-04 / AJ-05 (2026-10-23)
| Frente | Estado | Commit / evidencia |
| --- | --- | --- |
| Ajuste documental (tipos y soportes) | **Terminado**, conservado | AJ-03 `b83026d` (resultados `382535a`) |
| Interfaz jurídica | **Comprobada** (el aviso «perfil parcial» ya no es contenido principal; vive en Administración) | AJ-04 `75b0592`, resultados `6f6ae42`; `qa/EVIDENCIA_AJ04_…` |
| Integración satelital | **Implementada y alineada con Whisp 2.3.1**, probada con servidor controlado; llamadas reales deshabilitadas | AJ-05 `90205a8`, resultados `0b767f9`; `qa/EVIDENCIA_AJ05_…` |
| Ensayo real con Whisp | **Pendiente de insumo**: clave de API del propietario + su autorización expresa (términos aceptados por él) para una geometría artificial | `e2e/review/whisp-ensayo-real.mjs`; `decisiones/P0-028-WHISP-CONTRATO-2.3.1.md` |
| AJ-06 (trabajo asíncrono y credencial) | Avance, reanudación sin reenvío y cancelación en el proveedor; registro cifrado de la credencial por organización (migración `0067`); descarga alternativa del ensayo directo | RF-28; P0-028 | **DONE_LOCAL** sobre `6239de1` (validación APROBADA `2026-10-24T01-55-57-068Z`; respaldo `_respaldos/2026-10-24-satelite-0067/` con restauración aislada); **ensayo real NO EJECUTADO**; evidencia `qa/EVIDENCIA_AJ06_TRABAJO_ASINCRONO_Y_CREDENCIAL_2026-10-24.md` |
| AJ-07 (Whisp: envío incierto, reserva, original y descarga) | H2–H6 del plan de revisión: envío incierto sin reenvío (migración `0068`), reserva de a un trabajo, original inmutable por arrendamiento, descarga autorizada con huella, periodo rechazado, ensayo directo robusto | RF-28; P0-028 | **DONE_LOCAL** sobre `210d8f5` (validación APROBADA `2026-10-25T03-08-19-345Z` desde copia en SSD con Postgres temporal; cuatro ejecuciones previas FALLIDAS por latencia del disco USB, conservadas; respaldo `_respaldos/2026-10-25-satelite-0068/` con restauración aislada); **ensayo real NO EJECUTADO**; evidencia `qa/EVIDENCIA_AJ07_ENVIO_INCIERTO_ORIGINAL_Y_DESCARGA_2026-10-25.md`. **Entrega 2 (H7 riesgo, H8 expediente): implementada (`bd60914`, `ff0df37`) y comprobada con pruebas dirigidas el 2026-10-27; sin `validate` integral** |
