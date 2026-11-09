# D-05.B — Material para revisión por el responsable competente (revisión 2, 2026-10-21)

**Qué es esto.** Preparación de **D-05.B** (aplicabilidad jurídica) para que la revise un responsable regulatorio. **No es una aprobación, no adopta ninguna obligación y no cambia ninguna compuerta, permiso ni
comportamiento.** Completar la ficha del §8 **no registra una decisión regulatoria**: la decisión, si la hay, la registra quien tenga competencia, con su fuente y su estado de revisión. Documento base, **sin reescribir**:
`docs/decisiones/D-05-PROPUESTA.md` (revisión 4); sus erratas comprobadas se anotan allí sin borrar el texto original. Para resolver D-05.B **no** se cambian permisos ni roles: un rol de aplicación o un tipo de organización
**no es** una categoría jurídica del Reglamento (§4).

## 0. Historial de revisiones de este material
| Revisión | Commit | Qué cambió |
| --- | --- | --- |
| 1 (2026-10-21) | `4d8d96e` (conservada en Git) | Primera ficha: fuentes de la norma base y del destino, hallazgos H1–H9, hechos por entidad, Q1–Q8 |
| **2 (2026-10-21)** | este | (a) Se **incorporan y leen** el Reglamento de Ejecución **2024/3084** y su modificación **2026/1565**, con dos consolidados (H5 queda resuelta y se corrige su descripción); (b) se separa **entrada en vigor / aplicación / alcance**; (c) se **corrige la Q6** y se añade el hecho **F8**; (d) se separa la **decisión regulatoria** de la **implementación pendiente** (`geolocation_profile: null`) y se contrasta el evaluador con `dd.ts`; (e) se contrastan F1–F8 con los modelos existentes; (f) se corrige la Q8 (preparación y presentación) y (g) se anotan erratas comprobadas en la propuesta, conservando el historial |

## 1. Contenido vigente de la propuesta D-05 (resumen fiel)
| | Estado | Qué dice |
| --- | --- | --- |
| **D-05.A** perfil técnico | **ADOPTADO para desarrollo local** (2026-10-15); implementado `EUDR_GEO_V1` (migración 0041) | Umbral `> 4 ha` exige polígono (`= 4` admitido con aviso); mínimo 0,0001 ha para punto; 6 decimales como número; simulación del truncamiento hacia cero; sin huecos; `MEETS_PROFILE` solo significa «bien formado para una versión **documentada** del destino». Ninguna regla está comprobada contra el servicio real (DOC, no SRV) |
| **D-05.B** aplicabilidad jurídica | **PENDIENTE** | A qué actores y operaciones alcanzan las obligaciones del Reglamento; «solo un responsable regulatorio». Cuatro pendientes (§9 de la propuesta): qué actor es cada usuario (Art. 2(15)); condiciones 1, 2 y 4 del Art. 2(15a); Anexo III y el Reglamento de Ejecución 2024/3084; si Terra Link presenta o solo prepara |
| Qué **no** hace D-05.A | — | No acredita conformidad; no autoriza presentar ni llamar a TRACES; no cambia D-07 ni el catálogo `NOT_APPROVED`; **no desbloquea el expediente** |

**Opciones:** la propuesta no formula opciones para D-05.B; las del §6 son una forma de ordenar cada pregunta, no una recomendación jurídica.

