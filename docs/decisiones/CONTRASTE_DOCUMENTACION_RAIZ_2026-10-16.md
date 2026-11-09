# Contraste de la documentación raíz — qué está demostrado y qué no (2026-10-16)

Revisión de **solo lectura**: no cambia código, estados ni despliegue. Responde a una pregunta concreta — *¿qué
porcentaje de la documentación raíz está cubierto?* — y a una previa que hay que contestar antes: *¿sobre qué
denominador?*

## 1. Qué es «la documentación raíz» y cuál es su alcance

`docs/` tiene 28 documentos, pero **no todos enuncian requisitos**. Clasificados por lo que son:

| Grupo | Documentos | Qué aportan |
| --- | --- | --- |
| **Fuentes originales** | `docs/sources/` S1–S4 | El material del que se derivó todo. **No son requisitos**: son el texto de partida |
| **Requisitos con identificador** | `03_REQUISITOS.md` | **La única lista con IDs verificables**: RF-01…RF-47 y RNF-01…RNF-12 |
| **Plan de verificación** | `16_PLAN_QA.md` | QA-01…QA-17: los casos de aceptación |
| **Especificaciones** | `04`–`15`, `UX_UI.md` | *Cómo* debe cumplirse cada requisito. No añaden requisitos nuevos con ID propio |
| **Plan y estado** | `18`, `19`, `22`, `23`, `24` | Backlog, roadmap, decisiones abiertas, estado y la matriz fuente→requisito→historia→prueba |
| **Operación** | `17`, `20`, `21`, `25`, `MANUAL_OPERACION.md` | Procedimientos, comandos y guías |

**Método**: se mide sobre **`03_REQUISITOS.md`**, porque es el único documento con unidades contables y
verificables. Los demás se usan como **evidencia** de si cada requisito está demostrado, no como denominador: si
se contaran también sus secciones, el denominador dependería de cómo esté partido cada documento, que es una
decisión editorial, no de alcance.

**Fuente del estado por historia**: `23_ESTADO_DESARROLLO.md`. **Fuente del vínculo requisito → historia →
prueba**: `24_TRAZABILIDAD_REQUISITOS.md`, reutilizada tal cual.

## 2. Denominador

| Bloque | Cantidad | Qué es |
| --- | ---: | --- |
| **RF-01 … RF-31** | 31 | Capacidades del **MVP (P0)** |
| **RF-32 … RF-47** | 16 | Capacidades de **evolución (P1)**, fuera del MVP. Incluye **RF-47**, añadida el 2026-10-16 por el contraste de obligaciones (§2.bis) |
| **RNF-01 … RNF-13** | 13 | Condiciones **transversales**: seguridad, operación, offline, privacidad, rendimiento… Incluye **RNF-13**, añadida el 2026-10-17 por el mismo contraste (§2.bis) |
| **Total** | **60** | Requisitos con identificador |

En paralelo, el plan de QA define **17 casos** (QA-01…QA-17), que son el otro eje: un requisito puede estar
implementado y su caso de QA no haberse ejecutado todavía.

## 2.bis Comprobación: ¿toda obligación de las fuentes apunta a un requisito?

El denominador solo vale si **ninguna obligación de las fuentes se queda fuera por no tener identificador**. Se
comprobó sección por sección, enfrentando las secciones numeradas de cada fuente con las que la matriz
(`24_TRAZABILIDAD_REQUISITOS.md`) referencia.

| Fuente | Secciones numeradas | Referenciadas | Sin referencia directa |
| --- | ---: | ---: | ---: |
| **S1** Documentación técnica maestra | 118 | 76 | **42** |
| **S4** Workflows de cacao | 24 | 24 | **0** |
| **S2** Negocio y plataformas | 31 | 12 | 19 |
| **S3** Mapa competitivo | 43 | 19 | 24 |

Una sección sin referencia **no** es automáticamente una obligación perdida. Clasificadas una a una:

