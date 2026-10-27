# Estado compartido de desarrollo

Última actualización: **2026-10-20** (continuidad; ver «Próxima acción (2026-10-20)»). Repositorio de referencia `cyberlandec-oss/TERRA-LINK-EUDR-2026` (`TERRA-LINK-2025` queda como histórico), rama de trabajo `fix/next-seguridad-16-4-2` (`main` en `03bb2f6`, atrasada). Estado más reciente: sección «AJ-07b y AJ-08» al final.

**Seguimiento por historias (cifras al 2026-10-19, ver `sesiones/REANUDAR_2026-10-19.md`)** (cuenta **historias del MVP**, no esfuerzo):

| Estado | Historias |
| --- | ---: |
| **DONE_LOCAL**, con sus límites de evidencia | **25 de 32** (78,1 %; P0-003 cerrada el 2026-10-17) |
| Abiertas, con implementación parcial | **6** — P0-017, P0-022, P0-023, P0-024, P0-028, P0-029 |
| Piloto **sin ejecutar** | **1** — P0-031 |

**Qué mide y qué no ese 75 %.** Es el **cierre de historias del MVP** con evidencia local, y nada más. **No** es
un porcentaje de cumplimiento de la documentación raíz, que incluye además requisitos de producción, seguridad,
operación, conformidad EUDR y fases posteriores al MVP. Tampoco mide esfuerzo restante: las siete no cerradas no son
intercambiables entre sí ni con las cerradas. Y **DONE_LOCAL** sigue significando lo de siempre: criterios de la
historia cumplidos con pruebas locales, sin acreditar producción, Android real ni conformidad.

**Segunda medida, distinta y necesaria**: la **cobertura demostrada de requisitos** de `03_REQUISITOS.md` es
**25 de 58 — 43 %** (y **25 de 43 — 58 %** si se cuenta solo lo que el MVP se propuso). La diferencia con el 75 %
es exactamente lo que el cierre de historias **no** mide: los 12 requisitos **transversales** —operación,
seguridad, offline, rendimiento, recuperación— que ninguna historia cierra por sí sola, y los 15 de **evolución**,
que nunca estuvieron en el alcance del MVP. Contraste por requisito, con método y denominador:
`docs/decisiones/CONTRASTE_DOCUMENTACION_RAIZ_2026-10-16.md`.

De D-05 solo sigue abierta la parte **B** (aplicabilidad jurídica). De D-07, las partes **5 y 6** (perfil jurídico
y quién concluye).

**D-07 — mecanismos adoptados el 2026-10-15** (migración `0042`): aprobación con permiso propio y **adopción por
organización** separada de la publicación global; **severidad por regla agregada por máximo**, siempre con su
**cobertura**, y `NOT_ASSESSED` cuando no hay hallazgos; desactualización por cambio de datos o de reglas.
**D-07.3 no aplica** (sin pesos).

**Catálogo técnico `1.0.0` PUBLICADO el 2026-10-15** (migración `0043`), con ocho reglas: **cinco con severidad
declarada** (`MATERIAL_OF_UNKNOWN_ORIGIN` y `MASS_BALANCE_INCONSISTENT` CRITICAL; `DATA_MISSING_ORIGIN` y
`GEOMETRY_INVALID` HIGH; `DOCUMENT_EXPIRED` MEDIUM) y **tres sin ella**. Las cinco graduaciones son **decisiones
de producto**, no exigencias de la norma, y así se declara en cada regla. La versión es **inmutable**: cambiar una
severidad es publicar otra. `0.1.0` y `0.2.0` siguen `NOT_APPROVED`, sin severidades: no se migró nada.

**Publicar no es adoptar ni aprobar jurídicamente.** Ninguna organización ha adoptado `1.0.0`, de modo que ninguna
clasifica nada todavía; y `risk_rule_sets.regulatory_profile` es `NULL` en todas las versiones, porque **D-07.5**
(perfil jurídico) y **D-07.6** (quién concluye) siguen pendientes. Por eso el requisito `RISK_CATALOG_APPROVED` del
expediente sigue `NOT_EVALUABLE` incluso adoptando el catálogo, la conclusión regulatoria sigue `UNDETERMINED` por
`CHECK` y el expediente **no** se acerca a `READY`.

> Resultados ajenos a este proyecto: la auditoría inicial del repo `cacao` no aplica a Terra Link 2025.

## Criterio vigente: validación local

GitHub Actions no es requisito en esta etapa (workflow inactivo en `infra/ci/github-actions-ci.yml`). La facturación de GitHub **no es un bloqueo**. **DONE_LOCAL** = criterios de la historia cumplidos con evidencia local (`npm run validate` aprobado + suites de la historia). DONE_LOCAL no acredita producción, Android real ni conformidad EUDR.

Última validación: `npm run validate` **APROBADA** el 2026-10-15, corrida
`validation-results/2026-10-15T20-04-51-326Z` (no versionada): 7 pasos — servicios, typecheck, lint, build, OpenAPI
validado (**193 rutas**), **62 suites y 563 pruebas** de unitarias + integración y **62 pruebas** E2E de navegador.
Acredita los **mecanismos D-07** (migración `0042`) y la presentación de la severidad con su cobertura.
Su resumen anota `commit: 2430053` + 24 archivos sin confirmar: la corrida es **anterior** al commit, como siempre.

Anteriores del mismo día: `2026-10-15T19-47-14-688Z` (62/563 + 62 E2E, antes de corregir la pantalla de riesgo) y
`2026-10-15T18-33-43-757Z` (61 suites, 545 pruebas, 62 E2E, 192 rutas), que acreditó **D-05.A** (perfil
`EUDR_GEO_V1`, migración `0041`) y el cierre de **P0-009** y **P0-010**.

Su resumen anota `commit: b9b94cf` + 18 archivos sin confirmar, que es el contenido de esta entrega: la corrida es
**anterior** al commit, como siempre. Durante la corrida se editó por error un comentario de
`apps/api/src/plots/geo-profile.ts` y **se revirtió de inmediato**, de modo que el árbol probado es el que se
confirma. El método para comprobar esa correspondencia es el de
`docs/qa/EVIDENCIA_D32_D33_2026-10-15.md` §«Correspondencia entre la corrida y el commit».

**Corrida anterior** (`2026-10-15T04-25-29-508Z`, 60 suites / 519 pruebas + 61 E2E): se ejecutó **antes** del
commit final; su resumen anota `commit: 7e62c74` y 31 entradas sin confirmar. El código probado es el que después se guardó como **`2c1ab60`**, y esa correspondencia se
comprobó —padre del commit, 31 segundos de diferencia, y los registros de la corrida mostrando las suites y los
títulos de prueba que solo existen en ese commit— con su límite declarado, en
`docs/qa/EVIDENCIA_D32_D33_2026-10-15.md` §«Correspondencia entre la corrida y el commit». **A la corrida no se le
atribuye un SHA que aún no existía.**

El 2026-10-15, después de esa validación, se ejecutaron además —sin repetir `validate` completa, por tratarse de
código de prueba y documentación— el recorrido integral (**10/10**) y `e2e/tests/productos.spec.ts` completo
**dos veces, en dos ordenaciones distintas** (**24/24** cada una).

La anterior aprobada fue `a779ab3` (`2026-10-15T01-45-25-586Z`, 59 suites / 504 pruebas + 58 E2E). La corrida
intermedia `2026-10-15T03-42-23-936Z` se **conserva FALLIDA**: una expectativa de prueba desactualizada por la
publicación del catálogo `1.6.0`, no un defecto del producto.

**Pendiente de entorno, abierto**: entre el 2026-10-12 y el 2026-10-14 cinco corridas seguidas fallaron, cada una con una
suite distinta superando el timeout de 60 s. La causa no está confirmada; la hipótesis principal es la latencia del disco
USB donde se trasladó el almacenamiento de Docker. Una corrida aprobada **no** la confirma ni la descarta. Diagnóstico y
mediciones en `docs/qa/DIAGNOSTICO_VALIDACION_INESTABLE_2026-10-13.md`.

## Estado por historia