## 2. Fuentes: identificación, versión, fecha, procedencia, huella y estado de revisión
| Capa | Fuente | Versión / fecha | Procedencia y guardada en | sha256 | Leída | Estado de revisión |
| --- | --- | --- | --- | --- | --- | --- |
| **A · Norma** | Reg. (UE) 2023/1115 consolidado `— 18.09.2026 — 003.001` | M1 = 2024/3234; M2 = 2025/2650; M3 = Delegado 2026/2102 (13-07-2026). Descargado 2026-10-15 | Of. de Publicaciones; `docs/sources/eudr-norma-2026-10-15/02023R1115-20260918.xhtml` | `1cd2711f…cb1c6` | Sí | Sin revisión jurídica |
| A (histórico) | Consolidado `— 26.12.2025 — 002.001` | M1, M2 | ídem `…20251226.xhtml` | `a00f759d…ddbe6` | Sí | Comparado: ningún artículo cambió |
| A | Reg. (UE) 2025/2650 | 19-12-2025 | ídem `32025R2650.xhtml` | `f9a24402…37ae27` | Sí | Sin revisión |
| A (dato) | Comisión, *Country Classification List*: **Ecuador — standard risk** | Consultada 2026-10-15 | ídem `country-classification-list.html` | `b536d933…83356` | Sí | Dato fechado; **la lista cambia** (Art. 29) |
| **A′ · Ejecución** | **Reg. de Ejecución (UE) 2024/3084** (funcionamiento del sistema de información) | 4-12-2024; OJ 6.12.2024 | Of. de Publicaciones (CELEX `32024R3084`); `docs/sources/eudr-ejecucion-2026-10-21/32024R3084.xhtml` | `90258e22…6c53` | **Sí (íntegro)** | Sin revisión |
| A′ | **Reg. de Ejecución (UE) 2026/1565** (modifica el 2024/3084) | 13-07-2026; OJ 14.7.2026 | CELEX `32026R1565`; `…/32026R1565.xhtml` | `14a0ad0f…a825` | **Sí (íntegro)** | Sin revisión |
| A′ | Consolidado 2024/3084 `— 17.07.2026 — 001.001` y `— 15.10.2026 — 002.001` | Descargados 2026-10-21 | CELEX `02024R3084-20260717` y `…-20261015` | `e7593841…5232` · `72ec8493…6d50` | **Sí** | «No legal effect»; la versión `20261015` es la que incluye la atribución ya aplicable |
| **B · Destino** | *EUDR Operator API Reference*: servicio **V3**; documento **v1.2**; página GeoJSON **17-08-2026** (las otras tres no publican fecha) | Descargado 2026-10-15 | `docs/sources/eudr-is-2026-10-15/` | `index` `77be7296…` · `change-log` `8e5821f2…` · `validation-rules` `08d91eed…` · `geojson` `165fee68…` | Sí | Sin revisión; advierte que «may not be final» (§3.2) |
| **C · Interna** | `EUDR_GEO_V1@1.0.0` | 2026-10-15 | `apps/api/src/plots/geo-profile.ts` | — | — | Adoptada para desarrollo local; no aprobada para producción |

Huellas completas y procedencia de A′ en `docs/sources/eudr-ejecucion-2026-10-21/MANIFIESTO.md`. EUR-Lex responde a las peticiones automatizadas con un desafío WAF (202): el enlace `eur-lex.europa.eu/eli/reg_impl/2026/1565/oj/eng` que identifica el acto
**no se pudo leer por esa vía**; el texto se obtuvo del servicio de la Oficina de Publicaciones y se **leyó íntegro**. Que sea el mismo acto lo confirman su cabecera (`2026/1565`, 14.7.2026, «amending Implementing Regulation (EU) 2024/3084») y su ELI.

## 3. Reglamentos de ejecución: qué dicen y qué NO dicen
### 3.1 Lo que contienen (leído, no inferido del título)
**2024/3084 (original).** Funcionamiento del sistema de información (IS): definiciones; presentación, enmienda y retirada de DDS; perfilado de riesgo; asignación de números de referencia; rechazo; acceso y registro de usuarios mediante **EU Login**; **tratamiento de datos personales
(Art. 12)**: categorías permitidas, entre ellas **«data on geolocation pursuant to Article 2(28) […], where natural persons can be identified»** y los identificadores del usuario incluido el **EORI**; conservación de los datos personales de las DDS ≤ 10 años; y el Art. 19 (entrada en vigor).
**2026/1565.** Adapta el IS a las modificaciones del 2023/1115 por el 2025/2650: **(i)** atribución de las DDS a la autoridad competente: la del Estado miembro en que el **operador está establecido**; si está **fuera de la Unión**, la del Estado miembro **«with which operator is associated according to the operator's unique identifier provided in the Information System»**
(nuevo Art. 2(3)); lo mismo para la **declaración simplificada** (Art. 2(4)); **(ii)** nuevas definiciones (usuario del IS = operadores, incluidos micro y pequeños primarios, representantes, *downstream operators* y *traders*; «Simplified Declaration», «Declaration identifier»); **(iii)** presentación, actualización, retirada y registro de la declaración simplificada (Art. 4a);
**(iv)** **agrupación** de DDS y declaraciones (Art. 8a); **(v)** servicios web para usuarios y autoridades; **(vi)** cuenta única por usuario y actualización de su registro (Art. 10); **(vii)** conservación de datos personales ≤ 5 años (de la presentación o de la agrupación; de la retirada para declaraciones simplificadas) (Art. 12(5));
**(viii)** medidas de la Comisión sobre límites de tamaño de archivo y duplicados (Art. 15(4)); **(ix)** **contingencia** (Art. 15a: información pública «by 30 December 2026» y número de referencia/identificador de contingencia ante indisponibilidad > 60 minutos).

