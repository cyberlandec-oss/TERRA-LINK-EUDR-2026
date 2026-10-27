# Fuentes ecuatorianas para P1-005 — copia fechada (consultadas el 2026-10-17)

**Esto no es un perfil jurídico.** Es la preparación de fuentes que P1-005 exige antes de poder proponer uno:
qué documento es, quién lo emitió, dónde se publicó, qué versión se consultó, qué reformas se le conocen, de
qué URL salió, cuándo se consultó y qué huella tiene. **Ninguna compuerta se tocó, nada se aprobó y la
conclusión `UNDETERMINED` sigue igual.** Las llamadas satelitales siguen deshabilitadas.

Se sigue el mismo criterio que `docs/sources/eudr-norma-2026-10-15/`: copia fechada, con sha256, y lo que no se
pudo comprobar se declara como no comprobado.

## 1. El hallazgo que condiciona todo lo demás: no hay texto consolidado oficial y gratuito

Con la norma europea existe un **texto consolidado** publicado por la propia autoridad, con identificación de
versión (`02023R1115 — EN — 18.09.2026 — 003.001`) y lista de modificaciones. **En Ecuador no hay equivalente
gratuito.**

| | Unión Europea | **Ecuador** |
| --- | --- | --- |
| Publicación oficial | EUR-Lex / Oficina de Publicaciones | **Registro Oficial** (`registroficial.gob.ec`, alcanzable el 2026-10-17) |
| Qué publica | Ediciones **y consolidaciones** | **Solo ediciones cronológicas**: Registro Oficial, Suplemento, Edición Especial, Constitucional, Jurídica e Índice Mensual |
| Texto vigente consolidado | Sí, identificado y fechado | **No consultable por esa vía** |

Consecuencia directa, y hay que escribirla antes de cualquier regla: **la vigencia consolidada de ninguno de
los cuerpos legales de esta carpeta puede confirmarse con las fuentes obtenidas.** Reconstruirla exige aplicar
una por una las reformas publicadas en ediciones posteriores, o recurrir a una consolidación **comercial**
(LEXIS/SILEC), que no se ha contratado y que **no es fuente oficial**.

**Actualización del 2026-10-17.** El portal del Registro Oficial sigue sin servir texto consolidado, pero
**no es la única vía**: la **Asamblea Nacional conserva las publicaciones modificatorias** y por ahí sí se
obtuvieron (§2.3). La reconstrucción, por tanto, **es posible**: se hace ley por ley, siguiendo cada norma que
la reforma. Lo que sigue sin existir es un **texto consolidado oficial** que lo dé hecho.

**Por eso P1-005 no puede cerrarse con este material.** Lo que sí queda es la base fechada para trabajar.

## 2. Lo que se obtuvo

### Originales (no se modifican nunca)

| Archivo | Qué es | Autoridad emisora | Bytes | sha256 |
| --- | --- | --- | ---: | --- |
| `lotrta-ro-s-711-2016-03-14.pdf` | **Texto normativo**: Ley Orgánica de Tierras Rurales y Territorios Ancestrales (ver §2.0) | Asamblea Nacional del Ecuador (ficha oficial de la ley) | 1 025 486 | `8ee8598db5735098e278194995993a43e3b343dd78fba47acebb538f82cfc76b` |
| `coa-ro-s-983-2017-04-12.pdf` | **Texto normativo**: Código Orgánico del Ambiente (ver §2.1) | Asamblea Nacional del Ecuador (repositorio propio) | 1 660 486 | `033ffdd280975aabb0b89f6634b4e7f9462b3a835d49abcbbecefdaed96e61af` |
| `mag-indice-normativa.pdf` | **Índice institucional, NO texto normativo** (ver §2.2) | Ministerio de Agricultura y Ganadería | 501 628 | `c513533bcc7ff3c88848169706c811c9a84929e31cd58cc4e6465fc181609651` |

### Derivados (extracción de texto; **no son fuente**)

Los dos suplementos son **escaneos con capa de texto**, así que el texto se extrae sin OCR, con
`pdftotext -enc UTF-8`. **El original queda intacto**; la extracción se guarda aparte, con su propia huella, y
**no sustituye al original**: cualquier artículo que vaya a convertirse en regla se lee contra el PDF.