| Grupo | Secciones | ¿Obligación? |
| --- | --- | --- |
| **Encuadre** (objetivo, principio, alcance, arquitectura, stack) | S1 §1–7 | §5–7 sí, y están en **TECH-001 / ADR-0001 / docs/04**. §1–4 son contexto |
| **Detalle de API** (rutas de ejemplo) | S1 §50–53 | Sí, pero son **forma** de requisitos ya identificados (RF-06…RF-22). `docs/09` declara expresamente que «los endpoints de la spec son propuestas»: el grafo de trazabilidad existe como `upstream`/`downstream` dentro de `GET /lots/{id}` en vez de `/traceability/:tipo/:id`. Misma obligación, otra ruta |
| **Testing** | S1 §70 | Sí, y es **método**: vive en `16_PLAN_QA.md` (QA-01…17) y en la Definition of Done. Sus partes con requisito son RNF-01 (seguridad), RNF-04 (offline) y RNF-11 |
| **Plan y proceso** (sprints, backlog, semanas, DoD, instrucciones) | S1 §86–96, §100–102, §104–118 | No son obligaciones de producto: son el plan de trabajo. `18_BACKLOG.md` y `19_ROADMAP_Y_PILOTO.md` los recogen |
| **Invariantes y prohibiciones** | S1 §2, §103 | **Sí, y son transversales**: «quién, cuándo, dónde, de qué entidad, qué respalda» → RNF-03; «no mezclar organizaciones» → RNF-01; «no modificar históricos en silencio» → RNF-03 y los triggers; «una certificación no equivale a cumplimiento» → compuertas. Además están escritas como reglas del repositorio (`.claude/rules/00-domain.md`, `CLAUDE.md`) |
| **Negocio y competencia** | S2 §1–3, 10–17, 21–31 · S3 (casi todo) | No. Modelo de negocio, competidores, precios y estrategia. Las «FASE 6 – RISK ENGINE» y «FASE 7 – DUE DILIGENCE» de S2 describen el flujo ya cubierto por RF-20 y RF-22 |

### La única obligación encontrada sin requisito: S1 §49 (QR)

> «Agregar QR desde la primera arquitectura aunque no sea obligatorio en el MVP. […] Cada una podrá tener
> `public_reference`. Nunca exponer directamente IDs internos.»

**RF-33** cubre el QR como capacidad de P1, pero **ninguna** cubría la obligación **estructural**: que productor,
parcela, entrega, lote, paquete y embarque lleven una **referencia pública** desde el modelo de datos. Comprobado:
la columna `public_reference` **no existe en ninguna tabla**.

**Ajuste del denominador**: se añade **RF-47** a `03_REQUISITOS.md`, ligada a P1-002, con el texto literal de la
fuente. Queda **NO DEMOSTRADA**. El denominador pasa de 58 a **59** y el numerador no cambia.

**No se rehízo ningún documento ya trazado**: S4 estaba completo, y S1, S2 y S3 solo necesitaban la clasificación
anterior, no una reescritura.

## 3. Escala, sin terceras lecturas

- **DEMOSTRADO**: hay implementación **y** prueba local que la acredita.
- **PARCIAL**: hay implementación y prueba de **una parte**, con el resto identificado. **No cuenta como cumplido.**
- **NO DEMOSTRADO**: no hay implementación, o la hay sin prueba que la acredite.
- **BLOQUEADO**: depende de una decisión abierta o de una capacidad externa que no está en el proyecto.

Un requisito solo cuenta en el numerador si está **DEMOSTRADO**. No se pondera por esfuerzo: no hay base para
hacerlo y una ponderación inventada convertiría una medida en una opinión.

## 4. Requisitos funcionales del MVP (RF-01 … RF-31)

