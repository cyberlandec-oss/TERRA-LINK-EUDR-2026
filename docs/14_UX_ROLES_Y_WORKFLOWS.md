# UX por rol, workflows y pantallas

> **Relación con `docs/UX_UI.md` (2026-10-10):** UX_UI.md es la referencia para identidad visual, tokens, componentes, estados de presentación, accesibilidad y experiencia de los 12 roles. Este documento conserva los workflows y la matriz de pantallas por rol. Si discrepan, prevalecen los permisos y contratos reales del backend (doc 07, OpenAPI); después, UX_UI.md para la presentación y este documento para la secuencia del workflow. Registrar cualquier diferencia en lugar de mantener dos versiones.

FUENTE: S4 completo; mejoras de S3 §§18–23. Estado objetivo, no pantallas verificadas. Reutilizar My Work, Lot Hub y navegación contextual existentes si repo los acredita.

## Reglas de experiencia

Español primero, términos locales, pasos breves y controles accesibles. Organización activa visible. Menú derivado de permisos efectivos, no una home igual para todos. El lote es el centro de reconstrucción; Productor y Parcela enlazan contexto. Alertas muestran problema, impacto, causa, acción y responsable.

Separar cargando, vacío, sin permiso, error transitorio, datos incompletos y offline. Una sección 403 muestra acceso restringido sin «no hay evidencias». Un link sin permiso no promete navegación posible. Botón de confirmar offline indica «guardado en este dispositivo» y número de pendientes, no «registrado en servidor».

## Matriz rol × workspace × datos × acciones

| Rol | Home/navegación visible | Captura/acción | Consulta/evidencia | Aprobación y límite | Online/offline y recuperación |
| --- | --- | --- | --- | --- | --- |
| SUPER_ADMIN | Centro admin, tenants, seguridad, jobs, uso | Configurar tenant/integración y soporte autorizado | Métricas técnicas y audit trail | No operación diaria ni lectura sensible implícita | Online; job fallido → causa/reintento autorizado |
| ORG_ADMIN | Wizard organización, miembros, centros, catálogos, import | Configurar, invitar, mapear Excel, activar | Calidad de datos y pendientes de organización | Asignar solo permisos concedibles | Online; import inválido → corregir filas/preview |
| MANAGER | Centro operación y pendientes | Asignar/resolver excepciones según permiso | Entregas, inventario, lotes y riesgos | Supervisar sin cambiar regla jurídica | Online; bloqueo → entidad/causa/acción |
| FIELD_TECHNICIAN | Mi jornada, visitas, productores/parcelas, cola sync | Capturar perfil/GPS/polígono/foto/entrega | Solo asignaciones; evidencia de campo | Aportar, no aprobar riesgo/DDS | Offline; permiso GPS/almacenamiento/conflicto recuperables |
| PRODUCER | Mi finca, parcelas, entregas, documentos, pendientes | Confirmar datos y aportar soporte | Su historial e información registrada | Sin lectura de terceros ni GIS profesional | Móvil simple/offline donde aplique; borrador persistente |
| RECEPTION_OPERATOR | Nueva recepción, pendientes, búsqueda código | Proveedor → entrega → peso → producto → calidad básica → lote | Recibo, diferencias y ubicación | Confirmar recepción, no alterar histórico | Web/móvil; retry sin duplicar peso/stock |
| QUALITY_OPERATOR | Muestras/lotes por analizar | Muestra → medición → clasificación → liberar/rechazar | Parámetros, métodos y resultado ligado a lote | Liberación de calidad, no jurídica | Online; fuera de límites → revisión/motivo |
| TRACEABILITY_MANAGER | Explorer, lotes, procesos, balances | Investigar origen/destino, corregir relación autorizada | Grafo y cuantificación de inputs/outputs | No fabricar orígenes faltantes | Online; grafo truncado/incompleto distinguido |
| EUDR_MANAGER | Control riesgo, evidencia, mitigación, DD | Causa → soporte → acción → revisar → paquete | Factores, reglas, vigencia y readiness | Verificar con permiso y separación de funciones | Online; cambio relevante → STALE/nueva revisión |
| EXPORT_MANAGER | Embarques, compradores, preflight | Seleccionar lote → reservar → revisar → despachar | Cantidad disponible, calidad, DD y documentos | Liberar solo si guards pasan | Online; bloqueos y falta de saldo accionables |
| BUYER | Portal de embarques/lotes compartidos | Consultar/solicitar dato si se habilita | Origen, mapas, riesgo, soporte y paquete según grant | Sin editar operación ni ver backoffice | Online; acceso vencido → solicitud de renovación |
| AUDITOR | Audit Explorer y búsqueda tipada | Investigar y registrar hallazgo si habilitado | Timeline, versiones y soporte dentro de encargo | No modificar operación auditada | Online; exportación auditable y con alcance |

