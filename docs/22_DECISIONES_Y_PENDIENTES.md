# Decisiones y pendientes

Estas cuestiones no bloquean la lectura ni preparación del paquete. Bloquean únicamente la implementación que dependa de ellas. Resolver primero mediante repositorio/evidencia; preguntar al responsable solo lo que no se pueda determinar.

Resumen ordenado por lo que bloquea criterios originales, con qué historia desbloquea cada decisión:
**`docs/decisiones/DECISIONES-MINIMAS-PARA-CERRAR.md`** (recomendaciones, ninguna aprobada).

| ID | Decisión/diferencia | Responsable propuesto | Evidencia de cierre |
| --- | --- | --- | --- |
| D-01 | Stack NestJS/Next vs antecedente FastAPI/React | Tech lead | Manifiestos/commit y ADR-0001 |
| D-02 | Repo existente/vacío, monorepo o repos separados | Tech lead | Layout real; estrategia de integración sin duplicación |
| D-03 | 12 roles fuente vs catálogo ampliado previo | Backend/producto | Catálogo/migraciones/permisos; no inventar códigos |
| D-04 | Política de elevación SUPER_ADMIN y grants | Seguridad/dueño datos | Matriz aprobada y QA-02 |
| D-05 | Umbral GIS, borde =4 ha, precisión/formato de destino. **Partida en dos (2026-10-15)**: **D-05.A perfil técnico — ADOPTADO para desarrollo local** e implementado como `EUDR_GEO_V1` (migración `0041`); **D-05.B aplicabilidad jurídica — PENDIENTE**, necesita responsable regulatorio. Cumplir el perfil técnico **no es conformidad** y nada se ha probado contra el servicio real. `docs/decisiones/D-05-PROPUESTA.md` | GIS/regulatorio | A: hecho. B: qué actor es cada usuario (Art. 2(15)), condiciones del Art. 2(15a) y Anexo III |
| D-31 | Contrato de productos (provisional, P0-011): catálogo por organización (S1: `organization_id`); estados/presentaciones de sistema solo los 4 de las fuentes; código, estado y unidad inmutables desde la creación; gestión solo ORG_ADMIN | Producto/Data Steward | Ratificado; nuevos estados o permisos con migración |
| D-32 | Unidades y conversiones. **Parte resuelta — adoptada como regla provisional del MVP local (2026-10-15, instrucción del responsable de producto; no es validación en campo ni aprobación para producción)**: la **humedad** del secado se declara en **`%BH` (porcentaje en base húmeda)**, como una **medición** con **método y responsable**, obligatoria para cerrar el secado; la precisión se conserva hasta la que el almacenamiento admite (seis decimales) y **más precisión se rechaza con su motivo, nunca se redondea al escribir**; un decimal es **presentación**, no almacenamiento; el tope de 100 es estructural, no un límite de calidad; no se deduce la humedad de la merma ni se convierten masas por humedad. Detalle en `docs/decisiones/D-32-PROPUESTA-HUMEDAD.md`; implementado en la migración `0040` (KDE 1.6.0, compuertas 1.6.0, CTE 1.6.0). **Sigue pendiente**: unidades adicionales de peso (quintal, libra u otras), sus factores exactos y la regla de redondeo —no se introdujo ninguna— y los **límites de aceptación de calidad** de la humedad, que esta adopción no define. | Producto/operación | Lista de unidades y factores exactos aprobados, con regla de redondeo |
| D-33 | **Adoptado para el MVP local (2026-10-10, instrucción de diseño; no validada en campo)**: calidad durante la recepción o después del pesaje; sin dato = «Pendiente de evaluación»; recepción física y calidad como estados separados; sin tolerancias ni cierre por debajo de lo declarado (`docs/decisiones/D-33-34-35-MVP-2026-10-10.md`). **Ampliado el 2026-10-15 (instrucción del responsable de producto; aprobación para desarrollo, no validación en campo ni producción)** con el **cierre de entregas**: cierre explícito por quien puede confirmar recepciones, exigiendo además `delivery:correct` cuando hay diferencia; diferencia = declarado vigente − suma de recepciones vigentes, conservando ambas cifras; **toda** diferencia (± ) exige motivo escrito, lo que **no** prohíbe cerrar con diferencia; una entrega cerrada **no admite recepciones nuevas ni reapertura** (lo impide el guardián de la tabla, no solo la aplicación); las correcciones conservan todas sus guardas por asignación, reserva y consumo; si una corrección admitida cambia la diferencia, el cierre y su motivo **se conservan**, el estado derivado pasa a `CLOSED_JUSTIFICATION_STALE` y se exige **añadir** una justificación nueva —nunca sustituir la anterior—. Detalle y modelo de estado en `docs/decisiones/D-33-PROPUESTA-CIERRE-ENTREGAS.md`; implementado en la migración `0040` (`delivery_closures`, append-only). **Sigue pendiente**: historias de HARVEST (production_records), PACKAGING y SALE; obligatoriedad de hitos (`required` de S1) por flujo; catálogo de parámetros y **límites de aceptación de calidad**; y la comprobación con operadores reales de la regla de cierre. | Producto/trazabilidad | Historias asignadas, obligatoriedad por flujo y regla de cierre/tolerancias aprobadas |
| D-34 | **Adoptado para el MVP local (2026-10-10, instrucción de diseño; no validada en campo)**: `deliveries.production_period` con precisión día / mes o intervalo de meses / desconocido; meses como modalidad principal; desconocido no bloquea y queda pendiente (KDE 1.1.0). **Vigente desde 2026-10-16 (rev. 4 de `docs/decisiones/D-34-PROPUESTA.md`): opción A ADOPTADA como regla provisional del MVP local** —para despachar se exige el paquete final de diligencia, sin excepción por «no sujeto»; el vínculo es PREVIO (reserva activa, válida y de la misma organización) y se registra por ítem (`shipment_items.dd_package_export_id`; la columna única de `shipments` queda retirada); migración `0045`, catálogo KDE 1.7.0. Es política operativa de producto, no una afirmación jurídica, y no desbloquea el despacho mientras el expediente no pueda aprobarse (D-05.B, D-07.5/.6, P1-005, D-09.B). **Histórico (texto anterior, conservado):** «Pendiente: condición escrita de `shipments.dd_package_id` y `shipments.dispatch_at` (embarques P0-029; P0-022 no los usa todavía: el vínculo con embarques queda NO EVALUABLE en el expediente). Desde 2026-10-12 la compuerta SHIPMENT_DISPATCH (KDE 1.5.0) los marca BLOCKED_PENDING_DECISION: **ningún embarque se despacha hasta resolver D-34**. **Propuesta escrita el 2026-10-16** con el texto exacto, tres opciones (A siempre obligatorios · **B según el destino, recomendada** · C al cerrar, descartada), lo que cada una permitiría demostrar y el trabajo que haría falta DESPUÉS de decidir: `docs/decisiones/D-34-PROPUESTA.md`. » (Resuelto en la rev. 4: la opción A se adoptó; B y C quedaron descartadas.) | Producto/trazabilidad | Hecho (A, provisional). Sigue abierto el despacho real: D-05.B, D-07.5/.6, P1-005, D-09.B |
| D-35 | **Adoptado para el MVP local (2026-10-10, instrucción de diseño; no validada en campo)**: nota de entrega o recibo firmado como soporte base; guía de remisión, liquidación y varios soportes admitidos; la ausencia no impide la recepción física y queda pendiente (también como requisito PENDIENTE en el expediente P0-022). **Pendiente**: uso real de los documentos con productores/acopios y su validez jurídica (requiere perfil jurídico, P1-005). | Producto/trazabilidad | Validación en campo y perfil jurídico aprobado |
| D-37 | Evidencias (provisional, P0-019): catálogo de afirmaciones limitado a docs/12 con entidad existente; ¿se impide que quien aporta o envía verifique su propia afirmación (separación de funciones, docs/12 «si la política lo impide»)? Hoy se permite y queda registrado; ¿plazo o motivo obligatorio para revisar tras una nueva versión? **Alcance:** es la política de autoverificación y de revisión de evidencias. **No** abarca qué puede ser evidencia: el contrato de «resultado satelital → evidencia» es **D-42**, y solo cuando exista se le aplica esta política | Producto/EUDR | Política de separación de funciones y de revisión aprobada |
| D-42 | **Resultado satelital como evidencia** (abierta desde P0-028; S1 §95 encadena `Result → Evidence → Risk`). D-37 **no** la cubre: D-37 decide la separación de funciones al verificar una afirmación, no qué afirmación es un resultado satelital. Falta: (1) **tipo de afirmación** en el catálogo de docs/12 y su entidad titular (¿la versión de parcela, el lote, el productor?); (2) **qué acredita exactamente** un resultado con cobertura y qué NO acredita; (3) si una evidencia así requiere verificación humana o es evidencia de sistema con procedencia (y entonces, quién responde de ella); (4) **caducidad**: qué pasa con la evidencia cuando cambia la versión geométrica o la versión del dataset del proveedor. Mientras no exista, un resultado satelital **no se vincula como evidencia**: se consulta en la ficha de la parcela con su procedencia | Producto/EUDR | Tipo de afirmación, titular, alcance probatorio, régimen de verificación y caducidad aprobados; después se aplica D-37 a su verificación |
| D-38 | Auditoría (provisional, P0-025): exportación en CSV `TL_AUDIT_CSV 0.1` (formato local propuesto; las fuentes no definen uno), máximo 5000 registros por archivo, entregada en la respuesta sin almacenarla; `audit:export` concedido a ORG_ADMIN y AUDITOR (los roles que ya tenían `audit:read`; docs/07 lista «audit: read, export»); lista blanca de campos por tipo de registro. ¿Formato definitivo (CSV/JSON/PDF firmado), retención y límite? ¿Auditor externo por encargo con período/alcance acotado (P0-003 grants)? ¿Debe auditarse también la consulta (no solo la exportación)? | Producto/Seguridad/Cumplimiento | Formato, límites, retención y alcance del auditor aprobados |
| D-39 | Lotes y procesos (P0-016, propuesta sin aprobar): (1) ¿lotes con insumos de origen desconocido sin mezclar, o prohibidos? (docs/05 prohíbe mezclarlos); (2) ¿bloquear toda corrección de peso de una recepción ya asignada?; (3) ¿humedad de secado sin unidad (D-32) como pendiente permitido o bloquea el cierre?; (4) roles de procesamiento (QUALITY_OPERATOR en secado, MANAGER en lotes). Detalle y reglas R1–R10 en `docs/decisiones/P0-016-017-PROPUESTA-LOTES-INVENTARIO.md` **2026-10-10 — ADOPTADAS como reglas provisionales del MVP local** por instrucción del responsable de producto (no es validación en campo ni ratificación para producción): (1) lotes separados «Origen incompleto», sin mezcla con origen conocido, condición conservada en salidas; (2) corrección de peso bloqueada con asignación activa, reserva o consumo; permitida tras liberar por completo sin consumo; (3) secado se prepara e inicia, cierre bloqueado hasta definir la unidad de humedad (D-32, sigue pendiente); fermentación independiente; (4) MANAGER crea lotes; cerrar procesos exige `process:close` (no por el rol de calidad). Más: control de ciclos en todo enlace y FERMENTATION/DRYING integradas por separado. Implementado en P0-016. | Producto/trazabilidad | Las cuatro respuestas registradas antes de implementar P0-016 |
| D-36 | Documentos (provisional, P0-018): tipos LAND_TENURE y DELIVERY_SUPPORT; formatos PDF/JPEG/PNG; 10 MiB por archivo y 1 GiB por organización; LAND_TENURE como datos personales (contenido con `producer:read_identity`); análisis antes de almacenar (infectado no se guarda); retención de versiones sin plazo; autorrevisión permitida pero marcada | Producto/seguridad/legal | Tipos, límites, clasificación y retención aprobados |
| D-30 | Regla técnica `TL_GIS_TECH 1.0.0` (provisional): comparación dentro de la organización con parcelas activas; «punto dentro de otra parcela» fuera de V1; igualdad/solape → REVIEW_REQUIRED; comparaciones con geometrías inválidas → WARNING | GIS/Data Steward | Regla ratificada; cambios crean otra versión de regla |
| D-06 | Stock negativo y ajustes | Operaciones/traceability | ADR-0003 y QA-06; no bypass de consumo |
| D-43 | **Rotación de las claves de cifrado de datos personales** tras exponerse `PII_KEYS` y `PII_INDEX_KEY` en consola. **ADOPTADA Y EJECUTADA en local el 2026-10-16**: alcance **C** (datos mutables **e historial**), **rotación del índice ciego**, **custodia declarada** de los respaldos y ejecución inmediata. Recodificados 39 tokens de `k1` a `k2` y 6 índices; contenido, autoría, fechas y orden del historial **idénticos**; `k1` retirada del llavero activo y el sistema vivo funciona sin ella. Ensayo previo en copia aislada: **19/19**. **No resuelto, y declarado**: los respaldos anteriores siguen cifrados con la clave expuesta —no se borran ni se les retira la clave— y la transcripción sigue siendo material sensible. `docs/decisiones/D-43-ROTACION-CLAVES-PII.md` · `docs/qa/EVIDENCIA_D43_ROTACION_PII_2026-10-16.md` | Seguridad/producto | **Cerrada** salvo la custodia continuada de los respaldos |
| D-07 | Severidad/proceso/conclusión riesgo. **Mecanismos D-07.1, D-07.2 y D-07.4 ADOPTADOS para el MVP local (2026-10-15)** e implementados (migración `0042`): aprobación con permiso `risk:approve_rules` y **adopción por organización** separada de la publicación global; severidad **por regla y versión**, agregada por **máximo**, siempre **con su cobertura**, y `NOT_ASSESSED` cuando no hay hallazgos (**A.2**: no se asigna «bajo» por ausencia); desactualización por cambio de datos o de reglas. **D-07.3 NO APLICA**: sin pesos ni cortes. **Catálogo técnico `1.0.0` PUBLICADO el 2026-10-15** (migración `0043`, matriz aprobada en `docs/decisiones/D-07-MATRIZ-CATALOGO.md`): ocho reglas, cinco con severidad —**las cinco graduaciones son decisiones de producto, no exigencias de la norma**— y tres sin ella; versión **inmutable**; `0.1.0` y `0.2.0` intactos. **Publicar no es adoptar**: ninguna organización **real** lo ha adoptado (solo existe un ensayo local en la Cooperativa DEMO, comprobado el 2026-10-20) y sin adopción no se clasifica nada. **D-07.5 y D-07.6 PENDIENTES**: `risk_rule_sets.regulatory_profile` es `NULL` en todas las versiones, el requisito `RISK_CATALOG_APPROVED` del expediente sigue `NOT_EVALUABLE` incluso con el catálogo adoptado, y la conclusión regulatoria sigue `UNDETERMINED` por `CHECK` | Producto/regulatorio | Perfil jurídico (D-07.5); quién concluye (D-07.6) |
| D-08 | Estados expediente vs DDS existente | Backend/EUDR | Contrato y migración no destructiva; QA-12 |
| D-09 | Proveedor satelital y cobertura/coste. **Parte A ADOPTADA (2026-10-15)**: Whisp es el primer **adaptador de desarrollo** (`satellite_providers.WHISP = SELECTED_FOR_DEVELOPMENT`); permite construir y probar el adaptador contra servidores controlados y **no** autoriza llamadas reales, envío de geometrías, claves reales, contratación ni aceptación de términos. **Parte B PENDIENTE**: autorizar el uso real exige, además de marcar `SELECTED` con responsable, el interruptor `SATELLITE_LIVE_CALLS` y las condiciones de abajo. Propuesta y contraste: `docs/decisiones/P0-028-SATELITE.md` (Whisp como primer adapter, GFW como segundo, JRC como capa de referencia; con licencia, coste, límites y **qué datos saldrían del equipo**). Pendientes antes de enviar una sola coordenada: autorización para que las geometrías salgan hacia un tercero y su base de tratamiento (D-14), aceptación de los términos del proveedor, titularidad de la clave de API y significado operativo de cada indicador (D-07) | GIS/comercial | Canal/contrato/fixture/resultados reales |
| D-10 | Requisitos legales Ecuador | Responsable legal | Fuentes completas vigentes y perfil de aplicabilidad |
| D-11 | GUIA/Agrocalidad | Integraciones | API/acuerdo/export oficial comprobados |
| D-12 | EUDR-IS/rol legal/representación | Regulatorio/integraciones | Documentación vigente, acceso ACCEPTANCE y autorización |
| D-13 | Persistencia y sesión offline | Mobile/seguridad | Arquitectura real, política, QA Android |
| D-14 | Retención y base del tratamiento | Privacidad/Data Owner | Política aplicable por clase de dato |
| D-15 | SLO/RPO/RTO y costes | Operaciones/comercial | Medición del piloto/restore y compromiso acordado |
| D-16 | Tarifas/planes y titularidad de datos | Comercial/legal | Hipótesis validadas/contrato, no precios de benchmark |
| D-17 | OpenAPI y enlaces tipados | Backend | Schema executable validado + integridad DB |
| D-18 | Catálogo de `organization_type` (hoy código libre `^[A-Z_]{2,40}$`) | Producto | Catálogo aprobado y migración con CHECK/FK |
| D-19 | Mecanismo definitivo de invitación y verificación de correo (hoy enlace provisional) | Producto/seguridad | Tres decisiones separadas en ADR-0005: autenticación (local u OIDC), verificación del correo y entrega de invitaciones |
| D-20 | Umbrales del límite de login (5/20/50 por 15 min) y tolerancia al bloqueo temporal por terceros | Seguridad | Valores aprobados o ajustados con datos del piloto |
| D-21 | ¿`producer_code` distingue mayúsculas/minúsculas? | Producto/Data Steward | Regla aprobada; si se unifican, migración con detección previa de colisiones |
| D-22 | Reglas de coincidencia adicionales a la identidad (nombre + comunidad, teléfono…) | Producto/Data Steward | Reglas aprobadas con umbral y tasa de falsos positivos medida |
| D-24 | ¿AUDITOR necesita coordenadas exactas para verificar geolocalización? (hoy no las recibe) | Producto/regulatorio | Política de acceso por rol y propósito aprobada |
| D-25 | Política de calidad de precisión de ubicación (umbrales de advertencia; hoy solo se muestra el valor informado o «no informada») | GIS/campo | Umbral aprobado y probado en campo |
| D-26 | Geometría técnicamente no válida (p. ej. autointersección) «conservada para revisión» (P0-008, provisional): solo con confirmación expresa, sin superficie, `NOT_VALIDATED` y motivo en `notes`; sin reparación automática. ¿Se admite en operación o se bloquea siempre? | Producto/GIS | Política aprobada junto con la validación GIS (P0-010) |
| D-27 | Política de vértices repetidos consecutivos (hoy se advierten y se cuentan; ≥3 distintos es el mínimo) y tolerancia de distancia mínima entre vértices | GIS/campo | Regla aprobada con datos de campo |
| D-28 | Perfil de importación GeoJSON `GEOJSON_IMPORT_V1` (provisional): FeatureCollection de una sola feature aceptada; EPSG:4326 declarado rechazado por ambigüedad de ejes; altitud rechazada; límites por defecto 1 MiB / 5000 posiciones / 50 componentes | GIS/Producto | Perfil aprobado junto con el «perfil destino» (P0-010/D-05) |
| D-29 | Retención de originales importados: los descartados se borran; los confirmados se conservan sin plazo (sin caducidad). El barrido está programado en el worker (huérfanos con gracia de 1 h y descartados; tareas reintentables) | Operación/legal | Plazo de retención aprobado y barrido programado |
| D-23 | Catálogo de `survey_method` (provisional: DECLARED, MANUAL_COORDINATES, BROWSER_GEOLOCATION y FILE_IMPORT en uso desde P0-009; reservados GPS_POINT para el GPS nativo de la app móvil y GPS_POLYGON) y estados de parcela (ACTIVE/INACTIVE por la convención de baja lógica) | Producto/GIS | Catálogo aprobado; nuevos valores con migración |