| Historia | Estado | Motivo |
| --- | --- | --- |
| TECH-001 | **DONE_LOCAL (fundamentos)** | Ver tabla; lo funcional pendiente pasa a sus historias |
| P0-001 Organización | **DONE_LOCAL** | Criterios cumplidos; D-18 provisional no afecta el criterio |
| P0-002 Usuarios | **DONE_LOCAL** | Criterios cumplidos con la autenticación vigente; entrega de invitaciones provisional (D-19) registrada |
| P0-003 RBAC y aislamiento | **DONE_LOCAL** (2026-10-17) | Los seis criterios demostrados: catálogo efectivo, permisos por acción/recurso, A→A y A→B, **checks de FK/jobs/objects** (matriz QA-02), **buyer/grants** (concesiones externas con descarga) y **superadmin/elevación** (D-04 supervisada, ligada a la sesión). Validación APROBADA sobre `de7f996`. **D-04 adoptada como política provisional local**: la elevación habilita **una** acción de lectura redactada |
| P0-004 Productor | **DONE_LOCAL** | Brecha de cifrado de identidad resuelta (migración 0006) |
| P0-005 Código y deduplicación | **DONE_LOCAL** | Unicidad concurrente, coincidencia de identidad y revisión sin fusión |
| P0-006 Parcela | **DONE_LOCAL** (brecha corregida el 2026-10-10) | Clasificación de geometría exacta (doc 06) faltaba: detectada al iniciar P0-007, corregida con `plot:read_geometry` y probada antes de volver a declararla cumplida |
| P0-007 Punto GPS | **DONE_LOCAL** con evidencia **simulada**; captura real pendiente de comprobación humana | Ver criterios abajo |
| P1-015 Idiomas/SSO/consumo | **PARCIAL** (actualizada 2026-10-20): **D-54 adoptada** (coste por organización y período en USD con tarifas declaradas, Keycloak local con OIDC+PKCE, inglés con español fuente, rechazo por límites) e **implementada y demostrada** sobre `4f7e635` (validación aprobada: 88 suites, 953 pruebas, 78 E2E; demostración con Keycloak real 21/21; respaldo 0056 verificado). **Pendiente (único elemento original)**: la dependencia «piloto» (P0-031). Tarifa acordada e IdP de un cliente real **no son criterios originales**: configuración comercial a registrar como gates del piloto. SSO **deshabilitado por defecto**; Keycloak detenido | Ver `docs/qa/EVIDENCIA_P1015_COSTE_SSO_IDIOMAS_2026-10-20.md` |
| P0-031 Piloto y operación reproducible | **NO INICIADA** como piloto. Preparación hecha: **recorrido integral** de la cadena en base aislada (10 casos: **once transiciones encadenadas** —incluido el **cierre de entrega con diferencia**, desde el 2026-10-15— y **cinco bloqueos** con su decisión: D-05, D-07, D-09 parte B, expediente y despacho); **QA-16 COMPLETA en sus dos mitades**: respaldo y restauración verificados sobre las 39 migraciones de entonces (hoy el despliegue lleva **40**) (cotejo de 25 tablas, 265 FK, descifrado 18+21 campos sin fallos, objetos 2/2 por clave, tamaño y hash) **y la aplicación operando sobre la copia** en instancia aislada con API y web propias (9 comprobaciones correctas, 3 bloqueos esperados, 0 fallas); **manual de operación y guion de capacitación escritos**. **Sin ejecutar**: volumen de piloto (20–50 productores), Android real, **RPO/RTO con volumen real** y **capacitación impartida** | Ver `docs/qa/MATRIZ_RECORRIDO_INTEGRAL.md`, `docs/qa/EVIDENCIA_QA16_RESTAURACION_2026-10-15.md`, `docs/MANUAL_OPERACION.md`, `docs/qa/CONTRASTE_SEGURIDAD_2026-10-15.md` y `docs/decisiones/DECISIONES-MINIMAS-PARA-CERRAR.md` |
| P0-028 Primer proveedor satelital | **ABIERTA** (2026-10-14): contrato, persistencia, trabajo asíncrono, desenlaces, defensa de salida, permisos y ficha de parcela implementados y probados **sin proveedor seleccionado**. Ningún resultado puede guardarse con conclusión (`CHECK conclusion = 'NOT_EVALUATED'`) y los resultados de fixture quedan marcados `is_synthetic` y no satisfacen ningún requisito. **D-09 parte A adoptada (2026-10-15)**: adaptador Whisp de desarrollo, probado contra servidores controlados, con llamadas reales cerradas por configuración. Bloqueado por **D-09 parte B** (uso real), **D-07** (regla de riesgo evaluable) y **D-42** (contrato de resultado→evidencia; **no** es D-37, que decide la autoverificación). Validación vigente: `e9ffb9f` (57 suites, 472 pruebas, 58 E2E) | Ver `docs/decisiones/P0-028-SATELITE.md` y `docs/qa/EVIDENCIA_P0-028_2026-10-14.md` |
| P0-030 Reportes e indicadores | **DONE_LOCAL** (revisión 5, 2026-10-16). Cerrada tras contrastar el **criterio literal** de cada fuente: el «perfil de destino regulatorio del GeoJSON» que figuraba como bloqueo **no lo exige ninguna fuente** (S1 §97 dice «GeoJSON export»; S1 §16 pide dos rutas y un formato), se había añadido por interpretación y se retira como condición de cierre; la aplicabilidad jurídica sigue siendo **D-05.B** y se registra en `docs/22`. Cerrarla no acredita producción, volumen de piloto ni conformidad EUDR, y nada se probó contra el servicio real del destino. Antes (revisión 4, 2026-10-15). **`plots_valid` ya se calcula**: cuenta el dictamen del perfil `EUDR_GEO_V1` de la versión **vigente**, declara **perfil y versión contados** (y avisa si hay mezcla de versiones) y separa **cumple / no cumple / en revisión / no evaluable / sin evaluar**; las no evaluadas **no entran en el denominador**. Salió de `CRITERION_UNDEFINED` —el criterio ya existe— y pasa a `UNKNOWN` mientras no se ejecute. **Revisión 5 (2026-10-15): la distribución de riesgo ya se calcula.** Con el catálogo `1.0.0` publicado y **adoptado** por una organización, los indicadores clasifican sobre la base de los lotes con severidad y el **lote CRÍTICO se publica en su propio indicador** (`risk_critical`, **extensión declarada de Terra Link**, marcada como tal en pantalla y en la respuesta: no está en la lista de S1 §60). Sin adopción siguen en `UNKNOWN` **citando el motivo real** —publicar no es adoptar—, no una lista de historias pendientes. El perfil **técnico** ya existe (D-05.A) y la exportación declara `regulatory_profile: PENDING / depends_on D-05.B`, de modo que nadie la lea como acreditación. Antes (2026-10-14, revisión 3; `validate` APROBADA sobre `ebb8368`). Demostrado: 11 KPI de §60 con **cinco estados** y conteos `observed`; **seis reportes por entidad de §97** con permiso de **cada dominio del que publican datos**, probado en memoria con permisos arbitrarios; paginación por cursor (520 filas, sin duplicados ni omisiones) y exportación del conjunto completo hasta 20 000 filas, con el tope declarado; **GeoJSON técnico**; **comparación de actividad** por fecha operativa; cobertura histórica corregida; consistencia por instantánea declarada con su alcance exacto. Sin bloqueos propios: `plots_valid` y la distribución por severidad salieron de bloqueo el 2026-10-15, y el «perfil de destino regulatorio» no era un criterio de la historia | Ver `docs/decisiones/P0-030-CRITERIOS.md`, `docs/decisiones/P0-030-REPORTES.md`, `docs/qa/EVIDENCIA_P0-030_2026-10-14.md` y `docs/qa/EVIDENCIA_D07_CATALOGO_1_0_0_2026-10-15.md` |
| P0-029 Movimientos y embarque | **ABIERTA**: reserva/liberación/cancelación en el ledger, preflight y destino en el Lot Hub demostrados; **despacho no demostrado** (bloqueado por D-34, DD READY inalcanzable y calidad pendiente; mecánica probada solo con preflight sintético). `npm run validate` **APROBADA** el 2026-10-14 sobre `ad03b80` (`2026-10-14T02-21-43-641Z`): es la primera completa que incluye esta historia, y no cierra el pendiente funcional. CTE `SHIPMENT` figura INTEGRATED en su sentido de contrato —la operación y su evento existen—, no como despacho acreditado | Ver `docs/decisiones/P0-029-EMBARQUES.md` y `docs/qa/EVIDENCIA_P0-029_2026-10-12.md` |
| P0-027 Web por rol y Lot Hub | **DONE_LOCAL** (2026-10-12): reabierta por la condición de «Parcelas sin ubicación» y el aviso de parcelas restringidas; corregida y `npm run validate` aprobada (`2026-10-12T17-51-31-124Z`) | Ver `docs/decisiones/P0-027-WEB-POR-ROL-Y-LOT-HUB.md` |
| P0-026 Importación Excel | **DONE_LOCAL** (2026-10-12): cinco plantillas (productores, productos, parcelas, entregas, lotes) con criterios originales contrastados; `npm run validate` aprobada sobre el commit. No acredita uso con un Excel real de una asociación | Ver `docs/decisiones/P0-026-IMPORTACION-EXCEL.md` |
| Superficie declarada (P0-006) | **Adopción para desarrollo local** (2026-10-12): actualizarla conserva la geometría vigente; no hereda evaluaciones GIS | Ver `docs/decisiones/SUPERFICIE-DECLARADA-CONSERVA-GEOMETRIA.md` |
| P0-024 Sync | **ABIERTA**: servidor y motor móvil para ubicación y foto; probado en integración y con cliente Node contra la API; sin dispositivo ni inventario | Ver criterios abajo |
| P0-023 Captura offline | **ABIERTA**: sesión sin ventana extra, cifrado obligatorio en build nativo y fotos en la base probados en Node; sin ensayo Android real ni SQLCipher en dispositivo | Ver criterios abajo |
| P0-022 Diligencia y paquete | **ABIERTA**: capacidades independientes DONE_LOCAL; aprobación READY y `DD_PACKAGE` con datos reales no demostrables (requisitos dependientes de decisiones y capacidades inexistentes, sin rebajar) | Ver criterios abajo |
| P0-021 Mitigación | **DONE_LOCAL** (criterios originales demostrados); causas que dependen de D-05 o del proveedor satelital no se mitigan (no se simula su resolución) | Ver criterios abajo |
| P0-020 Riesgo | **DONE_LOCAL** para sus criterios originales. Desde el 2026-10-15 el **mecanismo** de severidad existe (D-07.2: por regla, por máximo, con cobertura), pero **ningún catálogo la declara ni está adoptado**, así que toda evaluación sigue saliendo `NOT_ASSESSED` **con su motivo**. La conclusión sigue `UNDETERMINED` por `CHECK` (D-07.5/D-07.6). Reglas dependientes de D-05.B y P0-028 siguen no evaluables | Ver criterios abajo y `docs/decisiones/D-07-PROPUESTA.md` |
| P0-017 Inventario y balance de masa | **Criterios demostrados localmente excepto despacho**; STORAGE integrada (CTE 1.3.0); reserva para embarques demostrada con P0-029 (2026-10-12). **Historia abierta**: el despacho sigue bloqueado (P0-029, D-34) | Ver criterios abajo |
| P0-016 Lotes y procesos | **DONE_LOCAL (2026-10-15)**: criterios originales demostrados localmente; FERMENTATION integrada (CTE 1.2.0) y **DRYING integrada** (CTE 1.6.0) tras adoptar D-32 (humedad en %BH con método y responsable). Siguen pendientes, fuera de los criterios de la historia, los **límites de aceptación** de la humedad y las unidades adicionales de peso (D-32) | Ver criterios abajo y «2026-10-15» |
| P0-012 Entregas y recepción | **DONE_LOCAL (2026-10-15)**: el criterio «diferencias con causa» queda demostrado con el cierre de entregas (D-33 adoptada). Antes: **Capacidades demostradas: verificadas localmente** (entrega, peso recibido, parciales, vínculos, calidad básica como decisión humana, no duplicación). **Historia completa: ABIERTA**, pendiente del criterio «diferencias con causa» (cierre y tolerancias sin política, D-33). Evidencia por criterio abajo (entrega, recepción física parcial, pesaje, soportes, calidad separada, correcciones, compuertas por transición) con decisiones de diseño MVP D-33/34/35 no validadas en campo; cierre por debajo de lo declarado, tolerancias, catálogo de límites, centros asignados e inventario (P0-017) pendientes | Ver criterios abajo |
| P0-025 Auditoría | **DONE_LOCAL** (criterios de la historia sobre los módulos existentes); auditoría de riesgo, entregas, procesamiento, expediente y concesiones pendiente de sus historias; formato de exportación provisional (D-38) | Ver criterios abajo |
| P0-019 Evidencias | **DONE_LOCAL** (criterios de la historia); afirmaciones de lote, análisis ambiental y mitigación esperan sus entidades; uso en riesgo/expediente es P0-020/P0-022 | Ver criterios abajo |
| P0-018 Documentos | **DONE_LOCAL** (criterios de la historia); usa auditoría ya verificada; P0-025 y P0-019 ya cerradas en local | Ver criterios abajo |
| P0-015 Eventos | **DONE_LOCAL** para los criterios internos de la organización (correction_of con efecto real en productor, historial autorizado, reproceso DEAD, fencing); concesiones externas y elevación siguen en P0-003 | Ver criterios abajo |
| P0-014 KDE | **DONE_LOCAL** para catálogo y servicio de validación; 0 compuertas integradas (cada operación lo demuestra en su historia); D-33, D-34 y configuración jurídica pendientes | Ver criterios abajo |
| P0-013 CTE | **DONE_LOCAL** (catálogo versionado y mapeo de lo existente; la integración de cada operación es criterio de su propia historia) | Ver criterios abajo |
| P0-011 Productos | **DONE_LOCAL** (2026-10-10): el criterio pendiente «transformación cambia estado con evento/rendimiento» quedó demostrado con la fermentación de P0-016 (`lots.int-spec.ts`, E2E) | Ver criterios abajo |
| P0-010 Validación GIS | **DONE_LOCAL (2026-10-15)**: la parte técnica ya estaba verificada (`TL_GIS_TECH 1.0.1`) y el criterio pendiente —«umbral debajo/igual/encima probado tras aprobar perfil»— queda demostrado con **D-05.A adoptado** e implementado como `EUDR_GEO_V1` (regla y tabla propias). **Separado y pendiente**: la **aplicabilidad jurídica (D-05.B)** y la **aceptación por el servicio real del destino**, que nunca se ha probado | Ver criterios abajo y `docs/decisiones/D-05-PROPUESTA.md` |
| P0-009 GeoJSON | **DONE_LOCAL (2026-10-15)**: el alcance independiente ya estaba verificado y el criterio «perfil destino» queda demostrado con la **exportación con perfil por productor** (`EUDR_GEO_V1`), que convive con la exportación técnica sin sustituirla. **Separado y pendiente**: **D-05.B** y la **aceptación por el servicio real**; cumplir el perfil técnico no es conformidad | Ver criterios abajo |
| P0-008 Polígono | **DONE_LOCAL** con evidencia de integración (PostGIS real) y navegador **[SIMULADA]**; captura real de campo pendiente | Ver criterios abajo |

### TECH-001 — criterio por criterio

| Criterio (doc 18) | Estado | Evidencia o destino |
| --- | --- | --- |
| Inventario, stack y estructura (ADR-0001), rules mapeadas | Cumplido | ADR-0001, `.claude/rules` |
| Comandos reproducibles | Cumplido | docs/20, `npm run validate` |
| Validación automatizada («CI») | **Cumplido en local**: `npm run validate` sustituye a Actions en esta etapa | docs/20 |
| Migraciones versionadas | Cumplido (0001–0007) | `apps/api/src/db/migrations` |
| OpenAPI ejecutable **validada** | Cumplido: generada y validada en cada `validate` | `npm run openapi -w apps/api` |
| ERD/diccionario contrastados | Cumplido para lo implementado | doc 06 «Esquema implementado» |
| Matriz RBAC real | Cumplido | doc 07 |
| Envolvente de eventos + outbox | Cumplido | doc 08 «Implementación vigente», `events.int-spec.ts` |
| Contenedores (API, web, worker) | Cumplido | docs/20 |
| Catálogos CTE/KDE | **Trasladado** a P0-013 (CTE) y P0-014 (KDE): son funcionalidad de dominio | backlog |
| Framework de reglas / riesgo | **Trasladado** a P0-020 (risk engine) | backlog |
| Ledger de inventario | **Trasladado** a P0-016/P0-017 (ADR-0003) | backlog |
| Reproceso manual de entregas DEAD | Pendiente técnico menor; se hará con el primer consumidor crítico (P0-015/P0-028) | doc 08 |

### P0-003 — criterios

Verificados: catálogo efectivo, permisos por acción y recurso, organización y membresía activas, referencias del mismo tenant, anti-escalamiento, efecto inmediato de revocaciones, ausencia de datos de otra organización, varios roles y organizaciones (`rbac.int-spec.ts`, `members.int-spec.ts`, E2E). **Bloqueados**: concesiones a BUYER/AUDITOR externos (falta contrato de grants) y elevación de SUPER_ADMIN (falta D-04; decisión mínima en docs/22). Jobs y objetos se verificarán cuando existan esos recursos.

### P0-004 — protección de identidad (revisión)

Doc 06 exige «identidad **cifrada**/restringida». Antes solo estaba restringida (brecha registrada). Ahora:
- Documento, teléfono y dirección se guardan con AES-256-GCM por campo. El AAD liga cada valor a su organización, registro y campo; las claves son versionadas, viven solo en `.env` (`PII_*`) y nunca en el repositorio.
- El número de documento tiene un índice ciego (HMAC con clave aparte) para la búsqueda exacta.
- No queda texto plano en la tabla ni en el historial (`producer_versions` cifra por versión).
- La migración 0006 cifra los datos existentes y se detiene sin cambios si faltan claves.
- Se mantiene la restricción por permiso (`producer:read_identity`): cifrado **y** permisos, no uno en lugar del otro.
- Pruebas: `pii.spec.ts`, `producer-identity-encryption.int-spec.ts` (sin texto plano en tablas, eventos ni auditoría; texto cifrado trasladado entre registros rechazado; migración con y sin claves).
- Pendiente operativo: custodia y respaldo de claves fuera del equipo y rotación con re-cifrado (antes de producción).

### P0-005 — criterios

| Criterio | Resultado | Evidencia (`producer-matching.int-spec.ts`) |
| --- | --- | --- |
| Código único por organización bajo concurrencia | 8 altas simultáneas → 1 × 201 y 7 × 409 `PRODUCER_CODE_TAKEN` | «unicidad del código bajo concurrencia» |
| Mismo código en otra organización | Permitido | «normalización del código…» |
| Normalización según contrato | Recorte de espacios; mayúsculas no unificadas (D-21, no bloquea) | ídem |
| Coincidencia de identidad | Mismo tipo y número normalizados → caso PENDING, sin cambios en productores | «coincidencia de identidad…»; mutante de la comparación de tipo detectado |
| Falsos positivos | Otro tipo, otro documento con el mismo nombre, otra organización → sin caso | «falsos positivos…» |
| Revisión asistida sin fusión | Resolver solo cambia el caso; productores intactos; par resuelto no se reabre; auditado | «resolver no fusiona…» |
| Permisos y aislamiento | `producer:review_duplicates` (ORG_ADMIN, MANAGER); técnico y auditor 403; otra org 404; quien registra solo ve el conteo | «permisos y aislamiento…» |
| UI en español | Aviso al registrar; página de revisión con identidad según permiso | E2E «posible duplicado…» |
| Fuera de alcance | Fusión de registros (sin contrato) y reglas no documentadas (D-22) | docs/22 |

### P0-006 — criterios

| Criterio (doc 18 / pedido) | Resultado | Evidencia (`plots.int-spec.ts` salvo indicación) |
| --- | --- | --- |
| FK productor mismo tenant | 422 `PRODUCER_NOT_AVAILABLE` (misma respuesta que fuera de alcance); FK compuesta en BD | «productor de otra organización…» |
| Código único por organización bajo concurrencia | 8 altas simultáneas → 1×201, 7×409 `PLOT_CODE_TAKEN`; mismo código en otra org permitido | «código concurrente…», «mismo código…» |
| Campos del contrato | Productor, código, cultivo obligatorios; nombre, variedad, uso del suelo y ubicación administrativa opcionales (doc 06, S1 §13) | «alta autorizada…» |
| Alta, búsqueda, listado paginado, detalle, edición | Cursor estable; filtros por texto, estado, situación geométrica y productor | API + E2E `parcelas.spec.ts` |
| Control de versión | Dos ediciones simultáneas → 200 + 409; versión geométrica con versión obsoleta → 409 | «conflicto de edición…»; E2E con borrador conservado |
| Geometría histórica y versión actual | `plot_versions` inmutable (trigger), `current_version_id` con FK compuesta; declarada → punto → polígono; la anterior intacta | «versiones geométricas…» |
| Superficie declarada y calculada separadas | Calculada solo para polígonos válidos con geodesia (~1,23 ha para 0,001°); punto sin superficie calculada (CHECK) | ídem |
| Comprobaciones estructurales ≠ validación GIS | 422 por anillo abierto o rango; autointersección guardada NOT_VALIDATED sin área; GPS/importación → 422 | «comprobaciones estructurales…», `geometry.spec.ts` |
| Técnico dentro de sus asignaciones | Solo productores asignados; parcela ajena por id → 404; la reasignación cambia el alcance | «técnico…»; mutante detectado; revisión visual (técnico no asignado) |
| Listados sin parcelas ajenas | ✔ | «listados sin parcelas ajenas…» |
| Historial y baja lógica | `plot_history` append-only; baja conserva versiones; productor de baja no admite parcelas | «baja lógica…» |
| Atomicidad y rollback | Fallos no dejan evento, historial ni auditoría; eventos sin coordenadas | «rollback…» |
| Interfaz (UI-06) | Menú por permiso, listado, alta contextual desde el productor, ficha con situación geométrica, esquema y tabla de coordenadas, navegación productor ↔ parcela; sin botones de GPS/importación | E2E + revisión visual |
| Fuera de alcance | Captura GPS (P0-007), polígono de campo (P0-008), GeoJSON (P0-009), validación GIS y umbral (P0-010, D-05) | — |