| RF | Capacidad | Historia | Estado | Qué falta |
| --- | --- | --- | --- | --- |
| RF-01 | Organización y membresía única | P0-001 | **DEMOSTRADO** | — |
| RF-02 | Usuarios sin pérdida de historial | P0-002 | **DEMOSTRADO** | Entrega de invitaciones provisional (D-19), registrada |
| RF-03 | Mínimo privilegio y aislamiento | P0-003 | **DEMOSTRADO** (2026-10-17) | Los dos criterios que faltaban quedaron cubiertos: *buyer/grants* con concesiones externas reales (D-P0003.1 = A, migración `0046`) y *superadmin/elevación* con la elevación supervisada ligada a la sesión (D-04, migraciones `0047`/`0048`). Tenant en **API, jobs, descargas y relaciones** en `qa02-jobs-objetos.int-spec.ts`; QA-01 en `members`/`rbac`. **Alcance de la elevación**: una sola acción de lectura redactada (`members:read`); no habilita escritura ni datos personales |
| RF-04 | Productor con identidad protegida | P0-004 | **DEMOSTRADO** | — |
| RF-05 | Código y deduplicación | P0-005 | **DEMOSTRADO** | — |
| RF-06 | Parcela | P0-006 | **DEMOSTRADO** | — |
| RF-07 | Punto GPS | P0-007 | **PARCIAL** | Evidencia **simulada**; captura real en dispositivo pendiente de comprobación humana |
| RF-08 | Polígono | P0-008 | **DEMOSTRADO** | — |
| RF-09 | GeoJSON | P0-009 | **DEMOSTRADO** | Aceptación por el servicio real del destino: **D-05.B**, fuera del criterio |
| RF-10 | Validación GIS | P0-010 | **DEMOSTRADO** | Ídem |
| RF-11 | Producto y transformación | P0-011 | **DEMOSTRADO** | — |
| RF-12 | Entregas y recepción | P0-012 | **DEMOSTRADO** | — |
| RF-13 | Calidad | P0-013 | **DEMOSTRADO** | — |
| RF-14 | Trazabilidad CTE/KDE | P0-014 | **DEMOSTRADO** | — |
| RF-15 | Eventos | P0-015 | **PARCIAL** | Criterios internos demostrados; concesiones externas y elevación dependen de P0-003 |
| RF-16 | Lotes y procesos | P0-016 | **DEMOSTRADO** | — |
| RF-17 | Inventario y balance de masa | P0-017 | **PARCIAL** | Todo demostrado **excepto despacho**, bloqueado por **D-34** |
| RF-18 | Documentos | P0-018 | **DEMOSTRADO** | — |
| RF-19 | Evidencias | P0-019 | **DEMOSTRADO** | Afirmaciones de lote y ambientales dependen de **D-37/D-42** |
| RF-20 | Riesgo | P0-020 | **DEMOSTRADO** | Conclusión regulatoria: **D-07.5/.6**, fuera del criterio |
| RF-21 | Mitigación | P0-021 | **DEMOSTRADO** | — |
| RF-22 | Expediente y paquete DD | P0-022 | **PARCIAL** | Capacidades sueltas demostradas; **`READY` y `DD_PACKAGE` inalcanzables** por seis requisitos no evaluables |
| RF-23 | Captura offline | P0-023 | **PARCIAL** | Motor y cifrado probados; **Android real sin ejecutar** |
| RF-24 | Sincronización | P0-024 | **PARCIAL** | Servidor y motor probados; ensayo offline completo sin ejecutar |
| RF-25 | Auditoría | P0-025 | **DEMOSTRADO** | — |
| RF-26 | Importación Excel | P0-026 | **DEMOSTRADO** | — |
| RF-27 | Web por rol y Lot Hub | P0-027 | **DEMOSTRADO** | — |
| RF-28 | Proveedor satelital | P0-028 | **PARCIAL** | Adaptador y defensas probados **sin proveedor**; **D-09 parte B** bloquea el uso real |
| RF-29 | Movimientos y embarque | P0-029 | **PARCIAL** | Reserva/liberación/cancelación demostradas; **despacho bloqueado por D-34** |
| RF-30 | Reportes e indicadores | P0-030 | **DEMOSTRADO** | — |
| RF-31 | Piloto y operación reproducible | P0-031 | **NO DEMOSTRADO** | Piloto **sin ejecutar**: volumen, Android real, RPO/RTO con volumen real y capacitación impartida |

**RF del MVP: 21 DEMOSTRADOS de 31.**

## 5. Requisitos de evolución (RF-32 … RF-46)

Las quince corresponden a historias **P1**, ninguna iniciada.