### Decisiones UX (docs/UX_UI.md §27.2) aplicadas en la interfaz

UX-D01 logotipo: sin activos oficiales en el proyecto → identificación textual «TERRA LINK» (no se redibuja el logo). UX-D02 Inter: se usa si está instalada; si no, fuente del sistema (no se distribuye). UX-D03 tokens auxiliares y títulos operativos: aplicados como propuesta UX-V1. UX-D08 (PRODUCER) y UX-D09 (BUYER/concesiones): cuentas creadas solo con membresía propia; experiencias rotuladas como pendientes. Ninguna bloquea criterios de P0-001 a P0-005.

### Efecto de cada decisión abierta sobre los criterios (2026-10-10)

Ninguna decisión es un bloqueo global. Solo bloquea la historia cuyo criterio de aceptación la necesita.

| Decisión | Comportamiento afectado hoy | ¿Bloquea un criterio? |
| --- | --- | --- |
| D-04 elevación SUPER_ADMIN | Acceso de plataforma a miembros, bitácora u operación sin membresía (hoy `ELEVATION_REQUIRED`/404) | **Sí**: P0-003 «superadmin/elevación» |
| Grants entre organizaciones (ADR-0002, P1-001) | Acceso de BUYER/AUDITOR externos | **Sí**: P0-003 «buyer/grants» |
| D-18 tipos de organización | Catálogo provisional de 8 tipos; no afecta permisos | No (P0-001 solo exige datos mínimos) |
| D-19 autenticación, verificación de correo, entrega de invitaciones | Invitación por enlace manual; correo sin verificar | No para P0-002 en local; sí antes de operación real |
| D-20 umbrales de login | 5/20/50 por 15 min, configurables | No |
| D-21 mayúsculas/minúsculas en `producer_code` | Hoy `PRD-1` y `prd-1` son códigos distintos (unicidad exacta tras recortar espacios) | No: el contrato solo exige unicidad por organización |
| D-22 reglas adicionales de coincidencia (nombre, ubicación) | Solo se aplica la regla documentada de identidad (mismo tipo y número de documento) | No: P0-005 exige la coincidencia de identidad |
| D-23 métodos de levantamiento y estados de parcela | Métodos DECLARED y MANUAL_COORDINATES disponibles; el resto se rechaza con 422 hasta su historia | No: P0-006 exige versión y método, no un catálogo cerrado |
| D-05 umbral GIS | **Desde el 2026-10-15 el umbral SÍ se aplica** en el perfil `EUDR_GEO_V1` (estricto, con 4 ha exactas admitidas), como dictamen **aparte** de `TL_GIS_TECH`. Lo que sigue sin aplicarse es la **conclusión regulatoria** (D-05.B) | P0-010 cerrada; la conclusión sigue fuera |
| Matriz `producer:*` | Propuesta provisional (doc 07) | No |
| ADR-0001 / ADR-0005 sin ratificar | Stack y autenticación adoptados para desarrollo | No en local |
| D-05, D-06… (GIS, stock) | Historias futuras | Se evaluarán en su historia |
| D-40 | Autorización local de captura más larga que la sesión (P0-023, **propuesta concreta redactada 2026-10-30 en `docs/11`; NO aprobada y NO aplicada**): hoy la captura termina al vencer el JWT (1 h). Decisión: **A** mantener 1 h · **B** credencial local de hasta 7 días con desbloqueo local · **C** otra duración. Conservar lo capturado 7 días y reconectar para enviar ya funcionan; lo único que depende de D-40 es **capturar de nuevo** esos días. Si se requiere trabajo de campo más largo, decidir credencial local emitida por el servidor por dispositivo (duración, desbloqueo local, revocación, retención, borrado remoto; contrato en docs/11) | Seguridad/producto | Política aprobada y ensayo Android |
| D-41 | Fotografía de campo — **adoptada provisionalmente para el MVP local (2026-10-11, instrucción del responsable)**: tipo `FIELD_PHOTO`, titular parcela, clasificada como dato personal; sin autenticidad ni valor probatorio automático (una foto disponible no verifica ninguna afirmación ni demuestra captura real). Versiones, hash, análisis antimalware y revisión siguen como dimensiones separadas. Metadatos embebidos eliminados en el dispositivo y rechazados en el servidor; título y nombre de archivo neutros | Producto/datos personales | Retención y uso probatorio definidos fuera del MVP |
| GitHub Actions / facturación | Ninguno: Actions inactivo; validación local | **No** (eliminado como bloqueo) |