### P0-007 — criterios

| Criterio | Resultado | Evidencia |
| --- | --- | --- |
| Coordenadas originales, fuente, adquisición, recepción, precisión, actor/organización/parcela/versión | `location_samples` + versión POINT `BROWSER_GEOLOCATION`, en una transacción con historial, evento y auditoría | `location-capture.int-spec.ts` «captura válida…» |
| La fuente no se presenta como GPS | Fuente `BROWSER_GEOLOCATION`; la UI explica que puede ser GPS, Wi-Fi o red | ídem; E2E |
| Fecha de adquisición preservada; recepción del servidor | `captured_at` = `position.timestamp`; `received_at` = `now()`; adquisición en el futuro → 422 | «captura válida…», «coordenadas, fecha y fuente inválidas…» |
| Precisión null explícita, 0 reportado, inválidas | null se conserva; 0 se conserva sin presentarse como perfecta; negativa, texto u omitida → 400 | «precisión…»; vitest `accuracyLabel` |
| Orden longitud/latitud | `ST_MakePoint(lon, lat)`; `ST_X` = longitud, `ST_Y` = latitud | «captura válida…» |
| Punto sin superficie | `area_calculated_ha` NULL; la declarada vigente se arrastra | «captura válida…», «versiones inmutables…» |
| Alcance del técnico y reasignación antes de guardar | No asignado 404; tras reasignar, el anterior 404 y el nuevo 201 | «alcance del técnico…» |
| Acceso entre organizaciones | 404 (ruta e id ajenos) | «acceso entre organizaciones…» |
| Conflicto y doble envío | 409 con muestra conservada; mismo `operation_id` → un efecto (201 + 200 réplica); reutilizado con otros datos → 409 | «doble envío…», «conflicto concurrente…»; E2E |
| Rollback y datos sensibles | Rechazos sin versión ni evento; eventos y auditoría sin coordenadas | «coordenadas, fecha…», «versiones inmutables…» |
| Captura web (UI-07) | Solicitar → revisar → confirmar → resultado; denegado, no disponible, timeout, sin soporte, cancelar; sin guardado automático | E2E `ubicacion.spec.ts` **[SIMULADA]** 8/8 |
| Captura real en este equipo | **No obtenida**: Chromium de Playwright sin proveedor de ubicación (timeout, código 3), con y sin ventana | Pendiente de comprobación humana en Edge/Chrome |

### P0-008 — criterios

Validación: `npm run validate` APROBADA (`validation-results/2026-10-10T16-01-06-176Z`): API 131/131, web 4/4, E2E 30/30, OpenAPI 45 rutas. Revisión visual 23 entradas, 0 incidencias.

| Criterio | Resultado | Evidencia (`polygon-drafts.int-spec.ts` salvo indicación) |
| --- | --- | --- |
| Borrador en servidor, reapertura tras recargar, orden explícito, versión del borrador | `polygon_drafts` + `draft_vertices` (0010); `acquisition_seq`; `row_version` | «recuperación tras recargar»; E2E |
| Muestra por vértice (coordenadas originales, fuente, adquisición, recepción, precisión o null, operation_id) | Append-only | ídem |
| Doble envío idempotente; id reutilizado con otros datos | 201 + 200 réplica; 409 `OPERATION_ID_REUSED` | «doble envío idempotente» |
| Deshacer sin falsear la muestra | Fila en `draft_vertex_exclusions`; UPDATE/DELETE de vértices rechazados por trigger | «deshacer…» |
| Dos pestañas | 409 `VERSION_CONFLICT`, muestra conservada, recarga visible | «dos pestañas»; E2E |
| <3 vértices distintos / repetidos | 422, borrador conservado; repetidos advertidos | «menos de 3…» |
| Cierre sin muestra extra | Anillo cerrado con el primer vértice; 4 muestras → 5 posiciones; `accuracy_m` de la versión null | «cierre sin muestra adicional…» |
| Confirmación atómica e inmutable; cambio posterior = otra versión | Versión POLYGON + borrador CONFIRMED + historial + evento + auditoría en una transacción | ídem |
| Estructura / validez técnica / GIS P0-010 separadas | `storable`, `technically_valid` (ST_IsValid), `NOT_VALIDATED` | ídem; E2E |
| Autointersección | Rechazada (422 `POLYGON_NOT_VALID`, borrador conservado) salvo `keep_invalid_for_review`: sin superficie, motivo en notas, sin reparar (D-26 provisional) | «autointersección» |
| Resumen de precisión completo/mixto/ausente; 0 conservado | `summarizeAccuracy` | unitarias `accuracy-summary.spec.ts`; integración |
| Acceso: `plot:read_geometry`, revalidación por escritura, otra organización | Auditor 403 y sin coordenadas; reasignado 404; membresía desactivada rechazada; org suspendida 403; org ajena 404 | «reasignación y revocación…», «entre organizaciones…» |
| Sin coordenadas en eventos/auditoría | Verificado sobre el payload y `audit_logs` | «cierre…» |
| Rollback sin efectos parciales | Conflicto de versión y fallo forzado en la transacción: sin versión, evento ni cierre | «rollback…» |
| UI (añadir, lista, vista previa, deshacer, revisar, confirmar, estados, teclado, 390 px) | `lib/polygon-capture.tsx` | E2E `poligono.spec.ts` **[SIMULADA]** 4/4; revisión por rol |
| Captura real en campo | **No obtenida** (mismo límite que P0-007) | Pendiente humano en Edge/Chrome |

Límite: la emulación de Chromium siempre informa precisión; «precisión no informada» se prueba solo en integración.

### P0-009 — criterios

Validación: `npm run validate` APROBADA (`validation-results/2026-10-10T17-00-24-210Z`): API 153/153, web 4/4, E2E 36/36, OpenAPI 53 rutas. Revisión visual 24 entradas, 0 incidencias. Perfil documentado en docs/10 §«Perfil de importación GeoJSON».

| Criterio | Resultado | Evidencia (`geometry-imports.int-spec.ts`, `geojson-profile.spec.ts`, E2E `geojson.spec.ts`) |
| --- | --- | --- |
| Import/export autorizado | Escritura: update en alcance + `plot:read_geometry` + org activa; lectura de original/exportación: read + `plot:read_geometry`. Auditor 403; técnico no asignado 404; otra organización 404 | «descarga del original…», «acceso entre organizaciones…», revisión por rol |
| `[lon, lat]` | Perfil RFC 7946; `ST_X` = longitud con ejemplo inequívoco; ejes nunca intercambiados (advertencia `POSSIBLE_AXIS_SWAP`) | integración «Polygon en Feature…», unitaria «orden de ejes» |
| Límites y errores | Bytes, profundidad, componentes, anillos y posiciones configurables; JSON mal formado, tipo, CRS, dimensiones, anillo abierto → 422 comprensible, sin eco ni almacenamiento | unitarias; «archivos fuera del perfil…»; E2E |
| Reintento sin duplicar | `operation_id` en análisis y confirmación; concurrente → una versión (201 + 200) | «doble confirmación…» |
| Revisión previa y versión única | Análisis → revisión (hash, tipo, componentes, huecos, posiciones, validez, advertencias, vista previa) → confirmación atómica con historia, evento y auditoría | «Polygon en Feature…», E2E |
| Original privado e intacto | S3 privado sin URL; SHA-256 del servidor; descarga revalida permisos y verifica el hash | «descarga del original…», E2E (bytes idénticos) |
| Staging y compensación (sin transacción S3+BD) | Fallo de subida → sin fila; fallo de BD → objeto borrado; original ausente → sin versión; descarte con fallo de borrado → barrido | «fallos de almacenamiento…» |
| Validez técnica vs P0-010 | Autointersección sin superficie, solo «conservar para revisión» (D-26), `NOT_VALIDATED`, sin reparar | «autointersección…» |
| Exportación actual/anterior; reimportación | Feature RFC 7946 sin identidad personal y con aviso «no es paquete EUDR»; serialización de 17 dígitos; reimportar conserva `geometry_hash` | «exportación…», E2E |
| Revocación/reasignación tras el análisis | Reasignado 404; membresía desactivada rechazada; org suspendida 403; la importación queda ANALYZED | «revocación o reasignación…» |
| MultiPolygon con huecos y compatibilidad | Versiones previas sin cambios (`source_import_id` NULL) | «MultiPolygon con hueco…», suites P0-006/007/008 en verde |
| **Perfil destino** | **DEMOSTRADO (2026-10-15)** con **D-05.A** adoptado: exportación con perfil **por productor** (variante de nivel de productor del destino), coordenadas con **6 decimales como números**, `Area` solo en puntos y como número, **sin `ProducerName`** (dato personal) ni **`ProducerCountry`** (no se registra país de producción: deducirlo sería inventarlo), y **lista de no exportables con su motivo**, con código propio para «no evaluada» | `geo-profile.int-spec.ts` §exportación (6 casos) |
| Perfil destino — **lo que NO acredita** | **Pendiente, separado**: la **aplicabilidad jurídica** (D-05.B) y la **aceptación por el servicio real del destino**, que no se ha probado nunca. El **período de producción** del Art. 9(1)(d) **no** viaja en el archivo: no hay contrato que diga cómo, y no se inventa la propiedad | — |
| Evidencia visual de precisión null (P0-008) | **[FIXTURE]**: muestras sintéticas enviadas a la API real con `accuracy_m` null; «Precisión no informada» y «(resumen incompleto)» en pantalla | E2E `poligono.spec.ts` |

Correcciones laterales: (1) el motivo de `ST_IsValidReason` incluía una coordenada y P0-008 lo guardaba en `notes` (visible sin `plot:read_geometry`); ahora se elimina en notas, eventos, auditoría y errores. (2) Las vistas de versiones usaban `ST_AsGeoJSON` con 9 decimales; ahora 17 (ida y vuelta exacta).

### P0-010 — criterios (parte técnica)

Validación: `npm run validate` APROBADA (`validation-results/2026-10-10T17-37-17-103Z`): API 168/168, web 4/4, E2E 37/37, OpenAPI 54 rutas. Revisión visual 25 entradas, 0 incidencias. Perfil documentado en docs/10 §«Evaluación GIS técnica».

| Criterio | Resultado | Evidencia (`gis-evaluation.int-spec.ts`, `storage-sweeper.int-spec.ts`) |
| --- | --- | --- |
| Geometría, CRS, coordenadas, vacía/degenerada, validez con motivos seguros | Comprobaciones con códigos controlados; ubicación del error solo con `plot:read_geometry` | «inválida…», «vacía y degenerada…» |
| Área solo cuando corresponde | Polígono válido → ha geodésicas; punto → no aplica; inválida → no ejecutada; huecos descontados | «punto sin área; huecos y MultiPolygon…» |
| Duplicados | Igualdad topológica (`ST_Equals`) distinta de igualdad de hash; distinto orden de vértices detectado | «igualdad topológica…» |
| Solapamiento vs contacto | Superficie compartida (DE-9IM) → REVIEW_REQUIRED; solo borde → VALID; sin intersección → VALID | «igualdad topológica…», «solo contacto…» |
| Cobertura de precisión | Completa, mixta, ausente, no disponible (importada) y no aplica | «punto sin área…», «vacía…» |
| Estados y versión de regla | VALID/WARNING/INVALID/REVIEW_REQUIRED con alcance técnico; regla y parámetros guardados | todos |
| Inmutable, versionado y desactualización | Append-only; reevaluar crea otro registro; GEOMETRY_CHANGED, COMPARED_PLOTS_CHANGED, RULES_CHANGED; sin compararse con su propio historial | «resultados inmutables…» |
| Acceso y privacidad | Auditor consulta sin evaluar ni coordenadas; técnico fuera de alcance 404; relaciones fuera de alcance sin identidad; otra organización 404; suspendida 403 | «acceso…», «igualdad topológica…» |
| Reintentos y rollback | `operation_id` concurrente → un registro; fallo forzado → sin evaluación, evento ni auditoría | «reintentos idempotentes…» |
| Errores, logs y NOTICE | NOTICE de PostGIS bloqueado (`client_min_messages=warning`, `ST_IsValidDetail`); errores de base registrados solo con SQLSTATE | «NOTICE de PostGIS…», «reintentos…» |
| Sin reparación destructiva | La evaluación no modifica versiones (plot_versions append-only) | — |
| **Umbral debajo/igual/encima** | **DEMOSTRADO (2026-10-15)** con **D-05.A** adoptado: operador **estricto** (`> 4` exige polígono), **exactamente 4 ha se admite** con aviso de igualdad y **sin banda de tolerancia**; mínimo de 0,0001 ha; comparación sobre el **valor almacenado**, sin reducirlo antes; punto sin superficie **no exportable**; discrepancia declarada/calculada que cruza el umbral → **revisión humana** | `geo-profile.int-spec.ts` (20 casos) |
| Perfil de destino como **dictamen aparte** | **DEMOSTRADO**: regla `EUDR_GEO_V1` con tabla propia y append-only; las evaluaciones `TL_GIS_TECH` **no se migran, ni se recalculan, ni se invalidan** (prueba que compara filas antes y después); los **dos dictámenes se muestran juntos** y pueden discrepar (polígono con hueco: técnico `VALID`, perfil `DOES_NOT_MEET`) | `geo-profile.int-spec.ts`, E2E `geojson.spec.ts` |
| Truncamiento del destino | **DEMOSTRADO**: simulación **hacia cero** en decimal exacto, con coordenadas **negativas**; se valida la geometría **resultante**; **el original no se modifica ni se repara**; el **cierre del anillo** se distingue de los vértices que **colapsan** | `geo-profile.int-spec.ts` (5 casos) |
| Barrido programado (P0-009/D-29) | Worker: huérfanos con gracia y descartados; protección de referenciados bajo bloqueo; tareas reintentables; varios workers sin duplicar | `storage-sweeper.int-spec.ts` 6/6 |

### P0-011 — criterios

Validación: `npm run validate` APROBADA (`validation-results/2026-10-10T18-06-40-557Z`): API 178/178, web 4/4, E2E 42/42, OpenAPI 60 rutas. Revisión visual 26 entradas, 0 incidencias. Contrato en docs/06 y D-31/D-32.

