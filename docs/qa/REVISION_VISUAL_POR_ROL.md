# Revisión visual por rol — Terra Link (local)

**Fecha:** 2026-10-10 · **Entorno:** aplicación de desarrollo en contenedores (`docker compose --profile app`), web `http://localhost:3000`, API `http://localhost:4000`, base `terra_link` (PostgreSQL en 5440) con datos DEMO sintéticos · **Base de código:** rama `feat/tech-001-ci-p0-002`, commit de esta sesión (ver registro de sesión) · **Especificación:** `docs/UX_UI.md`.

**Método.** Script reproducible `node e2e/review/revision-por-rol.mjs` (Playwright, Chromium). Abre una sesión de navegador **aislada** por cada fila de `CREDENCIALES.csv` (usuario + organización + rol), inicia sesión con la contraseña del CSV (nunca se imprime), entra en la organización, registra contexto, navegación y rutas, ejecuta una tarea real permitida, intenta acceder a otra organización DEMO y busca nombres de organizaciones ajenas en sus pantallas. Resultados completos en `docs/qa/revision-resultados.json` y capturas en `docs/qa/capturas/` (solo datos sintéticos rotulados DEMO; sin contraseñas).

Esta revisión no acredita producción, conformidad EUDR ni WCAG. Las experiencias de módulos inexistentes figuran como **pendientes**, no como aprobadas.

## Resultado

- **18 combinaciones usuario/organización/rol** (17 cuentas; una con roles en dos organizaciones): login correcto, organización y rol efectivos visibles en la cabecera, navegación derivada de permisos reales, **denegación coherente** (otra organización → «El recurso no está disponible», sin su nombre; módulo sin permiso → «No tienes permiso…»), **sin datos de otras organizaciones**, tarea real con el resultado esperado. **0 incidencias abiertas** en la última corrida.
- **Teclado:** foco visible (anillo sólido de 2 px) al recorrer el login con Tab.
- **Móvil (390 px):** menú oculto al inicio, se abre, marca visible, se cierra desde el panel y con Escape, sin desbordamiento horizontal (admin y técnico de la cooperativa).

## Detalle por cuenta