| Archivo | Origen | Bytes | sha256 |
| --- | --- | ---: | --- |
| `derivados/lotrta-lectura.txt` | `lotrta-ro-s-711-2016-03-14.pdf` | 174 588 | *orden de lectura (columna a columna)* |
| `derivados/lotrta-ro-s-711-2016-03-14.txt` | el mismo, con `-layout` | 222 348 | `e425c587da88e23dfb0470d2f4eed1f9479e2582e4c8d2d0b8d6c2478956ee25` |
| `derivados/coa-ro-s-983-2017-04-12.txt` | `coa-ro-s-983-2017-04-12.pdf`, con `-layout` | 429 743 | `9b8d0186f88e0e110f1447ca36ba436ccc00b178306c6e6ce93dfe613ccc7cb2` |

**Aviso de uso**: la extracción `-layout` conserva las **dos columnas** del Registro Oficial y por eso
**entrelaza frases de columnas distintas**. No se puede citar de ahí. Para leer artículos se usa la extracción
en orden de lectura, y aun así se contrasta contra el PDF.

URLs y fecha de consulta en §5.

### 2.0 `lotrta-ro-s-711-2016-03-14.pdf` — Ley Orgánica de Tierras Rurales y Territorios Ancestrales

| | |
| --- | --- |
| Autoridad emisora | **Asamblea Nacional del Ecuador**, desde la **ficha oficial de la ley** (enlace «Descarga aquí») |
| Publicación | Registro Oficial **Suplemento 711**, de **14 de marzo de 2016** |
| Versión consultada | **Publicación original**, no consolidada |
| Formato | PDF de **36 páginas**, escaneado **con capa de texto** |
| Fecha de consulta | 2026-10-17 |

**Comprobado, no supuesto**: la cabecera del documento dice literalmente «SUPLEMENTO · Año III · Nº 711 ·
Quito, lunes 14 de marzo de 2016», y coincide con lo que declara la ficha oficial y con el propio nombre del
archivo en el repositorio. Es la **ley promulgada**, no un proyecto ni una noticia.

### 2.1 `coa-ro-s-983-2017-04-12.pdf` — Código Orgánico del Ambiente

| | |
| --- | --- |
| Autoridad emisora | **Asamblea Nacional del Ecuador** (el archivo procede de su repositorio institucional) |
| Publicación declarada | Registro Oficial **Suplemento 983**, de **12 de abril de 2017** |
| Versión consultada | **Publicación original**, no consolidada |
| Formato | PDF de **136 páginas**, escaneado **con capa de texto** |
| Fecha de consulta | 2026-10-17 |

**Corrección de esta misma ficha (2026-10-17).** La primera versión afirmó que el PDF **no tenía capa de
texto** y que su contenido **no se había verificado**. Ambas cosas eran incorrectas: la comprobación se hizo
contando marcas `ToUnicode`, que este archivo no usa, y de ahí se concluyó de más. Extraído con `pdftotext`,
el documento **sí es legible**, y su cabecera dice «SUPLEMENTO · Año IV · Nº 983 · Quito, miércoles 12 de abril
de 2017», que es exactamente lo que se le atribuía. **La identificación queda comprobada contra el documento**,
no solo contra el nombre del archivo.

**El límite que sí se mantiene:** es el texto tal como se publicó en 2017 y **no incorpora reformas**. La
reforma del RO-S **309** (2018) **ya está verificada** —su artículo 53 sustituye el segundo inciso del
**artículo 209** del COA; ver §2.6—. Lo que **no** se ha hecho es una búsqueda exhaustiva de reformas
posteriores a 2018.

### 2.2 `mag-indice-normativa.pdf` — índice institucional, no norma

Documento de **una página** del Ministerio de Agricultura y Ganadería, fechado en el propio archivo el **7 de
diciembre de 2023**, que **enumera y enlaza** los cuerpos legales que rigen a la institución (Constitución,
Código Orgánico Administrativo, COGEP, COOTAD, Código del Trabajo, LOTAIP, LOSNCP, LOGJCC, LOSEP…).

**Es un índice de transparencia, no texto normativo y no una interpretación.** Sirve para orientarse; **no
sustenta ninguna regla** y su fecha (2023) es anterior a esta consulta, de modo que puede estar desactualizado.

### 2.3 Las dos publicaciones modificatorias (incorporadas el 2026-10-17)