### Supuestos vigentes de desarrollo (2026-10-10)

Se usan para avanzar; **no son decisiones ratificadas** ni están validados para producción.

- **D-18:** catálogo provisional de 8 tipos en la tabla `organization_types` (migración `0003`, estado `PROVISIONAL`, etiquetas en español). Los cambios se hacen con nueva migración (`RATIFIED`, `RETIRED`; los códigos previos fuera de catálogo quedan `LEGACY`). El tipo no concede permisos.
- **D-19:** invitaciones por enlace de un solo uso, sin proveedor externo. Tener el enlace no verifica el correo (`email_verified_at` sigue nulo).
- **D-20:** límites 5/20/50 por 900 s, configurables. Riesgo, recuperación y fallo de Redis en ADR-0005.
- **ADR-0001 y ADR-0005:** adoptados para desarrollo; ratificación pendiente del responsable técnico. No hay aprobación del usuario registrada.

### El bloque regulatorio en una sola tabla (2026-10-17)

Reúne **D-05.B, D-07.5, D-07.6 y P1-005**, que son las decisiones que sostienen la conclusión regulatoria,
`READY` y el expediente. **No se modifica ninguna compuerta ni se adopta nada aquí**: esto ordena lo que ya
está escrito en `docs/decisiones/D-05-PROPUESTA.md`, `D-07-PROPUESTA.md` y `D-07-MATRIZ-CATALOGO.md` para que
puedan decidirse juntas. **Una recomendación no es una aprobación.**

| | **D-05.B** | **D-07.5** | **D-07.6** | **P1-005** |
| --- | --- | --- | --- | --- |
| **Pregunta concreta** | ¿Qué actor de la norma es cada usuario (Art. 2(15)) y en qué condiciones aplica el Art. 2(15a) y el Anexo III? De ahí sale si una geometría «cumple» o solo cumple el **perfil técnico** | ¿Bajo qué **perfil jurídico** se aprueba una versión del catálogo de riesgo para poder **concluir**? Hoy `regulatory_profile` es `NULL` en las tres versiones | ¿**Quién** puede emitir la conclusión regulatoria, con qué revisión y qué la hace válida? Hoy la conclusión está clavada en `UNDETERMINED` por un `CHECK` | ¿Qué requisitos legales de Ecuador son exigibles, con qué documento, regla, versión, vigencia y aprobador? |
| **Propuesta existente** | `D-05-PROPUESTA.md`. **D-05.A ya adoptada** e implementada: perfil técnico `EUDR_GEO_V1` (migración `0041`), con el umbral de 4 ha exactas admitidas | `D-07-PROPUESTA.md` y `D-07-MATRIZ-CATALOGO.md`. **D-07.1/.2/.4 ya adoptados** (migración `0042`); catálogo técnico **`1.0.0` publicado** (`0043`) | Misma propuesta que D-07.5; el mecanismo de aprobación y adopción ya existe, falta **quién concluye** | `docs/18` P1-005 / RF-36. Sin propuesta redactada todavía |
| **Fuente oficial y vigencia** | Reglamento (UE) 2023/1115, copia fechada **2026-10-15** en `docs/sources/eudr-norma-2026-10-15/` (consolidados `20251226` y `20260918`, con sha256 en su `MANIFIESTO.md`) | La misma copia normativa. El catálogo de riesgo **no** deriva de un artículo: sus cinco graduaciones son **decisiones de producto** y así lo declara cada regla | La misma copia normativa | **Base iniciada el 2026-10-17**: `docs/sources/ecuador-2026-10-17/` con la **Ley Orgánica de Tierras Rurales y Territorios Ancestrales** (RO-S **711**, 14-mar-2016, desde la **ficha oficial** de la Asamblea) y el **Código Orgánico del Ambiente** (RO-S **983**, 12-abr-2017), ambos con sha256 y **publicación comprobada contra el propio documento**. Criterio adoptado: **fuentes oficiales como base**, consolidaciones comerciales **solo auxiliares identificadas**, sin contratar. **Las dos publicaciones modificatorias ya están incorporadas** (RO-S **309** de 2018 con su **fe de erratas** RO-S 321, y **2.º S. 29** de 2022), obtenidas de **fichas oficiales de la Asamblea** y verificadas —la de 2022, **visualmente**, sobre las páginas impresas 33–34—. **Corregida** la hipótesis de que 2022 tocaba solo el reglamento: **modifica la ley**. La **vigencia sigue sin poder afirmarse**: no hay consolidación oficial y **no se ha buscado exhaustivamente** después de marzo de 2022 |
| **Qué falta para decidir** | Interpretación jurídica de los artículos citados aplicada al caso cacao-Ecuador. **Ningún trabajo técnico la adelanta** | Definir el contenido de un «perfil jurídico» y qué lo hace aprobable; hoy el campo existe y está vacío a propósito | Definir el rol y el acto de conclusión, y si exige doble revisión como la mitigación | **Mecanismo entregado el 2026-10-17** (migración `0049`): perfil versionado, adoptable, con evaluación por parcela, ejes separados de aplicabilidad/evidencia/resultado e historial. **No aprueba nada**: el perfil es **PARCIAL** y su revisión jurídica **PENDIENTE**, así que `LEGAL_PROFILE` queda en `PENDING` y **READY sigue bloqueado**. **Ocho decisiones, presentadas juntas** en `docs/decisiones/P1-005-MATRIZ-OBLIGACIONES.md` §4: alcance inicial, qué es regla candidata, evidencia admitida, resultado ante evidencia ausente, **papel de la cartografía (indicio, no veredicto)**, responsable de revisión, aprobación y versionado, y caducidad por cambio normativo. Ninguna adoptada. Trabajo previo que sigue pendiente: **barrer el COA** (patrimonio forestal y cambio de uso), obtener los **reglamentos**, **verificar la cartografía** y buscar reformas posteriores a 2022. Exige **aprobador con competencia jurídica**: ningún rol actual la acredita |
| **Responsable necesario** | **Regulatorio** (con criterio jurídico) | **Regulatorio** + producto | **Regulatorio** + seguridad (quién firma) | **Regulatorio** + legal Ecuador |
| **Qué desbloquea** | Interpretación de **RF-09/RF-10**; el dictamen de aplicabilidad del GeoJSON | **RF-22**, parte de la conclusión; `RISK_CATALOG_APPROVED` deja de ser `NOT_EVALUABLE` | **RF-22**, la **conclusión regulatoria** y con ella `READY` | **RF-36**; el requisito de legalidad del expediente |