| Cuenta | Organización | Rol | Navegación visible | / | /productores | /coincidencias | /miembros | /auditoria | Tarea real | Denegación | Datos ajenos |
|---|---|---|---|---|---|---|---|---|---|---|---|
| superadmin.revision | (plataforma) | SUPER_ADMIN | Resumen de la organización, Incorporar administrador, Organizaciones (plataforma) | ✔ DEMO · Cooperativa Río Verde | 403 explicado | 403 explicado | ✔ Incorporar administrador | 403 explicado | Listar organizaciones de la plataforma: 6 organizaciones visibles | Denegado (sin elevación, D-04) | n/a (plataforma ve metadatos de organizaciones por diseño) |
| admin.cooperativa | Cooperativa Río Verde | ORG_ADMIN | Resumen de la organización, Productores, Posibles duplicados, Miembros e invitaciones, Auditoría, Mis organizaciones | ✔ DEMO · Cooperativa Río Verde | ✔ Productores | ✔ Posibles duplicados | ✔ Miembros e invitaciones | ✔ Auditoría | Consultar miembros y formulario de invitación: 6 miembros; invitar disponible | Recurso no disponible; sin datos de la otra organización | ninguno |
| supervisor.cooperativa | Cooperativa Río Verde | MANAGER | Resumen de la organización, Productores, Posibles duplicados, Miembros e invitaciones, Mis organizaciones | ✔ DEMO · Cooperativa Río Verde | ✔ Productores | ✔ Posibles duplicados | ✔ Miembros e invitaciones | 403 explicado | Listar productores (alcance por rol): 8 productores visibles (esperado 8); 1 caso(s) de posible duplicado pendientes | Recurso no disponible; sin datos de la otra organización | ninguno |
| tecnico1.cooperativa | Cooperativa Río Verde | FIELD_TECHNICIAN | Resumen de la organización, Productores, Mis organizaciones | ✔ DEMO · Cooperativa Río Verde | ✔ Productores | 403 explicado | 403 explicado | 403 explicado | Listar productores (alcance por rol): 5 productores visibles (esperado 5) | Recurso no disponible; sin datos de la otra organización | ninguno |
| tecnico2.cooperativa | Cooperativa Río Verde | FIELD_TECHNICIAN | Resumen de la organización, Productores, Mis organizaciones | ✔ DEMO · Cooperativa Río Verde | ✔ Productores | 403 explicado | 403 explicado | 403 explicado | Listar productores (alcance por rol): 2 productores visibles (esperado 2) | Recurso no disponible; sin datos de la otra organización | ninguno |
| productor.cooperativa | Cooperativa Río Verde | PRODUCER | Mi espacio, Mis organizaciones | ✔ Mi espacio | 403 explicado | 403 explicado | 403 explicado | 403 explicado | Ver su espacio y capacidades pendientes rotuladas: 1 capacidad(es) pendientes rotuladas; aviso de rol sin pantallas | Recurso no disponible; sin datos de la otra organización | ninguno |
| admin.acopio | Acopio San Isidro | ORG_ADMIN | Resumen de la organización, Productores, Posibles duplicados, Miembros e invitaciones, Auditoría, Mis organizaciones | ✔ DEMO · Acopio San Isidro | ✔ Productores | ✔ Posibles duplicados | ✔ Miembros e invitaciones | ✔ Auditoría | Consultar miembros y formulario de invitación: 3 miembros; invitar disponible | Recurso no disponible; sin datos de la otra organización | ninguno |
| recepcion.acopio | Acopio San Isidro | RECEPTION_OPERATOR | Resumen de la organización, Mis organizaciones | ✔ DEMO · Acopio San Isidro | 403 explicado | 403 explicado | 403 explicado | 403 explicado | Ver su espacio y capacidades pendientes rotuladas: 1 capacidad(es) pendientes rotuladas | Recurso no disponible; sin datos de la otra organización | ninguno |
| calidad.acopio | Acopio San Isidro | QUALITY_OPERATOR | Resumen de la organización, Mis organizaciones | ✔ DEMO · Acopio San Isidro | 403 explicado | 403 explicado | 403 explicado | 403 explicado | Ver su espacio y capacidades pendientes rotuladas: 1 capacidad(es) pendientes rotuladas | Recurso no disponible; sin datos de la otra organización | ninguno |
| admin.exportadora | Exportadora Pacífico | ORG_ADMIN | Resumen de la organización, Productores, Posibles duplicados, Miembros e invitaciones, Auditoría, Mis organizaciones | ✔ DEMO · Exportadora Pacífico | ✔ Productores | ✔ Posibles duplicados | ✔ Miembros e invitaciones | ✔ Auditoría | Consultar miembros y formulario de invitación: 6 miembros; invitar disponible | Recurso no disponible; sin datos de la otra organización | ninguno |
| trazabilidad.exportadora | Exportadora Pacífico | TRACEABILITY_MANAGER | Resumen de la organización, Productores, Mis organizaciones | ✔ DEMO · Exportadora Pacífico | ✔ Productores | 403 explicado | 403 explicado | 403 explicado | Consultar productores de su organización (solo lectura): vacío autorizado (la organización no tiene productores) | Recurso no disponible; sin datos de la otra organización | ninguno |
| eudr.exportadora | Exportadora Pacífico | EUDR_MANAGER | Resumen de la organización, Productores, Mis organizaciones | ✔ DEMO · Exportadora Pacífico | ✔ Productores | 403 explicado | 403 explicado | 403 explicado | Consultar productores de su organización (solo lectura): vacío autorizado (la organización no tiene productores) | Recurso no disponible; sin datos de la otra organización | ninguno |
| exportacion.exportadora | Exportadora Pacífico | EXPORT_MANAGER | Resumen de la organización, Mis organizaciones | ✔ DEMO · Exportadora Pacífico | 403 explicado | 403 explicado | 403 explicado | 403 explicado | Ver su espacio y capacidades pendientes rotuladas: 1 capacidad(es) pendientes rotuladas | Recurso no disponible; sin datos de la otra organización | ninguno |
| auditor.exportadora | Exportadora Pacífico | AUDITOR | Resumen de la organización, Productores, Auditoría, Mis organizaciones | ✔ DEMO · Exportadora Pacífico | ✔ Productores | 403 explicado | 403 explicado | ✔ Auditoría | Consultar la auditoría de su organización: 13 registros visibles | Recurso no disponible; sin datos de la otra organización | ninguno |
| admin.importador | Chocolates Europa (importador UE) | ORG_ADMIN | Resumen de la organización, Productores, Posibles duplicados, Miembros e invitaciones, Auditoría, Mis organizaciones | ✔ DEMO · Chocolates Europa (importador UE) | ✔ Productores | ✔ Posibles duplicados | ✔ Miembros e invitaciones | ✔ Auditoría | Consultar miembros y formulario de invitación: 2 miembros; invitar disponible | Recurso no disponible; sin datos de la otra organización | ninguno |
| comprador.importador | Chocolates Europa (importador UE) | BUYER | Mi espacio, Mis organizaciones | ✔ Mi espacio | 403 explicado | 403 explicado | 403 explicado | 403 explicado | Ver su espacio y capacidades pendientes rotuladas: 1 capacidad(es) pendientes rotuladas; aviso de rol sin pantallas | Recurso no disponible; sin datos de la otra organización | ninguno |
| coordinador.multi | Cooperativa Río Verde | MANAGER | Resumen de la organización, Productores, Posibles duplicados, Miembros e invitaciones, Mis organizaciones | ✔ DEMO · Cooperativa Río Verde | ✔ Productores | ✔ Posibles duplicados | ✔ Miembros e invitaciones | 403 explicado | Listar productores (alcance por rol): 8 productores visibles (esperado 8); 1 caso(s) de posible duplicado pendientes | Recurso no disponible; sin datos de la otra organización | ninguno |
| coordinador.multi | Exportadora Pacífico | TRACEABILITY_MANAGER | Resumen de la organización, Productores, Mis organizaciones | ✔ DEMO · Exportadora Pacífico | ✔ Productores | 403 explicado | 403 explicado | 403 explicado | Consultar productores de su organización (solo lectura): vacío autorizado (la organización no tiene productores) | Recurso no disponible; sin datos de la otra organización | ninguno |

