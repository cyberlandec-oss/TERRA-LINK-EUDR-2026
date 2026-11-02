# Índice único de revisión regulatoria (2026-10-21)

**Para quién:** el responsable jurídico/regulatorio competente (aún **no designado**) y el propietario del producto.
**Qué es:** el punto de entrada **único** a los materiales de revisión de P1-005, D-05.B y D-07.5(a)/D-07.6. **No contiene propuestas nuevas**: enlaza los documentos vigentes, ordena sus preguntas y dice qué aporta cada parte, qué debe quedar registrado y qué cambia en el sistema.
**Qué NO es:** no registra ninguna aprobación, no publica el perfil `0.2.0` (sigue en borrador), no adopta ninguna obligación, no cambia permisos, roles, compuertas ni `UNDETERMINED`. Completarlo **no equivale a una decisión**: la decisión, si la hay, la registra quien tenga competencia, con persona, cargo, fecha, fuente y versión consultada.
Sustituye a la tabla integradora de `docs/22` («Paquetes de revisión…»), que ahora remite aquí.

## 1. Documentos que debe revisar (y versión exacta)

| Documento | Versión / ubicación | Qué contiene | Para qué preguntas |
| --- | --- | --- | --- |
| `D-05B-FICHA-REVISION-2026-10-21.md` | **Revisión 2** (2026-10-21); base `D-05-PROPUESTA.md` rev. 4 con erratas | Fuentes con huella, reglamentos 2024/3084 y 2026/1565, hechos F1–F8 por entidad, **ficha §8** para responder | Q1–Q7 |
| `P1-005-MATRIZ-OBLIGACIONES.md` | **§2** (matriz EC-1…EC-10, 2026-10-17), **§6** (paquete de revisión) y **§7** (`0.2.0` borrador) | Reglas candidatas con artículo, sujeto, aplicabilidad, evidencia y lagunas | R1–R8 |
| Perfil `0.1.0` (publicado, **PARCIAL**, sin revisión) y `0.2.0` (**borrador**, migración `0060`) | Pantalla «Perfil jurídico» de cada organización; `GET …/legal-profile/catalog` | Fuentes (con sha256), reglas, interpretación propuesta y preguntas **por regla** (`gaps`) | R1–R8 |
| `D-07-PROPUESTA.md` | **§7** (con errata), **§11** (paquete), **§12–§13** (b-1 adoptada e implementada) | Significado exacto de D-07.5 y D-07.6, opciones, ejemplos sintéticos S1–S6 | D-07.5(a), D-07.6 |
| Copias de fuentes | `docs/sources/ecuador-2026-10-17/`, `docs/sources/eudr-ejecucion-2026-10-21/` (con `MANIFIESTO.md` y huellas) | Texto normativo guardado | Todas |

## 2. Qué aporta el propietario y qué exige la revisión competente

| | **Puede aportar el propietario del producto** | **Requiere revisión competente** |
| --- | --- | --- |
| Designación | Designar al revisor y su capacidad; abrir el canal de entrega | Ser quien revisa: con competencia en derecho ecuatoriano y en el Reglamento (UE) 2023/1115 |
| Hechos | **Hechos de operación** de cada organización (columna «Hechos» abajo): qué hace, con qué parcelas, a quién traspasa, qué documentos existen | Calificarlos jurídicamente (categoría, aplicabilidad, suficiencia) |
| Opciones de producto | Elegir A/B/C del contenido del perfil (D-07.5(a)); permiso y asignación de «concluir» **después** de que el revisor fije la capacidad (D-07.6); Q8 (la preparación y P1-007 **se conservan**) | — |
| Respuestas | Registrar el acto de revisión cuando exista (hoy **sin endpoint, a propósito**) | Responder las preguntas y fundamentarlas |

## 3. Índice maestro de preguntas

Columnas: **Hechos/evidencias** que debe aportar **cada organización** · **Registro** que debe quedar · **Efecto técnico** si se decide **y** se implementa (hoy no cambia nada).