### 3.2 Lo que NO contienen (comprobado sobre el texto)
**Ninguno de los dos actos** define actores del Reglamento 2023/1115, ni umbral de hectáreas, ni decimales, ni formato GeoJSON, ni reglas de validación de geometrías (la palabra *polygon* y *GeoJSON* no aparecen; *geolocation* solo en el Art. 12(2)(d) como categoría de dato personal). **No modifican D-05.A.**
La advertencia de la fuente B («the amendment procedure of the Implementing Regulation (EU) 2024/3084 that is currently undergoing») se refiere a un acto que **ya está adoptado** (2026/1565, 13-07-2026); si la documentación del destino ya lo refleja o no **no está comprobado** (la copia B es del 2026-10-15 y su contenido de validación no cita el 2026/1565).
No se atribuye a estos actos ninguna regla técnica de `EUDR_GEO_V1`.

### 3.3 Efecto sobre las preguntas de la ficha
| Pregunta | Efecto de 2024/3084 y 2026/1565 |
| --- | --- |
| Q1, Q3 (categoría del usuario) | **Ninguno directo**: no definen la categoría; **sí** exigen que cada usuario del IS tenga **registro (EU Login) e identificador único** y, si está fuera de la Unión, que quede **asociado a un Estado miembro** (Art. 2(3)–(4), 10). Hecho nuevo **F8** |
| Q4 (contenido de la geolocalización) | **Ninguno**: el contenido exigible está en el 2023/1115 (Art. 9(1)(d), Anexos II y III), no aquí |
| **Q6** (efecto del procedimiento de modificación) | **Respondida en lo documental**: el acto existe, está leído y **no contiene reglas de geometría**. Queda abierto si la documentación del destino (B) cambió por él |
| Privacidad / T14 (`ProducerName` no se exporta) | **Refuerza** la prudencia: el Art. 12(2)(d) trata la geolocalización como dato personal cuando se puede identificar a personas |
| A-03 / salida | Ninguno directo |

### 3.4 Entrada en vigor, fecha de aplicación y alcance (no mezclar)
| Disposición | Entrada en vigor | Aplicación | Alcance |
| --- | --- | --- | --- |
| Reg. 2023/1115, Arts. 3–13, 16–24, 26, 31, 32 | Art. 38(1): vigésimo día siguiente a su publicación | **30-12-2026** (Art. 38(2)); **30-06-2027** para personas físicas y micro/pequeñas empresas establecidas como tales a 31-12-2024, salvo productos del Anexo del Reg. 995/2010 (Art. 38(3)) | Obligaciones de operadores, *downstream operators* y *traders* (a partir de esas fechas) |
| Reg. 2023/1115, **artículos no enumerados** en el Art. 38(2) | Art. 38(1) | Su fecha de aplicación **no se analiza aquí** | **No se concluye** que «no sea exigible» |
| 2024/3084 (original) | Tercer día siguiente a su publicación (6.12.2024; **calculado** 9.12.2024) | No fija otra | Funcionamiento del IS |
| 2026/1565 | Tercer día siguiente a su publicación (14.7.2026; **calculado** 17.7.2026) | **Art. 1, punto (2)(c): desde el 15-10-2026 (ya aplicable a 2026-10-21)**; el resto, desde la entrada en vigor | Atribución de DDS por establecimiento / identificador |
| 2026/1565, Art. 15a | ídem | Información pública de la Comisión **«by 30 December 2026»** | Contingencia del IS |

**Lectura correcta del calendario:** que *determinados artículos* aún no sean aplicables **no significa** que el Reglamento «no sea exigible», ni **relaja** ningún control del producto (compuertas, `UNDETERMINED`, `READY`). El calendario no se usa aquí para decidir nada.

