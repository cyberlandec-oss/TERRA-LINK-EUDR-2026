# Evidencia — P1-013 «Extracción asistida de documentos» (2026-10-18)

**Validación**: `npm run validate` **APROBADA** sobre `09fb394` — **875** pruebas, **72** E2E, 0 fallos
(`validation-results/2026-10-18T22-16-47-717Z`). **Despliegue**: `/version` → `09fb394` (`BUILD_ARG`), esquema
**`0053`**. **Respaldo** hecho y **verificado por restauración aislada** (§9).

## 1. Contraste literal de los criterios originales

| Criterio (referencia exacta) | Qué exige | Estado |
| --- | --- | --- |
| **RF-44** (`docs/03:60`), tabla «Requisitos de evolución», columna **Restricción**: «**Revisión humana y evidencia de extracción**» | Que una persona decida, y que la extracción deje prueba | **CUMPLIDO**: sin decisión humana **no hay dato**; cada corrida guarda motor, versión del motor y **huella del contenido analizado**, y cada sugerencia su **fragmento literal y su posición** |
| **P1-013** (`docs/18:214`), **Aceptación mínima**: «campos sugeridos con **fuente/confianza** y **revisión**; **no decisión regulatoria automática**» | Fuente, confianza, revisión, y nada automático | **CUMPLIDO**: fuente = fragmento + posición; confianza = **la regla** que la produjo; revisión = permiso propio; y la extracción **no levanta ninguna compuerta** |
| **S1 §55** (`docs/sources/S1:1025`): «**Posteriormente**: OCR/IA, pero **no en la primera versión como dependencia crítica**» | Que nada dependa de esto | **CUMPLIDO**: ningún flujo del producto consulta la extracción; si falta o falla, todo sigue igual |
| `.claude/rules/00-domain.md`: «no inventes datos ausentes» | Ausencia explícita | **CUMPLIDO**: sin etiqueta ni patrón único **no se sugiere**; una fecha ambigua **no se normaliza** |

**Los cuatro están demostrados: RF-44 queda DEMOSTRADA y P1-013 DONE_LOCAL.**

## 2. Tres cosas distintas, en tres sitios distintos

1. **Texto extraído** (`document_extractions`): lo que el archivo dice, con motor, versión del motor y la
   **huella del contenido** —que se **recalcula** antes de leer, así que consta que se analizó *ese* archivo—.
2. **Valor sugerido** (`document_extraction_fields`): con el **fragmento literal**, su **posición** y la
   **regla** que lo propuso.
3. **Dato confirmado por una persona** (`document_extraction_decisions`): sin esta decisión, **no hay dato**.

Las tres tablas son **append-only**.

## 3. La «confianza» no es un número inventado

No hay modelo, ni puntuación, ni umbral. La confianza **es la regla**, y cualquiera puede comprobarla:

| Regla | Qué significa | Confianza |
| --- | --- | --- |
| `ETIQUETA_EXPLICITA` | el documento **rotula** el valor | **ALTA** |
| `PATRON_UNICO` | no hay rótulo, pero hay **exactamente un** candidato de esa forma | **MEDIA** |
| `PATRON_AMBIGUO` | hay **varios** o ninguno: **no se sugiere nada** y se listan | **BAJA** |

La pareja regla↔confianza está **impuesta por un CHECK** (`field_confidence_pairing`): no hay forma de
publicar ALTA sin rótulo. Y **ambiguo ⇒ sin valor** (`field_ambiguity_shape`).

**Lo que no se interpreta**: `03/04/2026` **no se decide** entre marzo y abril —queda como candidato sin
normalizar—; un año de dos cifras no se completa; una fecha imposible (`2026-02-30`) no se propone.

## 4. Nada sale de esta instalación — y una corrección sobre el OCR

Un PDF **con capa de texto** se lee **en local**, descomprimiendo sus propios flujos de contenido. Un PNG o un
PDF escaneado **no se leen**: se declaran `FORMATO_NO_SOPORTADO` o `SIN_TEXTO` **con su motivo**, y **no se
envían a ningún tercero**.

