# Evidencia — P1-006 «Intercambio con GUIA/Agrocalidad» (2026-10-18)

**Validación**: `npm run validate` **APROBADA** sobre `799b683` — 76 suites, **780** pruebas, **72** E2E, 0
fallos (`validation-results/2026-10-18T05-02-09-106Z`). **Despliegue**: `/version` → `799b683` (`BUILD_ARG`),
esquema **`0050`**. **Respaldo**: hecho y **verificado por restauración aislada** (§7).

## 1. La dependencia real, dicha antes que nada

**RF-37** (`docs/03:53`) admite el intercambio **«solo canal/acuerdo comprobados»**. `docs/15` registraba la
integración como **PROPUESTA**, con la condición «acuerdo/canal oficial o formato autorizado; **no asumir API
disponible**». **Hoy no existe ninguna de las tres cosas**: ni canal, ni acuerdo, ni formato oficial.

Por eso esta entrega **no implementa ninguna llamada de red**. Entrega el ***fallback* por archivo** que la
propia historia pide (`docs/18:207`: «*fallback* import/export»), **cerrado tras una compuerta** que la
organización **no puede abrirse a sí misma**. Es el mismo criterio con que se trató WHISP en P0-028: mecanismo
construido, uso real cerrado hasta que exista la condición.

**Por tanto esta historia NO se cierra.** Ver §8.

## 2. Qué recorrido nuevo completa una persona

1. **Registra el acuerdo** de intercambio: referencia, alcance declarado, vigencia y evidencia documental.
   Registrar **no habilita nada**, y la pantalla lo dice.
2. **La administración de plataforma verifica el canal** (`exchange:verify`). Hasta entonces, exportar y
   conciliar responden **409** con el motivo.
3. **Exporta el padrón de operadores** en el formato de intercambio. El acto queda registrado con su versión de
   formato, su número de filas y su huella.
4. **Concilia el archivo de la contraparte**: ve las **diferencias** —valor distinto, solo en la contraparte,
   solo en Terra Link— **sin que cambie ningún dato**.
5. **Decide cada diferencia** con su motivo. Aceptar el valor externo **no sobrescribe**: deja constancia de que
   hay que corregirlo por el caso de uso del dominio.
6. Consulta el **registro de actos**: qué se exportó o concilió, cuándo, quién y con qué huella.

## 3. Criterios originales y cómo se cubren

| Criterio (referencia exacta) | Cómo se cumple | Evidencia |
| --- | --- | --- |
| **P1-006** (`docs/18:207`): «**mapping**» | Formato versionado con **el elemento de la guía ecuatoriana al que corresponde cada columna**, publicado en `GET /exchange/format` y en el propio archivo | `intercambio.mjs` («CONTROL»: 6 campos, todos con su elemento) |
| **P1-006**: «**conciliación**» | Compara el padrón de la contraparte con el propio y produce diferencias de **tres clases**, **sin escribir** en los datos operativos | `intercambio.mjs` («CONCILIAR»: 2 diferencias, datos sin cambios) · `exchange.int-spec.ts` |
| **P1-006**: «**log**» | `exchange_acts`: tipo, versión de formato, filas, **huella sha256**, quién y cuándo. Append-only | `intercambio.mjs` («EXPORTAR»: acto con huella) |
| **P1-006**: «**acuerdo de intercambio**» | Referencia, alcance, vigencia y evidencia documental; decisiones `VERIFY`/`WITHDRAW` como **filas** | `exchange.int-spec.ts` (10) |
| **P1-006**: «***fallback* import/export**» | Exportación e importación **por archivo** `.xlsx`, con el mismo lector y escritor que las plantillas del producto | `intercambio.mjs` · reutiliza `imports/xlsx.ts` |
| **RF-37** (`docs/03:53`): «**solo canal/acuerdo comprobados**» | Sin acuerdo **verificado y vigente**: **409 `EXCHANGE_CHANNEL_NOT_VERIFIED`**. Verificar exige permiso **de plataforma** | `intercambio.mjs` («CANAL CERRADO», «LA ORGANIZACIÓN NO VERIFICA SU PROPIO CANAL»: organización 403, técnico 403, plataforma 201) |
| **docs/15**: «**no asumir API disponible**» | **Cero llamadas de red.** El formato declara que no está autorizado y que nada sale hacia un servicio externo | `intercambio.mjs` («NO SE ASUME NINGUNA API») |
| **S3 §19**: «importar/sincronizar los datos que ya existen» | La conciliación es justo eso, **sin sincronizar a ciegas**: propone, no impone | §2 |

## 4. Lo que deliberadamente NO viaja

| Dato | Por qué no |
| --- | --- |
| **Geometrías y coordenadas** | Enviarlas exigiría **otra decisión y otra base legal**. El archivo lo dice |
| **Documento de identidad** | No se exporta en esta versión |
| **Volumen y movimientos** | La guía los enumera, pero su intercambio **no está acordado** |

Comprobado en el despliegue: el archivo exportado con **7 operadores** no contiene coordenadas, geometrías ni
identificadores personales.

## 5. Conciliar no es sincronizar

