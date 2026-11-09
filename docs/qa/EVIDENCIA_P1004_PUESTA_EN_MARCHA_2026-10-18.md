# Evidencia — P1-004 «Puesta en marcha y madurez 0–6» (2026-10-18)

**Validación**: `npm run validate` **APROBADA** sobre `84e1322` — 75 suites, **768** pruebas, **72** E2E, 0
fallos (`validation-results/2026-10-18T03-29-27-116Z`). **Despliegue**: `/version` → `84e1322` (`BUILD_ARG`),
esquema `0049`. **Sin migración**: el diagnóstico se deriva del dato existente, así que no procede respaldo.

## 1. Lo primero, porque condiciona todo: la fuente no fija umbrales

**S3 §16** («Digital Maturity Engine») nombra los siete niveles —*No digitalizado, Registros manuales,
Excel/formularios, Trazabilidad digital, Trazabilidad + riesgo, EUDR operacional, Inteligencia comercial*—
precedidos de un **«Por ejemplo»**, apoyándose en la progresión de la guía ecuatoriana (papel → Excel →
formularios digitales → sistema interno → software especializado). **No fija ningún umbral, porcentaje ni
condición de paso de nivel**, y ninguna otra fuente lo hace.

Por tanto, **la correspondencia señal→nivel es una decisión de producto**, y así se entrega: **D-49,
versionada, en estado PROPUESTA y visible en la propia respuesta de la API**, no disfrazada de exigencia de la
fuente. Lo que sí es de la fuente son **los nombres**, que se usan literalmente.

**El único umbral es la presencia** —«existe al menos un registro»—, y la respuesta lo dice: *cualquier cifra
mayor sería inventada*. Comprobado en el despliegue: **ninguna cifra de porcentaje y ningún campo de avance**
en toda la respuesta.

## 2. Qué recorrido nuevo completa una persona

1. Abre **«Puesta en marcha»** desde el menú y ve **su nivel y el fundamento** de ese nivel.
2. Ve **los siete niveles**, cada uno con sus **señales**, y cada señal con **número, alcance, fecha y fuente**.
3. Ve **qué falta y de qué clase es**: un dato por cargar, una capacidad que no existe, o una decisión que
   nadie ha tomado.
4. Abre **el paso pendiente** desde el asistente, **lo completa en su módulo** y, al volver, **el resultado
   está actualizado**.

Demostrado en el despliegue con «DEMO · Acopio San Isidro»: paso **CENTROS PENDIENTE → HECHO** («1 ubicación(es)
activa(s)»), recorrido desde el propio asistente.

## 3. Criterios originales y cómo se cubren

| Criterio (referencia exacta) | Cómo se cumple | Evidencia |
| --- | --- | --- |
| **RF-35** (`docs/03:51`): «Wizard de onboarding y diagnóstico de madurez 0–6» | Asistente de 8 pasos (UX_UI §10.4) y diagnóstico de los 7 niveles de S3 §16 | `onboarding.ts` · `puesta-en-marcha.mjs` 18/18 |
| **RF-35**: «**Madurez ≠ conformidad legal**» | El aviso encabeza la pantalla, no es nota al pie; y de hecho no toca nada: nivel 4 con **2 lotes evaluados, todos `UNDETERMINED`** | `onboarding.int-spec.ts` · `puesta-en-marcha.mjs` («NO LEVANTA COMPUERTAS») |
| **P1-004** (`docs/18:205`): «**Wizard**» | Organización → equipo → productos → centros → productores → parcelas → importación (**opcional**) → revisión | `puesta-en-marcha.mjs` · `onboarding.int-spec.ts` |
| **P1-004**: «**evidencia de nivel 0–6**» | Cada señal con `count`, `scope`, `as_of` y `source`. **8 señales observadas, todas con evidencia; 4 con fecha** | `puesta-en-marcha.mjs` («EVIDENCIA») |
| **P1-004**: «**tareas**» | Cada paso enlaza a su módulo real, con quién puede hacerlo. **Los 7 destinos abren**; ninguno es un 404 | `puesta-en-marcha.mjs` («ENLACES») · prueba que fija la lista |
| **P1-004**: «**madurez no conclusión jurídica**» | Igual que RF-35, y el perfil jurídico aparece como revisión pendiente que la madurez **no sustituye** | `onboarding.int-spec.ts` |
| **UX_UI §10.4**: «Mostrar pasos **pendientes reales**» | Derivados del dato; **no hay tabla de pasos completados** | `onboarding.int-spec.ts` (desactivar el producto devuelve el paso a PENDIENTE) |
| **UX_UI §10.4**: «permitir **retomar**» | No hace falta persistencia: el estado **es** el dato, así que retomar es volver a abrir | `freshness` en la respuesta |
| **UX_UI §10.4**: «**No impedir una operación válida** por un checklist» | Solo lectura (`POST`/`PATCH` → **404**); ningún paso bloquea nada | `puesta-en-marcha.mjs` («SOLO LECTURA») |
| **UX_UI §10.4**: «**ni crear módulos que no existen** para completar el wizard» | El nivel 6 se declara **capacidad no implementada** (P1-014); no se inventó analítica | `onboarding.int-spec.ts` |