Leyenda: ✔ pantalla disponible (título mostrado) · «403 explicado» = mensaje «No tienes permiso para realizar esta acción.» (no se presenta como «sin datos») · «vacío autorizado» = la organización no tiene registros.

## Incidencias encontradas y corregidas en esta revisión

| # | Incidencia | Causa | Corrección | Verificación |
| --- | --- | --- | --- | --- |
| 1 | SUPER_ADMIN en `/productores/coincidencias` veía «El recurso no está disponible» mientras en `/productores` veía «No tienes permiso» | La página de duplicados llamaba a la API sin comprobar el permiso efectivo | Comprobación de `producer:review_duplicates` antes de cargar; mensaje 403 coherente | Ruta revisada de nuevo: «403 explicado» |
| 2 | Móvil: la marca «TERRA LINK» desaparecía al abrir el menú | El color global `a:hover` (bosque) se aplicaba al enlace de marca sobre fondo bosque | Color fijo de la marca en hover/visitado | `marca_visible: true` |
| 3 | Móvil: el panel abierto tapaba el botón «Cerrar menú» | El botón estaba solo en la cabecera, bajo el panel | Botón de cierre dentro del panel + cierre con Escape | `cierra_desde_panel`, `cierra_con_escape: true` |
| 4 | Revisión de duplicados mostraba el estado interno «ACTIVE» | Código del contrato sin traducir | Etiqueta en español (Activo, Borrador, De baja) | Captura `admin-cooperativa--coincidencias.png` |

Falsos positivos del propio script (conteos antes de terminar la carga) se corrigieron esperando el estado de datos; no eran defectos de la aplicación.

## Observaciones (sin defecto)

- ORG_ADMIN de la acopiadora y de la importadora ve «Productores» y «Posibles duplicados»: es coherente con la matriz (los permisos dependen del rol, no del tipo comercial, D-18). Si Producto quiere ocultarlos por tipo de organización, requiere decisión explícita.
- SUPER_ADMIN ve todas las organizaciones (metadatos) e «Incorporar administrador»; miembros, auditoría y productores de cada empresa están denegados (D-04).
- Organizaciones sin productores (exportadora, importadora) muestran el estado «vacío autorizado», distinto del filtro sin resultados y de la denegación.

## Experiencias pendientes de implementación