| RF | Capacidad | Historia | Estado |
| --- | --- | --- | --- |
| RF-32 | Buyer Portal | P1-001 | **DEMOSTRADO** (2026-10-17): concesión, vencimiento, revocación, aislamiento, portal, descarga autorizada y **los once indicadores de S3 §22.8** como estados, sobre **lote, embarque e instantánea**. **D-48(A) adoptada e implementada** |
| RF-33 | QR / pasaporte digital | P1-002 | **DEMOSTRADO** (2026-10-17): QR verificado **por decodificación**, recorrido completo y **dos audiencias** —las que las fuentes describen—. «Por audiencia» **no es exigencia de ninguna fuente**: `CONTRASTE_ACEPTACION_RF32_RF33_2026-10-17.md` §1 |
| RF-34 | My Work ampliado | P1-003 | **DEMOSTRADO** (2026-10-18): cola **personal** y de **supervisión** separadas por la autorización, **filtros reales** en el backend que no amplían el alcance, fila completa de docs/14 con **prioridad explicable** y sin plazos inventados, y la fila sale **al resolver el dominio** (recorrido real en navegador). QA-11 y QA-14 comprobadas |
| RF-35 | Onboarding y madurez | P1-004 | **DEMOSTRADO** (2026-10-18): asistente de 8 pasos (UX_UI §10.4) y diagnóstico de los **siete niveles de S3 §16 con la evidencia de cada señal**. La fuente **no fija umbrales**: la correspondencia señal→nivel es **D-49, opción A, ADOPTADA el 2026-10-18 para desarrollo local** —diagnóstico por **presencia de evidencias**, con reglas explícitas y versionadas, visible en la respuesta—. Es una **decisión provisional de producto**, no un umbral derivado de la fuente ni una certificación de madurez. Una organización sin datos **no** es «nivel 0». Se distinguen dato faltante, capacidad no implementada y decisión pendiente. **No levanta compuertas** |
| RF-36 | Perfil de legalidad Ecuador | P1-005 | **BLOQUEADO** — es la dependencia de `LEGAL_PROFILE` en el expediente |
| RF-37 | Intercambio GUIA/Agrocalidad | P1-006 | **PARCIAL** (2026-10-18): implementado el intercambio **por archivo** —mapeo declarado, conciliación que no escribe datos, registro de actos y acuerdo— y su **compuerta**: sin acuerdo verificado y vigente responde 409, y **verificar es de plataforma**. **No se declara demostrado** porque su propio criterio es «solo canal/acuerdo comprobados» y **no existe canal real**. El canal externo **sigue sin verificar**, que era el estado anterior. Evidencia: `docs/qa/EVIDENCIA_P1006_INTERCAMBIO_2026-10-18.md` |
| RF-38 | Integración oficial EUDR-IS | P1-007 | **BLOQUEADO** — rol y canal oficiales no verificados |
| RF-39 | ERP / API / webhooks | P1-008 | **NO DEMOSTRADO** |
| RF-40 | Simulador de preparación | P1-009 | **DEMOSTRADO** (2026-10-18): simulación por lote de **solo lectura** —sin `POST` ni `PATCH` y sin guardar escenarios—, con **entradas y fecha visibles**, las **mismas reglas** que el preflight y **el veredicto decidido por las causas, no por el porcentaje**. Separa estado real, escenario hipotético y lo que seguiría bloqueado, clasificado en dato, decisión o capacidad. **No habilita READY ni el despacho.** Evidencia: `docs/qa/EVIDENCIA_P1009_SIMULADOR_2026-10-18.md` |
| RF-41 | Coste de preparación | P1-010 | **DEMOSTRADO** (2026-10-18): presupuesto con importes **declarados por la organización** (D-51), en **USD**, versionados y con vigencia; **nada precargado** del ejemplo de S3. Cantidades **declaradas y marcadas como estimadas**; lo observado va **aparte y con su fecha**. Ausencia **no es cero**: el total se marca incompleto. Reparto por **productor distinto del grafo de origen** y por **tonelada del peso físico del ledger**; sin denominador válido, **no calculable**. **Reproducible**: cambiar una tarifa no reescribe una estimación guardada. Evidencia: `docs/qa/EVIDENCIA_P1010_PRESUPUESTO_2026-10-18.md` |
| RF-42 | Histórico temporal y alertas | P1-011 | **DEMOSTRADO** (2026-10-18): línea temporal que **reutiliza** el registro de cambios existente, las versiones, los análisis, la evidencia y el riesgo —**sin tabla nueva**—; **tres fechas separadas** y la ausente declarada; años sin registros **rotulados**, no interpolados; comparar con sus **limitaciones delante** y sin lenguaje de mejora ni deterioro; alertas **derivadas y de solo lectura** con **problema, impacto, causa y acción** (S4 §20) y **sin umbrales inventados**. Evidencia: `docs/qa/EVIDENCIA_P1011_HISTORICO_2026-10-18.md` |
| RF-43 | Precio, prima y pagos | P1-012 | **DEMOSTRADO** (2026-10-18), con **D-52(A) adoptada**: registro **versionado** de precio, prima y **pagos informados** sobre la entrega existente; **no se ejecuta ninguna transferencia**; **moneda y unidad** conservadas y **nunca convertidas**; **privacidad** con permisos propios —leer una entrega no da acceso a su dinero— y sin campos nuevos para el comprador. **Prima ausente ≠ cero** y **no deducible** sin fundamento. Evidencia: `docs/qa/EVIDENCIA_P1012_ECONOMIA_2026-10-18.md` |
| RF-44 | Extracción asistida de documentos | P1-013 | **DEMOSTRADO** (2026-10-18): **revisión humana** —sin decisión de una persona **no hay dato**— y **evidencia de extracción** —motor, versión, huella del contenido, fragmento literal y posición de cada sugerencia—. La **confianza** es **la regla** que la produjo, no un número inventado. **No hay decisión regulatoria automática** y **nada sale de la instalación**: el PDF con capa de texto se lee en local, y lo que este motor no sabe leer —imágenes y escaneos— se declara no soportado. **Precisión (2026-10-18)**: eso es una **limitación del motor implementado**, no una obligación de usar terceros; existen motores OCR **locales** (p. ej. Tesseract). No se incorpora ahora. **S1 §55** se respeta: nada del producto **depende** de la extracción. Evidencia: `docs/qa/EVIDENCIA_P1013_EXTRACCION_2026-10-18.md` |
| RF-45 | Analytics / supplier score | P1-014 | **DEMOSTRADO** (2026-10-18). **Contraste literal**: RF-45 está en la tabla «**Requisitos de evolución**» (`docs/03:45`), cuya cuarta columna es «**Restricción**», no «Validación»: «Analytics/supplier score comercial» es el **nombre de la capacidad** y lo exigible es la restricción «**métrica independiente de riesgo legal**». La **aceptación mínima** (`docs/18:215`) dice «**Métricas** comerciales separadas de riesgo jurídico, **denominadores** y **permiso**» —en plural y sin score—. Los cuatro puntos están demostrados: ningún indicador usa conclusión, severidad ni resultado técnico; cada cociente publica su denominador; `analytics:read` más el permiso de cada dominio, y la descarga con `report:export`. **Ningún criterio exige un score compuesto**: el único «score» de la documentación interna (`docs/12:41`) advierte *contra* manipularlo. Las seis preguntas de **S3 §41** van tras «**Podemos empezar a responder**» (`docs/sources/S3:1503`): son **posibilidades de evolución**, no obligaciones. Evidencia: `docs/qa/EVIDENCIA_P1014_INDICADORES_2026-10-18.md` |
| RF-46 | Multilenguaje / SSO / consumo | P1-015 | **PARCIAL** (2026-10-18): **español conservado** (comprobado: idioma declarado, único disponible, sin claves de traducción) y **límites comprobados** (10 publicados con procedencia y efecto, verificados superando uno). **Tres ADR por componente** entregados (0007/0008/0009). **Falta «coste … y SSO comprobados»**: no hay tarifa acordada ni proveedor de identidad, y la historia depende de un **piloto** que no existe. **No cuenta como demostrado**; la condición sale de los criterios, no de una interpretación. Evidencia: `docs/qa/EVIDENCIA_P1015_LIMITES_2026-10-18.md` |
| RF-47 | Referencia pública por entidad (`public_reference`) | P1-002 | **NO DEMOSTRADO** — añadida el 2026-10-16 por el contraste de obligaciones (§2.bis). La columna no existe en ninguna tabla |