### 3.1 D-05.B — aplicabilidad (ficha `D-05B-FICHA…` §6 y §8)
| ID | Pregunta concreta | Hechos/evidencias por organización | Registro (respuesta y fundamento) | Efecto técnico | Quién |
| --- | --- | --- | --- | --- | --- |
| **Q1** | ¿Qué categoría del Reglamento (2(15), Art. 7, 2(15b), 2(17), 2(15a), 2(22) o ninguna) corresponde a cada organización **según su operación**? | F1 país de establecimiento · F4 quién produce/recibe/exporta/importa · F5 mandato de representante · F6 qué ocurre en cada traspaso · F8 registro e identificador único en el IS | Categoría **por organización y operación**, artículo y versión del Diario Oficial, hechos asumidos | Registro versionado de categoría con fuente y revisión (si se elige modelar); si no, sin cambio | Hechos: propietario/organizaciones · Calificación: **revisor** |
| **Q2** | ¿Un traspaso entre organizaciones **fuera de la Unión** (A-03) es puesta en el mercado, puesta a disposición, exportación o ninguna? | F4, F6; destino final declarado | Respuesta y artículos (2(16), 2(18), Art. 7) | Informa D2/D4: la compuerta de salida de A-03 **sigue bloqueada** hasta D4/D-34 | **Revisor** |
| **Q3** | ¿Qué organizaciones cumplen **todas** las condiciones de 2(15a)? | F1, F2 tamaño (balance, cifra de negocios, empleados), F3 produce lo que vende; fecha de la clasificación de riesgo del país | Lista de organizaciones y condición no cumplida | Sin vía postal: geolocalizar **todas** las parcelas; si cambia la lista, reevaluar | **Revisor** (tamaño: aporta la organización) |
| **Q4** | ¿Qué contenido de geolocalización es exigible por categoría (9(1)(d); Anexos II y III), incluida **fecha o rango** de producción y **país de producción**? | F3; período por entrega (existe); país de producción (no es campo) | Opción (a)–(d) elegida con fundamento | **Define «satisfecho» para `GEOLOCATION_PROFILE`** y permite completar ese requisito original (D1/D2) | **Revisor** |
| **Q5** | ¿Cómo se trata una parcela que no es una *plot of land* (2(27))? | Propiedad catastral (no registrada hoy) | Opción (a) 1:1, (b) por propiedad o (c) consultar al destino | Podría cambiar qué parcelas exigen polígono | **Revisor** (+ propietario sobre el dato catastral) |
| **Q6** | ¿La documentación del destino (B) cambió por 2026/1565? (lo documental ya está respondido: ninguno sobre geometría) | Reconsulta de la documentación del destino | Fecha y versión consultadas | Si cambió: **versión nueva** del perfil técnico (T20) | Propietario (reconsulta) + **revisor** (efecto) |
| **Q7** | ¿Qué acto de revisión hace válida la respuesta y cómo se registra? | — | (a) registro en `docs/decisiones` o (b) registro versionado en el sistema | (b) exige diseño nuevo | Propietario + **revisor** |
| **Q8** | Preparación y presentación | — | **Resuelta como alcance:** la preparación y P1-007 **se conservan**; la presentación real sigue deshabilitada hasta su autorización, configuración y aceptación | Ninguno | **Propietario** |