| Rol | Experiencia (UX_UI §7) | Dependencia |
| --- | --- | --- |
| MANAGER | Centro de operaciones | P0-012, P0-016, cola de trabajo (UI-04) |
| FIELD_TECHNICIAN | Parcelas, captura GPS/polígono, offline | P0-006 a P0-008, P0-023/P0-024 |
| RECEPTION_OPERATOR | Nueva recepción y pesaje | P0-012 |
| QUALITY_OPERATOR | Cola de calidad | Backlog por confirmar (UX-D12) |
| TRACEABILITY_MANAGER | Lotes y explorador de trazabilidad | P0-013 a P0-017 |
| EUDR_MANAGER | Evidencias, riesgo, mitigación, expedientes | P0-018 a P0-022 |
| EXPORT_MANAGER | Embarques | P0-029 |
| AUDITOR | Explorador con comparación de versiones (hoy: bitácora de su organización) | P0-025 |
| BUYER | Portal comprador | P1-001 + contrato de concesiones (UX-D09) |
| PRODUCER | «Mi finca» | Vínculo cuenta–productor (UX-D08) |
| Todos | Logotipo oficial (hoy identificación textual) | Activos oficiales (UX-D01) |

## Actualización 2026-10-10 · P0-006 Parcelas

Script: `node e2e/review/revision-por-rol.mjs` (módulo `e2e/review/parcelas.mjs`), contra la aplicación de desarrollo con 6 parcelas DEMO de coordenadas sintéticas. 22 entradas, 0 incidencias.

| Cuenta | Comprobación | Resultado |
| --- | --- | --- |
| admin.cooperativa | Listado, ficha con polígono, teclado, vuelta al productor | 6 parcelas; esquema + 5 coordenadas + 2 versiones; sin botones de GPS/importación; foco visible; productor muestra sus 2 parcelas |
| tecnico1.cooperativa (asignado) | Alcance y ficha de punto | 5 parcelas (sin las de tecnico2); puede editar; «un punto no tiene superficie» |
| tecnico2.cooperativa (no asignado) | Abrir DEMO-PAR-002 por URL directa | «El recurso no está disponible», sin datos de la parcela |
| coordinador.multi | Dos organizaciones | Cooperativa (Supervisor): 6 parcelas; exportadora (Trazabilidad): vacío autorizado |
| tecnico1.cooperativa (390 px) | Ficha en móvil | Sin desbordamiento horizontal; la tabla de versiones se desplaza dentro de su marco |

Capturas: `parcelas--admin-listado.png`, `parcelas--admin-ficha-poligono.png`, `parcelas--tecnico1-ficha-punto.png`, `parcelas--tecnico2-id-ajeno.png`, `movil--parcela-ficha.png`. Ajuste aplicado tras la revisión: espaciado entre la tabla de coordenadas y «Registrar superficie declarada».

## Actualización 2026-10-10 · Clasificación de geometría y P0-007

23 entradas, 0 incidencias (tras corregir un defecto). Nueva cuenta DEMO `auditor.cooperativa`.

| Cuenta | Comprobación | Resultado |
| --- | --- | --- |
| admin.cooperativa | «Capturar ubicación» visible y alcanzable por teclado | Visible; foco sólido |
| tecnico1.cooperativa (asignado) | Captura disponible en sus parcelas | Visible |
| tecnico2.cooperativa (no asignado) | Parcela ajena por URL | No disponible, sin datos |
| auditor.cooperativa | Parcela con polígono | Ve atributos y superficies; **sin coordenadas** en pantalla ni en la respuesta de la API; aviso «Tu rol no tiene acceso a las coordenadas exactas»; sin botón de captura |
| tecnico1.cooperativa (390 px) | Ficha con bloque de captura | Sin desbordamiento horizontal |

Defecto encontrado y corregido: `geometry_visible` llegaba como texto `"false"` (parámetro SQL sin tipo) y el aviso al auditor no se mostraba. Las coordenadas nunca se expusieron. Cast `::boolean` y aserción nueva en la integración.

**Evidencia simulada** (`e2e/tests/ubicacion.spec.ts`, rotulada [SIMULADA]): posición emulada, permiso denegado, no disponible, timeout, navegador sin soporte, precisión no informada, cancelación y conflicto con muestra conservada. **Evidencia real:** intento con Chromium de Playwright sin posición emulada → timeout (código 3), con y sin ventana; no se obtuvo ubicación real. Comprobación pendiente con interacción humana.

## P0-008 Polígono (2026-10-10)
- tecnico1.cooperativa, DEMO-PAR-003, 390 px **[SIMULADA]**: 3 vértices persistidos tras recargar, resumen de precisión, revisión con validez técnica y GIS pendiente, sin desborde; borrador cancelado (DEMO intacto). Capturas `poligono--*.png`.
- admin.cooperativa: acción de polígono visible. auditor.cooperativa: no visible (sin `plot:read_geometry`). tecnico2 (no asignado): parcela ajena no disponible.
- Resultado: 23 entradas, 0 incidencias. La emulación siempre informa precisión; «no informada» se cubre en integración.