**Lo que estas cuatro NO desbloquean por sí solas**: el despacho sigue además condicionado por D-34.A, y el
satélite por **D-09.B**, que es una decisión **separada** de contratación y uso real. **Nada de esta tabla
autoriza una llamada externa ni el envío de geometrías a ningún proveedor.**

### D-04: parte bloqueada y decisión mínima

Implementado sin D-04: SUPER_ADMIN solo administra metadatos de organizaciones, incorpora al primer ORG_ADMIN (`organization:onboard_admin`) y desactiva cuentas. No hay bypass global.
**Bloqueado por D-04:** cualquier acceso de plataforma a miembros, datos personales, bitácora u operación de una organización donde no es miembro (hoy `ELEVATION_REQUIRED` o 404). Decisión mínima necesaria: (1) quién puede elevar y con qué aprobación, (2) motivo obligatorio y duración máxima, (3) alcance (lectura o escritura, qué recursos), (4) cómo se notifica a la organización y cómo se audita. Con eso se implementa una elevación temporal registrada y se prueba QA-02 «superadmin con elevación explícita».

Concesiones entre organizaciones (BUYER/AUDITOR externos): sin contrato definido (ADR-0002 propuesto, P1-001). Fuera del alcance de P0-003.

### D-18: catálogo provisional (NO ratificado; implementado como supuesto de desarrollo)

Las fuentes no enumeran `organization_type`: S1 §10 solo nombra el campo. Sí mencionan estos actores de la cadena: asociación/cooperativa de productores (S1 guía de asociaciones, S3), acopiador y centro de acopio (S2), procesamiento/industria (S2, GUIA en S3), exportador (S1, S2), importador UE y fabricante/retail (S2). Propuesta para revisión de producto:

| Código | Actor | Origen en fuentes |
| --- | --- | --- |
| ASSOCIATION | Asociación de productores | S1, S3 |
| COOPERATIVE | Cooperativa | S2, S3 |
| COLLECTOR | Acopiador / centro de acopio | S2, GUIA (S3) |
| PROCESSOR | Procesador / industria | S2, GUIA (S3) |
| EXPORTER | Exportador | S1, S2 |
| IMPORTER | Importador (UE) | S2 |
| MANUFACTURER | Fabricante / retail | S2 |
| OTHER | Otro (requiere descripción) | Propuesta |

Etiquetas en español en `organization_types.label_es`. Desde la migración `0003`, `organizations.organization_type` tiene FK al catálogo y la API rechaza códigos fuera de él (`ORGANIZATION_TYPE_UNKNOWN`). La ratificación sigue pendiente.

Resueltas el 2026-10-09: **D-01** (stack NestJS/Next.js/PostGIS, ADR-0001, adoptado por delegación del usuario) y **D-02** (monorepo nuevo `cyberlandec-oss/TERRA-LINK-2025`). Pendiente: ratificación del responsable técnico.

### D-48 — Indicadores del Buyer Portal — **ADOPTADA (opción A)**

**Adoptada el 2026-10-17 para desarrollo local**, e **implementada** en la misma entrega: los once indicadores de S3 §22.8 como **estados** del recurso concedido, con seis estados que distinguen favorable, desfavorable, pendiente, desactualizado, no evaluable y sin evaluar. **Con ella se cerraron RF-32 y P1-001.**

**S3 §22.8** dibuja el Buyer Portal con once indicadores: origen identificado · productores · parcelas ·
geolocalización validada · deforestación revisada · legalidad revisada · trazabilidad completa · balance de
masa · evidencias · riesgo final · DDS. **Hoy se entregan los tres primeros.** **RF-32** nombra además
«evidencia» de forma explícita.

| Opción | Qué implica | Efecto |
| --- | --- | --- |
| **(a) Conjunto completo de §22.8, como ESTADOS** | Los ocho restantes **como estado** —«revisada / no revisada / no evaluable»—, nunca como dato: sin coordenadas, sin identidad, sin documentos | **Cierra RF-32 y P1-001.** Varios dirían hoy «no evaluable» (riesgo `UNDETERMINED`, legalidad sin perfil aprobado, deforestación sin satélite) y **mostrarlo así es lo correcto** |
| **(b) Solo «evidencias»** | Únicamente el indicador que RF-32 nombra | Cumple la letra de RF-32; deja **S3 §22.8 incompleto** |
| **(c) No ampliar** | Dejar la proyección como está | RF-32 y P1-001 **siguen abiertas** por un criterio que sí está en la fuente |

**Recomendación: (a)**, porque son **estados derivados de lo que el expediente ya calcula** y no levantan la
clasificación. **Consecuencia de no decidir**: las dos historias quedan abiertas por una ampliación de campos
que **no se hace sin decisión explícita**.

**Fuera de esta decisión**: entregar el paquete DD, levantar la clasificación, mostrar identidad, geometrías o
documentos, y prometer un DDS. Nada de eso entra.

### D-49 — Correspondencia «señal observable → nivel de madurez» — **ADOPTADA, opción A (2026-10-18)**

**El problema**: **S3 §16** nombra los siete niveles —*No digitalizado, Registros manuales, Excel/formularios,
Trazabilidad digital, Trazabilidad + riesgo, EUDR operacional, Inteligencia comercial*— precedidos de un «Por
ejemplo», y **no fija ningún umbral, porcentaje ni condición de paso**. Ninguna otra fuente lo hace. Para
diagnosticar hace falta una correspondencia, y esa correspondencia **es una decisión de producto**.

**Lo implementado (P1-004), declarado como propuesta y visible en la propia respuesta de la API**:

| Regla | Cómo queda |
| --- | --- |
| Cada nivel se sostiene en **señales observables** del dato existente | Cada señal lleva su evidencia, su alcance, su fecha y su fuente |
| El único umbral es **la presencia** | «Existe al menos un registro». La fuente no da ninguno y **cualquier cifra mayor sería inventada**; se dice así en la respuesta |
| Los niveles **0 a 2** ocurren **fuera de Terra Link** | **NO_DETERMINABLES**. Una organización sin datos **no** es «nivel 0»: el sistema no distingue «no digitalizada» de «todavía no ha cargado nada» |
| **Vigencia** | Una adopción retirada deja de contar; el diagnóstico se calcula al leerlo y no guarda marcas |

**Opción adoptada: (A)** — diagnóstico por **presencia de evidencias**, con reglas explícitas y versionadas.
**Adoptada para desarrollo local el 2026-10-18.**

**Qué significa exactamente esta adopción, y qué no**:

- Es una **decisión provisional de producto**. **No** es un umbral derivado de la fuente, **no** es una
  certificación de madurez y **no** levanta ninguna compuerta.
- **La presencia también es una decisión de producto**, y conserva esa etiqueta. No es «lo único honesto»: es
  lo que se decidió, por ser la regla más simple que no exige acordar cifras.
- **Los umbrales cuantitativos no serían «inventados»** si se acordaran y justificaran. La diferencia real es
  que **las fuentes no los definen**: habría que decidirlos, escribirlos y poder defenderlos. Queda como vía
  abierta, no descartada.

**Las otras dos opciones siguen disponibles**: (B) **umbrales cuantitativos por nivel**, legítimos si se
acuerdan y se justifican —ninguna fuente los da, así que su fundamento tendría que ser propio—; (C) que cada
organización **declare** su nivel 0–2, lo que añadiría un dato autodeclarado y no verificable.

**Lo que esta adopción NO cambia**: los niveles **0 a 2 siguen NO DETERMINADOS** cuando Terra Link no puede
observarlos, y **ausencia de datos no se equipara a ausencia de digitalización**. Se mantiene la separación
entre **madurez operativa**, **capacidades pendientes** del producto y **conclusión jurídica**.

