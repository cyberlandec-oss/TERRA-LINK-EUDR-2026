# Evidencia — P1-015 «Límites y consumo» (2026-10-18)

> **Parcialmente superada el 2026-10-20**: «coste» y «SSO» pasaron a estar demostrados en local con D-54 adoptada (ver `EVIDENCIA_P1015_COSTE_SSO_IDIOMAS_2026-10-20.md`). Lo escrito abajo es el estado de entonces, conservado.

**Validación**: `npm run validate` **APROBADA** sobre `2197b9e` — **891** pruebas, **72** E2E, 0 fallos
(`validation-results/2026-10-18T23-42-51-172Z`). **Despliegue**: `/version` → `2197b9e`, esquema **`0054`**.
**Respaldo** hecho y **verificado por restauración aislada** (§10).

## 1. Contraste literal de los criterios originales

| Criterio (referencia exacta) | Qué exige | Estado |
| --- | --- | --- |
| **RF-46** (`docs/03:62`), tabla «Requisitos de evolución», columna **Restricción**: «**Español primero** y **decisiones de coste**» | Que el español no se degrade, y que el coste se **decida** | **Español: CUMPLIDO** y comprobado. **Coste: la decisión queda planteada (D-54), no tomada** |
| **P1-015** (`docs/18:216`), **Aceptación mínima**: «**ADR por componente**» | Un ADR por cada componente de la capacidad | **CUMPLIDO**: **ADR-0007** multilenguaje, **ADR-0008** acceso federado, **ADR-0009** consumo/límites/coste |
| **P1-015**: «**español conservado**» | Comprobable | **CUMPLIDO**: idioma declarado `es`, único disponible, y **ninguna clave de traducción** a la vista |
| **P1-015**: «**límites** … comprobados» | Que existan y se verifiquen | **CUMPLIDO**: 10 límites publicados con procedencia y efecto, y **comprobados superando uno de verdad** |
| **P1-015**: «**coste** … comprobado» | Un coste que verificar | **NO CUMPLIDO**: **no hay tarifa acordada ni proveedor contratado**. Sin coste no hay nada que comprobar |
| **P1-015**: «**SSO** comprobado» | Acceso federado funcionando | **NO CUMPLIDO**: no hay proveedor de identidad elegido (ya lo decía **ADR-0005**) |
| **P1-015**, dependencia: «TECH-001 y **piloto**» | Un piloto | **NO DISPONIBLE**: no existe piloto con usuarios reales |

**RF-46 queda PARCIAL.** Su condición sale de los **criterios literales** —«coste … y SSO comprobados», más la
dependencia «piloto»—, **no de una interpretación añadida**. No se cuenta como demostrado.

## 2. Qué se entregó

**Los límites ya existían en el producto**; lo que faltaba era **poder comprobarlos**.
`GET /organizations/:orgId/limits` publica **10**, cada uno con: qué limita, valor y unidad, **de dónde sale**
—variable de entorno o constante del código—, **dónde se aplica** y **qué responde el producto al superarlo**.

**No se fija ningún límite nuevo** y **no se inventa ninguna tarifa**. Los valores se leen de la configuración
vigente: si alguien cambia uno por entorno, la respuesta muestra el valor cambiado. **Publicar no es decidir.**

Junto a ellos, el **consumo observado** de la organización —documentos, versiones, bytes frente a la cuota,
parcelas, entregas y eventos—, con consultas reales y **denominador explícito**.

## 3. El límite publicado es el que se aplica

No se cree: **se comprueba**. La prueba y la revisión leen `DOCUMENT_MAX_BYTES` de la respuesta, suben un
archivo **de un byte más** y verifican que el producto responde **422 `FILE_TOO_LARGE`** —exactamente lo que
el campo `on_exceed` anunciaba—. Una lista escrita a mano no habría podido demostrar eso.

## 4. Lo que el producto NO insinúa

- **El consumo no es un coste**: no hay tarifa acordada ni proveedor contratado, y se dice en cada lectura.
  Comprobado que **ninguna cifra** del consumo lleva moneda ni se llama importe, precio o tarifa.
- **No hay SSO**: la autenticación es local y la respuesta lo declara. No se insinúa un acceso federado que no
  existe.
- **No hay segunda lengua**: `language.available` es `['es']`, y se explica que añadir otra **no podrá
  degradar el español** —ese es el límite que fija RF-46—.

## 5. Español conservado, comprobado

El idioma declarado es `es`, es el único disponible, y los textos que el producto publica **están en español**
y **no son claves de traducción** (`errors.document.too_large` y similares). La comprobación mira los textos
reales de la respuesta, no una bandera.

**Lo que esto NO demuestra**: soporte multilingüe. No existe y no se afirma. **ADR-0007** fija que, cuando se
añada, el **español será la fuente** y el mecanismo de reserva caerá al español, nunca a la clave.

## 6. Permisos y aislamiento

Leer límites y consumo exige **pertenecer a la organización** (`organization:read`). Otra organización es
**404 opaco** en ambos sentidos, y el consumo de una **no incluye nada** de la otra. La superficie es de
**solo lectura**: `POST` y `PATCH` responden **404**.

## 7. Decisiones abiertas (D-54, **propuestas**)

Unidad de coste, proveedor de acceso federado, alcance multilenguaje y qué pasa al llegar a un límite.
**Ninguna adoptada** y **ninguna implementada por adelantado**: no hay i18n instalado «por si acaso», no hay
integración OIDC sin proveedor, y no se fijó ninguna tarifa.

## 8. Resultados