**RF de evolución: 0 DEMOSTRADOS de 16.** Tres están **bloqueados por terceros** (RF-36, RF-37, RF-38): no son
trabajo técnico pendiente, sino decisiones o canales externos.

## 6. Requisitos no funcionales (RNF-01 … RNF-12)

Aquí está la mayor parte de lo que el cierre de historias **no** mide: operación, seguridad, móvil, rendimiento y
producción.

| RNF | Condición | Estado | Qué falta exactamente |
| --- | --- | --- | --- |
| RNF-01 | Aislamiento y mínimo privilegio | **DEMOSTRADO** (2026-10-17) | Cero accesos cruzados en la matriz QA-02 **incluidos objetos y relaciones**, con control autorizado en cada caso; y los dos criterios que faltaban de P0-003 —grants externos y elevación— demostrados |
| RNF-02 | Integridad transaccional | **PARCIAL** | Confirmación, cierre y reserva probados concurrentes; **despacho** no (D-34) |
| RNF-03 | Auditabilidad | **DEMOSTRADO** | — |
| RNF-04 | Offline (7 días simulados + interrupción real) | **NO DEMOSTRADO** | El **ensayo** no se ha ejecutado; la duración objetivo sigue sin ADR |
| RNF-05 | Rendimiento (budgets p95/SLO) | **NO DEMOSTRADO** | **No hay budgets acordados** (TECH-001) ni medición con dataset de piloto ni prueba de carga |
| RNF-06 | Recuperación (RPO/RTO) | **PARCIAL** | **QA-16 completa**: respaldo y restauración verificados, con la aplicación operando sobre la copia. Faltan **RPO/RTO medidos con volumen real** |
| RNF-07 | Privacidad | **DEMOSTRADO** | Clasificación y redacción en UI, API, logs, reportes y exportaciones, probadas. *Nota: las dos exposiciones de credenciales del 14 y 16 de octubre fueron **de procedimiento**, no del producto; corregidas con herramienta y pruebas* |
| RNF-08 | Interoperabilidad | **DEMOSTRADO** | OpenAPI validada en cada `validate`; fixtures de GeoJSON e importación |
| RNF-09 | Accesibilidad | **PARCIAL** | Teclado, 390 px y zoom 200 % probados **en web**; la app **móvil real** no se ha comprobado |
| RNF-10 | Observabilidad | **DEMOSTRADO** (2026-10-17) | Request/job IDs, `/health/live` y `/health/ready`, y **avisos verificados con fallos inducidos** en `operations-alerts.int-spec.ts` (6) y en el despliegue, sin secretos. **Cubre lo que su verificación nombra**; lo que S1 §77 pide además está ahora en **RNF-13** |
| RNF-13 | Instrumentación de observabilidad | **DEMOSTRADO** (2026-10-17) | Métricas medidas con **peticiones reales** (la serie va de 0 a 3), **267 series sin un solo identificador**, **recorrido real** de una traza desde su `request_id` hasta sus tramos de base, y `/version` sirviendo. Saneamiento con **lista blanca** probado aparte (`sanitize.spec.ts`, 14). **No cierra RNF-05 ni RNF-06**: medir no es tener objetivos |
| RNF-11 | Mantenibilidad | **DEMOSTRADO** | Linters sin avisos, módulos y límites conservados, ADR por cambio estructural |
| RNF-12 | Operación segura | **DEMOSTRADO** (2026-10-17) | Entornos separados y 0 secretos versionados; **D-43 ejecutada** el 2026-10-16; y el **ensayo de retorno 12/12** (`scripts/ensayo-retorno.mjs`) separando retorno de la aplicación, compatibilidad de esquema y restauración de datos, con referencias públicas exactas y un fallo inducido identificable y recuperable |