### D-07 (catálogo 1.0.0) — adopción técnica como ayuda de revisión interna — **ADOPTADA el 2026-10-20 (opción B)**

Decisión del propietario del producto, **solo como configuración técnica**: cada organización puede adoptar el catálogo
`1.0.0` (ocho reglas, sin cambios) como **ayuda a la revisión interna**, con sus límites y su **cobertura incompleta**
(cuatro categorías sin reglas: la clasificación sale siempre PARCIAL, con versión, reglas aplicadas, categorías sin
cobertura y limitaciones a la vista). **No es validación jurídica ni adopción por organizaciones reales**; la adopción de
**ensayo** ya existente (Cooperativa DEMO) se **conserva sin duplicarla**. **No** se ejecutan reevaluaciones masivas ni se
cambia ninguna conclusión: `UNDETERMINED`, `RISK_CATALOG_APPROVED` (sigue `NOT_EVALUABLE`), `READY` y el despacho no
cambian. Sigue pendiente D-07.5/D-07.6 y la revisión regulatoria. Contenido y opciones: `docs/decisiones/D-07-MATRIZ-CATALOGO.md` §5.

### D-54 — Multilenguaje, acceso federado y unidad de coste (P1-015) — **ADOPTADA para desarrollo y demostración local (2026-10-20)**

> **Adoptado el 2026-10-20 por el propietario del producto, para desarrollo y demostración local** (no validado con un
> cliente ni con una tarifa acordada): **(1) coste** — estimación **por organización y período explícito, en USD**, con
> tarifas **declaradas, versionadas y con vigencia** (sin tarifas precargadas); es el coste de **usar la plataforma**,
> distinto del presupuesto de P1-010 y del precio del cacao; sin facturación ni cobro. **(2) SSO** — **Keycloak
> autoalojado** como proveedor local de ensayo, OIDC Authorization Code + **PKCE**, vínculo por **emisor+sujeto** (nunca
> por correo), acceso con contraseña conservado, ningún proveedor de cliente real. **(3) Idiomas** — **inglés** como segunda
> lengua, **español como fuente** (ADR-0007 opción B). **(4) Límites** — se mantiene el **rechazo** al superarlos, con
> explicación y **sin sobrecoste automático**.
> **Implementado y demostrado** sobre `4f7e635` (ver `docs/qa/EVIDENCIA_P1015_COSTE_SSO_IDIOMAS_2026-10-20.md`).
> **P1-015 sigue PARCIAL**: falta únicamente el elemento original que no existe: la dependencia «**piloto**» (P0-031, no iniciada). Una tarifa acordada y el proveedor de identidad de un cliente **no son criterios originales de P1-015** (ni RF-46 ni la fila de P1-015 los nombran): son configuración comercial de un cliente y, si el piloto la requiere, **gates explícitos de P0-031**; no se añaden como compuertas de P1-015. Los tres puntos de su aceptación («ADR por componente, español conservado y límites/coste/SSO comprobados») están demostrados en local. Si la dependencia «piloto» puede satisfacerse con evidencia local (`docs/18`, regla de dependencias) lo decide el propietario del producto; **no está decidido**. Lo que sigue es el texto de la propuesta del 2026-10-18/20, conservado como histórico.

**Qué piden los criterios**. **RF-46** (`docs/03:62`, tabla de **evolución**, columna **Restricción**):
«**Español primero** y **decisiones de coste**». **P1-015** (`docs/18:216`, **aceptación mínima**): «**ADR por
componente**, **español conservado** y **límites/coste/SSO comprobados**», con dependencia «**TECH-001 y
piloto**».

**Qué se entregó el 2026-10-18**: los **tres ADR por componente** (**0007** multilenguaje, **0008** acceso
federado, **0009** consumo, límites y coste), la comprobación de que el **español está conservado**, y los
**límites comprobados** —publicados con su valor, su procedencia y su efecto, y verificados superando uno—.

**Qué NO se pudo comprobar, y por qué no es interpretación mía**: la aceptación mínima pide también «**coste**»
y «**SSO**» **comprobados**, y la historia depende de un «**piloto**» que **no existe**. Sin tarifa acordada no
hay coste que comprobar; sin proveedor de identidad ni usuarios reales, tampoco SSO.

| # | Decisión | Opciones | Efecto |
| --- | --- | --- | --- |
| 1 | **Unidad de coste** | **(A)** por organización · **(B)** por usuario activo · **(C)** por volumen trazado · **(D)** por almacenamiento | Decide a quién le sale caro: (B) castiga a cooperativas con muchos técnicos, (C) a las grandes, (D) a las que suben muchos documentos. **Recomendada: esperar** a tener consumo real; el del DEMO no sirve |
| 2 | **Proveedor de acceso federado** | **(A)** seguir solo con acceso local · **(B)** OIDC alojado (Entra, Auth0, Cognito…) · **(C)** OIDC autoalojado (Keycloak) · **(D)** híbrido por organización | (B) cuesta por usuario activo y añade dependencia para entrar; (C) cambia cuota por operación. **Recomendada: (A)** mientras no sea requisito de un comprador; **(C)** cuando lo sea |
| 3 | **Alcance multilenguaje** | **(A)** solo español —lo actual— · **(B)** i18n con el **español como fuente** · **(C)** i18n con claves abstractas | **(C)** permite que una clave sin traducir se muestre al usuario; **(B)** garantiza que el peor caso sea ver español. **Recomendada: (B)** cuando haya una segunda lengua decidida; **(A)** hasta entonces |
| 4 | **Qué pasa al llegar a un límite** | **(A)** rechazar —lo actual— · **(B)** avisar y dejar pasar · **(C)** cobrar el exceso | **(C)** exige la decisión 1 resuelta. **Recomendada: (A)**: es predecible y no cobra sorpresas |

**Distinciones que fijan qué cuenta como «comprobado» (2026-10-20, sin adoptar nada):**

| Criterio literal | Demostración técnica (posible sin terceros) | Lo que exige el criterio y falta |
| --- | --- | --- |
| «**coste**» (RF-46 «decisiones de coste»; P1-015 «límites/coste/SSO comprobados») | **Consumo medido** por organización y los 10 límites con su efecto (hecho). | **Coste previsto**: requiere tarifa o unidad acordada (decisión 1) y consumo real; el consumo medido no se presenta como coste. |
| «**SSO**» | Un ADR (0008) y, si se eligiera proveedor, una demostración contra un OIDC de prueba. | Conexión con un **proveedor de identidad de un cliente real**: no existe, y la decisión 2 no está adoptada. |
| «**español conservado**» / idiomas | Hecho: idioma declarado, sin claves de traducción. | Segunda lengua: decisión 3; sin ella no hay nada que comprobar. |
| «**piloto**» (dependencia) | Preparación y recorrido integral (P0-031). | Un piloto ejecutado; no lo sustituye ninguna demostración local. |

«Esperar a que un comprador lo pida» es una recomendación comercial; **no satisface** por sí mismo un criterio obligatorio: mientras no
se cumpla o se decida cambiar el criterio (decisión del propietario del producto, con trazabilidad), P1-015 sigue PARCIAL.

**(Texto de la propuesta, previo a la adopción del 2026-10-20.)** Nada de esto estaba adoptado entonces, y **nada se implementó por adelantado**: no hay i18n instalado «por si acaso»,
no hay integración OIDC sin proveedor y **no se fijó ninguna tarifa ni ningún límite nuevo**.

#### D-54 — propuesta concreta (2026-10-20; ADOPTADA con la selección de arriba: coste por organización, Keycloak, inglés, rechazo)

**Criterios originales (literales, `docs/03:62` y `docs/18:216`)**: «Español primero y decisiones de coste»; aceptación
mínima «ADR por componente, español conservado y límites/coste/SSO comprobados»; dependencia «TECH-001 y piloto».
Cumplido: ADR 0007/0008/0009, español conservado, 10 límites comprobados. **Faltan**: coste, SSO y piloto. Cambiar el
criterio solo para cerrar la historia no se propone; cada fila dice qué hay que desarrollar y qué no se puede
demostrar sin terceros.

| # | Decisión | Opciones y comportamiento que implementaría | Recomendación | Desarrollo que falta | Demostrable localmente | Necesita piloto/tercero |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Unidad de coste** | **A** por organización: tarifa plana por periodo · **B** por usuario activo: cuenta miembros con actividad en el periodo · **C** por volumen trazado: kg registrados · **D** por almacenamiento: bytes de la cuota. Cada una convierte el consumo medido en un **coste estimado**, rotulado «estimado», con moneda y tarifa **declaradas por quien las fija** | A como unidad provisional de **estimación** (la más simple y no castiga a nadie) mientras no haya consumo real; se puede cambiar sin migrar datos | Tabla de tarifas versionada (vigencia, moneda, unidad), cálculo del estimado desde el consumo ya medido, lectura con permiso `organization:read`, sin facturar ni cobrar | Cálculo y rotulado con una tarifa **de prueba** declarada sintética; invariantes: el consumo sigue sin llevar moneda; sin tarifa vigente → «sin tarifa», nunca 0 | Tarifa real y moneda: las fija negocio. «Coste comprobado» ante un cliente exige un acuerdo |
| 2 | **Acceso federado** | **A** solo local (hoy) · **B** OIDC alojado · **C** OIDC autoalojado (Keycloak) · **D** híbrido por organización | **C** para demostrar; **A** sigue como acceso de reserva | Flujo OIDC (código con PKCE), vínculo identidad externa→usuario por organización, política de alta sin crear cuentas ajenas, cierre de sesión y revocación | Con un proveedor **de prueba** en contenedor local: inicio de sesión, usuario no vinculado rechazado, revocación | **SSO con el proveedor de identidad de un cliente real** |
| 3 | **Idiomas** | **A** solo español · **B** i18n con español como fuente (el peor caso es ver español) · **C** claves abstractas | **B**, con la segunda lengua que usted designe; sin lengua designada, A | Infraestructura de catálogos por idioma, preferencia por usuario, reserva al español, prueba de que ninguna clave se muestra | Con una lengua **de prueba** parcial: reserva al español comprobada | Traducción revisada de la segunda lengua real |
| 4 | **Al llegar a un límite** | **A** rechazar (hoy, 422 con `on_exceed`) · **B** avisar y dejar pasar · **C** cobrar exceso | **A** | Nada si A | Ya comprobado superando un límite real | C exige decisión 1 y acuerdo comercial |