## 4. Referencias normativas: comprobación contra el texto guardado
**Coinciden literalmente** (consolidado `20260918`): Arts. 2(15), 2(15a), 2(16), 2(27), 2(28), 4a(5), 9(1)(d), 38(2)–(3). **Hallazgos** (la propuesta base no se reescribe; las erratas se anotan en ella):
| # | Hallazgo | Estado en revisión 2 |
| --- | --- | --- |
| H1 | **Artículos relevantes no analizados**: 2(15b) *downstream operator*, 2(17) *trader*, 2(22) y Art. 6 representante, **Art. 7** (el primero establecido en la Unión que pone a disposición se considera operador), Art. 4(2) y **Anexo II**, Art. 4(7), Art. 5 | Vigente |
| H2 | **Anexo III mal descrito como pendiente**: es la declaración simplificada de micro/pequeños operadores primarios (Art. 4a(3)); su texto está en la copia. Lo pendiente es **si alguien entra en esa categoría** | Vigente; **erratas anotadas** |
| H3 | **Contradicción U7 / §5.4** de la propuesta sobre Ecuador | **Corregida por errata** (U7 se lee resuelta, fechada y revocable); texto original conservado |
| H4 | «normalmente no es el operador» (§5.3 cond. 1) es una **lectura preliminar**, no un dato | Vigente; **errata anotada**; es la Q1 |
| H5 | El Reg. de Ejecución 2024/3084 «no está guardado» | **RESUELTA y ampliada**: 2024/3084 **y** 2026/1565 guardados y leídos (§2–§3). La propuesta y la revisión 1 ignoraban el 2026/1565 |
| H6 | Documento de trabajo, no auténtico: verificar contra el Diario Oficial | Vigente (aplica también a los nuevos consolidados) |
| H7 | Calendario | **Reformulado** en §3.4 |
| H8 | «Exportar» sin definición propia en el texto guardado | Vigente; es la Q2 |
| H9 | M3 no cambia lo citado (solo Anexo I; para cacao, `1801` no cambia) | Vigente |

## 5. Hechos por entidad, organización y operación
### 5.1 Qué registra el sistema y qué NO (contrastado con los modelos, 2026-10-21)
Se distinguen tres estados: **I** = dato inexistente; **V** = dato existente **sin vínculo suficiente** para el uso regulatorio; **D** = dato **declarado**, pendiente de verificación.
| Hecho | Estado | Modelo existente que podría reutilizarse | Qué falta (sin proponer campos todavía) |
| --- | --- | --- | --- |
| **F1** País de **establecimiento** y si es de la Unión | **V** | `organizations.country` (ISO2, obligatorio; el demo usa `EC` y `DE`) | **Documentado el 2026-10-21 (`docs/06`, «Semántica de `organizations.country`»)**: es **ambiguo** (rótulo «País» sin definición, `EC` precargado, fijado por la plataforma al crear, **no modificable**, nadie lo lee en una regla). **No se usa** como país de producción, de establecimiento ni de aplicabilidad. Reutilizarlo exige definir su significado y permitir corregirlo |
| **F2** Tamaño (micro/pequeña, Directiva 2013/34/UE) | **I** | — | No hay balance, cifra de negocios ni empleados |
| **F3** Produce ella misma lo que vende/exporta; parcelas del propio país | **V** | `producers`/`plots`/`deliveries` (parcela→productor→entrega→lote; `plots` con provincia/cantón) | Que el **productor sea la propia organización** no está modelado (productor es otra entidad); el país de la parcela no es un campo |
| **F4** Quién produce, recibe, exporta, importa | **V** | Cadena `entrega→recepción→lote→proceso→embarque`; `organizations.organization_type` (catálogo provisional, descriptivo); `buyers` (país **declarado**); `shipments.destination_country` (declarado) | Existe la cadena física; **no** la calificación de cada eslabón (operador, *downstream*, *trader*) ni la identificación de quién la hace «establecida en la Unión» |
| **F5** Mandato de representante autorizado | **I** | — | — |
| **F6** Qué ocurre en cada traspaso (A-03): entre quiénes, si sale del país | **V** | `custody_transfers` (organizaciones, lote, cantidades, estados) | Registra el traspaso físico; **no** si cruza una frontera ni qué es jurídicamente |
| **F7** Código HS / producto del Anexo I | **I** | `products` (código interno, estado, unidad KG) | No hay código HS; `1801` es una afirmación del revisor, no un dato |
| **F8** Registro e **identificador único** del usuario en el IS, y **Estado miembro asociado** (usuarios fuera de la Unión) | **I** | EORI/`tax_id`: `organizations.tax_id` existe pero no es el identificador del IS | Hecho nuevo (2024/3084 y 2026/1565) |
| **Período o rango de producción** (Art. 9(1)(d)) | **V** | `deliveries.harvest_precision/harvest_start/harvest_end` y derivados (D-34, adoptado MVP local) + `delivery_origins` (entrega↔parcela) | Existe **por entrega**, no por parcela; **no viaja** en el GeoJSON ni en el perfil. Reutilizar, no duplicar |
| **País de producción** (Art. 9(1)(c), Anexo II punto 3) | **I** como campo; **V** por `organizations.country` y ubicación de parcelas | `plots.province/canton/parish`; `organizations.country` | Deducirlo del país de la organización sería inventarlo (T14) |
| **Identidad del productor / geolocalización como dato personal** | existente | Identidad cifrada; `plot:read_geometry` | Alineado con el Art. 12(2)(d) de 2024/3084 |

