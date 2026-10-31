# Requisitos verificables

Estado inicial de todos: especificados, pendientes de contrastar con repositorio. RF son capacidades; RNF son condiciones transversales. Las restricciones legales del documento 13 requieren fuentes primarias y aprobación de su perfil.

## Requisitos P0

| ID | Capacidad y resultado obligatorio | Historia | Validación |
| --- | --- | --- | --- |
| RF-01 | Crear/suspender organización y seleccionar solo una membresía autorizada | P0-001 | QA-01 |
| RF-02 | Alta, baja e invitación de usuarios sin pérdida de historial | P0-002 | QA-01 |
| RF-03 | Permisos por recurso/acción y controles por tenant en API, jobs, descargas y relaciones | P0-003 | QA-01, QA-02 |
| RF-04 | Registrar, buscar y actualizar productores con trazabilidad de cambios | P0-004 | QA-03 |
| RF-05 | Código de productor único por organización con deduplicación asistida | P0-005 | QA-03 |
| RF-06 | Parcela vinculada a productor y geometría versionada | P0-006 | QA-04 |
| RF-07 | Capturar punto y precisión GPS conocida o desconocida explícita | P0-007 | QA-04, QA-08 |
| RF-08 | Capturar/importar polígono y conservar muestras/calidad | P0-008 | QA-04, QA-08 |
| RF-09 | Importar/exportar GeoJSON autorizado y compatible con perfil de destino | P0-009 | QA-04, QA-02 |
| RF-10 | Validar coordenadas, CRS, geometría, superficie, duplicados y necesidad de revisión | P0-010 | QA-04 |
| RF-11 | Catálogo de productos y estados del cacao con unidad | P0-011 | QA-05 |
| RF-12 | Entrega con origen/cantidad y recepción con peso real sin doble stock | P0-012 | QA-05, QA-06 |
| RF-13 | Catálogo CTE y registro de hitos físicos de la cadena | P0-013 | QA-05 |
| RF-14 | KDE por hito, validación y responsable, sin inventar datos | P0-014 | QA-05 |
| RF-15 | Eventos persistentes e inmutables, correcciones enlazadas y causalidad | P0-015 | QA-05, QA-07 |
| RF-16 | Lotes con entradas, salidas y grafo completo sin ciclos | P0-016 | QA-07 |
| RF-17 | Inventario, pérdidas, reservas y balance conservativo con protección concurrente | P0-017 | QA-06 |
| RF-18 | Subir/versionar documentos privados, escanear y gestionar vigencia | P0-018 | QA-09 |
| RF-19 | Vincular evidencia con afirmación, fuente y versión; revisión separada | P0-019 | QA-09, QA-10 |
| RF-20 | Evaluación de riesgo explicable, versionada y reproducible | P0-020 | QA-10 |
| RF-21 | Acción de mitigación con responsable, plazo, soporte y verificación/rechazo | P0-021 | QA-11 |
| RF-22 | Expediente y paquete de diligencia con bloqueos/readiness y snapshot | P0-022 | QA-12 |
| RF-23 | Capturar productores, parcelas, entregas y evidencias offline persistentes | P0-023 | QA-08 |
| RF-24 | Sync idempotente, dependencias y conflictos visibles con revalidación | P0-024 | QA-08, QA-02 |
| RF-25 | Auditar cambios, aprobaciones, descargas, exports y permisos | P0-025 | QA-13 |
| RF-26 | Excel con mapeo, preview, errores y commit sin duplicación | P0-026 | QA-03 |
| RF-27 | Web con navegación por permisos, Lot Hub y rutas de recuperación | P0-027 | QA-14 |
| RF-28 | Proveedor satelital sustituible con procedencia y fallo explícito | P0-028 | QA-15 |
| RF-29 | Movimientos y embarques con asignaciones y preflight de despacho | P0-029 | QA-06, QA-12 |
| RF-30 | Reportes/KPI calculados con denominadores y permisos reales | P0-030 | QA-13, QA-14 |
| RF-31 | Piloto completo y restauración demostrada | P0-031 | QA-16, QA-17 |

P0-027–031 son historias añadidas para cubrir capacidades ya mencionadas en las fuentes pero sin ID en su lista P0 original. No presentan nuevas pruebas como ejecutadas.

## Requisitos de evolución