**RNF: 5 DEMOSTRADOS de 13.**

## 7. Las dos mediciones

### 7.1 Cierre de historias del MVP

| | |
| --- | ---: |
| DONE_LOCAL | **24 de 32 — 75 %** |
| Abiertas con implementación parcial | 7 |
| Sin ejecutar | 1 |

Mide **historias cerradas**, no requisitos cubiertos, y solo del MVP. Es la cifra ya reportada, y el contraste de
§4 no la contradice: una historia DONE_LOCAL puede dejar requisitos transversales abiertos, porque los RNF no son
criterio de cierre de ninguna historia concreta.

### 7.2 Cobertura demostrada de la documentación raíz

**Denominador: 58** requisitos con identificador de `03_REQUISITOS.md`.
**Numerador: los DEMOSTRADOS**, sin ponderar y sin contar parciales.

| Bloque | Demostrados | Total | % |
| --- | ---: | ---: | ---: |
| RF del MVP (RF-01…31) | 21 | 31 | 68 % |
| RF de evolución (RF-32…47) | 0 | 16 | 0 % |
| RNF (RNF-01…13) | 4 | 13 | 31 % |
| **Total** | **25** | **60** | **42 %** |

*(La tabla conserva el corte del 2026-10-16; la cifra vigente está debajo.)*