### 5.2 Relaciones entre actores en el caso modelado (demo, sintético — para ilustrar, no para concluir)
`Productor (EC) → Cooperativa Río Verde (EC) → [traspaso A-03 dentro de EC] → Exportadora Pacífico (EC, EXPORTER) → comprador declarado (país UE, Chocolates Europa, IMPORTER, DE)`. La categoría de cada eslabón y el momento de la «primera puesta a disposición en el mercado de la Unión» **no están decididos** (Q1–Q3).

## 6. Preguntas pendientes, opciones, hechos necesarios y comportamiento que dependería
Las **opciones ordenan la pregunta**; no recomiendan el contenido jurídico. «Comportamiento» = qué cambiaría en el sistema si se decidiera **y** se implementara; **hoy no cambia nada**.
| # | Pregunta | Opciones | Hechos necesarios | Comportamiento que dependería |
| --- | --- | --- | --- | --- |
| **Q1** | ¿Qué categoría (operador 2(15), operador *deemed* Art. 7, *downstream* 2(15b), *trader* 2(17), micro/pequeño primario 2(15a), representante 2(22), ninguna) corresponde a cada organización **según su operación**? | (a) Por tipo de organización (no recomendable sola: el tipo es descriptivo y PROVISIONAL). (b) Por organización y operación, declarada y revisada. (c) El sistema no la modela; conserva F1–F8 | F1, F4, F5, F6, F8 | (a)/(b): registro versionado con fuente y revisión. (c): sin cambio |
| **Q2** | ¿Un traspaso entre organizaciones **fuera de la Unión** (A-03) es puesta en el mercado, puesta a disposición, exportación o ninguna? ¿Cambia si el destino final es la Unión? | (a) Ninguna hasta la salida. (b) Depende de la operación posterior. (c) Otra | F4, F6; 2(16), 2(18), Art. 7 | Condiciona la compuerta de salida de A-03 (D4); hoy **bloquea** |
| **Q3** | ¿Qué organizaciones usuarias cumplen **todas** las condiciones de 2(15a)? (cond. 3 resuelta **en contra** mientras Ecuador sea riesgo estándar) | (a) Ninguna mientras se mantenga. (b) Caso a caso si la lista cambia | F1, F2, F3 y fecha de la lista | Vía postal 4a(5) no disponible; geolocalizar **todas** las parcelas. Si cambia la lista: reevaluar |
| **Q4** | ¿Qué contenido de geolocalización es exigible por categoría (9(1)(d), Anexo II p. 3; Anexo III p. 3), incluida **fecha o rango** de producción y **país de producción**? | (a) Solo coordenadas conforme a `EUDR_GEO_V1`. (b) + período por parcela. (c) (b) + país de producción. (d) Otro | Textos de 9(1)(c)–(d), Anexos II/III; F3 | Define qué es «satisfecho» para `GEOLOCATION_PROFILE` (§7) |
| **Q5** | ¿Cómo se trata una parcela que no es una *plot of land* (2(27))? | (a) 1 parcela de Terra Link = 1 *plot*. (b) Agrupar por propiedad. (c) Consultar al contacto del destino (U6) | Propiedad catastral (no registrada) | Podría cambiar qué parcelas exigen polígono |
| **Q6** | ¿Qué efecto tienen **2024/3084 y 2026/1565** sobre el perfil técnico? | **Respondida en lo documental** (§3.2): ninguno sobre geometría. Queda: ¿la documentación del destino (B) cambió por 2026/1565? | Reconsultar B | Si B cambió: nueva versión de perfil (T20). Hoy no |
| **Q7** | ¿Qué acto de revisión hace válida la respuesta y cómo se registra? | (a) Registro en `docs/decisiones` con fuente, versión y estado. (b) Registro versionado en el sistema | Competencia del revisor; D-07.6 | (b) requeriría diseño nuevo |
| **Q8** | **Preparación y presentación** (ver §9). **No es** una pregunta para retirar P1-007 | — | — | — |