| Criterio | Resultado | Evidencia (`products.int-spec.ts`, E2E `productos.spec.ts`) |
| --- | --- | --- |
| Catálogo de cacao y unidades | Estados de sistema de las fuentes (4) y KG (masa); opciones servidas por la API; sin variedades, calidades, códigos regulatorios ni unidades inventadas | «opciones desde la API…» |
| Códigos por ámbito | Único por organización (mismo código válido en otra); unicidad bajo concurrencia (201 + 409 + 409) | «validaciones…», «consulta y administración…» |
| Unidades explícitas, sin conversión implícita | Respuestas con código, etiqueta, símbolo y dimensión; `conversions: []`; unidad desconocida 422 | «opciones…», «validaciones…» |
| Consulta/administración por rol; entre organizaciones | Recepción consulta, MANAGER no administra, BUYER 403, otra organización 404, suspendida 403 | «consulta y administración…», «organización suspendida…» |
| Edición concurrente e inmutables | `expected_version` (200 + 409); código/estado/unidad → 422 y trigger en BD | «edición concurrente…» |
| Inactivos, historia y referencias protegidas | Desactivar/activar con motivo; inactivo no se edita; sin borrado; historial append-only con instantáneas | «desactivar y activar…» |
| Rollback | Fallo forzado → sin producto, evento ni auditoría | «rollback…» |
| UI-09 | Listado, búsqueda, filtros, alta, edición con conflicto y borrador conservado, confirmación de desactivación, 403 sin enlace, 390 px y teclado | E2E 5/5; revisión por rol |
| **Transformación con evento/rendimiento** | **Pendiente de P0-016/017**: el catálogo impide cambiar estado o unidad por edición; el proceso con evento y rendimiento llega con procesamiento | — |

Corrección de privacidad P0-010 (misma entrega): las evaluaciones ya no devuelven tipo ni cantidad de relaciones fuera del alcance; prueba negativa «privacidad: el técnico no puede inferir…» (vistas indistinguibles con y sin coincidencias ocultas).

### P0-013 — criterios

Validación: `npm run validate` APROBADA (`validation-results/2026-10-10T18-26-11-088Z`): API 183/183, web 4/4, E2E 43/43, OpenAPI 63 rutas. Revisión visual 27 entradas, 0 incidencias.

| Criterio | Resultado | Evidencia (`cte.int-spec.ts`, E2E en `productos.spec.ts`) |
| --- | --- | --- |
| Catálogo versionado de los hitos de las fuentes | 10 hitos de S1 §19 + CLASSIFICATION (docs/08), versión de catálogo 1.0.0, códigos únicos por versión | «catálogo 1.0.0…» |
| Ámbito, consulta y administración | Sistema; consulta con `traceability:read_catalog`; productor 403; no miembro 404; sin rutas de administración (no hay facultad definida) | «permisos y aislamiento…» |
| Referencias estables, vigencia y retirada | `CODE@n` e id; nueva versión retira la anterior sin cambiarla; retirada con motivo; referencias antiguas resolubles | «nueva versión del catálogo…» |
| Auditoría de cambios | Cada publicación queda en `cte_catalog_releases` (inmutable); tablas append-only | «permisos…», «nueva versión…» |
| Rollback | Publicación fallida sin versión, definiciones ni retiradas parciales | «rollback…» |
| Hechos operativos mapeados a eventos existentes | Ningún evento existente es un hito (datos maestros); las 11 operaciones quedan PENDING con evento e historia previstos; el modelo distingue INTEGRATED | «catálogo 1.0.0…», «operación integrada frente a vínculo pendiente…» |
| UI | Consulta de solo lectura con código, descripción, versión, vigencia e integración; sin botones operativos; 390 px y teclado | E2E; revisión por rol |

Justificación de DONE_LOCAL: la aceptación pide el catálogo y el mapeo de los hechos **existentes**; ambos están verificados. La integración de cada operación futura queda como criterio explícito de P0-012/016/017/029 (backlog) y HARVEST/PACKAGING/SALE sin historia se registran en D-33. Mantener P0-013 abierta por operaciones futuras recrearía el ciclo con P0-012, que necesita la capacidad «catálogo de hitos».

GIS: `TL_GIS_TECH 1.0.1` publicada como versión de corrección (el alcance por evaluador cambia el conjunto comparado); registros 1.0.0 inmutables y marcados desactualizados.

### P0-014 — criterios

Validación: `npm run validate` APROBADA (`validation-results/2026-10-10T18-57-26-508Z`): API 195/195, web 4/4, E2E 44/44, OpenAPI 66 rutas. Revisión visual 27 entradas, 0 incidencias.
Fallo intermitente previo (`validation-results/2026-10-10T18-49-29-397Z`): `producers.int-spec.ts` superó 60 s en «búsqueda y paginación…» (la suite tardó 291 s; aislada tarda 12 s). Causa no determinada: sin conexiones pendientes en la base al revisar; hipótesis de contención del equipo durante la corrida. Se conserva la evidencia; no se declara resuelto.

| Criterio | Resultado | Evidencia (`kde-validator.spec.ts` [fixtures], `kde.int-spec.ts`) |
| --- | --- | --- |
| Definición | 62 KDE con código, versión, hito exacto, entidad/campo, tipo, unidad/dimensión, obligatoriedad y condición, regla tipada, responsable, fuente y diferencias | «catálogo 1.0.0…» |
| Validación | Válido, inválido, requerido/opcional ausente, no aplica, condición no evaluable y referencia no verificable; 0/false/""/null distinguidos; sin conversión | unitarias 6/6; «validación con referencias…», «condición entre hitos…» |
| Condición | Verdadera, falsa, desconocida (no equivale a falsa) y no definida en el contrato | unitarias; «condición entre hitos…» |
| Faltantes como faltantes e impedir la transición | `gate.transition_allowed=false` ante bloqueantes; nada se completa | unitarias; «validación…» |
| Versión y responsable | Referencia `CODE@n` a la versión exacta del hito; nueva versión preserva la anterior; hito retirado → 409 para operaciones nuevas | «versionado…» |
| Publicación atómica y esquema cerrado | Publicación fallida sin efectos; reglas fuera del esquema rechazadas | «publicación fallida…»; unitaria de esquema |
| Autorización y privacidad | Productor 403, no miembro 404, referencias fuera de alcance/organización/inexistentes con el mismo código, respuestas sin valores ni datos sensibles | «validación…», «respuestas sin valores…» |
| UI | Consulta por hito (tipo, unidad, obligatoriedad, condición, regla, responsable, fuente, integración) sin formularios; 390 px y teclado | E2E; revisión por rol |
| **Integración en operaciones** | **0 integradas**; cada historia (P0-012, P0-016, P0-017, P0-029) debe demostrar el bloqueo | — |

### P0-015 — criterios (alcance interno)

Validación: `npm run validate` APROBADA a la primera (`validation-results/2026-10-10T19-28-15-559Z`): API 203/203, web 4/4, E2E 45/45, OpenAPI 70 rutas. Revisión visual 28 entradas, 0 incidencias.

| Criterio | Resultado | Evidencia (`event-corrections.int-spec.ts`, `events.int-spec.ts`, E2E) |
| --- | --- | --- |
| Envolvente/versión/tenant/actor/tiempos, append-only | Existentes (TECH-001); actor de la sesión | `events.int-spec.ts` |
| correction_of | Misma organización y agregado, motivo, cadena, sin autorreferencia ni referencias ajenas (también en BD); original inmutable; efecto de dominio real en el productor | «corrección real…», «rechazos…» |
| Idempotencia y concurrencia | Reintento idéntico → réplica (con autorización revalidada); mismo id con otro contenido → 409; 3 correcciones simultáneas → 1; cambio posterior → obsoleta | «idempotencia y concurrencia…» |
| Rollback | Fallo forzado → sin cambio, evento ni auditoría | «rollback…» |
| Historial causal | Por recurso con alcance efectivo, orden y paginación estables, corrección y vínculo al original, campos permitidos, sin identidad ni secretos; tipo desconocido sin campos; reasignación y membresía desactivada retiran acceso | «historial por recurso…» |
| Outbox atómico y consumo idempotente | Fallo de confirmación tras efectos → efectos revertidos; reintento aplica una vez; entrega repetida sin efectos; recibos no se borran | «el consumidor completa sus efectos…» |
| Reproceso DEAD | Autorizado (ORG_ADMIN) con motivo y auditoría; auditor/técnico/otra organización denegados; solicitudes simultáneas → una; historial de intentos y recibos conservados | «DEAD → reproceso…» |
| Fencing de arrendamientos | Un worker con arrendamiento vencido no confirma la entrega reclamada después (LEASE_LOST); efectos una vez | «fencing…» |
| UI | Historial en fichas de productor y parcela; corrección solo con permiso y contrato; original visible y marcado; página de entregas DEAD; 390 px y teclado | E2E; revisión por rol |
| **Concesiones externas y elevación** | **Pendientes en P0-003** | — |

Diagnóstico del timeout de P0-004: `validate` guarda ahora `api-test-timings/` (duración por suite y prueba, fases del arnés —reinicio del esquema, migraciones, arranque, cierre— y consultas ≥ 1 s solo con texto SQL). En esta corrida no reapareció (suite más lenta 11,3 s; 0 consultas lentas). La causa original sigue sin determinar; evidencia en `validation-results/2026-10-10T18-49-29-397Z`. No se aumentó ningún timeout.

### Revisión 2026-10-11 (4) — intento 5 en emulador, vista previa web y prueba negativa

| Punto | Estado | Evidencia |
| --- | --- | --- |
| Recorrido en emulador, intento 5 (APK `184cbfa8`) | Todos los pasos OK salvo almacenamiento lleno | `docs/qa/EVIDENCIA_EMULADOR_INTENTO5_2026-10-11.md` |
| Almacenamiento lleno: error técnico de SQLite al crear borrador | **DEFECTO DE LA APP**, corregido en código; pendiente de APK nuevo | `storageFullMessage` + prueba unitaria |
| APK `184cbfa8` | **NO APTO** (renombrado `NO-APTO-mensaje-almacenamiento-lleno-184cbfa8.apk`) | README móvil |
| Vista previa web móvil (3001) | Funciona; 32/32 pasos en 390 px y escritorio; 3 defectos visuales corregidos | `docs/qa/REVISION_WEB_MOVIL_2026-10-11.md` |
| Prueba negativa sin SQLCipher | OK en emulador: bloqueo antes del login, sin base/token/fotos (etiqueta de variante incorrecta, documentada) | `docs/qa/EVIDENCIA_APK_9996a9b4_Y_NEGATIVA_2026-10-11.md` |
| APK `9996a9b4` (commit `0ba960a`) | **APTO para el ensayo físico**: autoprueba 9/9 y recorrido completo en emulador (intento 6) | idem |
| Teléfono físico | NO EJECUTADO | — |

P0-023 y P0-024 siguen ABIERTAS.

### Revisión 2026-10-11 (3) — recorrido en emulador, prueba negativa y orientación

Móvil (separado de `npm run validate`): `validation-results/2026-10-11T17-08-34-732Z-movil` (typecheck, 25 pruebas de núcleo, recorrido contra la API, bundle Android, expo-doctor). API: solo cambió una prueba (`sync.int-spec.ts` 7/7, lint OK); la última `npm run validate` sigue siendo `validation-results/2026-10-11T07-46-54-839Z`. Evidencia: `docs/qa/EVIDENCIA_EMULADOR_Y_NEGATIVA_2026-10-11.md`.

| Punto | Estado | Evidencia |
| --- | --- | --- |
| Recorrido integrado en emulador | **INTERRUMPIDO** | Login por la interfaz OK; apertura del almacén cifrado falló (defecto real) |
| Defecto SQLCipher + transacción (conexión sin clave) | CORREGIDO EN CÓDIGO, **APK SIN RECOMPILAR** | `apps/mobile/src/adapters/expo.ts`; guardia de disco detuvo Gradle |
| Prueba negativa sin SQLCipher | PREPARADA, **NO COMPILADA** | Variante aislada en `app.config.js`; 2,73 GB libres |
| Sonda de cifrado antes del login | IMPLEMENTADA (sin ejecutar en emulador) | Bloquea sin token/dataset/fotos |
| Orientación visual y aceptación del servidor | DEMOSTRADO | Chromium + `sync.int-spec.ts` |
| APK para el ensayo físico | **NO APTO** (`43f26c95…` contiene el defecto) | Recompilar tras recuperar espacio |
| Teléfono físico | NO EJECUTADO | — |

### Revisión 2026-10-11 (2) — limpieza, build nativo y autoprueba en emulador

Validación web/API: `npm run validate` APROBADA (`validation-results/2026-10-11T07-46-54-839Z`): 290/290 unitarias + integración, 55/55 E2E, OpenAPI 146 rutas. Móvil (separado): `validation-results/2026-10-11T07-58-10-356Z-movil` (typecheck, 24 pruebas de núcleo, recorrido contra la API en contenedor, bundle Android, expo-doctor).

| Punto | Estado | Evidencia |
| --- | --- | --- |
| Limpieza autorizada | HECHA | +5,70 GB en C: (npm); caché Docker 11,25 GB → 0 dentro del disco virtual (sin compactar) |
| Build nativo Android (release, clave de depuración) | GENERADO | APK `e484cf4a…`; SQLCipher en `libexpo-sqlite.so` |
| SQLCipher real | DEMOSTRADO EN EMULADOR | Autoprueba 8/8 (API 30 x86_64) |
| Fallo cerrado sin SQLCipher | PARCIAL | Lógica en el runtime real; sin build nativo sin SQLCipher |
| Copia temporal de subida | DEMOSTRADO EN EMULADOR | Limpieza tras fallo y tras interrupción |
| Salud con escáner caído | DEMOSTRADO | `degraded`, scanner `unavailable` (contenedor e integración) |
| Orientación tras quitar metadatos | DEMOSTRADO (fixtures) | Orientación EXIF conservada; resto eliminado |
| Teléfono físico (captura real, cierre, reinicio, vencimiento, cuentas, almacenamiento, conflictos) | **NO EJECUTADO** | Pasos en `apps/mobile/README.md` § B |

### Revisión 2026-10-11 — escáner, D-41, Expo Go y entorno Android

Validación web/API: `npm run validate` APROBADA (`validation-results/2026-10-11T05-58-21-233Z`): unitarias + integración (API y web) 289/289, E2E 55/55, OpenAPI 146 rutas. Móvil (separado): `validation-results/2026-10-11T05-56-44-934Z-movil (typecheck, 17 pruebas de núcleo, recorrido contra la API en contenedor, bundle Android, expo-doctor)`.

| Punto | Estado | Evidencia |
| --- | --- | --- |
| SCANNER_HOST en docker-compose | CONFIRMADO (commit `761d07f`) | Servicio `api` recreado conservando volúmenes; `printenv SCANNER_HOST` = scanner |
| Foto sintética pendiente → disponible por la API en contenedor | DEMOSTRADO | `docs/qa/evidencia-escaner-contenedor.json` (fase disponible) |
| Escáner inaccesible nunca da limpio | DEMOSTRADO | Fase caído: `FAILED`/`PENDING_SCAN`; fase reintento: `AVAILABLE` tras volver el escáner |
| D-41 adoptada; metadatos sin eludir clasificación | DEMOSTRADO (servidor y Node) | EXIF eliminado en el móvil; `PHOTO_METADATA_PRESENT` en el servidor; título/nombre neutros; eventos y auditoría sin leyenda, nombre ni coordenadas |
| Expo Go solo con fixtures | IMPLEMENTADO (no ejecutado en teléfono) | La app reemplaza cámara y ubicación por fixtures en Expo Go |
| SDK/JDK, build nativo, SQLCipher real, emulador, dispositivo | **NO EJECUTADO** | Bloqueado: 6,3 GB libres en el único disco |