**Piloto.** Es dependencia declarada de P1-015; ninguna fila lo sustituye. La historia seguirá PARCIAL hasta que
exista, o hasta que el propietario del producto decida y deje trazado un cambio de criterio.
**Lo que no se adopta por silencio:** nada de lo anterior. Con la decisión 1 y 2 tomadas, el desarrollo local de las
dos primeras filas es trabajo independiente y autorizable.

### D-53 — Evoluciones posibles de la inteligencia comercial (P1-014) — **ABIERTA, no bloqueante (2026-10-18)**

**Qué pide la fuente**. **S3 §41** («GAP 15 — pasar de *compliance* a inteligencia comercial») condiciona todo a
tener «productor + parcela + calidad + volumen + trazabilidad + riesgo + precio» y lista **seis preguntas**.
**RF-45** (`docs/03:61`) pide «analytics / supplier score comercial», con una condición dura: **métrica
independiente del riesgo legal**. **P1-014** (`docs/18:215`) añade «denominadores y permiso».

**Esto NO es una condición de cierre de RF-45.** El contraste literal lo dejó claro: RF-45 está en la tabla de **evolución** (`docs/03:45`), su columna exigible es **Restricción** —«métrica independiente de riesgo legal»— y la **aceptación mínima** (`docs/18:215`) pide «**Métricas** … separadas …, **denominadores** y **permiso**». **Ningún criterio pide un score compuesto**, y las seis preguntas de S3 §41 van tras «**Podemos empezar a responder**» (`docs/sources/S3:1503`). RF-45 quedó **DEMOSTRADA** el 2026-10-18; lo de abajo son **evoluciones posibles**, a decidir solo si se quieren, y **nada de ello está adoptado**.

**Qué se entregó el 2026-10-18**: los indicadores que **no exigen inventar nada** —precio medio ponderado por
grupo compatible, cobertura del dato económico, pagos informados sobre lo acordado, volumen recibido,
decisiones de calidad, presupuesto estimado y parcelas con geometría—, cada uno **autodescrito** (qué mide,
fórmula, unidad, período, denominador, cobertura, procedencia y límites) y **separado del riesgo regulatorio**.

**Evoluciones posibles —ninguna adoptada, ninguna bloqueante:**

| # | Decisión | Opciones | Efecto |
| --- | --- | --- | --- |
| 1 | **Composición del «supplier score»** | **(A)** no publicar score y dejar los indicadores separados —lo implementado— · **(B)** score con pesos **declarados por la organización**, versionados, como los parámetros de D-51 · **(C)** pesos fijos del producto | Un número único **exige ponderar** precio, calidad, volumen y trazabilidad, y **ninguna fuente fija esos pesos**. **(C)** queda descartada: serían pesos inventados por Terra Link. **Recomendada: (B)** si se quiere el score, con los pesos **visibles y versionados**; mientras tanto, **(A)** |
| 2 | **Umbral de «datos suficientes»** | **(A)** no fijar ninguno y **publicar la cobertura** —lo implementado— · **(B)** un mínimo declarado por la organización, por indicador · **(C)** un mínimo fijo del producto | Un umbral decide **cuándo una cifra se considera creíble**: inventarlo convierte una opinión en regla. **Recomendada: (A)**; **(B)** si hace falta ocultar cifras de muy baja cobertura, siempre **diciendo cuál es el mínimo y quién lo puso** |
| 3 | **Atribución de precio a un comprador** | **(A)** no atribuir —lo implementado— · **(B)** registrar **precio de venta** por embarque o comprador · **(C)** derivarlo del grafo de origen | «¿Qué comprador paga mejor?» **no se puede responder hoy**: el dato económico es lo que la organización paga al **productor**, no lo que cobra del comprador. **(C)** sería atribuir un precio sin relación que lo sustente. **Recomendada: (B)**, que es desarrollo nuevo, no una decisión suelta |
| 4 | **Rendimiento y potencial de expansión** | **(A)** no responder —lo implementado— · **(B)** registrar producción por parcela y período con su superficie | «¿Qué fincas pueden aumentar producción?» exige una **serie de rendimiento** que no existe. Responderla hoy sería **inventar el dato** |

**Lo que no está en discusión**, porque lo fija RF-45: la métrica comercial **no usa** la conclusión de riesgo,
la severidad ni el resultado técnico; **`UNDETERMINED` no significa riesgo bajo**; y una clasificación técnica
parcial **conserva sus límites y su cobertura**.

### D-52 — Base del precio, significado de la prima y quién registra el dinero (P1-012) — **ADOPTADA (2026-10-18)**

**Qué pide la fuente**. **S3 §32** dice que la mayoría de plataformas responde *«¿dónde está el cacao?»* y que
Terra Link debería añadir ***«¿cuánto recibió el productor?»***, enumerando **precio, prima, calidad, volumen,
frecuencia, pagos** e incentivos. **RF-43** (`docs/03:59`) lo recoge como «Registro de precio, prima y **pagos
informados**», con dos condiciones: «**no ejecutar transferencias**; **moneda y privacidad**». **P1-012**
(`docs/18:213`) añade «dato **informado/versionado** y moneda; privacidad; **ninguna transferencia automática**».

**Qué NO decide la fuente**. Ni S3 ni los requisitos dicen **sobre qué cantidad** se aplica el precio, **qué es**
una prima, ni **quién** la registra. No son datos ausentes: son **decisiones de producto** que hay que tomar y
justificar. Lo implementado el 2026-10-18 es un **contrato provisional** que deja las tres **visibles en el
dato**, de modo que adoptar cualquier opción después **no reescriba** lo ya registrado.

| # | Decisión | Opciones | Efecto |
| --- | --- | --- | --- |
| 1 | **Base del precio** | **(A)** se **declara por registro** entre «cantidad declarada en la entrega», «cantidad recibida (pesaje)» y «sin base» · **(B)** la organización fija **una sola** base y el sistema la aplica siempre · **(C)** siempre la **recibida**, y sin recepción no hay precio | Cambia el importe sin cambiar el precio: 250 kg declarados y 248 pesados dan totales distintos. **Recomendada: (A)** —queda escrito cuál se usó y con qué cantidad—, revisable a (B) si la operación resulta uniforme |
| 2 | **Significado de la prima** | **(A)** importe **por unidad** o **fijo**, con **fundamento declarado obligatorio** y **nunca deducido** · **(B)** añadir **porcentaje** sobre el precio · **(C)** catálogo cerrado de primas (certificación, calidad, EUDR) en vez de fundamento libre | **(A)** es lo implementado y es lo único que hoy se puede sostener: no hay catálogo de primas ni regla de cálculo acordada. **(B)** exige fijar sobre qué base se aplica el porcentaje; **(C)** exige un catálogo versionado que nadie ha definido |
| 3 | **Quién registra y quién corrige** | **(A)** permisos propios `economics:read` / `record` / `correct`, hoy en **ORG_ADMIN** y **MANAGER**, con **AUDITOR** de solo lectura y **técnico de campo sin acceso** · **(B)** que el operador de recepción registre el precio al recibir · **(C)** un rol comercial nuevo | **(A)** cumple «privacidad» de RF-43: leer una entrega **no** da acceso a su dinero. **(B)** acercaría el dato al momento real pero ampliaría quién ve precios; **(C)** es más limpio y cuesta un rol nuevo |

**Adoptada el 2026-10-18: opción (A) en los tres puntos.**

1. **Base del precio declarada por registro**: «cantidad declarada en la entrega», «cantidad recibida (pesaje)»
   o «sin base declarada». La base elegida se guarda **con su cantidad y su unidad tal como estaban al
   declararla**, así que cambiar la entrega después **no** reescribe el importe registrado.
2. **Prima por unidad o importe fijo, con fundamento obligatorio y nunca deducida.** Sin `premium_grounds` no se
   registra —**422 `PREMIUM_GROUNDS_REQUIRED`**, con el CHECK `economics_premium_shape` imponiéndolo también en
   la base—. **No** hay prima porcentual ni catálogo cerrado de tipos: si se quisieran, serían **una decisión
   nueva**, no una lectura de esta.
3. **Permisos económicos propios**: `economics:read` / `record` / `correct` en **ORG_ADMIN** y **MANAGER**,
   **AUDITOR de solo lectura**, y el **técnico de campo sin acceso**. Leer una entrega **no** da acceso a su
   dinero.

**Ya implementado así** en `4f94e7b` (validado y desplegado el 2026-10-18): la adopción **ratifica** el
comportamiento vigente y **no cambia código**, por lo que no repite validación ni despliegue. Las tres
elecciones siguen **escritas en el propio dato** sobre tablas **append-only**, de modo que una revisión futura
tampoco reescribiría lo registrado.

**Lo que no está en discusión**, porque lo fija el requisito: **no se ejecutan transferencias**, un **pago es
informado** por una persona, **un precio registrado no demuestra un pago**, **una prima ausente no es cero** y
**no se convierten unidades ni monedas en silencio**.

### D-51 — De dónde salen los importes del «coste de preparación» (P1-010) — **ADOPTADA (2026-10-18)**

