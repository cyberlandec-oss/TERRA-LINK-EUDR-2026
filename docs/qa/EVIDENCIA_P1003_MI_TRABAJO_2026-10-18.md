# Evidencia — P1-003 «Mi trabajo» ampliado (2026-10-18)

**Validación**: `npm run validate` **APROBADA** sobre `d2b8c85` — 74 suites, **757** pruebas, **72** E2E, 0 fallos
(`validation-results/2026-10-18T02-07-33-137Z`). **Despliegue**: `/version` → `d2b8c85` (`BUILD_ARG`), esquema
`0049`. **Sin migración**: la historia no toca el esquema ni los datos, así que no procede respaldo.

## 1. Qué recorrido nuevo completa una persona

Antes, la portada mostraba **grupos de tareas con un recuento** y hasta cinco ejemplos. Ahora una persona
abre su organización y:

1. ve **dos colas separadas** —«Cola personal» y «Supervisión»— con su recuento;
2. ve **cada tarea como una fila** con prioridad **y su motivo**, entidad, problema, impacto, responsable,
   plazo, estado, evidencia requerida y la acción que la resuelve;
3. **filtra** por cola, responsable y estado; el filtro viaja en la URL, así que **abrir una tarea y volver
   devuelve la misma vista filtrada**;
4. **resuelve la tarea en su dominio** —por ejemplo capturando la ubicación de una parcela— y **la fila
   desaparece**, porque la cola se deriva del dominio y no de una marca.

## 2. Criterios originales y cómo se cubren

| Criterio (referencia exacta) | Cómo se cumple | Evidencia |
| --- | --- | --- |
| **RF-34** (`docs/03:50`): «My Work con tareas reales de dominios operativos» | Siete tipos derivados de consultas al dominio; ninguna tabla de tareas propia | `my-work.ts` · `my-work.int-spec.ts` |
| **RF-34**: «Cerrar por **acción real**» | No existe endpoint de escritura: `POST`/`PATCH` → **404**. La fila sale cuando el caso de uso del dominio la resuelve | `mi-trabajo.mjs` («SOLO LECTURA», «LA ACCIÓN RESUELVE EL DOMINIO») · `my-work.int-spec.ts` |
| **RF-34**: «respetar **assignee/permisos**» | El alcance sale del permiso (`*:read` vs `*_assigned`); el responsable sale del dominio | `my-work.int-spec.ts` (alcance y «filtrar no amplía») |
| **P1-003** (`docs/18:204`): «**Cola personal/supervisión**» | `MINE` y `SUPERVISION`, con recuentos propios. La separación **la decide la autorización** | `mi-trabajo.mjs` («DOS COLAS») |
| **P1-003**: «**filtros reales**» | `queue`, `assignee`, `status` aplicados **en SQL**; `applied_in: BACKEND`; valor inválido → **400** | `mi-trabajo.mjs` («FILTROS», «FILTRO de cola», «FILTRO INVÁLIDO») · `my-work.int-spec.ts` |
| **P1-003**: «**acción resuelve dominio**» | Recorrido real en navegador: capturar ubicación retira la fila | `mi-trabajo.mjs`: `DEMO-PAR-003`, pendientes **3 → 2** |
| **docs/14 §My Work**: fila con «tipo, entidad, problema/impacto, responsable, plazo, prioridad, estado y acción contextual» | Los nueve campos presentes | `mi-trabajo.mjs` («FILA COMPLETA»: campos ausentes = ninguno) |
| **docs/14**: «Evitar checkbox local que no verifica mitigación ni aprueba DD» | No hay casilla ni escritura desde la cola | `mi-trabajo.mjs` («SOLO LECTURA») |
| **UX_UI §11**: «prioridad proviene de **regla explicable**» | Cada fila trae `priority_rule` | `my-work.spec.ts` (5) · `mi-trabajo.mjs` |
| **UX_UI §11**: «vuelve conservando filtros» | Los filtros viven en la URL | `mi-trabajo.mjs` («VOLVER conserva los filtros») |
| **UX_UI §11**: estados vacíos distintos | Cuatro: sin pendientes, sin coincidencias, cola personal vacía, supervisión vacía | `mi-trabajo.mjs` · `estados-web.mjs` |
| **QA-11**: «cola actualizada por **acción real**» y separación de funciones | El ciclo real de la mitigación mueve la fila: asignada → entregada → verificada | `mitigations.int-spec.ts` (caso P1-003/QA-11) |
| **QA-14**: vacío/error/carga, teclado, acción de My Work | Carga (`role=status`), error (`role=alert`) con reintento, vacío, teclado y 390 px | `estados-web.mjs` 6/6 · `web-por-rol.mjs` 22 combinaciones · `mi-trabajo.mjs` |

## 3. Lo que NO se inventó

**El plazo.** Solo existe donde el dominio lo registra: `mitigation_actions.due_date`. En las demás tareas es
`null`, `due_state` es `NONE` y la fila dice *«El dominio no registra plazo para esta tarea; no se inventa
uno.»* Un plazo inventado sería un dato falso con apariencia de compromiso. Comprobado: las **4** filas del
técnico lo declaran.