Módulos no necesarios se ocultan; aun así la API exige autorización. Notificaciones remiten a tareas/recurso autorizado sin PII innecesaria. Asignaciones unen gerente, técnico, EUDR y exportación; roles pueden combinarse con permisos explícitos.

## Pantallas y contratos

| Pantalla | Entidad/servicio | Acción principal | Permiso y prueba |
| --- | --- | --- | --- |
| Onboarding | organización/membresías/catálogos/import | Configurar y validar | Org admin; QA-01/03 |
| Perfil productor | productor/parcelas/entregas/documentos | Completar datos | producer:read/update; QA-03/14 |
| Ficha parcela/mapa | parcela/versión/GIS/riesgo | Capturar/revisar geometría | plot:read/create/correct; QA-04 |
| Registro entrega/recepción | delivery/reception/quality | Registrar y confirmar | delivery/reception; QA-05/06 |
| Lot Hub | lote/grafo/proceso/evidencia/riesgo/auditoría | Reconstruir y resolver | Permiso por sección; QA-07/14 |
| Balance Explorer | ledger/proceso/movimientos | Revisar diferencia | stock:read/adjust separado; QA-06 |
| Evidence Center | documento/evidencia/claim | Aportar y verificar | evidence según acción; QA-09 |
| Risk Center | evaluación/factores/mitigación | Explicar y actuar | risk/mitigation; QA-10/11 |
| Expediente | dd-case/readiness/package | Revisar y preparar | dd:approve/export; QA-12 |
| Embarque | shipment/preflight/reservas | Despachar | shipment:dispatch; QA-06/12 |
| My Work | proyección de dominios/tareas | Resolver trabajo real | Asignación + permiso; QA-14 |
| Buyer Portal | grant y vistas filtradas | Verificar soporte | Grant vigente; QA-02/14 |
| Audit Explorer | audit/eventos/snapshots | Investigar | audit:read/export; QA-13 |

Las rutas API propuestas están en el documento 09. Confirmar nombres y reutilizar cliente generado/contratos reales.

## Lot Hub

Resumen/cantidad/estado; origen/parcelas/productores; proceso/inputs/outputs/merma; inventario/calidad/movimientos; evidencias/documentos; riesgo/mitigación/readiness; embarques; auditoría y permisos. Si existe hub de siete secciones, extender por necesidad de usuario sin reorganizarlo por estética.

## Workflows de punta a punta

1. Asociación: importar productores → resolver errores → capturar parcela → validar → activar operación.
2. Campo: descargar asignación → capturar offline → guardar foto/GPS → sync → resolver conflicto → revisar en web.
3. Acopio: buscar entrega/proveedor → pesar → clasificar → confirmar → generar lote/evento → consultar saldo.
   - **Diferencia vigente (P0-012, instrucción de diseño MVP 2026-10-10, D-33):** buscar entrega → pesar → revisar → confirmar recepción física; la calidad se evalúa durante la recepción o después del pesaje y es un estado separado («Pendiente de evaluación» sin dato). Generar lote y consultar saldo llegan con P0-016/P0-017. El orden original se conserva arriba como referencia.
4. Proceso: seleccionar inputs disponibles → registrar transformación/merma → cerrar una vez → ver outputs y grafo.
5. EUDR: revisar evaluación → ver causa/soporte → asignar mitigación → aportar → verificar → reevaluar → preparar paquete.
6. Exportación: reservar lote → revisar preflight → resolver faltantes → despachar → compartir información autorizada.
7. Auditoría: buscar lote → abrir evento → reconstruir versiones/evidencia/responsables → exportar hallazgo dentro de alcance.

## My Work

Fila: tipo de tarea, entidad, problema/impacto, responsable, plazo, prioridad, estado y acción contextual. Cola personal y supervisión separadas; filtros reales `assignee/status`. Acción completa el trabajo en su dominio y la fila deja de ser pendiente. Evitar checkbox local que no verifica mitigación ni aprueba DD.

## Criterios UI

Mobile en poca conectividad; botones/inputs con etiquetas; color acompañado de texto; cantidades y unidades legibles; guardar borrador antes de navegación; error conserva datos; foco y teclado; enlace seguro; confirmación de operación crítica con efecto claro. No llenar dashboards de cifras ficticias: placeholders de diseño deben estar etiquetados hasta conectar queries reales.