## 7. Decisión regulatoria frente a implementación pendiente (no confundir)
**Dos cosas distintas** sobre `GEOLOCATION_PROFILE`:
1. **Decisión regulatoria pendiente (D-05.B)**: qué significa «satisfecho» para ese requisito (Q1–Q4).
2. **Implementación pendiente del requisito original**: `apps/api/src/dd/dd.ts` fija `profiles.geolocation_profile: null`, por lo que `requirements.ts` devuelve siempre `NOT_EVALUABLE` («Depende de D-05 (no aprobada)»). Eso **no es una ampliación nueva**: es el requisito `GEOLOCATION_PROFILE` ya autorizado en P0-022 y en la fila 14 de la matriz, **sin terminar de implementar**. Cuando D-05.B se resuelva, **completar ese requisito no necesita otra ampliación ni otra petición de permiso**; sí necesita la definición de «satisfecho».

### 7.1 Contraste del evaluador técnico con `dd.ts`
| Aspecto | Hallazgo |
| --- | --- |
| **Resultado técnico ya disponible** | `geo_profile_evaluations` (append-only, migración 0041): por **versión de parcela**, `status` (`MEETS_PROFILE` / `DOES_NOT_MEET` / `REVIEW_REQUIRED` / `NOT_EVALUABLE`), `checks`, base de superficie, versiones de las fuentes y `exportable` (con `CHECK` que impide exportable ≠ `MEETS_PROFILE`). Consultable por la API de la parcela |
| **Qué ve hoy el expediente** | El contenido de la instantánea (`DdContent.plots[]`) lleva `gis_status` (**TL_GIS_TECH**), tipo y hash de geometría, **pero no el veredicto `EUDR_GEO_V1`**; `profiles.geolocation_profile` es una constante `null` |
| **Qué información de aplicabilidad falta** | La de Q1–Q4 y los hechos F1–F8 de §5.1 (categoría de cada organización, contenido exigible, período y país de producción) |
| **Qué condición revisada permitiría resolver el requisito** | **No está definida**: depende de Q4 y de Q7. **No se inventa una condición de aprobación**; mientras tanto el requisito permanece pendiente |
| **Qué se puede preparar sin decidir contenido jurídico** | Ver §7.2 |