| ID | Capacidad | Historia | Restricción |
| --- | --- | --- | --- |
| RF-32 | Buyer Portal con lote/embarque, evidencia y descarga autorizada | P1-001 | Grant, expiración y revocación |
| RF-33 | QR/pasaporte digital por audiencia | P1-002 | No exponer PII ni prometer DDS |
| RF-47 | **Referencia pública por entidad** (`public_reference`) en productor, parcela, entrega, lote, paquete y embarque, desde el modelo de datos | P1-002 | S1 §49: «agregar QR desde la primera arquitectura aunque no sea obligatorio en el MVP» y «nunca exponer directamente IDs internos». Detectado sin requisito propio en el contraste de obligaciones del 2026-10-16. **Clasificación de alcance: evolución (P1)**, justificada abajo |
| RF-34 | My Work con tareas reales de dominios operativos | P1-003 | Cerrar por acción real, respetar assignee/permisos |
| RF-35 | Wizard de onboarding y diagnóstico de madurez 0–6 | P1-004 | Madurez ≠ conformidad legal |
| RF-36 | Perfil de legalidad Ecuador y documentos requeridos | P1-005 | Fuente, versión, vigencia y revisor |
| RF-37 | Intercambio con GUIA/Agrocalidad | P1-006 | Solo canal/acuerdo comprobados |
| RF-38 | Integración oficial EUDR-IS | P1-007 | Acceptance antes de producción; permiso de presentar |
| RF-39 | ERP/API/webhooks con asociación de referencias | P1-008 | Idempotencia y tenant |
| RF-40 | Simulación de preparación de lote | P1-009 | Solo lectura, inputs/fecha visibles |
| RF-41 | Medir costes de preparación por productor/tonelada | P1-010 | Costes medidos y asignación explicada |
| RF-42 | Historial temporal de parcela y alertas avanzadas | P1-011 | Versiones comparables; datos no disponibles explícitos |
| RF-43 | Registro de precio, prima y pagos informados | P1-012 | No ejecutar transferencias; moneda y privacidad |
| RF-44 | Extracción asistida de documentos | P1-013 | Revisión humana y evidencia de extracción |
| RF-45 | Analytics/supplier score comercial | P1-014 | Métrica independiente de riesgo legal |
| RF-46 | Extensión multilenguaje/SSO/consumo | P1-015 | Español primero y decisiones de coste |

### Ampliación autorizada A-01 (2026-10-20): captura de campo desde la web con alcance propio

Instrucción del propietario del producto, **posterior a la documentación original**. **No altera ningún criterio original**
(P0-006 a P0-010, P0-023/P0-024 y P0-028 conservan su aceptación; P0-023/P0-024 mantienen **pendientes sus criterios con
teléfono físico**). Se registra como requisito propio y **no entra en el conteo 42/60 ni 30/44** hasta que el propietario
decida incorporarlo a los porcentajes.

| ID | Requisito | Historia | Restricción |
| --- | --- | --- | --- |
| RF-48 | Captura web de la ubicación de la **parcela agrícola** (no del lote comercial) por quien corresponde: el **productor** sobre sus parcelas vinculadas, el **técnico** sobre los productores asignados, el administrador y el gerente según sus permisos; auditor y comprador solo consultan si están autorizados | A-01 | Alcance por **recurso**, no solo por rol; coordenada escrita ≠ medición GPS; geometría validada en backend; corrección con motivo y versión; una evaluación anterior no se reutiliza en silencio |

Aceptación de A-01 (propuesta de ingeniería, no de las fuentes originales): (1) seleccionar un productor y una parcela
autorizados; (2) coordenadas manuales, ubicación del navegador, punto o polígono **dibujado sobre un mapa** (cartografía real de OpenStreetMap servida localmente por Terra Link; decisión 2026-10-20) o, solo si faltan los datos cartográficos, en un croquis sin mapa base, o GeoJSON con el mecanismo
existente; (3) revisión de geometría y datos antes de confirmar, con el **orden de las coordenadas** a la vista; (4) evidencias
del recorrido adjuntables a la parcela —las fotografías con el contrato D-41 de la fotografía de campo (copia sin metadatos, dato personal) y consultables por el productor en sus parcelas—; (5) guardar, consultar y corregir con motivo conservando versiones y auditoría;
(6) un productor **no** modifica una parcela ajena y un técnico respeta sus asignaciones, también en documentos, búsquedas,
recuentos y descargas; (7) registrar coordenadas **no** concede aprobar evidencias ni concluir riesgo; (8) evaluación satelital
**de ensayo** desde la web con hallazgos, sin hallazgos, cobertura insuficiente, error y reintento, siempre identificada como
ENSAYO y sin efecto sobre conclusiones, `READY` ni despacho; (9) español e inglés, teclado y 390 px.