| Archivo | Qué es | Publicación | Bytes | sha256 |
| --- | --- | --- | ---: | --- |
| `fomento-ro-s-309-2018-08-21.pdf` | **Texto normativo**: Ley Orgánica para el Fomento Productivo…, cuyo **Art. 56** reforma la LOTRTA | RO **Suplemento 309**, 21-ago-2018 | 3 005 920 | `1b6584acbf3faf62a6beaf330cba31378524f69cbc6cb6a81f91d7fe8717e818` |
| `fe-erratas-ro-s-321-2018-09-06.pdf` | **Fe de erratas** de la anterior (Oficio SAN-2018-1371) | RO **Suplemento 321**, 6-sep-2018 | 4 002 395 | `c857e53df5f832439060d1b9b4fa614ca0de4ef67897ed10da2c5215ae4ee7ba` |
| `ro-29-2s-2022-03-25-comprimido.pdf` | **Texto normativo**: Ley Orgánica de Vivienda de Interés Social, cuyas **Disposiciones Reformatorias** modifican la LOTRTA | **2.º Suplemento 29**, 25-mar-2022 | 6 948 293 | `076904562ca77c9c7615c9a0f9c49751017d891f72df00419f9278a2a849f869` |

Las tres proceden de **fichas oficiales de la Asamblea Nacional** (enlace «Descarga aquí»), y las tres
cabeceras se comprobaron contra el propio documento.

**Sobre el 2.º Suplemento 29, con precisión.** La Asamblea publica **dos copias**: la **canónica** de la ficha
(26 326 983 bytes, sha256 `24ba55e6a206ea1113166243da4640eaca42a9f3ed5ef0e47868020926b03f44`) y una **comprimida**
(la de arriba). **En el repositorio se guarda la comprimida**, por peso; **la verificación visual se hizo sobre
la canónica**, cuyo hash y URL quedan aquí para que cualquiera la vuelva a descargar y repita la comprobación.
Las dos extraen el **mismo texto** (8 182 caracteres), porque el documento es un **escaneo**: de la página 4 a
la 39 **no hay capa de texto**.

**Por eso la verificación fue visual, no por extracción.** Se extrajeron las imágenes de página incrustadas en
el PDF y se leyeron. Las dos que sustentan la matriz quedan guardadas como **evidencia derivada**:

| Evidencia visual | Qué muestra | sha256 |
| --- | --- | --- |
| `derivados/ro29-paginas-verificadas/ro29-pagina-impresa-33.jpg` | **DISPOSICIONES REFORMATORIAS**, PRIMERA a CUARTA («Página 33 de 36») | `b505300b117637b8201aeadddaad277623236d5351af14b528562d7aa399ace0` |
| `derivados/ro29-paginas-verificadas/ro29-pagina-impresa-34.jpg` | QUINTA a OCTAVA y el inicio de las transitorias («Página 34 de 36») | `50faefb84a3b8eedc3c9ee081f51f4d3f8d93003b02371866d66de622d99ca54` |

**Corrección de la indicación de partida**: las disposiciones reformatorias están en las páginas impresas
**33 y 34 de 36**, no en las 35–36. Se registra la numeración que el propio documento imprime en su pie.

### 2.4 Qué dicen, comprobado

**RO-S 309 (2018), Art. 56** — leído en la extracción de texto:

> «Realícese la siguiente reforma a la Ley Orgánica de Tierras Rurales y Territorios Ancestrales. A
> continuación del artículo 39, añádase el siguiente artículo innumerado: “Artículo (…).- Seguro
> Agropecuario.- La autoridad Agraria Nacional, propondrá los parámetros de aseguramiento y riesgos de
> cobertura de las pólizas de seguro, a las actividades vinculadas a la producción agropecuaria. […]”»

**A quién se dirige**: a la **Autoridad Agraria Nacional** y a las autoridades competentes, que **proponen**
parámetros y **fijan** porcentajes de prima asumibles por el Estado **a título de incentivo**. **No crea un
deber del productor de contratar ni de presentar una póliza.**

**Fe de erratas (RO-S 321, 2018)** — leída entera: corrige el artículo 35, renumera el 47, sustituye la
Disposición General Décima, cambia una frase de la Transitoria Primera y elimina la Transitoria Sexta.
**No toca el artículo 56**: la reforma a la LOTRTA queda como se publicó.

**2.º Suplemento 29 (2022), Disposiciones Reformatorias** — leídas en las imágenes de página:

