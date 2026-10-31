# P0-027 — Web por rol y Lot Hub: auditoría, cambios y contraste de criterios (2026-10-12)

Fuentes: backlog P0-027, RF-27, QA-14, `docs/UX_UI.md` §6 (navegación), §7 (roles), §9 (estados), §11 (Mi trabajo),
§15.1 (Lot Hub); matriz RBAC `apps/api/src/authz/catalog.ts`. Validación local; no acredita producción.

## Auditoría inicial (qué existía y qué faltaba)

| Aspecto | Antes | Brecha |
| --- | --- | --- |
| Menú por permisos | `lib/workspace.tsx` deriva el menú de permisos efectivos y lo recarga en cada ruta | — (se conserva; sin otro sistema de permisos) |
| Contexto | organización activa, usuario y roles en la cabecera | — |
| Inicio | datos de la organización y «Próximas capacidades» | lista **desactualizada**: presentaba como pendientes módulos ya implementados; **sin tareas reales** (QA-14) |
| Lot Hub | resumen, operación, origen, historia | faltaban evidencias y riesgo/mitigación/expediente; entradas sin enlace; **fuga**: códigos de parcela de origen visibles para quien lee entregas pero no parcelas |
| Organización ajena por URL | inicio con 404 seguro | el resto de páginas quedaba **en blanco** |
| Filtros al volver | solo en estado local | se perdían al volver de un detalle |

## Cambios

- **Mi trabajo** (`GET /organizations/{orgId}/my-work`, `apps/api/src/work/my-work.ts`): tareas observables que el rol
  puede completar, contadas dentro del alcance con que su módulo las muestra (organización o asignados): borradores de
  entrega, entregas sin recepción, resultados de calidad sin decisión, posibles duplicados, parcelas sin ubicación (sin
  punto ni polígono vigente; la superficie declarada no la resuelve), mitigaciones asignadas y por verificar (sin las enviadas por uno mismo). Sin recursos ocultos; la tarea
  desaparece al resolverse en el dominio. Organización suspendida: sin tareas de escritura.
- **Inicio**: sección «Mi trabajo» (carga, error con reintento, vacío) y lista de capacidades **realmente** ausentes
  (offline en la app móvil, embarques P0-029, portal comprador P1-001, «Mi finca» UX-D08, elevación de plataforma D-04),
  rotulada como no operativa.
- **Lot Hub**: secciones de Evidencias (por el origen visible: el contrato vincula evidencias a productores y parcelas) y de
  Riesgo y debida diligencia (evaluación, mitigaciones, expediente), cada una con su permiso, carga, error y vacío; enlaces
  a entrega, productor y parcela solo si son legibles. **Corregida la fuga**: el origen hacia atrás solo incluye parcelas
  dentro del alcance de lectura de parcelas; sin lectura de parcelas se dice «parcelas restringidas
  para tu rol» **por permiso**, sin distinguir recepciones con o sin parcelas ocultas (reapertura 2026-10-12).
- **Organización ajena**: el `Shell` responde «El recurso no está disponible» para cualquier página de una organización
  sin membresía activa (sin cargar datos).
- **Filtros en la URL** (`lib/url-filters.ts`) en entregas, productores, parcelas y mitigaciones.

## Contraste con los criterios originales

| Criterio (backlog / QA-14) | Estado | Evidencia |
| --- | --- | --- |
| Home/menú por permiso | Cumplido | matriz 22 combinaciones: menú = permisos efectivos (`docs/qa/web-por-rol/matriz.json`) |
| Hub y enlaces seguros | Cumplido | secciones por permiso; enlaces solo legibles; fuga corregida (`test/my-work.int-spec.ts`); otra organización «no disponible» |
| Estados loading/vacío/403/error separados | Cumplido | `estados.json` (carga, error con reintento, vacío, sin permiso, error aislado por sección); 404 de organización ajena |
| Formularios conservan datos | Cumplido (existente) | E2E `parcelas.spec.ts` (conflicto conserva borrador), importaciones y entregas conservan el formulario ante error |
| Acciones con efecto de dominio | Cumplido | acción real desde «Mi trabajo» que retira la tarea (navegador y API) |
| Sin métricas falsas | Cumplido | conteos del dominio dentro del alcance; ninguna cifra fija |
| Acción My Work sale al resolverse (QA-14) | Cumplido | registrar borrador y recibir entrega retiran su tarea; para parcelas, un punto o un polígono la retiran y la superficie declarada **no** (corregido en la reapertura) |
| Teclado | Cumplido | enlace de salto con foco visible y destino `#contenido` |

Con `npm run validate` aprobada sobre el commit, **P0-027 queda DONE_LOCAL**.

## Limitaciones que permanecen visibles

1. **Destino/embarques** del Lot Hub: no existe el módulo (P0-029); el hub lo indica y no simula salidas.
2. **Evidencias del lote**: el contrato las vincula a productores y parcelas (P0-019); el hub enlaza al origen visible.
3. **BUYER, PRODUCER y SUPER_ADMIN**: sin concesiones (P1-001), sin vínculo cuenta–productor (UX-D08) y sin elevación (D-04)
   no tienen acceso implícito; se muestran como limitaciones, no como accesos.
4. La revisión cubre las cuentas DEMO existentes; no se crearon cuentas nuevas. La denegación por rol dentro de la misma
   organización se probó en la Cooperativa (la única con lotes DEMO).
5. Las revisiones heredadas usaban conteos fijos del seed: se ajustaron a la presencia de los registros del seed, porque la
   DEMO incluye registros importados (P0-026) y capturas previas del emulador (P0-024).

## Reapertura (2026-10-12)

La evidencia inicial dio por resuelta «Parcelas sin ubicación» al registrar superficie declarada: la condición contaba
parcelas sin versión vigente. Corregido: la tarea cuenta parcelas activas sin versión **o** con versión vigente sin
geometría; título «Parcelas sin ubicación», acción «Capturar ubicación». El aviso de parcelas restringidas del Lot Hub y del
detalle de entrega pasó a depender solo del permiso. Pruebas y acción real en `docs/qa/EVIDENCIA_P0-027_2026-10-12.md`.
P0-027 vuelve a DONE_LOCAL solo con `npm run validate` aprobada sobre el commit de la corrección.