### P0-024 — criterios

Validación web/API: `npm run validate` APROBADA (`validation-results/2026-10-11T05-28-58-923Z`): unitarias + integración (API y web) 289/289, E2E 55/55, OpenAPI 146 rutas; revisión por rol 40 entradas, 0 incidencias (corrida previa FALLIDA por lint en 2026-10-11T05-27-10-806Z, corregida). Móvil (separado): `validation-results/2026-10-11T05-25-49-416Z-movil`. Recorrido cliente-API: foto sincronizada con archivo verificado y escaneado (`AVAILABLE`), conflicto sin efecto, idempotencia y separación de cuentas. **No es validación en dispositivo.**

| Criterio original | Estado | Evidencia |
| --- | --- | --- |
| operation_id estable | DEMOSTRADO | Reintento tras timeout y desde otro dispositivo con el mismo id y hash (`sync.int-spec.ts`, `sync.test.ts`) |
| Dedup por hash | DEMOSTRADO | Mismo id+hash → `DUPLICATE` sin efecto doble; otro hash → `CONFLICT`; hash alterado → `HASH_MISMATCH` |
| Dependencias | DEMOSTRADO | `DEPENDENCY_PENDING` sin bloquear independientes; dependiente de conflicto → `DEPENDENCY_FAILED` |
| Cursor y tombstones | DEMOSTRADO (parcelas) | Cursor de servidor por org/usuario/dispositivo; tombstone al reasignar; cursor ajeno o caducado; bootstrap sin tocar pendientes |
| Conflictos visibles | PARCIAL | Servidor y motor: conflicto con versiones y resolución por nueva operación; **interfaz del dispositivo no ejercitada** |
| Adjuntos | DEMOSTRADO | Registro y archivo separados; integridad SHA-256/tamaño; Documentos (escaneo, permisos); subida incompleta rechazada |
| Revalidación tenant/permisos | DEMOSTRADO | Dispositivo ajeno/otra org/revocado; permisos retirados → `FORBIDDEN` también al reenviar |
| Timeout/retry no duplica inventario | PARCIAL | Demostrado para versiones de geometría (timeout tras commit, concurrencia); **inventario y entregas no tienen operaciones móviles** |
| Recorrido integrado | PARCIAL | Cliente móvil en Node contra la API local; **sin dispositivo** |

Defecto de entorno encontrado: la API en contenedor no tenía `SCANNER_HOST` (documentos quedaban sin analizar). Corregido localmente en `docker-compose.yml`, no confirmado en git (archivo raíz).

### P0-023 — criterios

Validación web/API: `npm run validate` APROBADA (`validation-results/2026-10-11T04-45-29-062Z`): unitarias + integración (API y web) 283/283, E2E 55/55, OpenAPI 141 rutas; revisión por rol 40 entradas, 0 incidencias. **No es validación del móvil.** Móvil: typecheck OK; `npm test` 9/9 (Node + SQLite real); `TL_API_SMOKE=1` 1/1 (cliente en Node contra la API local: tecnico1 recibió 5 parcelas, tecnico2 1, ninguna común); bundle Android exportado; expo-doctor 21/21.

| Criterio original | Estado | Tipo de evidencia |
| --- | --- | --- |
| Entidad/cola en transacción local | DEMOSTRADO EN NODE | Unitaria con SQLite real: todo o nada; operation_id estable; dependencias |
| Borradores/fotos/GPS sobreviven cierre y reboot | PARCIAL | Reapertura simulada en Node (nueva instancia, mismos archivos) y caché borrada; **sin cierre forzado ni reinicio en Android** |
| Dataset limitado y separación por cuenta | DEMOSTRADO EN NODE + API | Base y adjuntos por cuenta+organización; dataset según asignación del servidor; otra cuenta no ve capturas |
| Sesión offline definida | PROPUESTA | D-40 / ADR-0006 sin aprobar; ventana de 72 h; token no se renueva; revocaciones no detectables offline |
| Ensayo Android real (docs/11) | NO EJECUTADO | Este equipo no tiene Android SDK, JDK ni adb; instrucciones en `apps/mobile/README.md` |
| Cifrado local probado en la plataforma | NO EJECUTADO | SQLCipher requiere build de desarrollo; Expo Go queda sin cifrar (lo muestra «Diagnóstico») |

### P0-022 — criterios

Validación: `npm run validate` APROBADA (`validation-results/2026-10-11T03-57-59-556Z`): unitarias + integración (API y web) 281/281, E2E 55/55, OpenAPI 140 rutas; revisión por rol 40 entradas, 0 incidencias. Corrida previa FALLIDA conservada (`validation-results/2026-10-11T03-45-52-370Z`): la prueba E2E de P0-022 mostró que, sin evaluación de riesgo, los requisitos de catálogo y conclusión no se listaban; se corrigió el guard (ahora aparecen como pendiente/no evaluable) y se añadió una prueba unitaria. El fallo anterior de arranque E2E (`2026-10-11T02-05-01-152Z`) sigue con **causa no determinada**; no se aumentaron tiempos de espera.

| Criterio original (backlog) | Estado | Evidencia (`dd.int-spec.ts`, `requirements.spec.ts`, E2E, revisión) |
| --- | --- | --- |
| Guards por requisito | DEMOSTRADO | 16 requisitos: MET / PENDING / INVALID / NOT_EVALUABLE; desconocido = no evaluable; porcentaje alto no elimina bloqueos; calidad pendiente, origen incompleto y mitigaciones verificadas no equivalen a aprobación |
| Revisión autorizada | PARCIAL | Iniciar y devolver con motivo, permisos, transiciones inválidas, una aprobación por instantánea (índice único). Aprobar se rechaza con `READINESS_NOT_MET` y la lista de requisitos; la aprobación positiva no puede demostrarse con datos reales |
| Snapshot/manifest | DEMOSTRADO | Captura en REPEATABLE READ; contenido, hash total y por sección, manifest de versiones (lote, entregas, versiones de parcela con hash de geometría, versiones de documento con SHA-256, evidencias, evaluación de riesgo, catálogo, mitigaciones), fecha y autor; append-only |
| Export auditado | PARCIAL | Borrador interno: permiso, auditoría (SUCCESS/DENIED), evento, idempotencia, descarga regenerada desde la instantánea con verificación de hash, redacción de geometrías y documentos PERSONAL_DATA. `DD_PACKAGE`: rechazado sin preparación (probado); éxito solo con fixture sintética en el generador |
| Cambio relevante invalida readiness | DEMOSTRADO | Nueva evaluación de riesgo → instantánea STALE con secciones cambiadas; la instantánea y su paquete no cambian; aprobar/exportar sobre STALE se rechaza |
| Export no marca DDS aceptada | DEMOSTRADO | `submission: NOT_SUBMITTED` en paquete, vista y evento; textos «descargar no es presentar» |

Pendientes reales de P0-022: perfil jurídico (P1-005), D-05, proveedor satelital (P0-028), catálogo de riesgo aprobado, reserva/despacho y embarques (P0-017/P0-029); adjuntos incrustados en el paquete (hoy referencia por versión y SHA-256); política de identidad de productores en el paquete (hoy nunca se copia); un expediente por lote.

### P0-021 — criterios

Validación: `npm run validate` APROBADA en la primera corrida (`validation-results/2026-10-11T02-54-04-972Z`): API 269/269, web 4/4, E2E 54/54, OpenAPI 133 rutas. Revisión por rol: 36 entradas, 0 incidencias. **Fallo anterior de arranque E2E** (`2026-10-11T02-05-01-152Z`: el servidor web de E2E no arrancó en 240 s): **causa no determinada**; puertos libres y sin procesos residuales al revisarlo; no se aumentaron tiempos de espera. No se repitió en las corridas posteriores.

| Criterio original (backlog) | Estado | Evidencia (`mitigations.int-spec.ts`; E2E; revisión) |
| --- | --- | --- |
| Acción ligada a causa | DEMOSTRADO | Evaluación + factor + lote conservados; factores dependientes de D-05/P0-028 rechazados (`CAUSE_NOT_ACTIONABLE`); sin identidad ni coordenadas |
| Assignee / plazo / soporte / criterio | DEMOSTRADO | Responsable activo de la organización con facultad de aportar; plazo; evidencia requerida de la regla; criterio de aceptación documentado por quien crea |
| Aportar soporte | DEMOSTRADO | Versión exacta de documento (disponible, vigente) o evidencia con su versión; adjuntar no verifica; solo el responsable; versión nueva no sustituye ni hereda aprobación (pide revisión) |
| Verificar / rechazar con motivo y permisos | DEMOSTRADO | Ejecutor bloqueado (servicio y trigger de base); rechazo conserva soporte y motivo y abre nueva entrega; decisiones concurrentes: una gana |
| Resolver dispara reevaluación | DEMOSTRADO | Evento `MitigationVerified` → consumidor del outbox → nueva evaluación con disparador; idempotente; un trabajo atrasado no sustituye una evaluación posterior |
| Actualiza pendientes reales | DEMOSTRADO | `MITIGATION_UNVERIFIED` bloquea el cierre de la revisión de riesgo; verificar no elimina otros bloqueos (DATA_MISSING_ORIGIN sigue) ni da por resuelta la causa |

### P0-020 — criterios

Validación: `npm run validate` APROBADA (`validation-results/2026-10-11T02-28-47-248Z`): API 265/265, web 4/4, E2E 53/53, OpenAPI 127 rutas; revisión por rol 35 entradas, 0 incidencias. Otra corrida fallida conservada: 2026-10-11T02-23-01-580Z (segundo localizador ambiguo en la E2E de riesgo). Corridas previas fallidas conservadas: `2026-10-11T01-58-59-343Z` (localizador ambiguo en la prueba E2E) y `2026-10-11T02-05-01-152Z` (el servidor web de E2E no arrancó en 240 s por lentitud del equipo; puertos libres; sin pruebas ejecutadas).

| Criterio original (backlog) | Estado | Evidencia (`risk.int-spec.ts`; E2E; revisión) |
| --- | --- | --- |
| Categorías / factores / reglas / snapshot | DEMOSTRADO | 10 categorías de docs/13 (las que no tienen reglas: «sin reglas»); 8 reglas versionadas (0.1.0, NO aprobadas) con fuente, límite y evidencia requerida; instantánea con versiones de datos y evidencias y hash SHA-256 |
| Separar severidad / proceso / conclusión | DEMOSTRADO | Hallazgos técnicos · calidad de datos · resultado de riesgo (severidad NOT_ASSESSED, conclusión UNDETERMINED: CHECK en base) · revisión humana (OPEN → UNDER_REVIEW → RESOLVED) sin cambiar el resultado |
| Faltantes no son score cero | DEMOSTRADO | Sin puntuación; no evaluables → INCOMPLETE como máximo, nunca favorable |
| Reevaluación crea versión | DEMOSTRADO | Número de evaluación creciente; la anterior queda STALE sin modificarse (append-only); un trabajo basado en una evaluación vieja se rechaza (`STALE_BASE`) |
| Factor crítico no se diluye | DEMOSTRADO | Resultado por precedencia: un bloqueante da BLOCKED aunque el resto no tenga hallazgos |
| Autorización | DEMOSTRADO | Requiere alcance de organización completo; otra organización 404; roles sin permiso 403; sin referencias de recursos ocultos |
| Límites declarados | — | TL_GIS_TECH = validez técnica, no deforestación; D-05, satélite (P0-028) y mitigaciones (P0-021) no evaluables; no hay perfil jurídico |

### P0-017 — revisión enfocada (2026-10-10)

Brechas corregidas: (1) ajuste positivo en lote de origen declarado ahora rechazado y cantidad añadida identificada sin trazabilidad; (2) conciliación/incorporación con alcance de organización completo; (3) compuerta STOCK_MOVEMENT guardada por línea y bloqueo real probado. Totales y movimientos ya respetaban el alcance (prueba añadida). P0-017 sigue **abierta** por reserva/despacho (P0-029).

### P0-017 — criterios

Validación: `npm run validate` APROBADA (`validation-results/2026-10-11T01-20-07-037Z`): API 259/259, web 4/4, E2E 52/52, OpenAPI 122 rutas. Corrida previa fallida conservada: `2026-10-11T01-15-41-630Z` (expectativas de catálogo CTE/KDE/RBAC desactualizadas; código correcto). Revisión por rol: 34 entradas, 0 incidencias. DEMO incorporado al ledger por la migración 0024 (2 entradas por recepción, 2 asignaciones, 2 reservas, 1 cierre) y conciliado sin diferencias.

| Criterio original (backlog) | Estado | Evidencia (`inventory.int-spec.ts`; `lots.int-spec.ts`; E2E; revisión) |
| --- | --- | --- |
| Ledger | DEMOSTRADO | Única fuente de existencia/reserva/disponible para recepciones, asignaciones, procesos y movimientos; append-only; trigger diferido de saldos; referencias exactas, actor y `operation_id` |
| Merma | DEMOSTRADO | Con motivo; nunca sobre lo reservado; pérdida de proceso registrada una sola vez |
| Traslado | DEMOSTRADO | Conserva el total de la organización; centro de otra organización 404; lo reservado no se traslada; asignación de ubicación pendiente |
| Reserva/despacho | Reserva **DEMOSTRADA** (P0-029, 2026-10-12); despacho **NO DEMOSTRADO** | Reservas de proceso y de embarque reducen disponible, no existencia. El despacho está bloqueado por D-34 y por DD READY (P0-029) |
| Ajuste con motivo | DEMOSTRADO | Solo `stock:adjust`; nunca por debajo de lo reservado; no opera sobre recepciones; historia intocable |
| 800 → 750 + 50 válido, exceso rechazado | DEMOSTRADO | Existencia total −50 una sola vez; 3 líneas en el cierre; excesos rechazados (P0-016) |
| Concurrencia: sin doble consumo ni saldo negativo | DEMOSTRADO | Traslados y mermas simultáneos (201/409); reservas y cierres concurrentes; red de seguridad en base |
| Datos existentes | DEMOSTRADO | Incorporación idempotente (repetida no crea nada); conciliación informa diferencias sin ajustes |

### P0-016 — criterios

Validación: `npm run validate` APROBADA (`validation-results/2026-10-11T00-46-10-001Z`): API 254/254, web 4/4, E2E 51/51, OpenAPI 115 rutas. Corridas previas fallidas conservadas: `2026-10-11T00-36-27-453Z` (prueba unitaria usaba «lot» como entidad aún no verificable) y `2026-10-11T00-40-31-876Z` (E2E de hitos esperaba CTE 1.1.0): expectativas desactualizadas, código correcto. Revisión por rol: 33 entradas, 0 incidencias.