| Disposición | Artículo de la LOTRTA | Qué cambia |
| --- | --- | --- |
| **PRIMERA** | **Art. 54** | Define la **Regularización** (agraria o de vivienda) sobre **tierra rural estatal** y reparte competencias |
| **SEGUNDA** | **Art. 59** | La **adjudicación de tierras rurales estatales** en posesión agraria o de vivienda **constituye justo título** |
| **TERCERA** | **Art. 66** | Valor y forma de pago **en adjudicaciones del Estado** a posesionarios individuales |
| **CUARTA** | **Art. 67** | Falta de pago por caso fortuito o fuerza mayor: prórroga de hasta tres años |
| **QUINTA** | **Art. 68** | Formalidades: el **peticionario de la adjudicación** debe presentar una **declaración responsable** |
| **SEXTA** | **Art. 69** | Parámetros para fijar el valor de la tierra rural adjudicada |
| **SÉPTIMA** | **Título II** | Donde diga «Autoridad Agraria Nacional», añádase «o el ente rector de hábitat y vivienda, según corresponda» |
| OCTAVA | — | Ley Orgánica de Economía Popular y Solidaria: **no** es la LOTRTA |

**Queda corregida la hipótesis anterior**, que atribuía estas reformas **solo al reglamento**: modifican **la
ley**. Y hay un matiz que la matriz debe conservar: **las siete tratan de regularización y adjudicación de
tierra rural ESTATAL**, no de deberes generales de todo productor.

### 2.5 Bloque ambiental (incorporado el 2026-10-17)

| Archivo | Qué es | Publicación | Bytes | sha256 |
| --- | --- | --- | ---: | --- |
| `reglamento-coa-ro-s-507-2019-06-12.pdf` | **Texto normativo**: Decreto Ejecutivo **752**, Reglamento al Código Orgánico del Ambiente | RO **Suplemento 507**, 12-jun-2019 | 1 407 425 | `6c5ac3e13c26606090ea50221e121ec45e758e75afe10d35af286b8c521de454` |

**Procedencia y verificación.** Portal oficial del Estado (`gob.ec`). Cabecera comprobada **contra el propio
documento**: «SUPLEMENTO · Año III – Nº 507 · Quito, miércoles 12 de junio de 2019 · DECRETO **752** · Expídese
el Reglamento al Código Orgánico del Ambiente».

**Incidencia técnica registrada**: `www.gob.ec` **cierra la conexión** ante descargas automatizadas directas
(`Connection was reset`, también con cabeceras de navegador). Se obtuvo por otra vía de red, y queda anotado
igual que el desafío de AWS WAF de EUR-Lex y el fallo TLS de `ambiente.gob.ec`.

### 2.6 La reforma del COA, ahora SÍ verificada

El manifiesto registraba como **dato sin confirmar** que el RO-S 309 (2018) reformaba el COA. **Queda
verificado leyendo el propio documento**: su **SECCIÓN DÉCIMO NOVENA, «Reformas al Código Orgánico del
Ambiente», artículo 53**, sustituye el **segundo inciso del artículo 209 del COA**:

> «Los análisis se realizarán en laboratorios públicos, privados o de universidades e institutos de educación
> superior, acreditados ante el Servicio de Acreditación Ecuatoriano. […]»

**Qué alcanza y qué no.** Es una regla sobre **acreditación de laboratorios** para los análisis. **No crea
ninguna obligación para un productor de cacao**, y así se registra: encontrar una reforma no la convierte en
requisito exigible.

**Qué sigue sin verificarse.** Una fuente secundaria indica que el **Reglamento** fue reformado por última vez
en la **Edición Constitucional del RO 347, de 16-abr-2024**. **No se ha recuperado esa edición** y se registra
como **modificación localizada y no verificada**. Para el **COA** no se ha hecho una búsqueda exhaustiva de
reformas posteriores a 2018.

## 3. La distinción que P1-005 exige: norma, guía e interpretación

Se separan desde el principio porque sustentan cosas distintas:

| Clase | Qué es | Qué puede sustentar | En esta carpeta |
| --- | --- | --- | --- |
| **Texto normativo** | Lo publicado en el Registro Oficial | Una regla, **si** se confirma su vigencia | `lotrta-…pdf` (original 2016) y `coa-…pdf` (original 2017); en ambos la vigencia está **sin confirmar** |
| **Índice o compilación institucional** | Listado que una entidad hace de las normas que la rigen | Orientación; **nunca** una regla | `mag-indice-normativa.pdf` |
| **Guía, manual o resolución técnica** | Material operativo de una agencia (p. ej. manuales de Agrocalidad) | Práctica administrativa; **no** sustituye a la norma | **Ninguno** incorporado |
| **Consolidación comercial** | Texto refundido por una editorial (LEXIS/SILEC, Ediciones Legales) | **Auxiliar para contrastar**, identificada como tal; **nunca** se presenta como publicación oficial ni se acepta como vigente | **Ninguna incorporada**; se registran como pista en la matriz |
| **Propuesta de interpretación** | Lectura de cómo una norma aplica a EUDR | **Nada por sí sola**: requiere decisión y aprobador | **Ninguna**, y no se formula aquí |