La comprobación decisiva: tras conciliar un archivo que decía un cantón distinto para un productor real, **el
cantón propio seguía siendo el suyo** («Bolívar»), y el operador que solo existía en la contraparte **no se
creó**. Aceptar la diferencia tampoco lo cambia: registra la decisión y su motivo, y la corrección se hace
después en la ficha, auditada como cualquier otra.

## 6. Lo comprobado **antes** de congelar el candidato

A petición de la revisión, y para no repetir una validación completa por un enlace muerto descubierto después,
el recorrido se comprobó **sobre el árbol de trabajo desplegado** antes de confirmar: enlaces del menú,
permisos, estados de pantalla y el recorrido entero. **15/15**. Después se repitió sobre el SHA validado, con
el mismo resultado.

## 7. Respaldo, verificado y no solo generado

Hay migración (**0050**), así que corresponde respaldo:
`_respaldos/2026-10-18-p1006-migracion-0050/` (volcado, objetos, `claves.env` con acceso restringido,
`estado-actual.txt` y `SHA256SUMS.txt`), con la aplicación detenida durante la captura.

**Verificado restaurando en un contenedor y un volumen propios, sin seed ni migraciones**:

| Comprobación | Resultado |
| --- | --- |
| Restauración | **0 errores** |
| Migraciones | **50**, la última `0050_p1006_intercambio_guia` |
| Conteos por tabla | **93 tablas con datos, idénticas** al estado capturado |
| Restricciones | **317** FK, **394** CHECK, **147** UNIQUE |
| Append-only del intercambio | **5** disparadores, y un `DELETE` sobre `exchange_acts` **es rechazado** en la copia |
| Objetos | **857**, igual que el inventario capturado |

El entorno de verificación se eliminó al terminar; nunca se restauró sobre la base de desarrollo.

## 8. Por qué esta historia **no se cierra**, y qué falta

**P1-006 queda PARCIAL.** Su dependencia declarada (`docs/18:207`) es «**canal verificado, P1-005**», y
**ninguna de las dos se cumple**:

| Falta | Clase | Qué haría falta |
| --- | --- | --- |
| **Canal/acuerdo real** con GUIA/Agrocalidad | Decisión y gestión **fuera del software** | Un acuerdo o canal oficial; entonces la compuerta se abre sin tocar código |
| **Formato autorizado** | Dato externo | Al existir, se publica otra versión del formato; los actos antiguos conservan la suya |
| **P1-005** | Historia abierta | Que un registro externo liste a un operador **no acredita legalidad**. Sigue pendiente de revisión jurídica, cobertura, responsable y pruebas de vigencia |

**RF-37 no se declara demostrada** y **las cifras de cobertura no suben**: lo implementado es el mecanismo y su
compuerta, no un intercambio real con el registro nacional.

## 9. Resultados

| Comprobación | Resultado |
| --- | --- |
| `exchange.int-spec.ts` | **10/10** |
| `onboarding.int-spec.ts` | **12/12** (incluye la fuga del diagnóstico, §10) |
| `node e2e/review/intercambio.mjs` | **15/15** sobre el despliegue |
| `node e2e/review/puesta-en-marcha.mjs` | **19/19** (regresión de P1-004) |

## 10. Corrección de autorización en el diagnóstico de madurez (P1-004)

Señalada en revisión: **el nivel y los estados agregados también informan, aunque se oculte el recuento**.

**Confirmado y era una fuga real**, y peor de lo señalado: el **estado** de cada señal se calculaba sobre
**toda la organización** mientras el **número** se acotaba al alcance, de modo que para un técnico una señal
aparecía como `OBSERVADA` **con `count: 0`**. Bastaba con que otra persona cargara una parcela ajena para que
él lo notara.

**Reproducido primero** con un caso dirigido —crear un productor y una parcela fuera de su alcance— y luego
corregido: cada señal se evalúa **dentro del alcance de quien lee**; lo que no puede leer es **`RESTRINGIDA`**,
sin estado, sin número y sin fecha; el nivel que depende de ella queda **`NO_DETERMINABLE` para esa persona**,
no «no alcanzado»; y la respuesta declara **`scope_of_diagnosis`**: `ORGANIZACION` o `MI_ALCANCE`.

Comprobado: cambiar **solo** datos fuera del alcance del técnico **no altera nada** de lo que ve —ni recuentos,
ni estados, ni nivel—, con el **control** de que quien sí los lee sí ve el cambio.

## 11. D-49(A), con la precisión de la revisión

El texto que la API devolvía decía que «cualquier cifra mayor sería inventada», **y era más fuerte de lo
correcto**. Ahora dice lo que de verdad ocurre: **las fuentes no definen umbrales**, la presencia **es también
una decisión de producto** (D-49, opción A, adoptada), y **unos umbrales cuantitativos serían igual de
legítimos si se acordaran y justificaran**.

## 12. Compuertas

`UNDETERMINED` (4 evaluaciones), `SATELLITE_LIVE_CALLS=disabled`, READY y despacho **sin tocar**. El
intercambio **no acredita nada jurídico** y no levanta ninguna compuerta.