## 4. Las tres clases de «lo que falta», que no se confunden

| Clase | Ejemplo real | Por qué importa |
| --- | --- | --- |
| **Dato por cargar** | `EXPEDIENTES`: nadie ha abierto un expediente | Lo resuelve la organización trabajando |
| **Capacidad no implementada** | `ANALITICA_COMERCIAL` (nivel 6, **P1-014**) | **No es un pendiente de la organización**: el producto no lo tiene |
| **Decisión pendiente** | `INSTANTANEA_READY`: READY depende de **D-05.B, D-07.5, D-07.6** y **P1-005** | No se arregla cargando datos; espera una decisión |

Comprobado: **1 dato, 1 capacidad y 1 decisión**, en listas separadas y **sin mezclarse**.

## 5. Lo que NO se afirma

**Una organización sin datos NO es «nivel 0».** Los niveles 0 a 2 —papel, registros manuales, Excel— ocurren
**fuera de Terra Link**, y el sistema **no puede distinguir** una organización no digitalizada de una que
todavía no ha cargado nada. Se devuelven como **NO_DETERMINABLES** y el nivel alcanzado es **ninguno**, no cero.
Comprobado con «DEMO · Acopio San Isidro».

## 6. Vigencia y procedencia

La adopción del catálogo de riesgo es **append-only**: `ADOPT` y `WITHDRAW` son **filas**, no un estado. Contar
los `ADOPT` daría por vigente una adopción ya retirada, así que solo cuenta aquella **cuya última decisión es
ADOPT**. Probado de extremo a extremo: adoptar sube al **nivel 4**; **retirar** la adopción lo devuelve al
**3**, y la evaluación ya hecha **sigue siendo un hecho observado** —retirar no reescribe el histórico, y las
dos filas (`ADOPT`, `WITHDRAW`) siguen ahí—.

El diagnóstico **se calcula al leerlo**: no hay marcas guardadas que puedan contradecir la realidad.

## 7. Permisos y alcance

El **estado** de cada señal es de la organización —la madurez es una propiedad suya—, pero **el número** se
acota a lo que quien lee puede ver, y **sin permiso no se entrega número**. Comprobado con el técnico:
`PRODUCTORES` llega con **alcance `ASIGNADOS` (5)** y la nota de que **no es el total**; `CATALOGO_DE_RIESGO`
llega **`RESTRINGIDO`, sin número**.

**El onboarding no concede acceso**: el paso *Equipo* le aparece como `RESTRINGIDO` **y sin enlace**, y la
organización ajena responde **404**.

## 8. Resultados

| Comprobación | Resultado |
| --- | --- |
| `onboarding.int-spec.ts` | **10/10** |
| `my-work.int-spec.ts` | **12/12** (incluye el caso discriminante del tope, §9) |
| `node e2e/review/puesta-en-marcha.mjs` | **18/18** sobre el despliegue |

## 9. Corrección de P1-003 integrada en este candidato

Señalada en revisión: **el filtro de cola se aplicaba en memoria, después del tope de 50 por tipo**. Con más de
50 tareas autorizadas y las personales situadas detrás, `?queue=MINE` devolvía **vacío**. Arrastraba dos
defectos más: `queues` se contaba sobre **las filas devueltas** y `truncated` solo se calculaba **sin filtros**.

**Reproducido primero** con un caso discriminante —55 parcelas ajenas que ordenan antes y 2 propias que ordenan
después—: `total` devolvía **50**. **Corregido**: el filtro va **en SQL**, y los recuentos salen de la base con
agregados de ventana, que se calculan **antes** del tope. Ahora `total` es el real, `shown` el devuelto y
`truncated` lo declara; la pantalla dice «se muestran *n* de *N*».

## 10. Límites, dichos

- **D-49(A) quedó ADOPTADA el 2026-10-18** como **regla provisional de producto**: diagnóstico por presencia de
  evidencias, con reglas explícitas y versionadas. **No** es un umbral derivado de la fuente ni una
  certificación de madurez, y no afecta a ninguna compuerta. **Precisión incorporada en la adopción**: unos
  umbrales cuantitativos **no serían «inventados»** si se acordaran y justificaran —la diferencia es que **las
  fuentes no los definen**—, y **la presencia también es una decisión de producto**, con esa etiqueta. Las
  opciones (B) y (C) siguen abiertas; ver `docs/22`.
- El texto que la API devuelve sobre el umbral se ajusta en el **siguiente candidato**, no en una entrega
  aparte: decía «cualquier cifra mayor sería inventada», que es más fuerte de lo correcto.
- **Indicadores y actividad reciente de `UX_UI §11`** siguen **sin implementar**; quedan **trazados** en
  `docs/22` sin reabrir P1-003 y sin declararse hechos.
- **`puesta-en-marcha.mjs` cambia datos DEMO durante el recorrido y los restituye**: crea un registro y lo
  **desactiva** al terminar, con motivo. El estado **operativo** queda como estaba (Acopio: 0 centros y 0
  productores activos); los registros inactivos **permanecen en el histórico**, porque aquí no se borra nada.
- Compuertas intactas: `UNDETERMINED`, READY, despacho y llamadas satelitales sin tocar.