| Criterio original (backlog) | Estado | Evidencia (`lots.int-spec.ts`; E2E; revisión) |
| --- | --- | --- |
| Lote con inputs/outputs/run | DEMOSTRADO | Asignaciones parciales con referencias exactas (pesaje vigente, versión de recepción); proceso con reserva, consumo, salidas y pérdida |
| DAG sin ciclos | DEMOSTRADO | Trigger en todo enlace (incluido uno posterior insertado por fuera); lotes de salida cerrados a entradas; aristas append-only |
| Origen conservado en salida | DEMOSTRADO | Upstream hasta entrega, productor y parcela; «Origen incompleto» separado y propagado; sin mezcla (D-39.1) |
| Cierre atómico | DEMOSTRADO | Rollback completo; doble cierre concurrente y reintento → una salida; balance 800 → 750 + 50 y rechazo de 760+50, 750+60, 900+0, 750+49,999999 |
| Consulta upstream/downstream con cantidades y permisos | DEMOSTRADO | Solo nodos legibles; sin `delivery:read` no aparecen recepciones ni productores, sin conteos ni marcadores |
| Sin doble uso | DEMOSTRADO | Asignaciones y reservas concurrentes (201/409); corrección compitiendo con asignación; triggers de red de seguridad |
| Integración FERMENTATION/DRYING (nota del backlog) | FERMENTATION **sí** (2026-10-10); DRYING **sí** (2026-10-15) | Hasta el 2026-10-14: secado se iniciaba y el cierre quedaba bloqueado (`DECISION_PENDING`) aunque se enviara humedad. Con D-32 adoptada, el cierre se ejecuta con humedad en `%BH`, método y responsable, publica `ProcessingRunClosed` y DRYING pasa a INTEGRATED (CTE 1.6.0) |

### P0-012 — revisión enfocada por criterio original (2026-10-10)

Criterio de aceptación del backlog: «entrega declarada, peso recibido, recepción parcial/completa, diferencias con causa, vínculos válidos y quality básica; confirmar repetido no crea doble stock». No se eliminó ningún requisito.

| Criterio original | Estado | Evidencia | Pendiente real |
| --- | --- | --- | --- |
| Entrega declarada | DEMOSTRADO | `deliveries.int-spec.ts` «compuertas KDE reales…», «periodo de cosecha…»; E2E P0-012 | — |
| Peso recibido | DEMOSTRADO | «entrega y recepción sin documento…» (pesaje con método, KG, fecha y responsable de la sesión) | — |
| Recepción parcial / completa | DEMOSTRADO (parcial, «recibida por lo declarado», exceso señalado) | «recepciones parciales…», «total recibido… correcciones» | **Resuelto el 2026-10-15**: el cierre explícito existe (`POST deliveries/:id/close`), con motivo obligatorio ante cualquier diferencia |
| Diferencias con causa | **DEMOSTRADO (2026-10-15)** | `d32-d33.int-spec.ts`: cierre sin diferencia, por debajo y por encima; motivo obligatorio en ambos signos; permisos, aislamiento, concurrencia, rollback; recepción posterior rechazada; justificación desactualizada con historial conservado. En navegador: `productos.spec.ts` (D-33 en pantalla) | Límites de aceptación de calidad (D-33, siguen pendientes) y comprobación con operadores reales |
| Vínculos válidos | DEMOSTRADO | Ajenos/inexistentes 404; parcela de otro productor; centro de otra organización; documento de otro titular o tipo | — |
| Quality básica | DEMOSTRADO como **decisión humana registrada** | «calidad…»: muestra durante/después, pendiente, liberar/rechazar con responsable | Catálogo publicado de parámetros/límites: no existe; la referencia de límites es **declarada, no verificada** (KDE 1.2.0) |
| Confirmar repetido no crea doble stock | DEMOSTRADO como «no duplica recepción ni cantidad» | «reintentos…», «total recibido…» (correcciones concurrentes 201/409, rollback) | No hay stock ni ledger (P0-017): ninguna cantidad es inventario disponible |

Comprobaciones de esta revisión (pruebas añadidas):
- **Contrato de calidad**: la respuesta expone `limits_reference.status = DECLARED_UNVERIFIED`, `limits_verification = NOT_AVAILABLE` y `downstream_enablement = NOT_EVALUATED`; el evento lleva `limits_reference_status` y `limits_catalog = NOT_AVAILABLE`. Tres estados distintos: recepción física, decisión de calidad, habilitación posterior (no evaluada).
- **Perfiles por transición**: periodo desconocido + sin soporte + calidad pendiente → recepción permitida y pendientes visibles; la completitud enumera exactamente lo que falta (`DELIVERY_PLOTS:REQUIRED_MISSING`, `DELIVERY_PRODUCTION_PERIOD:DECLARED_UNKNOWN`, `DELIVERY_SUPPORT:REQUIRED_MISSING`) y solo es completa con todos los datos de entrega, recepción y pesaje.
- **Cantidades**: total = suma de la cantidad vigente de cada recepción (última corrección o la original); ejemplo probado 100→90/91→95 + 50 = 145, con originales y pesajes conservados; lista y detalle coinciden (defecto corregido: la lista devolvía `145.000000`). Exceso: se registra como «Recibido supera lo declarado», sin tolerancia ni ajuste de la declaración.

Validación de esta revisión: ver sesión `docs/sesiones/2026-10-10-p0-012-revision.md`.

### P0-012 — criterios

Validación: `npm run validate` APROBADA sobre el commit 58ee6fe (`validation-results/2026-10-10T23-29-45-285Z`): API 246/246, web 4/4, E2E 50/50, OpenAPI 104 rutas. Corridas previas fallidas conservadas: `2026-10-10T22-50-19-671Z` (E2E de hitos esperaba el catálogo 1.0.0: expectativa desactualizada; además la pantalla KDE decía «Ninguna operación usa todavía estos datos» para hitos ya integrados → **texto corregido**) y `2026-10-10T22-57-07-369Z` (la sección «Nueva entrega» se nombraba a sí misma con `aria-labelledby` → **defecto de accesibilidad corregido**). Revisión por rol: 32 entradas, 0 incidencias (tras corregir dos supuestos del script: membresías leídas del CSV bloqueado por Excel y conteo de integraciones CTE).

| Criterio (backlog / orden) | Resultado | Evidencia (`deliveries.int-spec.ts`; E2E; revisión) |
| --- | --- | --- |
| Entrega declarada | Borrador → registrada con compuerta DELIVERY_REGISTER (producto, fecha, peso KG bloquean; parcelas, soporte y periodo quedan pendientes); registrada inmutable (trigger) | «compuertas KDE reales…» |
| Periodo de cosecha (D-34) | Día, mes, intervalo de meses y desconocido; precisión conservada, sin días ficticios; derivados marcados; no se deriva de la fecha de entrega | «periodo de cosecha…», E2E |
| Peso recibido / pesaje | Recepción exige pesaje válido (método, valor KG, fecha, responsable = sesión); declarado y recibido separados | «entrega y recepción sin documento…» |
| Recepción parcial/completa | Parciales con historia propia; sin cierre automático ni ajuste de la declaración; exceso señalado | «recepciones parciales…» |
| Diferencias con causa | **Desde el 2026-10-15 (D-33)**: al recibir sigue siendo NO EVALUADO —una parcial no es todavía una diferencia— y al **cerrar** se exige motivo para cualquier diferencia, en ambos signos. La nota de la compuerta de recepción se republicó (KDE 1.6.0) porque decía que el cierre no estaba definido | `d32-d33.int-spec.ts` |
| Vínculos válidos | Productor, parcela (mismo productor), producto activo, centro, documento: mismo tenant y alcance; ajeno = inexistente (404) | varios casos |
| Soportes (D-35) | Varios por versión exacta; disponibilidad, vigencia y revisión visibles; sin aprobación automática; ausencia no impide la recepción | «varios soportes…» |
| Calidad básica (D-33) | Muestra durante o después del pesaje; «Pendiente de evaluación»; liberar exige versión de límites (declarada); decisión con `quality:decide`; estado separado | «calidad…» |
| Confirmar repetido no crea doble stock | Reintento y doble envío concurrente → una sola recepción y cantidad; operación reutilizada con otro contenido → 409; rollback completo si falla la auditoría. (No hay stock: P0-017) | «reintentos…» |
| Correcciones | DeliveryCorrected / ReceptionCorrected con correction_of; originales y pesajes conservados; fecha posterior a una recepción rechazada; conflicto de versión | «correcciones…» |
| Aislamiento y roles | Otra organización 404; técnico solo asignados; recepción sin identidad ni soportes; calidad/auditor sin recibir | «aislamiento…», revisión |
| UI §14, teclado y 390 px | Registro, revisión previa, recepción, soportes, pendientes, calidad, correcciones, historia | E2E P0-012, revisión `entregas.mjs` |

### P0-025 — criterios (y contenido incrustado del escáner)

Validación: `npm run validate` APROBADA (`validation-results/2026-10-10T21-52-03-657Z`): API 237/237 (30 suites), web 4/4, E2E 49/49, OpenAPI 90 rutas. Corridas previas fallidas conservadas: `2026-10-10T21-39-05-402Z` (los filtros se perdían al volver del detalle y la exportación salía sin filtrar → **defecto real**, corregido conservando los filtros en la URL) y `2026-10-10T21-46-27-217Z` (localizador ambiguo en la prueba). Revisión por rol: 31 entradas, 0 incidencias.

Escáner: políglota PDF+ZIP con objeto interno > MaxFileSize respondía `OK` (omitido sin aviso) → **brecha corregida** con rechazo `EMBEDDED_ARCHIVE_NOT_ALLOWED` antes de analizar; PDF con flujo inflado > MaxFileSize ya se detectaba como incompleto (prueba añadida). Detalle en docs/12 y `docs/sesiones/2026-10-10-p0-025-auditoria.md`.

| Criterio | Resultado | Evidencia (`audit.int-spec.ts`; E2E; revisión) |
| --- | --- | --- |
| Alcance de la auditoría | Misma tabla `audit_logs`; cubre alta/edición, corrección, revisiones, descargas, exportaciones (incluida `audit.export`) y permisos; worker en sus tablas propias | sesión §2 |
| Consulta con filtros y paginación estable | Período, tipo, id, operación, actor, resultado, correlación; cursor en SQL sin duplicados ni saltos | «filtros… y paginación estable» |
| Alcance por recurso aun con `audit:read` | Filtro SQL; totales, facetas, detalle y cursor sin fugas; reasignación y revocación inmediatas (técnico con contexto simulado: ningún rol de técnico tiene `audit:read`) | «alcance por recurso…» |
| Redacción | Lista blanca por tipo; sin secretos, enlaces, coordenadas, contenido ni identidad; original intacto y append-only | «redacción de presentación…» |
| Correcciones y versiones | Corrección enlaza evento original y de corrección; historia del registro conserva ambos | «historia inmutable…» |
| Exportación | Mismos filtros/alcance/redacción; metadatos; SHA-256 verificable; límite 5000; auditada; sin enlaces; fórmulas neutralizadas solo en el archivo | «exportación autorizada…», «celdas CSV…», E2E |
| UI §20.1 | Filtros, resultados, detalle, exportación; carga/vacío/error/denegado distintos; teclado y 390 px | E2E P0-025 ×2; revisión |
| Pendiente | Formato definitivo, retención, auditor externo por encargo, auditar consultas (D-38); dominios futuros | — |

### P0-019 — criterios (y comprobación del escáner)

Validación: `npm run validate` APROBADA (`validation-results/2026-10-10T21-04-53-544Z`): API 228/228, web 4/4, E2E 47/47, OpenAPI 85 rutas. La 1.ª corrida falló por un localizador ambiguo en la prueba E2E nueva (corregido). Revisión visual 30 entradas, 0 incidencias.

Escáner (brechas corregidas): `AlertExceedsMax` estaba desactivado (análisis incompleto podía responder «limpio») y `MaxScanTime` sin límite; el puerto se publicaba en todas las interfaces; multer aceptaba hasta 64 MiB antes de rechazar. Ahora: configuración versionada, límites alertados como FAILED, puerto en 127.0.0.1, límite de recepción = configuración. Limitación residual documentada en docs/12 (objeto interno > MaxFileSize → OK). Pruebas: `scanner-limits.int-spec.ts` (4) y casos nuevos en `documents.int-spec.ts` (cuota concurrente, análisis incompleto).

| Criterio | Resultado | Evidencia (`evidence.int-spec.ts`; E2E) |
| --- | --- | --- |
| Claim, fuentes/versiones, enlaces tipados | Afirmación sobre entidad existente; soporte = versión exacta con SUPPORTS/CONTRADICTS/BASED_ON; adjuntar no valida | «flujo autorizado…» |
| Revisión/verificación | Envío, verificación (facultad separada), rechazo, revocación y reapertura con motivo y responsable; historia completa | «flujo…», «nueva versión…» |
| Nueva versión no hereda | Enlace a v1 conservado; «requiere revisión»; reverificación tras vincular v2 y retirar v1 | «nueva versión del documento…» |
| Expiración y estados de soporte | Vencido, rechazado y no disponible bloquean la verificación con motivos distintos | «soportes vencidos…» |
| Contradicción | Preservada; verificar exige reconocimiento expreso; no se sobrescribe (append-only) | «contradicción preservada…» |
| Autorización y privacidad del grafo | Entidad/documento fuera de asignación o de otra organización → 404; soportes no visibles omitidos (sin conteos ni tipos), también en consulta inversa; auditor ve metadatos, no contenido personal | «autorización…», «privacidad del grafo…» |
| Revocación de acceso | Reasignar el productor retira el acceso a sus afirmaciones | «acceso revocado…» |
| Reintentos, concurrencia, rollback | `operation_id` en alta y vínculo; verificar/rechazar simultáneos → una decisión; fallo forzado sin efectos | «reintentos…» |

### P0-018 — criterios

Dependencias: P0-003 aporta la autorización dentro del tenant (verificada); de P0-025 se usa el registro de auditoría existente (`audit_logs`, verificado desde P0-002). La lectura/exportación de auditoría por alcance y la redacción (P0-025) no son necesarias para P0-018 y siguen pendientes. Concesiones externas y elevación: P0-003.

Validación: `npm run validate` APROBADA (`validation-results/2026-10-10T20-08-20-583Z`): API 215/215, web 4/4, E2E 46/46, OpenAPI 78 rutas. Revisión visual 29 entradas, 0 incidencias.