**Aclaración de alcance de A-01 (2026-10-21).** La documentación raíz sigue gobernando: se conservan los roles canónicos, sus responsabilidades y permisos base; A-01 **añade capacidades concretas** a los roles existentes (Productor: captura y consulta sobre sus parcelas vinculadas; Técnico de campo: sobre productores y parcelas asignados; Administrador de organización: gestión dentro de su organización; Gerente: captura cuando corresponda a sus permisos vigentes) y **no concede facultades sobre otros módulos**: capturar coordenadas no concede ejecutar análisis satelitales, aprobar evidencias ni concluir riesgo. Mapa base, geometría capturada y resultado satelital permanecen separados; los escenarios locales son ensayo. La captura web permite demostrar el recorrido satelital sin el teléfono; **no sustituye el ensayo físico móvil**, que sigue pospuesto, ni cierra sus criterios (P0-023/P0-024). Contraste y corrección de permisos en `docs/07` («Aclaración de alcance del propietario»).

**Estado de A-01 (2026-10-20): DONE_LOCAL** sobre `4913dd3` (validación APROBADA `2026-10-20T23-04-37-016Z`; candidatos anteriores y sus resultados en `docs/qa/EVIDENCIA_A01_CAPTURA_CAMPO_2026-10-20.md`). Nota de corrección: el criterio (2) se había redactado como «croquis», una reducción de la instrucción «dibujar sobre el mapa»; se corrigió con el mapa local. Los nueve puntos de aceptación se demostraron localmente (API, navegador en español e inglés, 390 px y teclado, escenarios satelitales de ENSAYO); ver `docs/qa/EVIDENCIA_A01_CAPTURA_CAMPO_2026-10-20.md`. Siguen separados: demostración local, aceptación con teléfono físico (pospuesta) y con proveedor satelital real (deshabilitado).

### RF-47: por qué es evolución y no MVP (2026-10-16)

RF-47 se numeró después de RF-46 pero se coloca junto a RF-33 porque es **la mitad de modelo de datos de la misma
capacidad**: RF-33 es el QR/pasaporte por audiencia y RF-47 la referencia pública que ese QR resuelve.

La fuente lo sitúa fuera del MVP por **tres vías independientes y concordantes**:

1. **S1 §49, literal**: «Agregar QR desde la primera arquitectura **aunque no sea obligatorio en el MVP**». La propia
   sección que crea la exigencia declara que no es obligatoria en el MVP.
2. **S1 §100 «BACKLOG P0»**, que es el alcance original del MVP: enumera P0-001…P0-026 y **no menciona QR ni
   `public_reference` en ninguna fila**.
3. **S1 §101 «P1 — Después»**: enumera **QR** explícitamente entre las capacidades posteriores.

**Lo que §49 sí obliga hoy** es de diseño, no de entrega: «nunca exponer directamente IDs internos». Es una
restricción sobre *cómo* se expone lo que ya existe, no una capacidad que el MVP deba entregar. Por eso RF-47 no
entra en el denominador del MVP y sí en el del catálogo completo.

**Denominadores, en consecuencia (sin corrección respecto de lo ya publicado):**

| Medida | Denominador | Por qué |
| --- | ---: | --- |
| Requisitos del alcance MVP | **44** (31 RF + 13 RNF) | RF-47 es P1: queda fuera. **RNF-13** (alta del 2026-10-17) sí entra |
| Requisitos identificados, incluida evolución | **60** | RF-47 y **RNF-13** cuentan aquí |

Los requisitos **parciales siguen fuera del numerador** en ambas medidas: se cuentan solo los completamente
demostrados. Contraste por requisito: `docs/decisiones/CONTRASTE_DOCUMENTACION_RAIZ_2026-10-16.md`.

## Requisitos no funcionales

| ID | Condición | Verificación y objetivo |
| --- | --- | --- |
| RNF-01 | Aislamiento y mínimo privilegio | Cero accesos cruzados en matriz QA-02, incluidos objetos y relaciones |
| RNF-02 | Integridad transaccional | Confirmación/despacho/cierre repetidos y concurrentes no duplican efecto |
| RNF-03 | Auditabilidad | Cada transición crítica reconstruible con actor, tiempo, regla y evidencia |
| RNF-04 | Offline | Ensayo de 7 días simulados y de interrupción/cierre real; duración objetivo final por ADR |
| RNF-05 | Rendimiento | Medir dataset del piloto y carga; budgets p95/SLO acordados en TECH-001, sin promesa inventada |
| RNF-06 | Recuperación | Restaurar DB y objetos coherentes; RPO/RTO medidos antes de producción |
| RNF-07 | Privacidad | Clasificación de campos y redacción en UI, API, logs, reportes y portal |
| RNF-08 | Interoperabilidad | OpenAPI validada y fixtures de GeoJSON/importación/exportación |
| RNF-09 | Accesibilidad | Controles con teclado, etiquetas, estados no dependientes solo de color |
| RNF-10 | Observabilidad | Request/job IDs, health/readiness y alertas verificadas sin secretos |
| RNF-11 | Mantenibilidad | Módulos y límites conservados; linters/formatters del repo, ADR de cambios estructurales |
| RNF-12 | Operación segura | Entornos separados, secretos fuera de git, rollback/migración revisados |
| RNF-13 | Instrumentación de observabilidad | Métricas y trazas del servicio consultables y recorribles sobre un caso real, sin secretos ni identificadores de persona o recurso; `/version` publica la versión desplegada (S1 §77) |