### 7.2 Implementación independiente (sin decidir nada jurídico) frente a lo que espera al revisor
| # | Pieza | ¿Independiente de D-05.B? | Nota |
| --- | --- | --- | --- |
| I1 | **[IMPLEMENTADO 2026-10-21, con otra solución de transición — ver §12]** Mostrar el veredicto vigente de `EUDR_GEO_V1` por versión de parcela de origen **sin cambiar el estado** del requisito. Redacción original: «incorporar al contenido del expediente…» | **Sí** — el catálogo de riesgo ya declara como entrada «dictamen EUDR_GEO_V1 de la versión vigente» | **Efecto a diseñar antes de escribir código:** la frescura de las instantáneas se calcula comparando el hash del contenido (`isStale`). Añadir el veredicto al contenido hace que **todas las instantáneas existentes pasen a «desactualizadas»**. Hay que decidir cómo se trata esa transición (nuevo campo en una sección propia, gestión de las instantáneas ya capturadas) y probarla. **Por eso no se implementó en este paso**: es un candidato propio con su validación |
| I2 | Una **prueba de guarda** que fije que `GEOLOCATION_PROFILE` **no puede ser `MET`** mientras la semántica de «satisfecho» no esté definida, sea cual sea el veredicto técnico | **Sí** | No decide contenido; evita que una implementación futura marque `MET` por inercia |
| I3 | Mostrar en el detalle del requisito la **lista de parcelas sin evaluación de perfil / con evaluación obsoleta** (pendiente operativo, no jurídico) | **Sí** | Se apoya en I1 |
| I4 | Cargar F1 (aclarar el significado de `organizations.country`) en la documentación del diccionario de datos | **Sí** | Documental |
| D1 | Definir «satisfecho» (`MET`) para `GEOLOCATION_PROFILE` | **No — decisión del revisor (Q4, Q7)** | — |
| D2 | Campos de categoría jurídica, tamaño, HS, país de producción, período por parcela, identificador del IS | **No — esperan Q1–Q4 y F1–F8**; reutilizar antes de crear (§5.1) | — |
| D3 | Qué hace la compuerta de A-03 | **No — D4/D2/Q2** | — |

## 8. Ficha para el responsable competente
*Para completar por quien tenga competencia. **Completarla no registra una aprobación**: mientras no figuren persona, cargo, fecha, fuente consultada (versión del Diario Oficial) y estado `REVIEWED`, D-05.B sigue PENDIENTE.*
| Pregunta | Respuesta | Fundamento (artículo y versión del Diario Oficial) | Hechos asumidos (F1–F8) | Efecto técnico si se autoriza | Revisor / cargo / fecha |
| --- | --- | --- | --- | --- | --- |
| Q1 Categoría por organización y operación | ☐ | | | Registro versionado de categoría con fuente y revisión | |
| Q2 Traspaso fuera de la Unión | ☐ | | | Condiciona la compuerta de salida de A-03 (D4) | |
| Q3 Condiciones de 2(15a) | ☐ | | | Vía postal; geolocalizar todas las parcelas | |
| Q4 Contenido de la geolocalización exigible (incl. período y país) | ☐ | | | Define «satisfecho» para `GEOLOCATION_PROFILE` (D1) | |
| Q5 Definición de parcela (2(27)) | ☐ | | | Agrupación de parcelas para el umbral | |
| Q6 ¿La documentación del destino (B) cambió por 2026/1565? | ☐ | | | Versión nueva del perfil técnico | |
| Q7 Acto de revisión y registro | ☐ | | | Cómo se registra la decisión | |

## 9. Preparación y presentación (Q8, corregida)
- **Preparación de expedientes**: es el alcance original ya implementado (expediente, instantánea, paquete interno `READY`/`EXPORTED`). No cambia.
- **Integración EUDR-IS**: **P1-007 sigue en el backlog con su alcance original** («Fixture/ensayo ACCEPTANCE, recibos auténticos, reconciliation ante timeout; permiso separado de producción»; dependencias P0-022 y rol/canal verificados). **Q8 no la retira ni autoriza activar envíos.** Los nuevos actos añaden requisitos que P1-007 deberá contemplar al integrarse: registro (EU Login) e identificador único del usuario, atribución por Estado miembro asociado, agrupación de DDS, servicios web, identificadores de contingencia y declaración simplificada.
- **La presentación real** sigue requiriendo **configuración, autorización y aceptación** (rol/canal verificados, acceso ACCEPTANCE y autorización expresa). Esta ficha no autoriza ningún envío ni llamada externa.

## 10. Efecto de resolver D-05.B (tres planos)
| Plano | Estado actual | Qué cambiaría | Qué seguiría pendiente |
| --- | --- | --- | --- |
| **`GEOLOCATION_PROFILE`** | `NOT_EVALUABLE` por una constante (`null`); regla del catálogo sin severidad | Permitiría **definir** «satisfecho» (Q4/D1) y, entonces, completar la implementación del requisito original | La definición (D1), el período y país de producción (D2) y la implementación |
| **Expediente / `READY`** | Exige todos los requisitos en `MET`; siguen `LEGAL_PROFILE` (P1-005 parcial, sin revisión jurídica), `REGULATORY_CONCLUSION` (D-07.6, `UNDETERMINED` por `CHECK`), `RISK_CATALOG_APPROVED` (D-07.5), `DEFORESTATION_ANALYSIS` (D-09.B) y lo operativo del lote | Quita **una** condición | **Resolver D-05.B no basta para `READY`** |
| **Salida de A-03** | Bloqueada por `TRANSFER_DISPATCH_GATE` (D4; D-34) | Q1–Q2 **informan** D2/D4 | D4, D-34, D2 y la sustitución autorizada de la compuerta. Ninguna respuesta la abre sola |