**Sí se puede calcular**, y es **70,0 %** al 2026-10-19: **42 de 60** (RF-32 y RF-33 cerradas el 2026-10-17; **RF-34**, **RF-35**, **RF-40**, **RF-41**, **RF-42**, **RF-43**, **RF-44** y **RF-45** el 2026-10-18; **RF-39** el 2026-10-19). Partía de 42 % (25/59) y suben nueve
requisitos: **RF-47** (2026-10-16), **RF-03** y **RNF-01** (al cerrarse P0-003), **RNF-10** y **RNF-12**
(avisos verificados y ensayo de retorno) y **RNF-13** (métricas y trazas). El denominador pasó de 59 a **60**
al registrarse **RNF-13**: el catálogo estaba incompleto, no se amplió el alcance. La diferencia con el 75 % no es una contradicción: son medidas de cosas
distintas. El 75 % cuenta **historias del MVP cerradas**; el 43 % cuenta **requisitos demostrados de todo el
documento de requisitos**, incluyendo los 15 de evolución —que nunca estuvieron en el alcance del MVP— y los 12
transversales, que ninguna historia cierra por sí sola.

**Si se midiera solo lo que el MVP se propuso** (31 RF del MVP + 13 RNF = 44), el resultado sería **30 de 44,
68,2 %** — RF-47 es de evolución y no entra aquí; RF-03, RNF-01, RNF-10, RNF-12 y RNF-13 sí. Es la cifra más comparable con el 75 %, y la distancia entre ambas es justamente **lo que el cierre de
historias no mide**: los requisitos transversales.

### 7.3 Qué NO miden estos porcentajes

- **No miden esfuerzo restante.** No hay base para ponderar y no se inventa ninguna.
- **No miden conformidad EUDR.** Ningún porcentaje la acredita.
- **No incluyen** las secciones sin ID de las especificaciones (`04`–`15`, `UX_UI.md`): se usan como evidencia,
  no como unidades contables.
- **No incluyen** el eje de verificación: de los **17 casos de QA**, QA-16 está completo y varios siguen sin
  ejecutarse (QA-15 con proveedor real, QA-17 de operación, el ensayo offline de QA-08).
- **Un PARCIAL no es medio cumplido.** Nueve RF y seis RNF están en ese estado; ninguno cuenta.

## 8. Separación: decisión, trabajo técnico y prueba no ejecutada

Lo que falta **no es homogéneo**. Mezclar las tres cosas es lo que produce planes irreales.

### 8.1 Esperan una DECISIÓN (no hay nada que programar)

| Decisión | Bloquea | Quién decide |
| --- | --- | --- |
| **D-04** elevación y superadmin | RF-03, RNF-01 | Producto/seguridad |
| **D-05.B** aplicabilidad jurídica del perfil | Interpretación de RF-09/RF-10 | Regulatorio |
| **D-07.5** perfil jurídico · **D-07.6** quién concluye | RF-22, conclusión regulatoria | Regulatorio |
| **D-09 parte B** uso real del satélite | RF-28 | Producto/contratación |
| **D-34** compuerta de despacho | RF-17, RF-29, RNF-02 | Producto |
| **D-37 / D-42** resultado → evidencia | RF-19 | Producto |
| **D-43** claves PII (cuatro subdecisiones) | RNF-12 | Seguridad/producto |
| **ADR-0002 / P1-001** contrato de grants | RF-03, RF-32 | Arquitectura |
| **TECH-001** budgets p95/SLO | RNF-05 | Arquitectura |