## P0-009 GeoJSON (2026-10-10)
- admin.cooperativa (DEMO-PAR-001): análisis con hash del servidor, válida, GIS pendiente; descartado (DEMO intacto). Exportación `DEMO-PAR-001-v2.geojson`: Feature/Polygon con aviso, sin identidad del productor.
- tecnico1.cooperativa (DEMO-PAR-003, 390 px, teclado): autointersección no válida sin superficie, confirmar bloqueado, retomada tras recargar y descartada; sin desborde.
- auditor.cooperativa: sin panel de importación ni descargas; API de exportación e importaciones 403.
- Capturas `geojson--*.png`. Resultado: 24 entradas, 0 incidencias. Archivos sintéticos.

## P0-010 Evaluación GIS técnica (2026-10-10)
- admin.cooperativa (DEMO-PAR-001): evaluada VALID con alcance técnico, perfil de destino «No evaluado (D-05)», precisión de captura no disponible (coordenadas ingresadas).
- tecnico1.cooperativa (DEMO-PAR-002, 390 px, teclado): botón de evaluación disponible, resultado visible, sin desborde. DEMO-PAR-003 no muestra el botón porque no tiene versión.
- auditor.cooperativa: consulta el resultado sin botón de evaluación ni ubicación del problema.
- Capturas `gis--*.png`. Resultado: 25 entradas, 0 incidencias.

## P0-011 Productos (2026-10-10)
- admin.cooperativa (390 px, teclado): 4 productos con «Kilogramo (kg, masa)», formulario de alta con 4 estados desde la API, confirmación de desactivación que explica efectos (cancelada; catálogo DEMO intacto), sin desborde.
- recepcion.acopio: enlace «Productos», consulta de 4 productos, sin formulario de alta.
- productor.cooperativa: sin enlace y acceso directo denegado («Tu rol no permite consultar el catálogo de productos.»).
- Capturas `productos--*.png`. Resultado: 26 entradas, 0 incidencias.

## P0-013 Hitos de trazabilidad (2026-10-10)
- admin.cooperativa (390 px, teclado): 11 hitos, 11 operaciones pendientes, 0 integradas, sin botones operativos, sin desborde.
- coordinador.multi (responsable de trazabilidad en la exportadora): enlace «Hitos (CTE)» y catálogo completo, sin acciones.
- productor.cooperativa: sin enlace; acceso directo denegado.
- Capturas `cte--*.png`. Resultado: 27 entradas, 0 incidencias.

## P0-014 Datos mínimos KDE (2026-10-10)
- admin.cooperativa (390 px, teclado): «Ver datos mínimos de Entrega» → 7 datos con tipo, unidad (peso declarado en KG, masa), obligatoriedad, regla y responsable; sin formularios; sin desborde.
- coordinador.multi (responsable de trazabilidad): datos mínimos de Recepción (6), incluida la causa de diferencia condicional.
- productor.cooperativa: sin acceso al catálogo ni a los datos mínimos (mensaje de permiso).
- Capturas `kde--*.png`. Resultado: 27 entradas, 0 incidencias.

## P0-015 Eventos (2026-10-10)
- admin.cooperativa (390 px): «Historial de eventos» en la ficha de DEMO-RV-001 (sin correo ni documento), página «Entregas de eventos fallidas» accesible (sin DEAD en DEMO).
- tecnico1.cooperativa: historial de su productor asignado; sin enlace a entregas DEAD.
- tecnico2.cooperativa: sin acceso al historial de un productor no asignado.
- auditor.cooperativa: ve el historial, sin botones de corrección; entregas DEAD denegadas.
- La corrección con teclado a 390 px se verifica en E2E (`productos.spec.ts`). Capturas `eventos--*.png`. Resultado: 28 entradas, 0 incidencias.

## P0-018 Documentos (2026-10-10)
- admin.cooperativa: centro con el soporte sintético DEMO «Disponible (análisis limpio)», formulario de carga, descarga `guia-demo.pdf` y acciones de revisión.
- tecnico1.cooperativa (390 px, teclado): ve los documentos de sus productores; puede subir, no revisar; sin desborde.
- tecnico2.cooperativa: no ve documentos de productores ajenos.
- productor.cooperativa: sin enlace y acceso denegado.
- Capturas `documentos--*.png`. Resultado: 29 entradas, 0 incidencias.

