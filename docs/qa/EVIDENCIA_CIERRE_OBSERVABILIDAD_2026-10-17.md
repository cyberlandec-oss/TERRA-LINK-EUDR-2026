# Evidencia — Cierre dirigido de observabilidad y fuentes de P1-005 (2026-10-17)

Quinta entrega agrupada. **No rehace la observabilidad ya demostrada**: corrige dos defectos concretos de la
anterior y prepara, en paralelo, las fuentes normativas.

| | |
| --- | --- |
| Candidato | **`eaefd1b`** |
| Validación | `2026-10-17T18-37-05` — **APROBADA** |
| Pruebas | **71 suites, 680** unitarias e integración · **72** E2E · 0 fallos |
| Respecto de `83f7d7a` | 677→**680** pruebas: las tres de alcance y revisión |
| Migraciones | **48**, sin cambios |
| Respaldo | **Ninguno**: sin migración, sin cambio criptográfico, sin intervención sobre datos |
| Ensayo de retorno | **No repetido** |
| Recorrido en despliegue | `e2e/review/observabilidad.mjs` **26/26** |

## 1. `document:read` no es alcance de organización

**El defecto era real.** El aviso contaba **todas** las versiones de la organización a quien tuviera
`document:read`. Ese permiso **no** da alcance de organización: lo acota el **titular** del documento, y
`DocumentsService.list()` lo aplica **fila a fila** con `producers.load()` / `plots.load()`.

Un **técnico de campo** tiene `document:read` pero solo `producer:read_assigned` y `plot:read_assigned`: ve los
documentos de **sus** productores asignados. El aviso le publicaba un total que **la lista le niega** — una vía
lateral para contar lo protegido.

### 1.1 Se podía calcular respetando el alcance, así que no hace falta `RESTRICTED`

El contrato admitía devolver `RESTRICTED` sin valor si el agregado no se podía calcular con alcance. **Sí se
puede**: el alcance depende de `assigned_membership_id` del productor titular, que es una columna, de modo que
el recuento usa **el mismo predicado `inScope`** de esos servicios, en una sola consulta:

| Titular | Visible cuando |
| --- | --- |
| `producer` | `producer:read` **o** (`producer:read_assigned` **y** el productor está asignado a esa membresía) |
| `plot` | `plot:read` **o** (`plot:read_assigned` **y** el productor de la parcela está asignado a esa membresía) |
| `delivery` | **Nunca**: `entityScope` responde `ENTITY_TYPE_NOT_AVAILABLE`, así que tampoco se cuenta |

`RESTRICTED` se conserva para el caso que sí lo exige: **no tener `document:read`**.

Quien no tiene alcance completo lo **ve declarado** —«… dentro de tu alcance»—, para que su recuento no se lea
como total de la organización. **Administrador y auditor conservan el total**, que es su alcance real.

### 1.2 Demostrado con dos técnicos de la misma organización

`operations-alerts.int-spec.ts` (**12**, antes 10). Dos técnicos, asignaciones distintas, y un documento
pendiente cuyo titular está asignado **solo al primero**:

| Quién | Recuento | Qué prueba |
| --- | --- | --- |
| Técnico **1** (titular asignado a él) | `base + 1`, pasa a **FIRING** | **Control**: el documento existe y se cuenta de verdad |
| Técnico **2** (misma organización, otra asignación) | **`base`, sin cambio** | Añadir un documento fuera de su alcance **no altera su recuento ni su estado** |
| **Administrador** | `base + 1` | Su alcance **sí** es de organización |
| **Auditor** | **idéntico al administrador** | Conserva el total porque su permiso es de organización |

La prueba **discrimina**: contra el código anterior, el técnico 2 habría visto `base + 1` y habría fallado. Se
comprueba además que su recuento **no supera** lo que la **lista de documentos** le deja ver: misma
autorización, no una regla paralela.

**En el despliegue** el caso confirma la **redacción y la cota**, no la discriminación: la organización DEMO no
tiene documentos pendientes y los dos recuentos son `0`. Queda dicho en el propio recorrido, para que `26/26`
no se lea como más de lo que es.

## 2. `/version` identifica el código desplegado

Antes devolvía `commit: null`. Ahora la revisión se **inyecta en el artefacto**:

| | |
| --- | --- |
| Cómo entra | `ARG APP_COMMIT` en el `Dockerfile`, pasado por `docker-compose` |
| De dónde sale | `git rev-parse --short HEAD` **en el momento de construir** (`scripts/desplegar.mjs`) |
| Si el árbol está sucio | Se marca **`+sucio`**: lo desplegado **no es** ese commit exacto |
| Si no se inyectó | `commit: null`, `commit_source: NOT_INJECTED` — **declarado**, nunca inventado |
| Del cliente | **Nunca**: una cabecera `X-App-Commit` no la cambia |

**No es una etiqueta manual.** Una escrita en `.env` o en el compose se queda vieja en cuanto alguien
reconstruye sin tocarla, y entonces `/version` miente. Aquí el valor se calcula al construir y **se comprueba
después**: el propio script contrasta `/version` con lo que acaba de construir, y el recorrido de revisión lo
contrasta con `git HEAD`.

Comprobado en el despliegue: `commit=eaefd1b+sucio (BUILD_ARG)`, **correspondiente al candidato `eaefd1b`**. El
`+sucio` es correcto y deliberado: esta evidencia y las fuentes normativas se escribieron **después** de
congelar el candidato, y el marcador lo dice en vez de fingir un árbol limpio.

