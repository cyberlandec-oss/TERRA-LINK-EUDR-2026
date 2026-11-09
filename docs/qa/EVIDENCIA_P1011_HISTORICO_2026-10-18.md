# Evidencia — P1-011 «Histórico temporal y alertas» (2026-10-18)

**Validación**: `npm run validate` **APROBADA** sobre `ca517e1` — **817** pruebas, **72** E2E, 0 fallos
(`validation-results/2026-10-18T17-09-10-317Z`). **Despliegue**: `/version` → `ca517e1` (`BUILD_ARG`), esquema
**`0051`** — **no hay migración nueva**: todo el histórico se deriva de tablas que ya existían, así que **no
corresponde respaldo**.

## 1. Qué piden los criterios originales, y qué se hizo con eso

| Criterio (referencia exacta) | Qué exige | Cómo se cumple |
| --- | --- | --- |
| **RF-42** (`docs/03:58`): «Versiones comparables; datos no disponibles **explícitos**» | Comparar versiones, y decir lo que falta | `GET …/plots/:id/timeline/compare` publica **las limitaciones antes del resultado**; lo ausente se rotula, no se rellena |
| **P1-011** (`docs/18:212`): «Comparar geometría/datasets/periodos **con limitaciones**; **no inferir** datos inexistentes» | Nada derivado de la nada | Ningún período se interpola; un año sin registros se declara `SIN_REGISTROS` |
| **S4 §20** (`docs/sources/S4:1161`): la alerta contiene **Problema → Impacto → Causa → Acción** | Cadena completa | Las cinco alertas llevan los cuatro campos y su `action_href` |
| **S4 §20** (`docs/sources/S4:285`): «Cada alerta debe llevar **directamente a la acción**» | Un clic hasta la acción | Comprobado en navegador y **por teclado** |
| `.claude/rules/00-domain.md`: «no sobrescribas … evidencia histórica» | El pasado no se reescribe | Una versión nueva **no altera** las entradas anteriores; dos lecturas dan lo mismo |

**El impacto se afirma solo sobre lo que el dato registrado puede o no sustentar.** No se afirma ninguna
consecuencia jurídica, ningún plazo y ninguna sanción; hay una prueba que lo exige explícitamente.

## 2. Lo que se reutilizó en vez de duplicar

Al implementarlo apareció que **`GET /plots/:id/history` ya existía**: es el **registro de cambios de la
ficha** (`plot_history`), con versión, campos cambiados, motivo y autor. Mi ruta nueva lo **ensombrecía** —el
controlador antiguo ganaba y mi manejador no se alcanzaba nunca—.

Se resolvió por el lado correcto: la ruta original **se deja intacta**, la línea temporal pasa a
`…/plots/:id/timeline`, y **esas mismas filas entran en la línea** como entradas `CAMBIO_DE_FICHA`. Así
«qué cambió y por qué» se lee en el mismo sitio que la evolución, **sin una segunda fuente de verdad**.
La respuesta enlaza al registro original (`change_log_href`) y lo dice (`reuse_note`).

Lo demás también es reutilización: `plot_versions`, `satellite_jobs`/`satellite_results`, `evidence` y las
evaluaciones de riesgo de los lotes que contienen la parcela. **No hay tabla nueva.**

## 3. Qué recorrido nuevo completa una persona

1. Abre **Histórico** y ve las **alertas** de su alcance, cada una con problema, impacto, causa y acción.
2. **Abre la acción** de una alerta y cae en la parcela o en la evidencia que la causa. La alerta **sigue
   ahí**: abrirla no la resuelve.
3. Elige una parcela y ve su **evolución por años**, con los años sin registros **rotulados**.
4. Lee cada hecho con **sus tres fechas separadas**, y la que falta **dicha**, no sustituida.
5. **Compara dos versiones**: primero las limitaciones, después el detalle.

## 4. Las tres fechas, separadas

`occurred_at` (cuándo pasó), `recorded_at` (cuándo se guardó) y `evaluated_at` (cuándo se evaluó) **no se
mezclan**. Donde el dominio no registra una, se publica `null` **y se explica por qué**, con el texto propio
de cada tipo de hecho:

- un cambio de ficha **solo tiene fecha de registro**;
- una versión de geometría **sin levantamiento declarado** lo dice;
- una evaluación **no tiene «fecha del hecho»**: evalúa el estado en un momento.