## 4. Identificados y NO obtenidos

Relevantes para la «legislación pertinente» del país de producción (EUDR art. 2(40): uso del suelo, protección
ambiental, bosques, derechos de terceros, laboral, derechos humanos, CLPI, tributario, aduanero y
anticorrupción). **Las citas de Registro Oficial proceden de fuentes secundarias y NO se han verificado**; se
anotan para localizarlas, no como hecho acreditado:

| Cuerpo legal | Cita declarada (**sin verificar**) | Por qué importa | Estado |
| --- | --- | --- | --- |
| Constitución de la República | RO 449, 20-oct-2008 | Derechos de la naturaleza, territorios ancestrales | **No obtenido** |
| Reglamento al Código Orgánico del Ambiente | D.E. 752, RO-S 507, 12-jun-2019 | Desarrolla el COA | **No obtenido**: `site.inpc.gob.ec` no resuelve |
| Ley Orgánica de Sanidad Agropecuaria | RO-S 27, 3-jul-2017 | Registro de operadores (Agrocalidad) | **No obtenido**: no se localizó texto completo en sitio oficial; solo resoluciones que la citan |
| Código Orgánico Integral Penal | RO-S 180, 10-feb-2014 | Delitos ambientales | **No obtenido** |
| Código del Trabajo | RO-S 167, 16-dic-2005 | Derechos laborales | **No obtenido** |
| COPCI | RO-S 351, 29-dic-2010 | Aduanas y comercio | **No obtenido** |

**Incidencia técnica registrada:** `www.ambiente.gob.ec` **no se pudo consultar** el 2026-10-17: el saludo TLS
falla (`SEC_E_ILLEGAL_MESSAGE`). No es un fallo de red puntual del lado del cliente —el resto de dominios
respondieron—, y queda anotado igual que en su momento se anotó el desafío de AWS WAF de EUR-Lex.

## 5. URLs y fecha de consulta

Todas consultadas el **2026-10-17**:

| Archivo | URL |
| --- | --- |
| `lotrta-ro-s-711-2016-03-14.pdf` | Ficha oficial: `https://www.asambleanacional.gob.ec/es/multimedios-legislativos/37677-ley-organica-de-tierras-rurales-y` → enlace «Descarga aquí»: `https://www.asambleanacional.gob.ec/sites/default/files/private/asambleanacional/filesasambleanacionalnameuid-29/Leyes%202013-2017/36-ley-tierras/RO-LEY%20DE%20TIERRAS-RO-SUP-711-14-03-2016.pdf` |
| `coa-ro-s-983-2017-04-12.pdf` | `https://www.asambleanacional.gob.ec/sites/default/files/private/asambleanacional/filesasambleanacionalnameuid-29/Leyes%202013-2017/102-ambiente/ro-cod-ambiente-ro-s-983-12-04-2017.pdf` |
| `mag-indice-normativa.pdf` | `https://www.agricultura.gob.ec/wp-content/plugins/download-monitor/download.php?id=4475&force=1` |
| Portal del Registro Oficial (estructura, §1) | `https://www.registroficial.gob.ec/` |

## 6. Qué haría falta para que P1-005 avance

En este orden, porque cada paso depende del anterior:

1. **Reconstruir la vigencia reforma a reforma desde el Registro Oficial** (criterio adoptado el 2026-10-17):
   fuentes oficiales como base, y las consolidaciones comerciales **solo como auxiliares identificadas**, nunca
   como publicación oficial ni como prueba de vigencia. Sin esto, ninguna regla puede declararse vigente.
2. **Obtener los textos de §4 que siguen faltando** y, sobre los ya obtenidos, **localizar y verificar sus
   reformas** en las ediciones posteriores del Registro Oficial. Ver `docs/decisiones/P1-005-MATRIZ-OBLIGACIONES.md`.
3. **Verificar visualmente** contra el PDF cada artículo que vaya a convertirse en regla. La extracción de
   texto es un **derivado**, no la fuente.
4. **Recién entonces** proponer el perfil: requisito, documento que lo acredita, regla, versión y aprobador.
   **Eso es una decisión, no un trabajo de recopilación**, y exige un aprobador con competencia jurídica.

**Nada de lo anterior está hecho**, y por eso **P1-005 sigue abierta** y el expediente sigue bloqueado.