## P0-019 Evidencias (2026-10-10)
- admin.cooperativa: afirmación DEMO «Existe documentación de tenencia» en revisión; estados distintos visibles (archivo disponible / revisión documental / afirmación); botón «Verificar afirmación»; ningún estado «conforme».
- tecnico1.cooperativa (390 px, teclado): ve la afirmación de su productor, no puede verificar; orden de tabulación correcto en el alta; sin desborde.
- auditor.cooperativa: consulta sin acciones; el soporte de tenencia indica «contenido restringido para tu rol».
- Capturas `evidencias--*.png`. Resultado: 30 entradas, 0 incidencias.

## P0-025 Auditoría (2026-10-10, `node e2e/review/revision-por-rol.mjs`, datos DEMO en `terra_link`)

| Cuenta | Resultado | Captura |
| --- | --- | --- |
| admin.cooperativa | 25 de 279 registros a su alcance; exportación CSV con metadatos `TL_AUDIT_CSV 0.1`, SHA-256 visible, sin secretos | `auditoria--admin.png` |
| auditor.cooperativa | Consulta sin correos de actores; puede exportar; detalle «Qué cambió» sin acciones de edición | `auditoria--auditor-detalle.png` |
| tecnico1.cooperativa (390 px, teclado) | Acceso denegado explícito (no «sin datos»); sin enlace en el menú; sin desborde; foco con Tab | `auditoria--tecnico1-390.png` |

Resultado global de la revisión: 31 entradas, 0 incidencias.

## P0-012 Entregas y recepción (2026-10-10, datos DEMO en `terra_link`, Cooperativa Río Verde)

| Cuenta | Resultado | Captura |
| --- | --- | --- |
| admin.cooperativa | ENT-2026-00001: periodo «Mes: septiembre de 2026» sin días; nota de entrega vinculada (sin aprobar); recepción parcial 200 de 350 kg; calidad pendiente; aviso de no conformidad | `entregas--admin-detalle.png` |
| tecnico1.cooperativa (390 px) | Solo entregas de productores asignados; su borrador visible; no puede recibir; sin desborde | `entregas--tecnico1-390.png` |
| recepcion.acopio (membresía en la Cooperativa, teclado) | ENT-2026-00002: origen faltante y periodo desconocido visibles; sin identidad del productor; revisión previa con Enter (no se confirmó sobre datos DEMO) | `entregas--recepcion-revision.png` |

Resultado global: 32 entradas, 0 incidencias.

### P0-012 — revisión enfocada (2026-10-10)

| Cuenta | Resultado | Captura |
| --- | --- | --- |
| recepcion.acopio (permisos por organización) | 2 organizaciones; RECEPTION_OPERATOR en Acopio y Cooperativa con los mismos permisos; tiene `reception:confirm`, `quality:record`; no tiene `quality:decide`, `document:read`, `producer:read_identity` | — |
| calidad.acopio (permisos por organización) | 2 organizaciones; QUALITY_OPERATOR en ambas con los mismos permisos; tiene `quality:record`, `quality:decide`; no tiene `reception:confirm`, `delivery:create`, `document:read` | — |
| calidad.acopio (390 px, teclado, cambio de organización) | En el Acopio no hay entregas; en la Cooperativa registra un resultado **sin decisión** sobre DEMO-M-001 (una sola vez); la recepción sigue «Pendiente de evaluación»; no puede recibir; ve la opción de decidir | `entregas--calidad-390.png` |

Las segundas membresías existen **solo para la revisión DEMO** dentro de la Cooperativa: no son concesiones entre organizaciones ni prueban entregas entre empresas. Resultado global: 32 entradas, 0 incidencias.

## P0-016 Lotes y procesos (2026-10-10, datos DEMO en `terra_link`, Cooperativa)

DEMO: LOT-2026-00001 (150 kg de ENT-2026-00001, origen declarado), LOT-2026-00002 (120 kg de ENT-2026-00002, «Origen incompleto»), PRC-2026-00001 fermentación cerrada 150 → 140 + 10 kg → LOT-2026-00003 (cacao fermentado), PRC-2026-00002 secado en curso con cierre bloqueado. Cifras sintéticas.