| Criterio | Resultado | Evidencia (`documents.int-spec.ts` con ClamAV/S3/PostgreSQL reales; E2E) |
| --- | --- | --- |
| Carga y descarga autorizadas, privadas | Objeto privado, SHA-256 del servidor, bytes idénticos, descarga con permiso, alcance del titular y hash verificado; auditada | «carga autorizada…» |
| Cuotas, tamaño, formato, MIME engañoso | Límite por archivo y cuota por organización serializada; tipo real por firma; declarado distinto → rechazo | «formatos…», «cuota…» |
| Cuarentena y escaneo | EICAR rechazada por el escáner real sin almacenar; escáner caído → pendiente, sin descarga, revisión ni compuerta; reintento real → disponible; reintento con malware → rechazada | «muestra EICAR…», «escáner indisponible…» |
| Vigencia y nueva versión | Versión vencida visible como «vencida» (no inaccesible); nueva versión conserva la anterior y no hereda revisión; conflicto de versión | «versiones y revisiones…» |
| Acceso y referencias | Otra organización, titular ajeno o inexistente, técnico sin asignación → 404; datos personales sin `producer:read_identity` → metadatos sí, contenido no; entregas → 422 | «clasificación y alcance…», «referencias ajenas…» |
| Idempotencia, almacenamiento y rollback | Reintento idéntico → réplica; mismo id con otro archivo → 409; S3 caído → nada; fallo de BD → objeto compensado; bytes alterados → no se entregan | «reintento…», «fallos de almacenamiento…» |
| Revocación | Membresía desactivada durante la carga → rechazo y compensación; reasignación → sin acceso residual | «revocación…» |
| Sin filtraciones | Errores y eventos sin contenido, nombres de archivo ni identidad | «sin filtraciones…» |

### Preparación de P0-012 Entregas (revisión, sin implementar)

| Aspecto | Situación |
| --- | --- |
| Productos | Capacidad disponible (catálogo por organización, KG) |
| CTE/KDE que usará | DELIVERY@1 (7 KDE), RECEPTION@1 (6), WEIGHING@1 (5), CLASSIFICATION@1 (5) |
| Condiciones indefinidas (D-34) | `DELIVERY_PRODUCTION_PERIOD` → CONDITION_NOT_EVALUABLE en **toda** entrega: la compuerta bloquearía cualquier registro |
| Referencias sin entidad | `DELIVERY_SUPPORT`: **verificable desde P0-018** (referencia y disponibilidad técnica); falta decidir cuándo se exige (D-35); `RECEPTION_LOCATION` (centros: docs/06 `locations`), `WEIGHING_SUBJECT` (modelo de pesaje), `CLASSIFICATION_SAMPLE` (muestras) deben modelarse en P0-012 |
| Diferencias de modelo | `deliveries` sin parcela en docs/06 (arreglo tipado en docs/09); proveedor no productor sin entidad; sin entidad de pesaje |
| Eventos y correcciones | DeliveryRegistered, ReceptionConfirmed, WeightRecorded, QualityDecisionRecorded; `ReceptionCorrected` definido en docs/08 (referencia al original, motivo, ajuste; bloquear si hay descendientes) — usar el mecanismo `correction_of` de P0-015 |
| Decisiones que **bloquean** | **D-34** (condición de production_period), **D-35** (exigencia del soporte documental o P0-018), **D-33** en lo que afecta a P0-012 (si pesaje y clasificación son obligatorios antes de confirmar la recepción) |
| Decisiones que no bloquean | D-32 (KG es suficiente), D-31 (catálogo provisional ya usable), proveedor no productor (P0 puede limitarse a productores si se registra la limitación) |

No se convierte ninguna condición desconocida en opcional para desbloquear Entregas.

## Interfaz según docs/UX_UI.md (2026-10-10)

Aplicado a las pantallas existentes y conectadas a operaciones reales: tokens M1/UX-V1 únicos en `apps/web/app/globals.css`; shell adaptable (organización activa con selector, usuario y rol efectivo, navegación por permisos, migas, «Saltar al contenido», menú móvil); login (UI-01) con mostrar/ocultar y mensajes distintos para 401/429/503/red; organizaciones (UI-02); miembros, invitaciones y roles (UI-03) en página propia; auditoría (UI-18) en página propia; productores y revisión de duplicados (UI-05) con tabla, filtros y estados diferenciados (carga, vacío, filtro sin resultados, error, 403, 404, conflicto 409 con recarga). Sin menús de módulos futuros; las capacidades pendientes por rol aparecen rotuladas en una tarjeta aparte. Revisión por rol: `docs/qa/REVISION_VISUAL_POR_ROL.md` (0 incidencias abiertas; 4 corregidas).

## Brechas reales

- P0-003: grants y elevación (decisiones/contratos ausentes).
- Custodia de claves PII fuera del equipo y procedimiento de rotación con re-cifrado.
- Invitaciones: entrega por canal verificado y verificación de correo (D-19) antes de operación real.
- Fallo intermitente E2E del 2026-10-10 (reload sin respuesta): causa no determinada, evidencia perdida; `validate` conserva trazas desde ahora.
- Android/offline, integraciones, despliegue: no iniciados.
- Logotipo oficial y verificación de licencia de Inter (UX-D01/UX-D02). Evaluación de accesibilidad completa (lector de pantalla, zoom 200 %) no realizada: solo foco por teclado y móvil comprobados.

## Próxima acción (2026-10-20)

**Paquetes de revisión preparados (2026-10-21):** P1-005 (`decisiones/P1-005-MATRIZ-OBLIGACIONES.md` §6), D-07.5/D-07.6 (`decisiones/D-07-PROPUESTA.md` §11) y D-09.B (`decisiones/P0-028-SATELITE.md`, «Revisión de fuentes oficiales», con copias en `sources/satelite-2026-10-21/`); quién decide cada punto: `22_DECISIONES_Y_PENDIENTES.md`. **Es preparación documental**: no aprueba nada, no cambia porcentajes, requisitos ni compuertas, y no se contrató, registró ni envió nada a ningún proveedor.

**Corte del 2026-10-21: «desarrollo técnico autorizado completado; aceptación y activaciones pendientes».** SHA validado y desplegado `1de15c0`; cobertura sin cambio (42/60 = 70,0 %, MVP 30/44 = 68,2 %). No hay implementación independiente pendiente identificada: el bloqueo principal es la **revisión regulatoria** (ficha de D-05.B), seguida del perfil legal de Ecuador (P1-005), las decisiones de riesgo (D-07.5/7.6), el proveedor satelital real (D-09.B), las integraciones externas (GUIA/EUDR-IS), el piloto (P0-031) y, al final, el ensayo físico en teléfono Android. **Esto NO declara la plataforma terminada ni apta para producción, ni acredita conformidad EUDR**; el entorno queda disponible para revisión web.


**GEOLOCATION_PROFILE I1–I4 (2026-10-21)**: panel de consulta «Evaluación geográfica técnica actual», separado de la instantánea, con guarda y pendientes; validado y desplegado en `ea495a6`; el requisito sigue `NOT_EVALUABLE` y D-05.B pendiente. **Corrección de alcance de A-01**: el Gerente deja de vincular cuentas a productores; validada y desplegada en `1de15c0` (91 suites/1000 pruebas, demostración 6/6). Evidencia: `qa/EVIDENCIA_GEOLOCATION_PROFILE_I1I4_2026-10-21.md`. No cambia 42/60, 30/44 ni 25/32.

**A-03 DONE_LOCAL (2026-10-21)** sobre `d99f40a` (esquema 0058): traspaso de custodia entre organizaciones, desarrollo técnico demostrado. **No está habilitado para operaciones reales**: la salida permanece bloqueada (D4 no adoptada, D-34) y D2 espera revisión competente. Validación APROBADA `2026-10-21T15-35-07-183Z` (90 suites, 990 pruebas, E2E 104) tras una 1.ª ejecución FALLIDA conservada; demostración 7/7; respaldo `…-a03-traspaso-0058` verificado. Detalle: `qa/EVIDENCIA_A03_TRASPASO_2026-10-21.md`. Fuera del conteo: 42/60, 30/44 y 25/32 no cambian.

**A-02 DONE_LOCAL (2026-10-21)** sobre `0211a30`: administración web de concesiones, demostrada 7/7 y con respaldo `…-a02-concesiones-0057`. **A-03** sigue como propuesta con D1–D9 abiertas. Pendiente propio: diagnosticar la causa de los commits lentos del entorno de pruebas (dos validaciones de `acac9b5` fallaron por ello). Detalle: `qa/EVIDENCIA_A02_CONCESIONES_2026-10-21.md`. No cambia 42/60, 30/44 ni 25/32.

**Recorrido integral desde la web (2026-10-21)**: 15 transiciones por rol sobre los datos DEMO, **sin defectos del producto** y con los bloqueos esperados (D-05.B, D-07.5/7.6, D-34); dos puntos **no definidos** para decisión del producto (traspaso de lotes entre organizaciones; pantalla del propietario para concesiones). Detalle: `qa/RECORRIDO_INTEGRAL_WEB_2026-10-21.md`. Prepara P0-031; **no** la inicia como piloto.

**A-01 cerrada DONE_LOCAL (2026-10-20, noche)**: captura de campo web con alcance propio, mapa base local y fotografías propias; validada y desplegada en `4913dd3` (esquema 0057), demostrada por roles, con respaldo `…-a01-mapa-fotos-0057` verificado. Es una ampliación distinta del catálogo original: no cambia 42/60, 30/44 ni 25/32. Ver `sesiones/REANUDAR_2026-10-20.md` §0 y `qa/EVIDENCIA_A01_CAPTURA_CAMPO_2026-10-20.md`. El resto de esta sección sigue vigente: las prioridades 1–8 (decisiones regulatorias, adopción del catálogo, proveedor satelital real, **teléfono Android**) no cambian.

**Actualización posterior (2026-10-20, tarde)**: D-54 y el catálogo `1.0.0` (opción B) **adoptados** para desarrollo y demostración local; funcional validado y desplegado en **`4f7e635`**, esquema **0056**, respaldo `_respaldos/2026-10-20-p1015-migracion-0056` verificado. **P1-015 sigue PARCIAL** por un único elemento original: la dependencia «piloto» (tarifa acordada e IdP de cliente no son criterios originales). Cobertura **sin cambio (42/60 = 70 %)**. La fila 8 de la tabla siguiente queda reducida a esas tres condiciones.

**Estado verificado.** P1-008 cerrada sobre `fb46321` (913 pruebas, demostración 26/26, cobertura **42/60 = 70 %**, MVP 30/44 = 68,2 %), sin cambios. Cambio de herramientas `5845414` (limpieza del bucket de pruebas con guarda exacta): `validate` **APROBADA** (`validation-results/2026-10-19T23-31-51-458Z`); sin despliegue de producción. Commits posteriores son documentales y no repiten la validación funcional. Contrato móvil contra la API actual: OK (`docs/20`).

**No hay historia con implementación independiente pendiente.** Cada criterio que falta depende de una persona o un tercero:

| Prioridad | Qué aportas | Quién más | Desbloquea (criterio exacto) |
| --- | --- | --- | --- |
| 1 | **D-05.B**: qué actor es cada usuario (Art. 2(15)), Art. 2(15a), Anexo III | Responsable regulatorio | `GEOLOCATION_PROFILE` de P0-022 → P0-029/P0-017 (despacho) |
| 2 | **D-07.5** (perfil jurídico; recomendado: mínimo versionado) y **D-07.6** (conclusión por persona autorizada) | Responsable regulatorio; producto fija los permisos | `LEGAL_PROFILE` y `REGULATORY_CONCLUSION` de P0-022; la categoría LEGALITY de P0-020 |
| 3 | **Adopción del catálogo 1.0.0** por la organización | Producto | `RISK_CATALOG_APPROVED` (P0-022); severidades visibles |
| 4 | **P1-005**: contenido, versión y aprobación del perfil legal de Ecuador | Responsable jurídico competente | RF-36; dependencia de P0-022 y P1-006 |
| 5 | **D-09.B**: autorizar salida de geometrías (D-14), términos, titular de la clave, significado de indicadores (D-07), proveedor `SELECTED` con responsable | Producto/comercial + jurídico | P0-028 («contrato real y coste»); `DEFORESTATION_ANALYSIS` |
| 6 | **Teléfono Android físico** y ejecutar el ensayo de `apps/mobile/README.md` | Tú | P0-023, P0-024 (gate «Android real») |
| 7 | **Canal/acuerdo con GUIA** y rol/canal EUDR-IS verificados; acceso ACCEPTANCE | Organización operadora, autoridad | P1-006 (RF-37 «Solo canal/acuerdo comprobados»), P1-007 («recibos auténticos») |
| 8 | ~~**D-54**~~ **adoptada 2026-10-20**; para cerrar P1-015 solo queda su dependencia original «**piloto**» (o que el propietario decida si la evidencia local la satisface). Tarifa acordada e IdP de cliente: configuración comercial, no criterio | Producto, cliente piloto | P1-015; P0-031 |

Separación: 3 y 8 son decisiones de **producto**; 1, 2, 4 y 5 (parte jurídica) requieren **revisión competente** y su fuente, versión y estado de revisión deben conservarse (`docs/decisiones/D-05-PROPUESTA.md`, `D-07-PROPUESTA.md` §7.2). Un perfil mínimo no acredita suficiencia regulatoria. Se mantienen `UNDETERMINED`, satélite deshabilitado, destinos de ensayo inactivos y las compuertas de READY y despacho.

Inventario de volúmenes Docker (2026-10-20, solo lectura): 19 volúmenes anónimos de PostgreSQL de procedencia no confirmada (probables restauraciones aisladas del 18-oct), sin borrar; pendiente de autorización.

## Próxima acción (2026-10-15) — histórico

**D-05**, ahora partida en dos (`docs/decisiones/D-05-PROPUESTA.md`, **revisión 3**, NO aprobada):

- **D-05.A · perfil técnico de intercambio**: **decidible por el equipo**, con 20 reglas concretas y cada una
  marcada según la exija el receptor o la proponga Terra Link. Falta ratificarlas, fijar la banda
  `NEAR_THRESHOLD`, decidir `ProducerName` y preguntar cuatro incertidumbres al contacto técnico del destino.
- **D-05.B · aplicabilidad jurídica**: **no decidible por el equipo**. Necesita un responsable regulatorio.

La **norma ya no está pendiente de lectura**: el consolidado `02023R1115 — EN — 26.12.2025 — 002.001` y el
Reglamento (UE) 2025/2650 están guardados con su sha256 en `docs/sources/eudr-norma-2026-10-15/`, con los
artículos citados verbatim. Lo que **nadie ha hecho** es probar contra el servicio real de TRACES.

Después, **D-07** (severidad de riesgo), que sigue siendo independiente. Lista completa y ordenada en
`docs/decisiones/DECISIONES-MINIMAS-PARA-CERRAR.md`.

Histórico: la acción anterior era «decisiones D-33/D-34/D-35 para P0-012». D-33 quedó **adoptada como regla
provisional del MVP local** el 2026-10-15 (no validada en campo ni para producción); D-34 y D-35 siguen abiertas.

## Anterior: P0-006 Parcela