**Corrección (2026-10-18)**: una versión anterior de esta evidencia presentaba el OCR como si **exigiera** un
servicio externo. **Es falso.** Hay motores de OCR que se ejecutan **enteramente en local** —**Tesseract**,
por ejemplo, ofrece motor y programa de línea de comandos para imágenes
(<https://github.com/tesseract-ocr/tesseract>)—. Por tanto:

- **la ausencia de OCR aquí es una limitación del motor implementado**, no una consecuencia de no usar terceros;
- incorporar OCR **no obligaría** a enviar documentos fuera: podría instalarse en local;
- **no se incorpora ahora**, y esta entrega no lo prejuzga. Lo que sigue siendo cierto es lo que el producto
  hace hoy: **no sale nada de la instalación** y lo no legible **se declara**, en vez de fingirse.

**Pendiente heredado**: el texto que el producto devuelve en esas respuestas arrastra la misma redacción
inexacta. Se corrige **dentro del siguiente candidato**, con su regresión, en vez de abrir una entrega aparte.

## 5. No sobrescribe, y está atado a la versión exacta

- `document_versions` **no se toca**: comprobado comparando `issuer`, `issued_at` y `expires_at` antes y
  después de confirmar. Confirmar **registra** un dato propio, atribuido a quien lo confirmó.
- La extracción cuelga de **`version_id`**: subir una versión nueva **no arrastra nada**, la nueva aparece
  **sin extracción** y la vieja **avisa** de que ya no es la vigente.
- **Lo decidido no se pisa**: una segunda decisión sobre el mismo campo es **409**; rectificar exige extraer
  de nuevo, y el historial de corridas **crece**.

## 6. Permisos del documento **y** del destino

| Quién | Puede |
| --- | --- |
| `document:extract` (ORG_ADMIN, MANAGER) | lanzar la extracción |
| `document:review` (ORG_ADMIN) | **confirmar o descartar** |
| `producer:read_identity` | ver el **contenido** de un documento de datos personales |

Comprobado con casos discriminantes: el **técnico que subió** el archivo **no puede extraerlo** (403) —subir
no autoriza a procesar—; el **auditor**, que lee documentos pero **no identidad**, **no ve** el contenido de
uno personal (403); el **gestor** extrae pero **no confirma** (403). En los tres hay **control autorizado**.

## 7. Se respetan los controles que ya existían

- **Sin análisis antivirus limpio no se abre el archivo** (`SCAN_NOT_CLEAN`).
- **Formatos**: solo los que el producto ya admite (PDF, JPEG, PNG); de ellos, solo el PDF es extraíble.
- **Límites de procesamiento**: tope de caracteres, de flujos y de bytes por flujo. Si se corta, **se dice**:
  un texto parcial **no se presenta como completo**.
- La huella **se recalcula**: si el contenido almacenado no coincide con la registrada, **no se extrae**.

## 8. Lo que NO hace

- **No acredita** autenticidad, legalidad, calidad ni suficiencia documental.
- **No decide**: no levanta `UNDETERMINED`, READY ni el despacho, y **no confirma ninguna importación**.
- **No sobrescribe** datos operativos.
- **No sale** a ningún servicio externo ni envía datos personales a nadie.
- **No presenta un formulario manual como extracción**: el texto sale del archivo, y las pruebas construyen
  **PDF sintéticos de verdad** que el extractor tiene que descomprimir.

## 9. Respaldo

Hay migración (**0053**), así que corresponde: `_respaldos/2026-10-18-p1013-migracion-0053/`, capturado con
**la aplicación detenida** y **verificado por restauración aislada**, esperando al **arranque definitivo** del
contenedor —no a su fase de inicio—.

| Comprobación | Resultado |
| --- | --- |
| Restauración aislada | **0 errores** |
| Migraciones | **53**, la última `0053_p1013_extraccion_asistida` |
| Conteos por tabla | **100 tablas con datos, idénticas** |
| Restricciones | **339** FK, **435** CHECK, **209** UNIQUE |
| Objetos del esquema | **500**, igual que el origen |
| Filas de extracción restauradas | **27** corridas · **72** sugerencias · **9** decisiones |
| Append-only en la copia | **3** disparadores, y un `DELETE` sobre `document_extraction_fields` **es rechazado** |

Incluye `object-data.tar.gz`, `claves.env` con ACL restringida y `SHA256SUMS.txt`.

## 10. Resultados

| Comprobación | Resultado |
| --- | --- |
| `src/extraction/extraction.spec.ts` (sin base ni red) | **13/13** |
| `test/extraction.int-spec.ts` (PDF sintéticos reales) | **13/13** |
| `test/documents.int-spec.ts` (regresión) | **13/13** |
| `node e2e/review/extraccion.mjs` | **18/18** sobre el despliegue |
| `node e2e/review/estados-web.mjs` · `web-por-rol.mjs` | **APROBADOS** |
| `npm run validate` sobre `09fb394` | **APROBADA**: 875 pruebas, 72 E2E, 0 fallos |
| `node e2e/review/extraccion.mjs` sobre el despliegue de `09fb394` | **18/18** |
| Respaldo verificado por restauración aislada | **0 errores**, 100 tablas idénticas, 500 objetos |

## 11. Una corrida de validación interrumpida, y por qué no se oculta

La **primera** corrida sobre `09fb394` terminó en **FALLIDA**, y conviene ser exacto sobre qué falló:

| Hecho | Evidencia |
| --- | --- |
| **Ninguna prueba falló** | **82 suites PASS, 0 FAIL** en `validation-results/2026-10-18T21-46-46-690Z/pruebas-unitarias-integracion.log` |
| Lo que falló fue **arrancar** el ejecutor de pruebas de `apps/web` | `npm error code 3221225794` (**0xC0000142**, fallo de inicialización de proceso) al lanzar `vitest run` |
| Coincidió con **falta de memoria** | El entorno avisó de memoria baja en ese momento; quedaban **3,9 GB de 23,7 GB** |
| El paso **sí funciona** | `npm test -w apps/web` ejecutado aparte: **2 archivos, 4 pruebas, todo correcto** |
| No quedaron restos | Sin procesos del ensayo y **sin sesiones** sobre las bases `*_test` antes de relanzar |

**Por qué se relanzó y no se dio por fallida la entrega**: la regla prohíbe *repetir hasta obtener verde* para
tapar un fallo. Aquí **no hubo fallo que tapar**: un paso **no llegó a ejecutarse**. El **código es idéntico**
—entre una corrida y otra solo cambió documentación—, y la corrida interrumpida **se conserva** en
`validation-results/2026-10-18T21-46-46-690Z/` para que pueda comprobarse.

## 12. Dos defectos corregidos, uno del producto y uno de la revisión

**En la revisión** (no en el producto): la comprobación de permisos en pantalla leía la página **antes de que
cargara**, de modo que «0 botones de revisar» podía cumplirse **con la pantalla vacía** —una aserción vacua,
justo lo que `comprobacion.mjs` prohíbe—. Pasó en la primera ejecución por azar de tiempos y falló en la
segunda. Corregida: ahora espera la tabla y **exige que haya sugerencias a la vista** antes de contar.

**En el producto**:

Una etiqueta **mencionada** bastaba para sugerir: el texto «Sin **emisor** rotulado ni fechas» proponía
«rotulado ni fechas» como emisor **con confianza ALTA**. Lo encontró la prueba de «información ausente».
Corregido: la etiqueta tiene que **rotular** —dos puntos para el emisor, o una fecha ISO justo detrás— y debe
ser **palabra completa**. Queda fijado con su prueba unitaria.

## 13. Comprobación dirigida de los límites del motor (2026-10-18, posterior al cierre)

**Superar las pruebas con PDF que genera el propio autor no demuestra compatibilidad general.** Se hizo una
comprobación acotada con un PDF producido por una **herramienta independiente** —el motor de impresión de
**Chromium**, guardado como `apps/api/test/fixtures/chromium-capa-texto.pdf`— y empujando el motor contra sus
bordes. **Destapó cuatro defectos**, corregidos con su regresión **dentro del siguiente candidato**, sin abrir
una entrega aparte.

| # | Qué se comprobó | Qué pasaba | Corrección |
| --- | --- | --- | --- |
| 1 | **PDF de otra herramienta** | Devolvía **miles de caracteres que no son el texto del documento** y los publicaba como `EXTRAIDA` | Se **mide si el resultado es texto** y, si no lo es, se publica `TEXTO_NO_INTERPRETABLE` **sin texto y sin sugerencias** |
| 2 | **«Sin capa de texto» vs «no supe leerla»** | Ambas acababan en `SIN_TEXTO` | Estados **distintos**: `SIN_TEXTO` (no hay) y `TEXTO_NO_INTERPRETABLE` (hay, pero este motor no la entiende) |
| 3 | **Multipágina** | De **tres** flujos de contenido leía **uno**: la palabra `endstream` contiene `stream`, y el barrido se comía el siguiente | Se reanuda **después** de `endstream`. Probado con tres flujos |
| 4 | **Codificaciones** | Cadenas **hexadecimales** `<…>` se perdían enteras; **UTF-16BE** salía con el BOM dentro (`þÿHola`) | Ambas se **decodifican** |

**El hallazgo más importante, y por qué una sola señal no bastaba.** Con el PDF de Chromium el texto
descomprimido **parece ASCII imprimible** —la legibilidad por repertorio da **87 %**— pero son **índices de
glifo**: `0DQDEt` es «Manabí» desplazado. Una medida de «caracteres razonables» lo habría dado por bueno. Lo
delatan dos señales añadidas: **caracteres de control** donde debería haber espacios, y un texto largo **sin un
solo espacio**. El motor publica **cuál** señal lo descartó, para que pueda comprobarse.

**Lo que SÍ estaba bien**: los **límites de procesamiento** cortan y lo **declaran** (`truncated`), y un flujo
con Flate corrupto **no revienta ni inventa**.

**Clasificación y permisos del texto extraído**: comprobado que el texto de un documento de **datos
personales** hereda su protección —quien no tiene `producer:read_identity` recibe **403** y el texto **no se
filtra** por la ficha del documento—, también en las tablas y respuestas nuevas.

**Lo que esta comprobación NO demuestra**: compatibilidad general con cualquier PDF. Se probó **un** generador
independiente. El producto lo dice en cada respuesta (`engine_limits`): *superar las pruebas de formatos
propios no acredita compatibilidad general*.

**Migración 0054** añade el estado nuevo al CHECK; la tabla es append-only y las filas anteriores no se tocan.


## 14. El motor se sustituyó: las heurísticas no demostraban la decodificación (2026-10-19)

**El problema de fondo.** Las señales añadidas en §13 —proporción de caracteres legibles, caracteres de
control, ausencia de espacios— **detectaban los ejemplos probados**, pero son **heurísticas sobre el
resultado**: no demuestran que los caracteres correspondan al documento. Se confirmó con un caso
construido a propósito: un PDF con fuente compuesta `Identity-H` **sin `/ToUnicode`** produce **«HIJK»**
—texto **perfectamente imprimible**, sin un solo carácter de reemplazo— que **no es el texto del documento**.
Ninguna de las tres señales lo habría detectado.

**La decisión.** Reconstruir un lector de PDF general a mano sería rehacer, peor, algo que ya existe. Se
sustituyó **solo esa pieza** por un componente **mantenido y local**: **pdf.js** (`pdfjs-dist 4.10.38`), el
motor de PDF de Mozilla, que **interpreta de verdad** codificaciones y mapas de fuente.

| | Antes (lector propio) | Ahora (pdf.js) |
| --- | --- | --- |
| PDF de otra herramienta (Chromium) | basura binaria presentada como texto | **se lee**: «Registro de la Propiedad de **Manabí**», «Fecha de **emisión**» |
| Acentos españoles | se perdían | **correctos** |
| Fuente sin mapa de caracteres | pasaba como texto creíble | **rechazo explícito**, sin texto ni sugerencias |
| Multipágina | perdía páginas | completo |

**El rechazo ya no depende de mirar el resultado.** Antes de publicar nada se comprueba **la estructura del
documento**: si alguna fuente **compuesta** no declara su `/ToUnicode`, el resultado se **rechaza entero**
—`TEXTO_NO_INTERPRETABLE`, sin texto y **sin sugerir ningún campo**— por legible que parezca. Los caracteres
de reemplazo y del área de uso privado quedan como **red adicional**, no como la comprobación.

**Lo que no cambia**: nada sale de la instalación —pdf.js es una biblioteca, no un servicio—, no hay OCR, se
conservan permisos, versiones, revisión humana, límites y procedencia, y el motor y su versión **viajan con
cada extracción**.

**Lo que sigue sin poder afirmarse**: compatibilidad general con cualquier PDF. Lo comprobado es: un generador
independiente, acentos españoles, un caso de **texto mal decodificado que sigue siendo imprimible**, un
escaneo sin capa de texto, un archivo que no es PDF y los límites de procesamiento.

**Protección del texto extraído**: comprobado de nuevo que el texto de un documento de **datos personales**
hereda su clasificación —403 sin `producer:read_identity`— y que **no se filtra** por la ficha del documento,
también con las tablas y respuestas nuevas.

**Cambio de entorno de pruebas**: `pdfjs-dist` solo publica compilación ESM, así que el ejecutor de pruebas de
la API arranca con `--experimental-vm-modules`. No afecta al producto.


## 15. La comprobación de soporte pasa a ser POR OBJETO (2026-10-19)

**El defecto.** La primera versión de la comprobación buscaba `/ToUnicode` en una **ventana de ±600
caracteres** alrededor de cada `/Type0`. **La proximidad no demuestra asociación**: con dos fuentes vecinas
—una con mapa y otra sin él— encontraba el mapa de la primera y **daba por buena la segunda**, que es
justamente el caso que pretendía rechazar.

**Comprobado con un archivo construido a propósito** (`dos-fuentes-vecinas.pdf`): la ventana detectaba
**0** fuentes sin mapa cuando había **1**, y esa segunda fuente producía **«HIJK»** —imprimible y falso—.

**La corrección.** Ahora se **interpretan los objetos del documento y sus referencias**: se enumeran los
objetos de nivel superior **y los contenidos en flujos de objetos (`/ObjStm`)**, y de cada fuente compuesta
se mira **su propio diccionario**. Si esa fuente no declara `/ToUnicode`, se rechaza el documento entero.

| Archivo | Fuentes compuestas | Sin mapa | Veredicto |
| --- | --- | --- | --- |
| `chromium-capa-texto.pdf` | 1 | 0 | se lee |
| `fuente-sin-mapa.pdf` | 1 | **1** | **rechazado** |
| `dos-fuentes-vecinas.pdf` | 2 | **1** | **rechazado** (la ventana lo aceptaba) |

**Lo que no se pudo inspeccionar tampoco se da por bueno.** Un flujo de objetos que no se descomprime, o una
cabecera que no se entiende, cuentan como **indeterminado**: el resultado es `SOPORTE_INDETERMINADO`, sin
texto y **sin sugerencias**. Antes se omitían en silencio, lo que equivalía a afirmar que todo estaba
comprobado.

**Y no se presenta `/ToUnicode` como garantía de corrección**: lo que acredita es que el documento **declara**
el soporte. Sin esa declaración el rechazo es seguro; con ella, el texto lo produce pdf.js, no esta
comprobación.

## 16. Los límites ahora interrumpen de verdad (2026-10-19)

El control anterior miraba el reloj **entre páginas**, así que **no interrumpía** una apertura o una página
atascada: el proceso podía quedarse esperando indefinidamente dentro de una sola operación.

Ahora **cada operación** —abrir el documento, obtener una página, extraer su texto— corre **contra un plazo**
(`10 s` por operación, `30 s` en total). Al vencer:

- la operación se **abandona** en vez de esperar;
- el documento se **libera** (`destroy()`), también si la apertura fue la que se atascó —se cancela la tarea—;
- el resultado se publica como **incompleto** o como `TIEMPO_AGOTADO`, **nunca** como texto completo, y **no
  se sugiere nada** a partir de un texto truncado por plazo.

Los topes de descompresión de la auditoría estructural también están acotados: tamaño por flujo y número de
objetos inspeccionados; superarlos cuenta como **indeterminado**, no como «comprobado».

## 17. Un fallo de la corrida anterior, y su causa

La validación de `f9efb88` quedó **FALLIDA** con **5 pruebas** en rojo, todas de `extraction.spec.ts`. La
causa **no era el lector**: la importación dinámica de pdf.js se hacía **dentro de la petición**, y su
trabajador llegaba a cargarse **después** de que el entorno de pruebas se hubiera desmontado
(«*import after teardown*»), dejando la suite unitaria sin motor. Corregido cargando el componente **una vez,
al cargar el módulo**. No se declaró aprobado nada mientras el resultado estuvo pendiente.