Comprobado que **ninguna entrada copia la fecha de registro en la del hecho**.

## 5. Comparar sin convertir una diferencia en un juicio

`comparar()` devuelve `comparable` y `limitations`. Hoy declara cinco: cambio de **dataset**, caída de
**cobertura**, **resultado sintético**, cambio de la **versión de las reglas de validación** y cambio del
**método de levantamiento**. Con cualquiera, `comparable: false` y la respuesta dice que **no es concluyente**.

La frase que importa está en el producto, no solo aquí: *una diferencia no se interpreta como mejora ni como
deterioro*. **Menos hallazgos con menos datos no es una mejora.** La revisión comprueba que esa advertencia
aparece y que **fuera de ella** no hay lenguaje de mejora ni de deterioro.

Comparar una versión **consigo misma** se rechaza con **422**: no se devuelve «sin cambios».

## 6. Alertas: derivadas, trazables y de solo lectura

Cinco códigos, todos derivados de un registro concreto que se cita por `kind` + `id`:
`ANALISIS_DE_GEOMETRIA_ANTERIOR`, `RESULTADO_SINTETICO`, `ANALISIS_SIN_RESULTADO`,
`GEOMETRIA_VIGENTE_SIN_ANALISIS`, `EVIDENCIA_FUERA_DE_VIGENCIA`.

- **Ningún umbral inventado**: comprobado que no aparecen porcentajes, días ni plazos. La única vigencia que
  se menciona es **la que la propia evidencia declara**, y se dice que **el plazo no lo fija Terra Link**.
- **Solo lectura**: no hay `POST`, `PATCH` ni `DELETE`; los tres intentos responden **404**, y la lectura
  posterior sigue en **200**. No se marcan, no se resuelven, no se descartan.
- **Leerlas no cambia nada**: comprobado por igualdad de filas del dominio antes y después.
- **Notificación interna únicamente**: no hay envío externo de ninguna clase.

## 7. Permisos y alcance

La autorización es del backend, por organización **y por recurso**:

- `plot:read` ve la organización; `plot:read_assigned` **solo sus parcelas** —lo ajeno es **404**, con el
  control autorizado de que el admin sí lo abre—;
- quien no lee satélite, riesgo o evidencia **no recibe esas entradas**, y la respuesta **declara la sección
  ausente** (`restricted_sections`): ausente por permiso **no es** ausente por falta de datos;
- quien no lee parcelas recibe el **motivo**, no una pantalla vacía, y la entrada **no aparece en el menú**.

## 8. Un defecto corregido antes de congelar

La pantalla leía `/plots` **como si fuera un array**, y la respuesta viene paginada (`{items, next_cursor}`).
El selector de parcelas no llegaba a dibujarse. Corregido leyendo `items` y —lo que faltaba de verdad—
**diciendo cuándo la lista está truncada**, con el enlace a Parcelas: aquí **no se afirma que estas sean todas**.

## 9. Lo que NO hace

- **No reconstruye períodos** ni rellena huecos con ceros.
- **No reescribe el pasado**: las entradas anteriores no cambian al registrar una versión nueva.
- **No inventa umbrales, caducidades ni plazos legales.**
- **No resuelve nada al leer**: ninguna alerta se cierra, ningún expediente cambia.
- **No levanta** `UNDETERMINED`, READY ni el despacho.

## 10. Resultados

| Comprobación | Resultado |
| --- | --- |
| `history.int-spec.ts` | **10/10** |
| `node e2e/review/historico.mjs` | **18/18** sobre el despliegue |
| `node e2e/review/estados-web.mjs` | **APROBADO** (regresión del menú) |
| `node e2e/review/web-por-rol.mjs` | **APROBADO** (22 combinaciones, 19 cuentas) |
| `npm run validate` sobre `ca517e1` | **APROBADA**: 817 pruebas, 72 E2E, 0 fallos |
| `node e2e/review/historico.mjs` sobre el despliegue de `ca517e1` | **18/18** |

**Límite de esta revisión**: el conjunto DEMO es todo de 2026, así que **no contiene ningún año vacío**. El
rótulo `SIN_REGISTROS` lo demuestra `history.int-spec.ts`, **no** la revisión en navegador, y el arnés lo dice
en vez de darlo por aprobado.