| Comprobación | Resultado |
| --- | --- |
| `limits.int-spec.ts` | **7/7** |
| `node e2e/review/limites.mjs` | **16/16** sobre el despliegue |
| `extraction.spec.ts` (con las pruebas de límites del motor) | **20/20** |
| `extraction.int-spec.ts` | **15/15** |
| `node e2e/review/extraccion.mjs` (regresión de P1-013) | **18/18** |
| `node e2e/review/estados-web.mjs` · `web-por-rol.mjs` | **APROBADOS** |
| `npm run validate` sobre `2197b9e` | **APROBADA**: 891 pruebas, 72 E2E, 0 fallos |
| `node e2e/review/limites.mjs` sobre el despliegue de `2197b9e` | **16/16** |
| Respaldo verificado por restauración aislada | **0 errores**, **130 tablas con conteos EXACTOS idénticos** |

## 9. Lo que va en este mismo candidato, y por qué

La comprobación dirigida del extractor (P1-013) destapó **cuatro defectos**. Se corrigieron **aquí**, con su
regresión, en vez de abrir una entrega aparte: un defecto encontrado al revisar se arregla en el candidato
siguiente. El detalle está en `docs/qa/EVIDENCIA_P1013_EXTRACCION_2026-10-18.md` §13.

**Tres clases de evidencia, que no se mezclan:**

| Clase | Qué es | Qué vale |
| --- | --- | --- |
| **Sintética propia** | PDF que genera el propio autor de las pruebas | Prueba la **lógica**, no la compatibilidad |
| **Compatibilidad técnica demostrada** | PDF de una **herramienta independiente** (Chromium) | Prueba que el motor **detecta y declara** lo que no sabe leer. **Un** generador, no todos |
| **Aceptación con documentos reales** | Documentos de una organización real | **No existe**: no hay piloto |

## 10. Respaldo, y una corrección del procedimiento de verificación

Hay migración (**0054**, del arreglo del extractor), así que corresponde:
`_respaldos/2026-10-18-p1015-migracion-0054/`, capturado con **la aplicación detenida** y verificado por
**restauración aislada**, esperando al **arranque definitivo** del contenedor.

| Comprobación | Resultado |
| --- | --- |
| Restauración aislada | **0 errores** |
| Migraciones | **54**, la última `0054_p1013_texto_no_interpretable` |
| **Conteos EXACTOS por tabla** | **130 tablas, todas idénticas** |
| Restricciones | **339** FK, **435** CHECK, **209** UNIQUE |
| Objetos del esquema | **500**, igual que el origen |
| El estado nuevo existe en la copia | `TEXTO_NO_INTERPRETABLE` admitido por el CHECK restaurado |
| Append-only en la copia | un `DELETE` sobre `document_extractions` **es rechazado** |

**Corrección del procedimiento.** Las verificaciones anteriores comparaban `n_live_tup` de
`pg_stat_user_tables`, que es una **estimación del recolector de estadísticas**, no un conteo. Aquí dio una
falsa diferencia —`audit_logs` 1626 frente a 1625— que resultó ser **solo** eso: el conteo **exacto** del
origen era 1625, idéntico al de la copia. A partir de ahora la comparación usa **`count(*)` por tabla** en
ambos lados, y el fichero `conteos-exactos.txt` queda guardado junto al respaldo.

Es el segundo ajuste del procedimiento que se deja escrito, después del contenedor que aún estaba en su fase
de inicio (P1-010): **verificar mal es tan peligroso como no verificar**, porque da confianza sin sustento.


## 11. Rectificación de los tres respaldos verificados con estimaciones (2026-10-19)

**Afectados, exactamente tres**: `2026-10-18-p1010-migracion-0051`, `2026-10-18-p1012-migracion-0052` y
`2026-10-18-p1013-migracion-0053`. Sus informes originales **se conservan intactos**; dentro de cada carpeta
se añadió `RECTIFICACION-VERIFICACION-2026-10-19.md` y `conteos-exactos-restaurado.txt`.

**No se restauró sobre desarrollo y no se borró ningún respaldo.**

| Respaldo | Errores | Migraciones | Tablas (con datos) | Filas exactas | Objetos | Append-only en la copia |
| --- | --- | --- | --- | --- | --- | --- |
| 0051 (P1-010) | **0** | 51 | 125 (95) | **10 661** | 476 | **rechazado** |
| 0052 (P1-012) | **0** | 52 | 127 (97) | **11 077** | 487 | **rechazado** |
| 0053 (P1-013) | **0** | 53 | 130 (100) | **12 057** | 500 | **rechazado** |

**Qué acredita**: los tres **se restauran sin errores** —y como `pg_restore` aplica las restricciones después
de los datos, eso implica que **claves ajenas y CHECK se cumplen** sobre el contenido restaurado—, el esquema
y los disparadores llegan completos, el **append-only sigue aplicándose** y se conoce el **número exacto de
filas** de cada tabla.

**Qué NO acredita**: que el contenido coincida **fila a fila con el origen en el instante de la captura**. En
aquel momento **no se guardó un recuento exacto del origen**, y compararlo ahora contra la base de desarrollo
**sería falso**: esa base ha seguido cambiando. Una restauración correcta demuestra **recuperabilidad y
contenido restaurado**; **no permite reconstruir una comparación que nunca se capturó**.

**Dos falsos negativos de la propia herramienta de reverificación**, corregidos y dejados por escrito: un
**retorno de carro** que rompía el nombre de tabla, y **`pipefail`** invalidando la comprobación porque `psql`
devuelve error **precisamente cuando el rechazo funciona**. Ambos daban «append-only NO aplicado» sobre
copias donde **sí** se aplicaba. Es la tercera lección del mismo tipo: **una verificación que falla en
silencio es peor que no tenerla**.