### 3.2 P1-005 — contenido del perfil jurídico (`P1-005-MATRIZ…` §6.6 y §7)
| ID | Pregunta concreta | Hechos/evidencias por organización | Registro | Efecto técnico | Quién |
| --- | --- | --- | --- | --- | --- |
| **R1** | ¿Es vigente la redacción de cada fuente (LOTRTA, Art. 56 del Fomento Productivo, reformas de 2022, COA)? ¿hay reformas posteriores? | — (es de la norma) | Fuente, versión del Diario Oficial y fecha de verificación por fuente | Marca la vigencia revisada de cada fuente | **Revisor** |
| **R2** | ¿`EC-FUNCION-SOCIAL` y `EC-USO-ECOSISTEMAS-FRAGILES` son exigibles al **operador** o solo oponibles por el Estado? ¿y EC-7 a EC-9? | Tenencia de cada parcela; si el predio contiene o colinda con ecosistemas frágiles / PFN | Respuesta por regla | Decide qué reglas entran al perfil publicado | **Revisor** |
| **R3** | ¿Qué evidencia es admisible por regla y de qué procedencia (documento oficial o declaración del productor)? | Acto de adjudicación, constancias, declaraciones que **existen** en cada organización | Criterio por regla | Fija lo que `OFFICIAL_DOCUMENT`/`PRODUCER_DECLARATION` pueden satisfacer | **Revisor** |
| **R4** | ¿Qué materias mínimas debe cubrir el perfil para llamarse `COMPLETE` frente al art. 2(40) y cuáles de las siete pendientes son exigibles hoy? | — | Lista de materias exigibles | Permite publicar un perfil **COMPLETO** (condición necesaria para `LEGAL_PROFILE` y para vincular un catálogo) | **Revisor** (+ propietario: opción A/B/C) |
| **R5** | ¿Se incorporan EC-7 a EC-9? ¿qué prima si concurren COA Art. 99 y LOTRTA Art. 13? | Presencia de páramos, moretales, manglares o PFN en los predios | Respuesta por regla y criterio de precedencia | Publicar `0.2.0` (o una versión posterior) | **Revisor** |
| **R6** | ¿Son necesarios los reglamentos de la LOTRTA y del COA? | — | Sí/no y cuáles | Añadir fuentes al perfil | **Revisor** (+ propietario: obtener los textos) |
| **R7** | ¿Qué fuente oficial de cartografía delimita ecosistemas (EC-2) y posesión ancestral (EC-4)? | Capas oficiales disponibles | Fuente y alcance | Habilita indicios cartográficos fundamentados (siguen siendo **indicio**, no veredicto) | **Revisor** |
| **R8** | ¿Quién firma el acto de revisión, con qué capacidad y fundamento y cómo se designa? | — | Persona, cargo, capacidad, fundamento, fecha, decisión (`REVIEWED`/`OBJECTED`/`WITHDRAWN`) | Habilita registrar `legal_profile_reviews` (**hoy sin endpoint**) | Propietario (designa) + **revisor** |

### 3.3 D-07.5(a) y D-07.6 (`D-07-PROPUESTA.md` §11–§13)
| ID | Pregunta concreta | Hechos/evidencias por organización | Registro | Efecto técnico | Quién |
| --- | --- | --- | --- | --- | --- |
| **D-07.5(a)** | ¿Qué alcance de perfil se adopta para el MVP: **A** completo antes de habilitar, **B** mínimo versionado que declara lo que cubre *(recomendación existente)*, **C** fuera del MVP? Es la misma decisión de contenido que R4. | — | Opción elegida y fundamento | **B**: sigue `PENDING` mientras sea `PARCIAL`, diciendo la verdad sobre su alcance · **A**: `MET` posible con `COMPLETE` + revisión + sujeto resuelto · **C**: `LEGAL_PROFILE` permanece pendiente y `READY` inalcanzable | **Propietario** elige; el **revisor** fija el contenido |
| **D-07.6** | ¿Quién puede **concluir** (`NEGLIGIBLE`/`NON_NEGLIGIBLE`) y con qué capacidad y fundamento? Opción **A** (motor concluye) **descartada por la fuente**; **B** persona autorizada con motivo *(recomendación existente)*; **C** nadie en el MVP | Qué personas reales harían de revisor autorizado y distinto de quien evalúa | Capacidad y fundamento del revisor; condiciones previas (catálogo aprobado y adoptado, perfil revisado, evaluación no `STALE`, revisor distinto, motivo escrito) | Un permiso nuevo y su asignación (**decisión del propietario después**), endpoint y `CHECK` sustituto para registrar una conclusión. **Hoy no existe ninguno; no se asigna** | **Revisor** (capacidad) → **propietario** (permiso y asignación) |