| Cuenta | Resultado | Captura |
| --- | --- | --- |
| admin.cooperativa | Lot Hub de LOT-2026-00003: origen hasta ENT-2026-00001 y DEMO-PAR-001; calidad pendiente conservada; saldo de procesamiento (no inventario); proceso cerrado con balance y rendimiento en masa 93,33 % | `lotes--admin-hub.png`, `lotes--admin-fermentacion.png` |
| coordinador.multi (MANAGER, 390 px, teclado) | Puede formar lotes; no prepara procesos; foco con Tab; sin desborde | `lotes--gerente-390.png` |
| calidad.acopio (QUALITY_OPERATOR) | Ve el secado en curso con el cierre bloqueado explicado; no puede cerrar | `lotes--calidad-secado.png` |
| auditor.cooperativa | Consulta sin formularios | — |

Resultado global: 33 entradas, 0 incidencias.

## P0-017 Inventario (2026-10-10, datos DEMO en `terra_link`, Cooperativa)

| Cuenta | Resultado | Captura |
| --- | --- | --- |
| admin.cooperativa | LOT-2026-00003 (fermentado): existencia 140, reservado 140 por el secado, disponible 0; LOT-2026-00002 «Origen incompleto» 120 disponible; material sin lote de ENT-2026-00001 (50 kg); conciliación sin diferencias | `inventario--admin.png` |
| coordinador.multi (MANAGER, 390 px, teclado) | Lectura de existencias; sin formularios de movimiento; sin desborde | `inventario--gerente-390.png` |
| recepcion.acopio · auditor.cooperativa | Consulta sin formularios ni conciliación | — |

Resultado global: 34 entradas, 0 incidencias.

## P0-020 Riesgo (2026-10-10, datos DEMO en `terra_link`, Cooperativa)

DEMO: evaluaciones de LOT-2026-00001 y LOT-2026-00002 con reglas 0.1.0 sin aprobar; sin revisiones humanas.

| Cuenta | Resultado | Captura |
| --- | --- | --- |
| admin.cooperativa | LOT-2026-00002 «Origen incompleto»: BLOCKED (MATERIAL_OF_UNKNOWN_ORIGIN, DATA_MISSING_ORIGIN) sin dilución; LOT-2026-00001: incompleto con reglas no evaluables visibles (D-05, satélite, mitigaciones); conclusión indeterminada; sin puntuación | `riesgo--admin-bloqueado.png` |
| auditor.cooperativa (390 px, teclado) | Lectura sin evaluar ni revisar; sin desborde | `riesgo--auditor-390.png` |
| coordinador.multi (MANAGER) | Sin enlace; acceso directo denegado | — |

## P0-021 Mitigación (2026-10-10, datos DEMO en `terra_link`, Cooperativa)

DEMO: mitigación ABIERTA «Completar el origen de ENT-2026-00002» (causa DATA_MISSING_ORIGIN de LOT-2026-00002), sin entregas ni decisiones (no se simula la resolución de la causa).

| Cuenta | Resultado | Captura |
| --- | --- | --- |
| admin.cooperativa (responsable) | Causa y evaluación de origen; abierta; aviso de separación de funciones; puede aportar soporte | `mitigaciones--admin.png` |
| auditor.cooperativa (390 px, teclado) | Lectura sin acciones; sin desborde | `mitigaciones--auditor-390.png` |
| coordinador.multi (MANAGER) | Acceso denegado | — |

E2E (cuenta administradora del entorno E2E): crear desde la causa, aportar soporte por versión, entregar y comprobar que el ejecutor no puede verificar. La verificación por un segundo usuario y la reevaluación por outbox se prueban en integración (dos verificadores, worker real).

## P0-021 Mitigación — recorrido completo con segunda persona (2026-10-10)

Cuenta DEMO nueva `eudr.cooperativa` (Diana Ponce, rol existente EUDR_MANAGER; sin permisos adicionales; el auditor no cambió). Credencial recuperable según docs/20.

| Paso | Cuenta | Resultado | Captura |
| --- | --- | --- | --- |
| Aportar soporte (versión 1 de un documento DEMO) y entregar | admin.cooperativa (ejecutor) | Sigue abierta al adjuntar; luego «Entregada: pendiente de verificación» | `mitigaciones--admin.png` |
| Verificar con motivo (teclado) | eudr.cooperativa | «Verificada (entrega 1) por Diana Ponce»; reevaluación por outbox → «Evaluación 2 registrada» | `mitigaciones--verificador.png` |
| Riesgo tras reevaluar | eudr.cooperativa | Evaluación 2 vigente: DATA_MISSING_ORIGIN y MATERIAL_OF_UNKNOWN_ORIGIN siguen bloqueantes; conclusión Indeterminada; reglas 0.2.0 sin aprobar | `mitigaciones--riesgo-reevaluado.png` |