### 8.2 Es TRABAJO TÉCNICO (se puede programar ya)

| Trabajo | Cubre | Depende de |
| --- | --- | --- |
| Alertas verificadas sobre health/readiness | RNF-10 | Nada |
| Ensayo de rollback de migración | RNF-12 | Nada |
| Herramientas de recodificación y reindexado PII | RNF-12 | **D-43.1/.2** |
| Completar el expediente hasta `READY` | RF-22 | **D-07.5/.6**, D-05.B, P1-005 |
| Despacho de embarque | RF-17, RF-29 | **D-34** |
| Historias P1 (12 sin bloqueo externo) | RF-32…RF-35, RF-39…RF-46 | Prioridad |

### 8.3 Son PRUEBAS NO EJECUTADAS (el código puede estar listo)

| Prueba | Cubre | Qué hace falta |
| --- | --- | --- |
| Captura GPS en **dispositivo real** | RF-07 | Un teléfono y una persona |
| **Android real**: instalar, capturar, sincronizar | RF-23, RF-24, RNF-09 | Dispositivo físico |
| **Ensayo offline** de 7 días simulados + interrupción | RNF-04 | Ejecutarlo |
| **Carga y p95** con dataset de piloto | RNF-05 | Budgets (TECH-001) + ejecución |
| **RPO/RTO con volumen real** | RNF-06 | Volumen de piloto |
| **Piloto completo** | RF-31 | Organización piloto real |
| **QA-15 con proveedor real** | RF-28 | **D-09 parte B** |
| **Capacitación impartida** | RF-31 | Personas |

## 9. Orden de trabajo recomendado

### Ejecutable ya, sin esperar a nadie

1. **D-43: decidir y ejecutar** (§6 de ese documento). Es la ventana más barata —6 filas y 7 versiones— y cierra
   el único pendiente de seguridad que depende solo de nosotros.
2. **Ensayo de rollback de migración** y **alertas verificadas**: cierran RNF-12 y RNF-10 sin depender de nada.
3. **Ensayo offline** (RNF-04): el motor ya está probado en integración; falta el ensayo como tal.
4. **Historias P1 sin bloqueo externo**, por valor: P1-003 (My Work ampliado) y P1-009 (simulador) reutilizan lo
   construido y no esperan a terceros.

### Requiere una decisión interna primero

5. **D-34** → desbloquea despacho, y con él RF-17, RF-29 y RNF-02: tres requisitos con una sola decisión. Es el
   mejor retorno por decisión tomada.
6. **D-04** → RF-03 y RNF-01, y con ellos el último criterio de una historia que arrastra a P0-015.
7. **TECH-001 budgets** → sin ellos, RNF-05 no es medible: no se puede aprobar lo que no tiene umbral.

### Requiere intervención externa

8. **Dispositivo Android real** → RF-07, RF-23, RF-24, RNF-09. Cuatro requisitos esperando un teléfono.
9. **D-09 parte B** (contratar proveedor) → RF-28 y QA-15.
10. **D-05.B, D-07.5, D-07.6, P1-005** (regulatorio) → RF-22, la conclusión y `READY`. **Es el bloque que ningún
    trabajo técnico puede adelantar**, y del que depende que el producto signifique algo frente a la norma.
11. **Organización piloto** → RF-31, RNF-05 y RNF-06 con volumen real.

**Observación sobre el orden**: los pasos 1–4 suben la cobertura de requisitos sin tocar el 75 % de historias,
porque son transversales. Los pasos 5–7 mueven ambas cifras. Los pasos 8–11 no dependen de programar más código,
y son los que separan un MVP local demostrado de un producto utilizable: conviene empezar a gestionarlos **ahora**,
en paralelo, porque su tiempo de espera no se acorta trabajando más deprisa.