### RNF-13: una omisión del catálogo, registrada (2026-10-17)

S1 §77 «OBSERVABILIDAD» manda implementar cinco cosas —*structured logs*, **metrics**, **tracing**, *error
monitoring* y *health checks*— y exponer tres endpoints: `/health`, `/ready` y **`/version`**.

La verificación de **RNF-10** nombra «Request/job IDs, health/readiness y alertas verificadas sin secretos».
Eso cubre los *structured logs* correlacionados, el *error monitoring* y los *health checks*. **No cubre
metrics, tracing ni `/version`**, y el repaso de los 59 requisitos con identificador confirma que **ningún
otro los recoge**.

**Una obligación de la fuente no desaparece porque la columna de verificación de un requisito resumido la
omita.** Por eso se registra como **RNF-13**, igual que **RF-47** se dio de alta cuando S1 §49 exigía algo que
el catálogo no recogía.

**Por qué un requisito nuevo y no ensanchar RNF-10.** RNF-10 está demostrado contra la verificación que tiene
escrita, y esa demostración sigue siendo válida: reabrirla no identificaría ninguna carencia en lo que sí
verifica. La carencia concreta —no hay métricas, no hay trazas, no hay `/version`— es **otra obligación**, con
su propia verificación, y así se puede decir sin ambigüedad qué está hecho y qué no.

**Alcance MVP.** Entra, como los otros doce RNF: es instrumentación transversal y **no depende de ninguna
decisión pendiente**. Se distingue de **RNF-05**, que sí espera los *budgets* p95/SLO de TECH-001: RNF-13 exige
**medir y poder recorrer**, no alcanzar un objetivo. Tener métricas **no cierra RNF-05 ni RNF-06**.

**Denominadores, en consecuencia:**

| Medida | Antes | Ahora | Por qué |
| --- | ---: | ---: | --- |
| Requisitos del alcance MVP | 43 (31 RF + 12 RNF) | **44** (31 RF + **13** RNF) | RNF-13 es transversal del MVP |
| Requisitos identificados, incluida evolución | 59 | **60** | RNF-13 cuenta en ambos |

**El alta baja los porcentajes publicados mientras RNF-13 no esté demostrado**, y así debe leerse: 30/59 =
50,8 % pasa a **30/60 = 50,0 %**, y 29/43 = 67,4 % pasa a **29/44 = 65,9 %**. No se corrige ninguna cifra
anterior: eran correctas con el catálogo que se conocía entonces.

## Condiciones de cierre

Una historia incluye permisos, validación, persistencia, API, auditoría, errores y prueba del resultado. UI/móvil/offline aplican según alcance. Si falta prueba de dispositivo, regulatoria o integración externa, se registra como gate pendiente; no se declara producto listo por porcentajes de avance.

### Ampliaciones autorizadas A-02 y A-03 (2026-10-21): administración web de concesiones y contrato de traspaso entre organizaciones

Instrucciones del propietario del producto, **posteriores a la documentación original y a A-01**. **No alteran ningún criterio original** ni los de A-01, y **no entran en el conteo 42/60 ni 30/44**
(ni modifican el denominador) hasta que el propietario lo decida. La recomendación que las originó vino del recorrido integral web (`docs/qa/RECORRIDO_INTEGRAL_WEB_2026-10-21.md`, T14 y T15).