No se inventaron datos de origen: la causa continúa visible. La evaluación 2 figura con la verificadora como actor (es quien disparó la reevaluación).

## P0-022 Debida diligencia (2026-10-10, DEMO, Cooperativa)

DEMO: expediente de LOT-2026-00002 con una instantánea (sin revisar, aprobar ni exportar en el seed).

| Cuenta | Resultado | Captura |
| --- | --- | --- |
| eudr.cooperativa | Requisitos con estado y fuente; perfil/D-05/catálogo/conclusión/embarques no evaluables; DATA_MISSING_ORIGIN inválido; paquete deshabilitado con motivo; «no presentada» | `diligencia--eudr.png` |
| auditor.cooperativa (390 px, teclado) | Lectura sin acciones; sin coordenadas (solo hash); sin desborde | `diligencia--auditor-390.png` |
| coordinador.multi, tecnico1.cooperativa | Acceso denegado y sin enlace | — |

E2E (390 px, teclado): crear expediente, capturar instantánea, requisitos no evaluables visibles, borrador interno generado y descargado, iniciar revisión, aprobar y paquete deshabilitados con explicación.

## Revisión P0-021: corrección de la verificación DEMO (2026-10-10)

El criterio «Parcela de origen identificada…» no se cumplía: el documento aportado no identifica la parcela. Con
`eudr.cooperativa` (verificadora, no ejecutora) se registró por la interfaz una corrección: soporte aceptado, criterio no
cumplido, causa persistente. La verificación original sigue en el historial. El worker creó la evaluación 3: «Desencadenada
por Diana Ponce (demo) (corrección de una verificación)», «Ejecutada por proceso automático: worker de reevaluación»,
«Resultado revisado por: nadie todavía». DATA_MISSING_ORIGIN y MITIGATION_UNVERIFIED visibles; conclusión Indeterminada.
El expediente DEMO de P0-022 queda desactualizado por ese cambio (su instantánea no se modifica). Capturas:
`mitigaciones--verificador.png`, `mitigaciones--riesgo-reevaluado.png`.

## P0-023 móvil — revisión de interfaz (2026-10-10)

Revisión de código frente a UX_UI §21 (no renderizada en dispositivo ni emulador): cinco destinos o menos (Inicio,
Captura, Pendientes, Diagnóstico), controles ≥ 48 px, etiquetas y roles de accesibilidad nativos, estados con texto
(«Borrador local», «Pendiente (en cola)», «Sincronización no disponible todavía»), precisión «no informada» cuando es
nula, procedencia sin atribuir GPS, aviso de capturas pendientes al cerrar sesión. **Pendiente**: revisión visual y con
lector de pantalla en un Android real.

## P0-023/P0-024 móvil — revisión de interfaz (2026-10-11)

Revisión de código frente a UX_UI §21.3 (no renderizada en dispositivo): «Entorno de prueba sin cifrado» en Expo Go;
pantalla de bloqueo si el build nativo no inicializa el cifrado; sesión vigente/vencida sin ventana extra; «Sincronizar
ahora» con resumen (confirmadas, conflictos, rechazadas, pendientes, fotos); en Pendientes, estados Pendiente / Enviando /
Sincronizado / Rechazado / Conflicto / Bloqueado por acceso, foto con estado propio («archivo pendiente de subir»,
«análisis pendiente», «disponible») y botón «Reenviar sobre la versión actual del servidor» que conserva la original.
**Pendiente**: revisión visual, teclado/lector de pantalla y 390 px en Android real.

## Escáner real por la API en contenedor (2026-10-11)

Foto SINTÉTICA (fixture JPEG sin EXIF, generado por el script; no es una foto real) enviada por sincronización a la API
del servicio `api` de docker compose con ClamAV real. Fases registradas en `docs/qa/evidencia-escaner-contenedor.json`:
disponible (`AWAITING_CONTENT → AVAILABLE`), escáner detenido (`PENDING_SCAN`, análisis `FAILED`, nunca `CLEAN`) y
reintento con el escáner activo (`SCAN_FAILED → AVAILABLE`). El primer intento de la fase «reintento» falló por un error
del script después de ejecutar el reintento (registrado como «ya reintentado»); se repitió el ciclo completo limpio.