## 4. Cómo debe quedar registrada cada respuesta

Una respuesta **solo cuenta** si incluye todo lo siguiente: **persona, cargo y capacidad** · **fecha** · **fuente consultada y versión del Diario Oficial** (con huella si es copia) · **respuesta** y **fundamento** (artículo) · **hechos asumidos** (F1–F8 u otros) · **alcance y salvedades** · **estado**: `REVIEWED`, `OBJECTED` o `WITHDRAWN`.
Hoy se registra en `docs/decisiones` (fichas §8 y §6.6). El registro **en el sistema** (`legal_profile_reviews`) **no tiene endpoint**: crearlo es implementación pendiente que depende de R8/Q7.

## 5. Qué se implementa cuando lleguen las respuestas (ya autorizado, hoy sin habilitar)

| Respuesta | Implementación original que habilita | Se contrasta con |
| --- | --- | --- |
| Q4 (y D1/D2) | Evaluar `GEOLOCATION_PROFILE` con una definición de «satisfecho»; período y país de producción | Criterios originales del requisito de geolocalización (RF de geolocalización; `docs/13`) |
| R4, R5, D-07.5(a) | Publicar un perfil nuevo (completo o mínimo) y su adopción por organización | RF-36/37 y el contrato de `LEGAL_PROFILE` |
| R8 / Q7 | Endpoint del **acto de revisión jurídica** con revisor identificado | `docs/07` y `docs/13` (trazabilidad del revisor) |
| Perfil **completo y revisado** | **Crear la versión vinculada** del catálogo (b-1, ya implementada) y que las organizaciones la adopten | `D-07-PROPUESTA.md` §13 |
| D-07.6 | Permiso, endpoint y `CHECK` para registrar una conclusión | `docs/13` §Dimensiones; S1 §35 |
| Q1–Q2 | Registro de categoría; informa D2/D4 de la compuerta de A-03 | `docs/14`, D-34 |

Cada una **se contrasta con los criterios originales** antes de implementarse y se prueba con datos sintéticos aislados; ninguna habilita `READY` por sí sola: siguen `GEOLOCATION_PROFILE`, `DEFORESTATION_ANALYSIS` (D-09.B), `LEGAL_PROFILE`, `RISK_CATALOG_APPROVED`, `REGULATORY_CONCLUSION` y `SHIPMENT_LINK`.

## 6. Estado actual (verificable)

Cobertura original **42/60 = 70 %**; MVP **30/44 = 68,2 %**; sin cambios por esta entrega. Perfil `0.1.0` publicado parcial y sin revisión; `0.2.0` borrador no adoptable; ninguna versión del catálogo declara perfil; `REGULATORY_CONCLUSION` = `UNDETERMINED` por `CHECK`. Las guías de revisión web y la plataforma siguen disponibles (`CREDENCIALES.csv` local, `node e2e/review/revision-por-rol.mjs`).

## 7. Actualización (2026-10-22): el acto de revisión ya existe

El registro de la respuesta de R8/Q7 **ya tiene mecanismo**: `POST /api/v1/platform/legal-profile/reviews` y la pantalla `/plataforma/perfil-juridico` (SUPER_ADMIN), con persona revisora declarada, usuario que registra, fecha, fundamento y soportes. Falta el **contenido real**: ninguna revisión está registrada. Ver `qa/EVIDENCIA_REVISION_PERFIL_2026-10-22.md`.

## 8. Actualización (2026-10-22): la respuesta de Q4 ya tiene mecanismo

La definición de «satisfecho» de `GEOLOCATION_PROFILE` (Q4) se registra como **versión nueva de la configuración de reglas** (`/plataforma/geolocalizacion`) y su **revisión** con el alcance de aplicabilidad (organizaciones y operación) declarado por quien revisa. Falta el contenido real. Ver `qa/EVIDENCIA_GEOLOCATION_PROFILE_CONFIG_2026-10-22.md`.