## 11. Lo que este material NO hace
No implementa supuestos; no cambia permisos, roles, compuertas ni catálogo; no registra severidad, conclusión ni aprobación; no usa la clasificación de riesgo de **país** (Art. 29) como riesgo de parcela o de lote; no equipara tipo de organización ni rol de aplicación con categoría jurídica;
no contacta al destino ni a TRACES; no presenta ninguna declaración; no modifica código ni porcentajes (42/60 · 30/44 · 25/32). `UNDETERMINED`, satélite real deshabilitado y las compuertas vigentes **no se tocan**.

## 12. Estado de I1–I4 (implementación del requisito original; 2026-10-21)
**Solución de transición adoptada por el propietario** (en lugar de modificar el contenido de las instantáneas): un **panel de consulta «Evaluación geográfica técnica actual», separado de la instantánea**, que lee las evaluaciones de `EUDR_GEO_V1` y muestra por parcela autorizada versión geométrica, perfil y versión, veredicto, fecha, vigencia/obsolescencia, explicación y siguiente acción. **No** entra en el contenido ni en el hash de ninguna instantánea; las instantáneas existentes no se modifican ni se declaran obsoletas por esta incorporación. Si el resultado debe entrar algún día al contenido formal de la instantánea, será con un contrato versionado y una transición explícita.
| Pieza | Estado | Dónde |
| --- | --- | --- |
| **I1** Mostrar el veredicto técnico vigente sin cambiar el estado del requisito | **Hecho** como panel de consulta | `GET …/dd-cases/{id}/geo-evaluation` (`apps/api/src/dd/geo-panel.ts`); `apps/web/lib/geo-eval-panel.tsx` en la pantalla del expediente |
| **I2** Guarda: el resultado técnico no convierte `GEOLOCATION_PROFILE` en `MET` | **Hecho** | `src/dd/requirements.spec.ts` (2 pruebas) y `test/dd-geo-panel.int-spec.ts` («guarda»: todas las parcelas en `MEETS_PROFILE` → requisito `NOT_EVALUABLE`, sin `READY`, aprobación y exportación rechazadas) |
| **I3** Parcelas sin evaluación vigente, distinguiendo ausencia, obsolescencia (por geometría o por versión del perfil) y resultado no evaluable | **Hecho** | Recuentos, lista de pendientes y detalle; permisos aplicados a recuentos, detalle y enlaces |
| **I4** Semántica de `organizations.country` | **Hecho (documental)** | `docs/06`, «Semántica de `organizations.country`» |
**Lo que NO cambia:** `profiles.geolocation_profile` sigue siendo `null` y `GEOLOCATION_PROFILE` sigue `NOT_EVALUABLE`; la definición de «satisfecho» (D1), los campos de categoría/tamaño/HS/país/período (D2) y la compuerta de A-03 (D3) siguen esperando al revisor. D-05.B y la revisión de las fuentes permanecen **pendientes**.

## 13. Actualización (2026-10-22): el requisito original GEOLOCATION_PROFILE ya está implementado

La «implementación pendiente del requisito original» (§7) quedó **terminada como mecanismo**: configuración versionada de reglas (la regla activa usa la evaluación vigente de `EUDR_GEO_V1`; período y país de producción son **candidatas**, sin aplicar ni deducir), revisión propia con alcance de aplicabilidad, adopción por organización y aplicación al expediente. **Q4 sigue siendo decisión del revisor**: cuando se responda, se prepara una versión nueva de la configuración; mientras exista una candidata, el requisito no llega a `MET`. Ver `qa/EVIDENCIA_GEOLOCATION_PROFILE_CONFIG_2026-10-22.md`.