**Las trazas no se tocaron**: mismo anillo en memoria, misma capacidad **200**, mismo límite documentado —se
pierden al reiniciar y el worker tiene el suyo—. No se añadió ningún componente por esta corrección.

## 3. Fuentes para P1-005

**Criterio adoptado**: fuentes oficiales como base y **reconstrucción trazable** de sus modificaciones. Las
consolidaciones comerciales solo como **auxiliares identificadas**, sin contratar nada.

### 3.1 Obtenido

| Cuerpo legal | Publicación | Procedencia | Verificación |
| --- | --- | --- | --- |
| **Ley Orgánica de Tierras Rurales y Territorios Ancestrales** | RO **Suplemento 711**, 14-mar-2016 | **Ficha oficial** de la Asamblea → enlace «Descarga aquí» | Cabecera del documento: «SUPLEMENTO · Año III · Nº 711 · Quito, lunes 14 de marzo de 2016» |
| **Código Orgánico del Ambiente** | RO **Suplemento 983**, 12-abr-2017 | Repositorio de la Asamblea | Cabecera: «SUPLEMENTO · Año IV · Nº 983 · Quito, miércoles 12 de abril de 2017» |

Con URL, fecha de consulta y **sha256**. Es la **ley promulgada**, no un proyecto ni una noticia: la ficha
oficial y la cabecera del Registro Oficial coinciden.

### 3.2 Una corrección de la entrega anterior

El manifiesto del 2026-10-17 afirmó que el PDF del COA **no tenía capa de texto** y que su contenido **no se
había verificado**. **Las dos cosas eran incorrectas.** La comprobación contaba marcas `ToUnicode`, que ese
archivo no usa, y de ahí se concluyó de más. Extraído con `pdftotext`, el documento **es legible**, y su
cabecera confirma exactamente la publicación que se le atribuía. Queda corregido en el manifiesto.

**Originales intactos; extracciones como documento derivado**, con su propia huella y la advertencia de que la
extracción `-layout` **entrelaza las dos columnas** del Registro Oficial y **no se puede citar**. Cada artículo
de la matriz se leyó en orden de lectura y se contrastó contra el PDF.

### 3.3 Matriz revisable

`docs/decisiones/P1-005-MATRIZ-OBLIGACIONES.md`: **siete obligaciones candidatas** con artículo, aplicabilidad
**condicional**, evidencia que exigiría y validación pendiente. Cuatro leídas y contrastadas en la LOTRTA
—función social (Art. 11), **no ampliar la frontera agrícola en ecosistemas frágiles** (Art. 13), Registro de
Tierra Rural (Art. 42) y posesión ancestral (Arts. 77–78)—; tres candidatas en el COA, con el barrido de
patrimonio forestal **declarado como pendiente**.

**La aplicabilidad es condicional a propósito**: el Art. 13 solo importa si la parcela contiene o colinda con
un ecosistema frágil, y los Arts. 77–78 solo si está en territorio ancestral. **No se convierte ningún
documento encontrado en requisito universal para todo productor.**

### 3.4 Lagunas declaradas

**Una búsqueda sin resultados no acredita que no existan reformas.** Se localizaron dos —**2.º Suplemento del
RO 29, de 25-mar-2022** (que las referencias atribuyen al **Reglamento**, no necesariamente a la ley) y
**Suplemento del RO 309, de 21-ago-2018**— y **ninguna se pudo recuperar** de la edición oficial: el archivo
del Registro Oficial navega por JavaScript y sirve los PDF tras identificadores opacos. Mientras no se
recuperen, **no se sabe** si los artículos siguen en su redacción original, y **ninguna fila puede convertirse
en regla**.

Sin fuente todavía: laboral, penal ambiental, tributario, aduanero y anticorrupción. **Su ausencia no significa
que no existan obligaciones**: significa que no se han buscado.

**Nada se aprobó**: sin perfil jurídico, sin tocar compuertas, `UNDETERMINED` intacto y satélite deshabilitado.

## 4. Contraste de los criterios

| Requisito | Estado |
| --- | --- |
| **RNF-13** | **Sigue demostrado**, y ahora `/version` **identifica el código desplegado**, que era su parte floja |
| **RNF-10** | **Sigue demostrado** |
| **RNF-01** | **Sigue demostrado**, y **reforzado**: el agregado ya no excede el alcance de quien pregunta |

**Sin cambio en las cifras**: **31/60 = 51,7 %** del catálogo y **30/44 = 68,2 %** del MVP. Esta entrega
**corrige** requisitos ya contados; no añade ninguno. **La recopilación normativa no sube el numerador**:
P1-005 sigue abierta, y RNF-05 y RNF-06 siguen pendientes porque TECH-001 no ha acordado objetivos.

## 5. Medición de la quinta entrega agrupada

| | Primera | Segunda | Tercera | Cuarta | **Quinta** |
| --- | --- | --- | --- | --- | --- |
| Validaciones completas | 2 | 2 | 1 | 1 | **1** |
| Despliegues | 1 | 1 | 1 | 1 | **1** |
| Respaldos | 1 | 1 | 0 | 0 | **0** |
| Commits de resultados | 1 | 1 | 1 | 1 | **1** |

**Tercera entrega seguida sin repeticiones.** Las dos correcciones de esta entrega salieron de una **revisión
externa**, no de las pruebas: las suites estaban verdes con el defecto de alcance dentro. Es el mismo patrón
que `8f54b71` —una validación verde no acredita el contrato— y la razón por la que la comprobación dirigida y
la revisión siguen haciendo falta además de la validación.