**El responsable.** Sale de `producers.assigned_membership_id` o de `mitigation_actions.assignee_membership_id`.
Donde no hay, la fila dice que no hay, y no se atribuye a quien mira.

**La prioridad.** No hay puntuación oculta: el plazo vencido o próximo manda, y si no hay plazo decide el tipo
de tarea, **diciendo cuál es el motivo en la propia fila**.

## 4. Separación de funciones, en la cola (QA-11)

| Momento | Cola del ejecutor | Cola de quien verifica |
| --- | --- | --- |
| Acción creada y asignada | **Personal**, `OPEN`, con su plazo real | — (nada que verificar) |
| Aporta un soporte | **Sigue personal**: adjuntar no es haber terminado | — |
| La entrega | **Sale** de su cola | **Supervisión**, `SUBMITTED` |
| Verificada | — | **Sale** |

Y quien entregó **no** encuentra su propia acción para verificar, **ni filtrando** por `queue=SUPERVISION` o
`status=SUBMITTED`.

## 5. Filtrar no amplía el alcance

La comprobación decisiva: el técnico pide la cola **de otra membresía** y recibe **0 filas**, no la de esa
persona; y en **ninguna** consulta suya —sin filtro, por supervisión, por responsable ajeno o por estado—
aparece un recurso de un productor que no tiene asignado. El control autorizado está en la misma ejecución:
ambas cuentas reciben filas sin filtro, así que un `0` significa «nada», no «el servicio no responde».

## 6. Resultados de las comprobaciones

| Comprobación | Resultado |
| --- | --- |
| `my-work.int-spec.ts` | **11/11** (6 regresiones de P0-027 + 5 nuevas de P1-003) |
| `my-work.spec.ts` (regla de prioridad) | **5/5** |
| `mitigations.int-spec.ts` | **6/6**, con el caso QA-11 de cola |
| `node e2e/review/mi-trabajo.mjs` | **17/17** sobre el despliegue |
| `node e2e/review/estados-web.mjs` | **6/6** (regresión: cambió el DOM de la sección) |
| `node e2e/review/web-por-rol.mjs` | **APROBADO**, 22 combinaciones (regresión por el mismo motivo) |

## 7. Límites, dichos

- **`web-por-rol.mjs` y `estados-web.mjs` se actualizaron** porque la sección pasó de lista a tabla. Se
  conservó lo que comprobaban; en `web-por-rol` la comparación UI↔API ahora es contra `rows` —una fila por
  tarea concreta— en vez de contra `tasks` —una por grupo—.
- **`mi-trabajo.mjs` cambia datos DEMO en un solo punto**: el caso 7 captura una ubicación **simulada por el
  navegador de la prueba** para demostrar que la fila sale al resolver el dominio. Queda una versión de
  geometría real, igual que si la hubiera capturado una persona.
- **Lo que esta historia no incluye**: indicadores con numerador/denominador y actividad reciente, que
  `UX_UI §11` describe para el «centro de operaciones». **No son criterio de P1-003** (`docs/18:204` pide cola,
  filtros, acción y QA-11/14) y no se usan como condición de cierre ni se dan por hechos.
- Las compuertas no se tocan: `UNDETERMINED`, READY, despacho y llamadas satelitales siguen como estaban.

---

## Adenda — corrección del filtro de cola (2026-10-18)

**Señalado en revisión**: en el fragmento compartido, las consultas aplicaban `LIMIT 50` por tipo y **después**
se filtraba `MINE`/`SUPERVISION` **en memoria**.

**Confirmado, y era un defecto real**, con dos consecuencias más de las señaladas:

1. Con más de 50 tareas autorizadas y las personales situadas **después** del primer bloque, `?queue=MINE`
   devolvía **vacío**.
2. `queues.mine` y `queues.supervision` se contaban sobre **las filas devueltas**, así que un recorte los
   dejaba por debajo del trabajo real.
3. `truncated` solo se calculaba **sin filtros**: un resultado filtrado y recortado parecía completo.

**Reproducido antes de corregir**, con un caso discriminante: 55 parcelas de un productor sin responsable
—que ordenan antes— y 2 de un productor asignado a quien consulta —que ordenan después—. `total` devolvía
**50**, y la cola personal no aparecía.

**Corrección**: el filtro de cola se expresa **en SQL** (`(responsable = yo) IS TRUE` / `IS NOT TRUE`, para que
un responsable nulo caiga del lado de supervisión y no desaparezca por lógica ternaria), y los recuentos salen
de la base con **agregados de ventana**, que se calculan **antes** del tope. La respuesta distingue ahora
`total` (lo que coincide de verdad), `shown` (lo devuelto) y `truncated`; la pantalla lo dice: «se muestran *n*
de *N*».

**Comprobado**: `my-work.int-spec.ts` **12/12**, con el caso discriminante entre ellas. La corrección se
integró en el candidato de **P1-004** (`84e1322`, **APROBADA**, 768 pruebas), **sin entrega separada**.