**Qué entiende la fuente por «coste»**. **S3 §33** («GAP 7 — Coste de cumplimiento») pide responder *«¿cuánto me
cuesta cumplir EUDR por productor?»* con una tabla de **conceptos y dinero** —georreferenciación, validación,
documentación, análisis satelital, administración— que suma un **total por productor**, para que la asociación
pueda negociar («el comprador europeo debe financiar $6,20/productor»). Las cifras que aparecen son un
**«Ejemplo»**. **RF-41** (`docs/03:57`) exige «costes **medidos** y asignación explicada» y **P1-010**
(`docs/18:211`) «**coste real/moneda**, asignación por productor/tonelada y **supuestos visibles**».

**Por qué no se puede entregar hoy**: en Terra Link **no existe ninguna cifra monetaria medida**. Lo único
parecido es `satellite_providers.cost_note`, que es **texto** copiado de la documentación de cada candidato, y
además **no hay proveedor seleccionado ni contratado** (P0-028, **D-09 parte B**). Sin importes no hay «coste
real», y las cifras de S3 §33 **no son tarifas**: usarlas sería inventarlas.

**Lo que hay que decidir, junto:**

| # | Decisión | Opciones | Efecto |
| --- | --- | --- | --- |
| 1 | **De dónde salen los importes unitarios** | **(A)** parámetros **declarados por la organización**, versionados, con **moneda y vigencia**, multiplicados por cantidades que el sistema sí mide · **(B)** esperar a tener contabilidad real y proveedor contratado · **(C)** usar el ejemplo de S3 como tarifa | Sin esto **no hay dinero que mostrar**. (C) queda descartada: sería inventar tarifas. **Recomendada: (A)**, dejando escrito que son **supuestos de la organización**, nunca tarifas de Terra Link |
| 2 | **Qué cantidad mide cada concepto** | ¿Una georreferenciación es **una versión de geometría** o una visita? ¿Un análisis satelital es **un trabajo lanzado** o uno con resultado? ¿La documentación se cuenta por **documento** o por **versión**? | Cambia el total sin cambiar los importes. Hay que fijarlo y escribirlo junto al resultado |
| 3 | **Denominador de la asignación** | Por **productor** y por **tonelada**: ¿tonelada **declarada**, **recibida** o **del lote**? | `docs/18:211` pide ambas asignaciones; sin fijar el denominador, dos cifras correctas pueden contradecirse |
| 4 | **Moneda** | Una por organización, o una por parámetro con conversión | Mezclar monedas sin declararlo produciría un total sin significado |

**Resuelto el 2026-10-18, como contrato provisional para desarrollo local:**

| # | Decisión adoptada |
| --- | --- |
| 1 | **Opción (A)**: los importes los introduce una persona autorizada como **parámetros presupuestarios**, con concepto, unidad, importe, moneda, vigencia, autor y versión. **No** son precios oficiales, costes medidos ni ofertas de proveedores; **no** se precargan los importes ilustrativos de S3 ni se consulta ningún servicio externo |
| 2 | **Unidades**: georreferenciación → *visita prevista*; validación → *revisión prevista*, **identificando su tipo**; documentación → *expediente documental por preparar o revisar*; análisis satelital → *análisis presupuestado*; administración → *hora prevista*. Las **cantidades se declaran** y quedan **marcadas como estimadas**: una versión de geometría no demuestra una visita, una evaluación automática no demuestra una revisión humana y un trabajo satelital no demuestra un servicio facturado. Lo observado **explica** el trabajo pendiente y **no se convierte** en unidad de coste |
| 3 | **Denominadores**: total, **coste por productor distinto del alcance** y **por tonelada del peso físico del ledger** —no el declarado ni el disponible tras reservas—, con cantidad, unidad y fecha de consulta. Sin denominador válido o con cero: **«no calculable»**, nunca cero ni infinito. Es una **distribución del presupuesto del escenario**, no un coste contable del lote, y **no se reparte entre productores concretos** |
| 4 | **Moneda**: **USD** únicamente, sin conversiones ni tipos de cambio |

**Lo que la adopción obliga además**: ausencia **no es cero** —el total se marca incompleto y separa lo
conocido—, el cálculo debe **reproducirse** con las mismas versiones y entradas, y **una tarifa cambiada después
no reescribe una estimación guardada**. Implementado en P1-010 (migración **0051**, tablas append-only).

### D-50 — Formato de intercambio con GUIA/Agrocalidad — **ADOPTADA, opción A (2026-10-18)**

**El problema**: **RF-37** admite el intercambio «**solo canal/acuerdo comprobados**» y `docs/15` condiciona la
integración a «acuerdo/canal oficial o **formato autorizado**; **no asumir API disponible**». Hoy **no hay
canal, acuerdo ni formato oficial en mano**, y sin algún formato no hay intercambio posible ni siquiera por
archivo.

| Opción | Qué supone | Efecto |
| --- | --- | --- |
| **(A) Formato propio, versionado y declarado NO OFICIAL**, con mapeo explícito a los cinco elementos de la guía ecuatoriana | Se puede exportar y conciliar **hoy**, por archivo, sin fingir una especificación ajena | **Adoptada.** Cada acto guarda **con qué versión se hizo**; al existir un formato autorizado se publica otra versión sin reescribir el pasado |
| (B) Esperar al formato oficial | Nada que entregar hasta que exista el canal | La historia queda parada por completo |
| (C) Inventar un «CSV de GUIA» | Presentaría como ajena una especificación propia | Descartada: sería afirmar algo que no se ha comprobado |

**Lo que la adopción incluye**: el formato v`1.0.0-no-oficial` exporta **código, nombre, ubicación
administrativa y número de parcelas**. **No** exporta **geometrías ni coordenadas**, **ni el documento de
identidad**, y lo dice en el propio archivo; incluirlos sería **otra decisión, con otra base legal**. Volumen y
movimientos los enumera la guía, pero su intercambio **no está acordado** y no se incluye.

**Compuerta, y quién la abre**: la organización **registra** el acuerdo —referencia, alcance, vigencia y
evidencia documental—; **la administración de plataforma lo verifica** (`exchange:verify`). Registrar **no
habilita** nada. Sin acuerdo **verificado y vigente**, exportar y conciliar responden **409**.

**Lo que NO hace, y es parte de la decisión**: ninguna llamada de red; **conciliar no escribe** en los datos
operativos —produce diferencias que alguien decide, y la corrección se hace por el caso de uso del dominio—; y
que un registro externo liste a un operador **no acredita legalidad** (eso es P1-005, que sigue abierta).

### Pendientes trazados de `UX_UI §11` (centro de operaciones) — **NO IMPLEMENTADOS**

Se registran aquí para que queden **trazados sin reabrir P1-003**, cuyos criterios (`docs/18:204`: cola,
filtros, acción y QA-11/14) están cubiertos y **no los incluyen**:

| Capacidad de `UX_UI §11` | Estado | Dónde correspondería |
| --- | --- | --- |
| **Indicadores** con numerador/denominador, unidad, período y actualización | **No implementado**; no se declara hecho | Centro de operaciones; se solapa con **P1-014** (analítica) y con los indicadores ya entregados en el portal (**D-48**) |
| **Actividad reciente** autorizada, con hora y vínculo a la entidad | **No implementado**; el histórico existe en auditoría y eventos, sin esta superficie | Centro de operaciones; depende de `audit:read`/`events` |

Ninguna de las dos es criterio de P1-003 ni de P1-004, y **ninguna se usa como condición de cierre**.

## Decisiones operativas de esta entrega

- Mantener los originales intactos y separarlos de las instrucciones activas.
- Audit-first para no confundir documento objetivo con estado implementado.
- Preservar IDs P0 originales y añadir historias explícitas para capacidades omitidas de su tabla.
- Bloqueos críticos independientes del score; datos desconocidos no se inventan.
- Los detalles adicionales de arquitectura son propuestas para revisión del equipo.

No marcar «aceptado por el usuario» si la decisión fue inferida en esta entrega. Tras resolver, enlazar ADR, responsable, fecha, commit/artefacto y pruebas afectadas.

### A-01 — Prioridad: web antes que teléfono (2026-10-20) — **AUTORIZADA**

El propietario del producto autoriza **posponer el ensayo físico Android** (P0-023/P0-024 conservan sus criterios con teléfono
pendientes y la evidencia técnica ya obtenida) y **continuar el desarrollo desde la plataforma web**. Las coordenadas se registran
en la **parcela agrícola**; los lotes comerciales conservan su vínculo con esas parcelas. Alcance por rol: productor — sus
parcelas vinculadas y sus evidencias; técnico de campo — parcelas de productores asignados; administrador de organización —
las de su organización; gerente — según sus permisos de gestión; auditor y comprador — consulta autorizada, sin captura. **La
captura web y el análisis satelital son funciones distintas**: la demostración usa un proveedor local de ensayo cuyos resultados
**no acreditan deforestación ni conformidad real**. Detalle y aceptación: `docs/03` (RF-48) y `docs/18` (A-01). **Estado 2026-10-20: implementada y demostrada localmente (DONE_LOCAL, `4913dd3`).** Ensayo físico Android: sigue pospuesto.

### A-01.b — Mapa base local y fotografías propias del productor (2026-10-20) — **AUTORIZADAS**