| ID | Requisito | Historia | Restricción |
| --- | --- | --- | --- |
| RF-49 | Administración **web** de concesiones externas de lectura: consultar vigentes, vencidas y revocadas; elegir el recurso que se comparte (lote, embarque o instantánea de diligencia); identificar al destinatario sin enumerar usuarios ni organizaciones; revisar el alcance; otorgar con confirmación; consultar el estado y revocar | A-02 | Reutiliza la API, el permiso `grant:manage` y la auditoría existentes; la pantalla **no amplía permisos**; compartir lectura no concede propiedad, modificación ni identidad, geometrías o economía; vencimiento obligatorio |
| RF-50 | **Traspaso de custodia física** entre organizaciones vinculadas (vínculo bilateral → oferta y reserva → aceptación → salida autorizada → tránsito → recepción → conciliación y cierre), distinto de la concesión de lectura, de la exportación y de la compraventa jurídica | A-03 | Núcleo operativo **adoptado** el 2026-10-21 (D1 b, D3 b, D5 a con precisiones, D6 a, D7 a, D8 a, D9 b; `docs/decisiones/A03-TRASPASO-ENTRE-ORGANIZACIONES.md` §0). **D2 pendiente de revisión competente; D4 no adoptada: la salida real permanece bloqueada**, sin bypass en la API operativa. Ningún `organization_id` cambia; no se copia inventario: cada cantidad se mueve por movimientos del ledger de su organización; saldo físico, reservas, tránsito y cantidades recibidas se mantienen separados |

**Estado de A-02 (2026-10-21): DONE_LOCAL** sobre `0211a30`. El criterio (7) —español e inglés, teclado y 390 px— se cumple en la **pantalla de administración**; la vista del destinatario (`/compartido`, P1-001) sigue en español. **Estado de A-03 (2026-10-21): núcleo operativo desarrollado y demostrado en local (**DONE_LOCAL** sobre `d99f40a`; ver `docs/qa/EVIDENCIA_A03_TRASPASO_2026-10-21.md`); la activación operativa de la salida y las decisiones D2/D4 siguen pendientes y se documentan por separado.** Sigue fuera del conteo 42/60 y 30/44.

Aceptación de A-02 (propuesta de ingeniería): (1) lista con estados ACTIVA/VENCIDA/REVOCADA, recurso con su código, destinatario, alcance, vigencia, quién concedió y revocó y por qué;
(2) recursos compartibles limitados a lo que la persona puede leer; (3) destinatario identificado por su correo exacto, sin buscador ni lista, con respuesta indistinguible para «no existe» y
«no disponible»; (4) revisión del alcance y confirmación antes de otorgar; (5) revocar con motivo y efecto inmediato; (6) recorrido propietario → destinatario → revocación → pérdida de
acceso, con rechazos por recurso y organización ajenos; (7) español e inglés, teclado y 390 px.

Aceptación de A-03 (propuesta de ingeniería, 2026-10-21; **fuera del conteo 42/60 y 30/44**): (1) vínculo bilateral con código de un solo uso, confirmado por la **otra** organización, un solo vínculo activo por pareja y sin enumerar organizaciones;
(2) oferta que **reserva** en el libro del emisor sin mover la existencia, idempotente y segura ante concurrencia y saldo insuficiente; (3) aceptación, rechazo y cancelación permitidos según el estado, cada uno con su efecto sobre la reserva;
(4) **la salida real está bloqueada mientras la compuerta de diligencia no se resuelva** y no existe bypass en la API operativa; (5) tránsito derivado de pasos append-only que nunca es negativo y no es saldo de ninguna organización;
(6) recepción total o parcial, faltante, sobrante, rechazo en tránsito y pérdida declarada, con **motivo obligatorio** en toda diferencia, sin existencias creadas ni descontadas automáticamente; (7) conciliación consistente de **ambos** libros;
(8) devolución solo como otro traspaso vinculado; (9) permisos por lado, 404 para terceros y ausencia de filtraciones (la receptora ve la instantánea técnica del origen, no el inventario ni los centros de la emisora);
(10) el lote de la receptora nace con origen INCOMPLETO, sin expediente, severidad, conclusión ni aprobación heredados; (11) español e inglés, teclado y 390 px.

### Precisión de RF-18, RF-19, RF-27 y RF-36 (2026-10-23, sin cambiar sus IDs)

- **RF-18 (documentos):** el documento se aporta a su entidad desde su contexto (productor, parcela, Mi finca) con el mismo servicio; el soporte de una **entrega** se vincula desde la entrega (`delivery_supports`). Subir no aprueba.
- **RF-19 (evidencia):** la revisión humana identifica a la persona, la fecha y el motivo; no es una certificación.
- **RF-27 (web por permisos):** «Mi finca» (UI-22) para cuentas con alcance propio, con tres estados distintos: sin permiso, cuenta sin vínculo y sin datos.
- **RF-36 (legalidad):** la guía por aspecto orienta, con fuente y fecha; no es una lista obligatoria uniforme ni un dictamen de aplicabilidad.
Fuente: `contexto/PLAN_AJUSTE_MINIMO_DOCUMENTACION_Y_PRODUCTO_2026-10-23.md`. No altera 42/60 ni 30/44.