Dependencias: P0-004 (DONE_LOCAL). Leer docs/10 (GIS), 05/06 (`plots`, `plot_versions`, `gps_samples`) y 18 §P0-006–P0-010. Alcance de P0-006: parcela vinculada a un productor de la misma organización, con código único por tenant, versión geométrica (PostGIS, SRID 4326), permisos `plot:*` y eventos. La validación GIS y el umbral de 4 ha son P0-010 y dependen de D-05.

**Guarda de `RISK_CATALOG_APPROVED` y perfil `0.2.0` borrador (2026-10-21, `f40b9f4`, validación APROBADA, desplegado, esquema `0060`).** `regulatory_profile` es ahora una referencia a un perfil adoptado, completo y con revisión vigente (trigger `0059`); `0.2.0` existe como borrador no adoptable (`0060`). Evidencia y separación de dimensiones: `qa/EVIDENCIA_GUARDA_CATALOGO_PERFIL_0_2_0_2026-10-21.md`. D-07.5(b) b-1/b-2/b-3 siguen sin decidir (`decisiones/D-07-PROPUESTA.md` §12). No cambia porcentajes, requisitos de expedientes ni compuertas; `UNDETERMINED` se conserva.

**D-07.5(b), opción b-1 adoptada e implementada (2026-10-21; `390b5ce` validado y desplegado, esquema `0061`).** Acto de plataforma que crea una versión nueva del catálogo con referencia a un perfil revisado; hoy no hay ninguna versión vinculada (no existe un perfil completo y revisado) y el caso positivo es solo sintético aislado. Distingue crear la versión, la aprobación técnica, la adopción por organización y la conclusión: ninguna implica a las otras. Evidencia: `qa/EVIDENCIA_VINCULO_CATALOGO_B1_2026-10-21.md`. Respaldo: `_respaldos/2026-10-21-vinculo-catalogo-0061/` (restauración aislada verificada). Sin cambios de porcentajes ni compuertas; `UNDETERMINED` se conserva.

**Entrega al revisor preparada (2026-10-21):** `decisiones/INDICE-REVISION-REGULATORIA.md` es el índice único de P1-005 (R1–R8), D-05.B (Q1–Q8) y D-07.5(a)/D-07.6. Solo documentación: no registra aprobaciones, no publica `0.2.0`, no repite validación, demostración ni respaldo (cierre de b-1 sobre `390b5ce`, evidencia en `0ee87c0`). Cuando lleguen respuestas, se contrastan con los criterios originales y se implementa lo que habiliten (índice §5). Cobertura sin cambio: 42/60 = 70 %; MVP 30/44 = 68,2 %.

**Acto de revisión del perfil jurídico (2026-10-22; `95b6e87` validado y desplegado, esquema `0062`).** **Implementación demostrada**: API y pantalla de plataforma para registrar `REVIEWED`/`OBJECTED`/`WITHDRAWN` con persona revisora declarada, usuario que registra y soportes, con las consecuencias técnicas ya definidas (elegibilidad, vigencia de la vinculación, obsolescencia). **Aceptación regulatoria pendiente**: no hay ninguna revisión real registrada y los perfiles `0.1.0`/`0.2.0` siguen sin revisión. La cobertura aceptada (42/60 = 70 %; MVP 30/44 = 68,2 %) mide requisitos aceptados, **no** código construido. Evidencia: `qa/EVIDENCIA_REVISION_PERFIL_2026-10-22.md`; respaldo `_respaldos/2026-10-22-revision-perfil-0062/`; demostración `node e2e/review/revision-perfil-demostracion.mjs` (10/10).

**GEOLOCATION_PROFILE: mecanismo funcional terminado (2026-10-22; `f0dd2f0` validado, desplegado, esquema `0063`).** Configuración versionada de reglas (activas/candidatas), revisión propia con alcance de aplicabilidad, adopción por organización y aplicación al expediente con trazabilidad. **Implementación demostrada**; **configuración y aceptación reales pendientes**: la `0.1.0` sembrada es candidata, sin revisión ni adopción, y los expedientes siguen en `NOT_EVALUABLE`. Validaciones: `576aa53` FALLIDA (latencia de disco, ajena) y `967e1b9` FALLIDA (defecto propio del arnés), conservadas; `f0dd2f0` APROBADA. Evidencia: `qa/EVIDENCIA_GEOLOCATION_PROFILE_CONFIG_2026-10-22.md`; respaldo `_respaldos/2026-10-22-geo-config-0063/`; demostración `node e2e/review/geo-config-demostracion.mjs` (14/14). La cobertura aceptada no cambia (42/60 = 70 %; MVP 30/44 = 68,2 %): mide requisitos aceptados, **no** código construido.

## D-07.6 conclusión humana — DONE_LOCAL del mecanismo (2026-10-22)

Candidato `747ac41`: `npm run validate` **APROBADA** (`validation-results/2026-10-22T17-36-04-543Z`); desplegado (esquema
`0065_d076_carencias_conclusion_favorable`); demostración 11/11 sin conclusiones reales; respaldo `_respaldos/2026-10-22-conclusion-humana-0064-0065/`
con restauración aislada verificada. Incluye Next.js 16.4.2 (avisos GHSA-2464-fhr4-w9xw y GHSA-p3m5-59mp-jv5r ya no figuran).
Validaciones previas fallidas conservadas (`0864fc4`, `5176d70`, `6ea3d10`); causas en la evidencia. **No acredita** aceptación
regulatoria, conformidad EUDR, Android ni producción; la cobertura 42/60 (MVP 30/44 = 68,2 %) no cambia. Detalle: `qa/EVIDENCIA_D076_CONCLUSION_HUMANA_2026-10-22.md`.

## QA integral local y revisión de seguridad (2026-10-22)
Candidato `29ab9bf`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T00-37-00-488Z`); desplegado. Barrido de las 288 rutas (sin credenciales, otra organización, plataforma, rol de solo lectura): sin fugas. Dos hallazgos corregidos (puertos de datos en loopback; cabeceras de seguridad). Validación previa `3335cd1` FALLIDA por una carrera del test de parcelas, conservada. No es una auditoría independiente. Detalle: `qa/EVIDENCIA_QA_SEGURIDAD_LOCAL_2026-10-22.md`.

## A-04 «Mi ubicación» (2026-10-23)
`5f77b72`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T03-00-54-744Z`); web desplegada y demostrada (8/8, posición EMULADA, sin cambios en datos operativos); móvil con pruebas del núcleo y verificación en emulador (ver evidencia). Validaciones previas fallidas conservadas: `353d23e` (carrera del test de productos). **No acredita** GPS real, Android físico, producción ni conformidad EUDR; la cobertura 42/60 (MVP 30/44) no cambia. Detalle: `qa/EVIDENCIA_A04_MI_UBICACION_2026-10-23.md`.

## «Mi finca» y documentos en contexto — entrega 1 (2026-10-23)
`42f7433`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T05-44-49-396Z`); desplegado y demostrado (7/7, sin cambios en datos). Reutiliza el servicio de documentos; sin migración ni permisos nuevos. Pendiente de la entrega 2: entregas propias (permiso acotado), documentos con titular entrega y textos desactualizados. **No acredita** certificación ni conformidad; 42/60 y 30/44 sin cambio. Detalle: `qa/EVIDENCIA_A05_MI_FINCA_DOCUMENTOS_2026-10-23.md`.

## Ajuste mínimo, entrega 2 (2026-10-23)
`53f6e81`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T07-56-18-883Z`); desplegado y demostrado (8/8, sin cambios en datos). `delivery:read_own` (solo listado), Mis entregas, textos corregidos, revisión humana con su responsable, y guarda contra respuestas viejas en listados. `1cc6eff` falló en E2E (carrera de respuestas en Productores y un test desactualizado), conservada. Sin migración. **No acredita** certificación ni conformidad; 42/60 y 30/44 sin cambio. Detalle: `qa/EVIDENCIA_AJ_ENTREGA2_2026-10-23.md`.

## AJ-03 tipos documentales (2026-10-23)
`b83026d`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T13-16-46-803Z`); migración `0066` desplegada y respaldada con restauración aislada verificada; demostración 9/9. Tipos ambiental, laboral y de derechos de terceros: solo clasifican. **No acredita** certificación ni conformidad; 42/60 y 30/44 sin cambio. Detalle: `qa/EVIDENCIA_AJ03_TIPOS_DOCUMENTALES_2026-10-23.md`.

## AJ-04 Legalidad y soportes (2026-10-23)
`75b0592`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T14-29-27-735Z`); desplegado, demostración 5/5 solo lectura. Sin migración. No certifica; 42/60 y 30/44 sin cambio. Detalle: `qa/EVIDENCIA_AJ04_LEGALIDAD_Y_SOPORTES_2026-10-23.md`.

## AJ-05 Análisis de deforestación Whisp 2.3.1 (2026-10-23)
`90205a8`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T15-41-03-942Z`); desplegado; demostración 4/4 solo lectura. Adaptador corregido contra el contrato oficial 2.3.1; mecanismo demostrado con servidor controlado. **Integración real con Whisp NO EJECUTADA**: falta clave de API y autorización del propietario. Llamadas reales siguen deshabilitadas; 42/60 y 30/44 sin cambio. Detalle: `qa/EVIDENCIA_AJ05_ANALISIS_DEFORESTACION_WHISP_2026-10-23.md`.

## AJ-06 Trabajo satelital asíncrono y credencial por organización (2026-10-24)
`6239de1`: `npm run validate` **APROBADA**; migración `0067` desplegada y respaldada con restauración aislada; demostración 6/6 solo lectura. Avance, reanudación y cancelación en el proveedor probados con servidor controlado; registro cifrado de la credencial por organización. **Whisp real NO EJECUTADO.** Detalle: `qa/EVIDENCIA_AJ06_TRABAJO_ASINCRONO_Y_CREDENCIAL_2026-10-24.md`.

## AJ-07 Whisp: envío incierto, original y descarga (2026-10-25)
`210d8f5`: `npm run validate` **APROBADA** desde copia limpia en SSD con base de pruebas en memoria (cuatro ejecuciones previas FALLIDAS por la latencia del disco USB del proyecto y de Docker; conservadas en `validation-results/`). Migración `0068` desplegada y respaldada con restauración aislada; demostración 7/7 solo lectura. **Whisp real NO EJECUTADO.** Pendiente: entrega 2 (riesgo/expediente). Detalle: `qa/EVIDENCIA_AJ07_ENVIO_INCIERTO_ORIGINAL_Y_DESCARGA_2026-10-25.md`.

## AJ-07b y AJ-08: comprobación dirigida (2026-10-27)
Sobre `acec2cc` (AJ-07b `e4b5db9`/`7b48c1f`; AJ-08 `bd60914`/`ff0df37`; ya subidos). **Pruebas dirigidas, no `npm run validate`**: unitarias `src/satellite`, `src/dd`, `src/risk` e integración `test/satellite.int-spec.ts`, `test/satelite-riesgo-expediente.int-spec.ts`, `test/dd.int-spec.ts` contra PostgreSQL/PostGIS real (`terra_link_test`): **7 suites aprobadas, 111 pruebas OK, 55 omitidas** (ensayos que requieren el servicio real; **ensayo Whisp real NO EJECUTADO**). Typecheck y lint de la API sin errores.
Hallazgo: la prueba de integración AJ-08 (`bd60914`) no había llegado a ejecutarse con éxito y fallaba por dos defectos del fixture, no del producto: insertaba `raw_sha256` sin `raw_object_key` (viola `satellite_results_raw`) y usaba la columna inexistente `satellite_providers.selected_at`. Corregidos solo en la prueba; tras ello H7 (instantánea de riesgo con frescura; sintético rotulado) y H8 (expediente: «recibido» frente a «criterio satisfecho») pasan.
Estado: **implementado y comprobado localmente de forma dirigida**. Falta la validación integral del candidato (`npm run validate`) y la aceptación con servicio real. Entorno: faltaba el runtime de Visual C++ (Jest no cargaba `unrs-resolver`; instalado `Microsoft.VCRedist.2015+.x64`) y la base `terra_link_test` (al recrear el volumen, el script de inicio no se montó por la ruta con espacios y se aplicó a mano).

## AJ-08 corrección de B y C (parcial): acceso de plataforma, observabilidad y avisos (2026-10-27)
Sobre `44c8b8f`. **Pruebas dirigidas, no `npm run validate`.**
- **B**: el requisito `DEFORESTATION_ANALYSIS` (en `dd.ts`) evaluaba cualquier resultado histórico `COVERED`, mientras la instantánea mostraba el más reciente. Ahora ambos usan `satelliteInputs` (el resultado más reciente del proveedor seleccionado, real, por versión de parcela). Regresión «COVERED anterior → UNKNOWN vigente» en `test/satelite-riesgo-expediente.int-spec.ts`: falla (`MET`) con el código anterior y pasa con el nuevo. API: 7 suites, 111 pruebas OK, 55 omitidas; typecheck y lint sin errores.
- **C**: pantallas nuevas «Acceso de plataforma» (`/organizaciones/{id}/acceso-plataforma`: solicitud con contraseña y aprobación, rechazo o revocación por quien administra la organización; solo lectura de miembros, máximo 15 min) y «Observabilidad» (`/plataforma/observabilidad`: dependencias, código desplegado, trazas en memoria), ambas con inglés. Se retiran el aviso de despacho «hasta definir D-34» (el preflight lista los bloqueos reales) y el mensaje de recuperación obsoleto de `ELEVATION_REQUIRED`. Web: typecheck, lint y 27 pruebas OK. El flujo solicitud → aprobación se comprobó en navegador con las cuentas DEMO antes de reconstruir esta copia.
- **Pendiente de C**: gestión global de usuarios (la API solo desactiva/reactiva por identificador; no hay listado global, y exponerlo requiere una decisión de privacidad), revisión en navegador de Calidad y de las demás cuentas, 390 px, y un texto obsoleto en el detalle de la entrega («lotes, procesamiento e inventario no existen», origen sin localizar).
- Entorno: este trabajo se rehízo en `C:\Users\mario\PROYECTOS DEV\TERRA LINK 2025` (la unidad D: dejó de estar disponible).

## C: gestión global de usuarios (2026-10-27, sin validar con `npm run validate`)
- Decisión del propietario: listado global **mínimo** para SUPER_ADMIN (`user:deactivate`): nombre, estado, marca de plataforma y organizaciones con membresía activa; sin correo, roles ni datos operativos.
- API: `GET /api/v1/users` (`MembersService.listUsers`), tope 500 filas; desactivar/reactivar siguen en `POST /api/v1/users/:id/deactivate|reactivate` (motivo, sesiones revocadas, auditoría). OpenAPI regenerado (292 rutas).
- Web: `/plataforma/usuarios` («Usuarios de la plataforma»), en la navegación solo para plataforma; sin acciones sobre la propia cuenta; EN cubierto.
- Pruebas dirigidas: `members.int-spec` 15/15 (permitido SUPER_ADMIN, prohibido ORG_ADMIN con 403, claves exactas sin correo); web typecheck, lint y 27 pruebas OK; api typecheck y lint OK. No revisada en navegador.