Dos decisiones del propietario del producto, registradas el 2026-10-20 y cumplidas en `4913dd3`:
1. **Mapa base local**: se autoriza MapLibre y una fuente cartográfica local basada en datos públicos de OpenStreetMap (Geofabrik, Ecuador), descargados y procesados localmente respetando licencia y atribución. **No** autoriza enviar parcelas, coordenadas, fotografías ni identidades a terceros, ni un proveedor de mapas, ni un respaldo silencioso hacia teselas, geocodificación o CDN externos. La cartografía es una referencia visual: no acredita límites de propiedad, precisión GPS, deforestación ni conformidad y no ajusta vértices. No es una integración satelital: las llamadas externas siguen deshabilitadas.
2. **Fotos propias**: el productor consulta y descarga las `FIELD_PHOTO` de sus parcelas autorizadas con un permiso específico (`document:read_field_photo_own`), sin lectura general de identidad ni de otras fotografías; clasificación de dato personal, auditoría, copia sin metadatos y rechazo del servidor intactos.
Corrección de redacción: A-01 pedía «dibujar sobre el mapa»; se había registrado como «croquis». No volver a reducirlo. Detalle: `docs/qa/EVIDENCIA_A01_CAPTURA_CAMPO_2026-10-20.md`, `infra/maps/README.md`.

### A-02 y A-03 — Concesiones web y traspaso entre organizaciones (2026-10-21) — **AUTORIZADAS**

El propietario autoriza (1) completar la **administración web de concesiones** (A-02, independiente) y (2) **preparar el contrato de traspaso** entre organizaciones (A-03): propuesta primero, movimientos después.
Ambas se registran como ampliaciones separadas de los criterios originales y de A-01. La decisión empresarial sobre el traspaso (opción recomendada y **D1–D9 completas**, con su clasificación operativa/regulatoria) está en `docs/decisiones/A03-TRASPASO-ENTRE-ORGANIZACIONES.md` y **sigue abierta**; no se adopta ninguna obligación de diligencia. **A-02: DONE_LOCAL (`0211a30`).**

### A-03 — Decisiones del propietario sobre el traspaso de custodia (2026-10-21)
Adoptadas: **D1 (b)** custodia física; **D3 (b)** proyección técnica autorizada (sin acceso general al origen; ni consentimiento ni instantánea prueban origen completo); **D5 (a)** con precisiones (toda diferencia exige motivo; diferencia ≠ pérdida; recepción parcial, faltante, sobrante, rechazo y pérdida declarada son cosas distintas; una discrepancia pendiente conserva estado y cantidad; sin existencias adicionales ni pérdidas por resta automática; devolución = otro traspaso vinculado; el rechazo en tránsito conserva la procedencia); **D6 (a)**, **D7 (a)**, **D8 (a)**, **D9 (b)**.
**No resueltas**: **D2** queda pendiente de revisión competente (solo existe la salvaguarda técnica de no herencia automática, que no es una determinación jurídica); **D4 (a) NO queda adoptada** — se contrasta con D-34 y las compuertas vigentes y, mientras no se resuelva, la salida real permanece bloqueada, sin bypass en la API operativa y sin equiparar traspaso con exportación.
Consecuencia técnica registrada: `TRANSFER_DISPATCH_GATE` bloquea por defecto. **Reabrir D4** exige: (1) la condición de D-34 (`dd_package_id` y `dispatch_at`) escrita, (2) la conclusión competente sobre si el traspaso es «puesta en el mercado», (3) una decisión del propietario que sustituya el proveedor de la compuerta, con su propia prueba. Detalle: `docs/decisiones/A03-TRASPASO-ENTRE-ORGANIZACIONES.md` §0 y §13.

### Paquetes de revisión de los bloqueos regulatorios y de proveedor (2026-10-21)

> **Actualización (2026-10-21): el punto de entrada único es `decisiones/INDICE-REVISION-REGULATORIA.md`** (documento y versión por revisar, preguntas, hechos por organización, registro de la respuesta y efecto técnico; qué aporta el propietario y qué exige la revisión competente). La tabla de abajo se conserva como referencia histórica; no la dupliques.

Los cuatro paquetes están **preparados en sus fuentes responsables**; esta tabla solo los enlaza y separa **quién decide**. Preparar un paquete **no es decidirlo** ni cambia ningún porcentaje, estado de requisito, compuerta o `UNDETERMINED`.

| Bloqueo | Paquete (fuente responsable) | Decide el **propietario** | Decide un **revisor competente** |
| --- | --- | --- | --- |
| **D-05.B** | `decisiones/D-05B-FICHA-REVISION-2026-10-21.md` (ficha Q1–Q7) | Q8: presentar o preparar (P1-007 conserva su alcance original) | Q1–Q7: categoría de cada actor, 2(15a), contenido de la geolocalización, definición de parcela, efecto de 2024/3084 y 2026/1565, acto de revisión |
| **P1-005** | `decisiones/P1-005-MATRIZ-OBLIGACIONES.md` §6 | ¿Publicar `0.2.0` con EC-7–EC-9 en `DRAFT` (publicación técnica)? | R1–R8: vigencia de fuentes, aplicabilidad, evidencia admisible, materias mínimas, reglas ambientales, reglamentos, cartografía, designación del revisor |
| **D-07.5 / D-07.6** | `decisiones/D-07-PROPUESTA.md` §11 | D-07.5(b): b-1 / b-2 / b-3 (vinculación catálogo↔perfil); permiso y asignación de «concluir» (después de que el revisor fije la capacidad) | D-07.5(a) (el contenido del perfil, ver P1-005) y D-07.6 (capacidad y fundamento para concluir) |
| **D-09.B** | `decisiones/P0-028-SATELITE.md` («Revisión de fuentes oficiales para D-09.B») | (1) ensayo con geometría **sintética**; (2) titularidad y custodia de la clave; (3) Whisp primero o reabrir; (4) quién acepta los Términos | (5) si una geometría de parcela es dato personal y su base (D-14); (6) aceptabilidad de un servicio sin SLA, con términos modificables sin aviso y sin foro nacional; (7) la contradicción de la fuente sobre qué llega a Google Earth Engine |

**Implementación original pendiente que depende de esas respuestas** (ninguna es inequívoca e independiente hoy): evaluar `GEOLOCATION_PROFILE` (D-05.B), acto de revisión jurídica del perfil (P1-005), vinculación y verificación de `regulatory_profile` y registro de una conclusión (D-07.5/.6), llamadas reales al proveedor (D-09.B). Hallazgo nuevo para el revisor: `RISK_CATALOG_APPROVED` pasa a `MET` hoy con cualquier `regulatory_profile` no nulo (`decisiones/D-07-PROPUESTA.md` §11.1).

### Alcance de presentación conservado (2026-10-21)

Q8 (D-05.B) **no recorta el proyecto**: Terra Link conserva la preparación de expedientes y la integración de presentación prevista en **P1-007**. La presentación real permanece **deshabilitada** hasta cumplir su autorización, configuración y aceptación. «Solo preparar» no es una opción que elimine esa historia.

### Guarda de `RISK_CATALOG_APPROVED` y perfil `0.2.0` (2026-10-21)

Implementada la guarda técnica (`regulatory_profile` es una referencia a un perfil adoptado, completo y con revisión vigente; trigger `0059`) y preparado `0.2.0` como borrador no adoptable (`0060`). Siguen pendientes: D-07.5(b) b-1/b-2/b-3 (`D-07-PROPUESTA.md` §12), la revisión jurídica (P1-005 §6–7) y D-07.6. Sin cambios de porcentaje, requisitos ni compuertas.

### D-07.5(b): opción b-1 adoptada (2026-10-21)

Adoptada por el propietario e implementada (`decisiones/D-07-PROPUESTA.md` §13). Pendientes que NO resuelve: contenido del perfil y su revisión jurídica (D-07.5(a), P1-005), D-07.6 (quién concluye y con qué permiso), y un perfil completo y revisado que permita vincular una versión real. La etiqueta opcional de b-2 no se implementó.

## D-07.6 — conclusión humana del responsable EUDR (2026-10-22)

**Adoptada por el propietario e implementada (mecanismo).** El rol canónico `EUDR_MANAGER` registra una conclusión humana
(`NEGLIGIBLE`/`NON_NEGLIGIBLE`) con el permiso específico `risk:conclude`, solo en su organización; ningún otro rol lo recibe.
El motor nunca concluye (`UNDETERMINED` por `CHECK`). Una conclusión no anula requisitos pendientes ni habilita READY ni despacho,
y se invalida si cambian evaluación, perfil o catálogo. La favorable exige resolver **cada carencia** con justificación y soporte
propios; rechazar textos idénticos es solo una comprobación formal. Enmienda acotada de `docs/07` (asignación de
`EUDR_MANAGER` por `membership:assign`). Migraciones `0064`–`0065`. Evidencia: `qa/EVIDENCIA_D076_CONCLUSION_HUMANA_2026-10-22.md`.
**Sigue pendiente (separado):** aceptación regulatoria real del criterio y de las conclusiones, revisión jurídica real del perfil,
y los avisos de la cadena de desarrollo (jest).

## Aclaración del propietario sobre el propósito y la documentación (2026-10-22/23)

Terra Link **prepara y gestiona evidencia** para la debida diligencia (origen, trazabilidad, soportes, riesgos, medidas); **no certifica** autenticidad ni conformidad y no atribuye aprobación automática al subir un archivo. La responsabilidad de la debida diligencia es de la entidad obligada. Adoptada como criterio de producto y aplicada mediante el plan de ajuste mínimo (`contexto/PLAN_AJUSTE_MINIMO_DOCUMENTACION_Y_PRODUCTO_2026-10-23.md`): Mi finca, aportación documental contextual, entregas propias (listado) y atribución de la revisión humana. **No es una decisión regulatoria**. **Tipos documentales por aspecto: resueltos (2026-10-23, migración 0066) dentro del ajuste ya autorizado**, sin pedir otra decisión; el detalle de la entrega se conserva restringido (el listado satisface el criterio). Pendientes que siguen separados: todo lo externo (revisión jurídica, GUIA/EUDR-IS, piloto, Android físico).
