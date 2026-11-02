# D-43 — Rotación de las claves de cifrado de datos personales (PROPUESTA, no ejecutada)

Archivo: `docs/decisiones/D-43-ROTACION-CLAVES-PII.md` · Revisión **3** (2026-10-16) · Estado: **ADOPTADA Y
EJECUTADA en el entorno local**.

La revisión 2 **corrigió** la conclusión sobre el historial: que el trigger lo impida con el mecanismo de hoy no
demuestra que toda rotación deba alterar el contenido histórico. Ver §3.

**Decisión tomada el 2026-10-16**: **alcance C** (incluye historial) · **sí** se rota el índice ciego ·
**custodia declarada** de los respaldos existentes · **ejecución inmediata**. Ejecutada tras un ensayo sobre una
copia aislada que pasó **19/19** comprobaciones. Evidencia:
`docs/qa/EVIDENCIA_D43_ROTACION_PII_2026-10-16.md`.

**Lo que NO resolvió**: los respaldos anteriores siguen cifrados con la clave expuesta y la transcripción sigue
siendo material sensible. Ver §5.

Este documento no contiene ninguna clave ni ningún valor.

## 0. Por qué

El 2026-10-16 un `grep` sobre `.env` imprimió en consola `PII_KEYS`, `PII_INDEX_KEY` y `SEED_ADMIN_PASSWORD`.
La tercera ya está **rotada** (`docs/qa/ROTACION_CREDENCIALES_DEMO_2026-10-16.md`). Las dos primeras son claves
criptográficas y no se rotan con un cambio de valor.

### Tres cosas distintas que conviene no confundir

| | Qué es | Exposición |
| --- | --- | --- |
| `SEED_ADMIN_PASSWORD` | **Contraseña de acceso** de una cuenta. Se guarda como hash argon2id; el valor solo sirve para iniciar sesión | **Resuelta**: rotada, sesiones invalidadas |
| `PII_KEYS` | **Claves criptográficas** AES-256-GCM. Descifran lo ya escrito, esté donde esté | **Abierta**: quien tenga `k1` descifra todo lo cifrado con `k1`, aquí y en los respaldos |
| `PII_ACTIVE_KEY_ID` | **Identificador** de cuál clave del llavero se usa al escribir. **No es un secreto**: aparece en claro dentro de cada token (`v1.<kid>.…`) | **Ninguna**: no hay nada que rotar |
| `PII_INDEX_KEY` | **Clave HMAC** del índice ciego. No descifra nada; permite **recalcular** el índice y, con ello, comprobar si un número de documento concreto está en la base | **Abierta**, con otro efecto: no revela datos, habilita confirmarlos por fuerza bruta sobre un espacio pequeño (una cédula tiene 10 dígitos) |

Que `PII_ACTIVE_KEY_ID` estuviera en la salida **no añade exposición**: su valor viaja en claro en cada token
cifrado, por diseño, para saber con qué clave descifrar.

## 1. Dónde vive cada cosa (inventario, sin valores)

### Configuración y contenedores

| Sitio | Qué contiene | Nota |
| --- | --- | --- |
| `.env` (raíz, no versionado) | Las tres variables | Origen de todo lo demás |
| `.env.example` | Solo los **nombres**, sin valores | Correcto como está |
| `docker-compose.yml` → `migrate`, `api` | `${PII_*:?definir en .env}` | El worker **no** las recibe: no descifra |
| `infra/qa16/docker-compose.ensayo.yml` | `${PII_*:?falta …}` | Ensayo de restauración |
| `scripts/validate-local.mjs` | Comprueba que **existen**; no las lee | Correcto |
| `apps/api/src/config.ts`, `src/crypto/pii.ts` | Las parsea y usa | Nunca las registra |

### Pruebas

`src/crypto/pii.spec.ts` y `test/producer-identity-encryption.int-spec.ts` **generan claves al vuelo** con
`randomBytes`. No usan las reales ni las incrustan. No hay nada que rotar ahí.

### Datos cifrados en la base

| Tabla · columna | Filas con dato | ¿Mutable? |
| --- | --- | --- |
| `producers.document_number_enc` | 6 | Sí |
| `producers.document_type_enc` | 6 | Sí |
| `producers.phone_enc` | 6 | Sí |
| `producers.address_enc` | 0 | Sí |
| `producers.document_number_bidx` (índice ciego) | 6 | Sí |
| `producer_versions.snapshot` → `*_enc` | **7 de 10 versiones** | **NO: `producer_versions_no_mutation` bloquea UPDATE y DELETE** |
| `import_rows.cells_enc` | 0 | **NO: `import_rows_guard` bloquea UPDATE y DELETE** |

**Todo el texto cifrado existente lleva `kid = k1`.** Comprobado leyendo el segundo campo del token, que no es
secreto.

### Respaldos

Tres, en `D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\_respaldos\`:

| Respaldo | ¿Lleva `claves.env`? |
| --- | --- |
| `2026-10-13-pretraslado` | **Sí** |
| `2026-10-13` | No |
| `2026-10-15-qa16` | **Sí** |

Los dos con `claves.env` contienen **la clave expuesta** junto al volcado que cifra. **No se borra ninguno y no se
retira ninguna clave**: sin ellas, ese respaldo deja de ser restaurable, que es peor problema que el que se
intenta resolver. Lo que cambia es **cómo se custodian** (§6).

## 2. Qué soporte de rotación existe realmente

**Comprobado en el código, no supuesto** (`apps/api/src/crypto/pii.ts`):

- `PII_KEYS` admite **varias claves**: `k1:<base64>,k2:<base64>`. `parsePiiConfig` las carga todas.
- `encrypt()` usa **siempre** la de `PII_ACTIVE_KEY_ID` y escribe su identificador dentro del token.
- `decrypt()` elige la clave **por el `kid` del token**, no por la activa.

⇒ **Activar una clave nueva funciona hoy, sin tocar un solo dato**: lo nuevo se cifra con `k2`, lo viejo se sigue
descifrando con `k1`. Hay una prueba que lo fija (`pii.spec.ts`: cifrar con `k1`, rotar a `k2`, descifrar ambos).

**Lo que NO existe**: ninguna herramienta de **recodificación** (releer, descifrar con `k1` y volver a cifrar con
`k2`), y ninguna de **reindexado** del índice ciego. Habría que escribirlas.

**Y lo que ninguna herramienta puede dar**: activar `k2` **no reduce la exposición de lo ya escrito**. Mientras
exista un solo texto cifrado con `k1` —en la base, en un respaldo o en un volcado— quien tenga `k1` lo descifra.
La rotación protege **las escrituras futuras**; el pasado solo se protege recodificándolo **y** controlando las
copias.

## 3. El historial: qué protege de verdad su inmutabilidad

**Corrección de la revisión 0 de este análisis.** Se afirmó que recodificar el historial «exige romper la
invariante de inmutabilidad». Eso mezclaba dos cosas distintas y **era inexacto**:

- **el contenido histórico**: quién cambió qué, cuándo y por qué;
- **su protección criptográfica**: con qué clave está cifrado el mismo contenido.

Cambiar la segunda sin tocar la primera **no altera el historial**. Que el trigger actual lo impida dice que el
*mecanismo* de hoy no lo permite, no que toda rotación tenga que alterar el contenido.

### Qué protege cada cosa, comprobado

| Mecanismo | Qué garantiza | Qué NO cubre |
| --- | --- | --- |
| Trigger `producer_versions_no_mutation` | Que **ninguna ruta de la aplicación** actualice o borre una fila del historial. Es un `BEFORE UPDATE OR DELETE` | No es un hash ni una firma: no acredita *qué bytes* tenía la fila. Un `ALTER TABLE … DISABLE TRIGGER` en una migración lo levanta, y el proyecto **ya lo hizo una vez** (§3.1) |
| `dd_snapshots.content_hash`, `section_hashes`, `manifest` | La instantánea del expediente: sujeto, cantidades, entregas, parcelas, calidad, documentos, evidencias, riesgo, mitigaciones y perfiles | **No incluye identidad del productor ni ninguna referencia a `producer_versions`.** Comprobado sobre `DdContent`: no hay campo de productor |
| `risk_evaluations.snapshot_hash` | El grafo de origen del lote | Excluye expresamente «valores personales y coordenadas» |
| `producer_versions` | — | **No tiene columna de hash**, **ninguna clave foránea la referencia** y **ningún artefacto externo fija sus bytes** |

Y la comprobación que cierra el asunto: en `domain_events` y en `audit_logs` hay **cero** valores con formato de
token cifrado (`v1.<kid>.…`). **El texto cifrado vive únicamente en `producers.*_enc` y en
`producer_versions.snapshot`.** Nada más en el sistema depende de esos bytes concretos.

⇒ **Recodificar el historial no invalida ningún hash, ninguna referencia ni ninguna firma del expediente**,
porque no existe ninguno que lo cubra.

### 3.1 Ya hay precedente, y está en el repositorio

La migración `0006_producer_identity_encryption.ts` hizo **exactamente esto**: desactivó el trigger, reescribió
`producer_versions.snapshot` para sustituir texto plano por texto cifrado y lo volvió a activar. Su propio
comentario lo enmarca: «El historial es append-only; esta migración controlada es la única excepción para retirar
texto plano.»

Es decir: el proyecto **ya aceptó** que una migración versionada y revisable cambie la **representación** de los
datos históricos conservando su contenido. Una rotación de clave es el mismo tipo de operación, con menos alcance
—allí cambiaba de plano a cifrado; aquí, de cifrado con `k1` a cifrado con `k2`.

### 3.2 Qué debe demostrar una recodificación del historial

No basta con que sea posible: hay que poder **demostrar** que conservó lo que importa. Por cada fila tocada:

| Qué se conserva | Cómo se demuestra |
| --- | --- |
| **Contenido** | El texto descifrado **antes** y **después** coincide. Se compara por hash del valor en claro, sin imprimirlo |
| **Autoría y fechas** | `changed_by` y `changed_at` quedan **byte a byte iguales**; se comparan antes/después |
| **Referencias y orden** | `id`, `organization_id`, `producer_id`, `version` y `change_type` iguales; el conteo de filas por productor y la secuencia de `version` no cambian |
| **Lo no cifrado del snapshot** | Todas las claves del `snapshot` distintas de las cuatro `*_enc` quedan idénticas: se compara el hash del snapshot **excluyendo** esas cuatro |
| **Contexto criptográfico** | El AAD se recalcula igual: `producer_version|<org>|<id>|<version>|<campo>`. Si se equivoca, **falla al autenticar** en vez de corromper en silencio |
| **Huella de la operación** | Una entrada en `audit_logs` por fila, y la migración versionada en el repositorio: queda registrado que esas filas se recodificaron, cuándo y por qué |

**Lo que sí cambia, y hay que decirlo**: los bytes del `snapshot` de 7 filas marcadas como append-only. No es un
cambio de contenido, pero tampoco es invisible. Por eso va en una **migración versionada y revisable**, no en un
script suelto, y por eso la huella forma parte del procedimiento.

### 3.3 Las tres opciones, con su exposición residual

| Opción | Qué hace | Exposición que CONSERVA |
| --- | --- | --- |
| **A. Clave nueva solo para lo venidero** | Añadir `k2`, activarla. Ningún dato se toca | **Todo lo escrito hasta hoy**: 6 productores y 7 versiones, más los **tres respaldos**. `k1` sigue siendo necesaria y sigue expuesta. Protege únicamente lo que se escriba a partir de ahora |
| **B. A + recodificar lo mutable** | `producers.*_enc` pasa a `k2` | **El historial (7 filas) y los respaldos.** `k1` sigue viva porque sin ella el historial no se lee. **No es remediación completa y no debe presentarse como tal** |
| **C. B + recodificar el historial** | `producer_versions.snapshot` pasa a `k2`, con las demostraciones de §3.2 | **Los respaldos**, y solo ellos. `k1` puede retirarse de la configuración viva, aunque **debe conservarse en el `claves.env` de cada respaldo**: sin ella esa copia deja de restaurarse |

**Recomendación: C**, por dos razones. Primera: es la única que permite dejar de usar `k1` en el sistema vivo, y
mientras `k1` siga haciendo falta, rotar no ha reducido casi nada. Segunda: no hay nada que lo impida más allá
del mecanismo —ni hash, ni firma, ni referencia—, y existe precedente propio de cómo hacerlo de forma controlada.

**B es una etapa intermedia legítima** si se quiere avanzar hoy y decidir el historial después, pero entonces hay
que decir, en cada informe, que **la exposición del historial y de los respaldos sigue abierta**.

**Ninguna opción remedia los respaldos.** Eso no depende del alcance elegido: ver §5.

**Dato que pesa en la decisión**: los datos de esta base son **sintéticos** (DEMO y pruebas). La exposición no
afecta a ninguna persona real. Eso no justifica dejarlo sin resolver, pero sí ordena el coste aceptable.

## 4. Procedimiento propuesto, reversible (pasos 4.1 y 4.2 valen para B y para C; 4.2.bis es lo propio de C)

### 4.0 Antes de nada

1. **Respaldo nuevo y completo**, con el procedimiento de `docs/20` §«Respaldo y restauración verificada»:
   volcado, objetos, `claves.env` —que aquí debe llevar **`k1` y `k2`**—, `estado-actual.txt` y `SHA256SUMS.txt`.
   Carpeta `_respaldos/<fecha>-pre-rotacion-pii/`.
2. **Restaurarlo y verificarlo** en el entorno aislado **antes** de tocar nada. Si la copia no se restaura, no se
   rota: no se empieza un cambio sin salida.
3. Anotar los conteos de §1 como línea base: 6 productores con documento, 7 versiones con texto cifrado.

### 4.1 Activar la clave nueva (reversible)

1. Generar `k2` (32 bytes) y **añadirla** a `PII_KEYS` **sin quitar `k1`**.
2. `PII_ACTIVE_KEY_ID=k2`.
3. Reiniciar `api` y `migrate`. Comprobar: alta de un productor de prueba → su token empieza por `v1.k2.`; los
   productores existentes se siguen leyendo.

**Reversión**: volver `PII_ACTIVE_KEY_ID=k1`. Lo escrito con `k2` se sigue leyendo mientras `k2` esté en el
llavero. **Nunca se retira una clave del llavero mientras exista un solo token con su `kid`**, aquí o en un
respaldo restaurable.

### 4.2 Recodificar `producers` (reversible)

Herramienta nueva, en una migración o un script de mantenimiento auditado:

1. Por cada fila con `*_enc`: descifrar con el `kid` del token y el **AAD exacto** —`producer|<org>|<id>|<campo>`;
   el AAD liga el texto cifrado a su fila y a su campo, así que un error aquí **falla al autenticar** en vez de
   corromper en silencio— y volver a cifrar con la activa, con el mismo AAD.
2. Fila a fila, en una transacción por fila, comparando **el valor descifrado antes y después**: si no coincide,
   se aborta esa fila y se registra.
3. `UPDATE` sobre `producers` (tabla mutable: no hay trigger que lo impida).
4. En el camino **B**, aquí se detiene: no se tocan `producer_versions` ni `import_rows`.
5. Registrar en `audit_logs` una entrada por fila, con `action = 'producer.pii_rekeyed'`, sin valores.

**Comprobaciones de integridad** (todas, antes de dar por buena la recodificación):

- Conteo de filas con `*_enc` **idéntico** al de la línea base: 6.
- Ninguna fila con `kid = k1` en `producers` y **todas** con `kid = k2`.
- Descifrado de las 6 filas correcto, **sin imprimir valores**: se compara el hash del valor descifrado contra el
  tomado antes de empezar.
- `producers_document_bidx_consistent` (el `CHECK` que exige que `document_number_enc` y `document_number_bidx`
  sean ambos nulos o ambos no nulos) sigue satisfecho.
- `producer_versions` **intacta**: mismo número de filas y mismo hash del conjunto de `snapshot`.

**Reversión**: restaurar el respaldo de §4.0. Como `k1` sigue en el llavero, una reversión parcial también
funciona: lo recodificado se lee con `k2` y lo no recodificado con `k1`.

### 4.2.bis Recodificar el historial (solo camino C)

Migración versionada, con el patrón de `0006` y **todas** las demostraciones de §3.2:

1. Antes de tocar nada: para cada una de las 7 filas, guardar en memoria el hash del valor **descifrado** de cada
   campo y el hash del `snapshot` **excluyendo** las cuatro claves `*_enc`.
2. `ALTER TABLE producer_versions DISABLE TRIGGER producer_versions_no_mutation` — dentro de la migración, con el
   mismo comentario explícito que usó `0006`.
3. Por fila y campo: descifrar con el AAD `producer_version|<org>|<id>|<version>|<campo>` y volver a cifrar con la
   activa y **el mismo AAD**.
4. `UPDATE producer_versions SET snapshot = …` cambiando **solo** esas cuatro claves.
5. `ENABLE TRIGGER`.
6. Comprobar, **antes de dar la migración por buena**: los hashes del paso 1 coinciden uno a uno; `changed_by`,
   `changed_at`, `version`, `change_type`, `changed_fields` y `reason` iguales; mismo número de filas; ningún
   token con `kid = k1`. Si algo no cuadra, la migración **falla** y la transacción revierte.
7. `audit_logs`: una entrada por fila, `action = 'producer_version.pii_rekeyed'`, sin valores.

**Reversión**: restaurar el respaldo de §4.0 — `k1` sigue en el llavero, así que la copia se lee sin problema.

### 4.3 Rotar el índice ciego (`PII_INDEX_KEY`) — decisión aparte

**Es un cambio distinto y puede hacerse después, o no hacerse.** Rotarlo exige recalcular
`producers.document_number_bidx` para las 6 filas: descifrar el número, normalizarlo
(`normalizeDocumentNumber`: mayúsculas, sin espacios, puntos ni guiones) y recalcular
`HMAC-SHA256(indexKey, "<org>|DOC|<normalizado>")`.

**Qué se rompe si se hace a medias**: el índice es **determinista y por organización**. Si unas filas quedan con
la clave vieja y otras con la nueva, dos productores con el mismo documento **dejan de coincidir** y la detección
de duplicados (P0-005) empieza a decir que no hay duplicados donde los hay — un falso negativo silencioso, que es
el peor resultado posible. Por eso el reindexado es **todo o nada, en una sola transacción**.

**Comprobaciones obligatorias después de reindexar**:

| Qué | Cómo |
| --- | --- |
| **Búsqueda por documento** | `GET /producers?q=<número>` con un documento conocido devuelve al productor. Antes y después, mismo resultado |
| **Detección de duplicados** | Dar de alta dos productores con el mismo tipo y número en la misma organización abre un caso `PENDING` (regla de P0-005). Debe seguir abriéndose |
| **Casos ya revisados** | Los casos de duplicado existentes siguen enlazados a los mismos pares, sin reabrirse ni duplicarse |
| **Aislamiento entre organizaciones** | El mismo número en dos organizaciones **no** coincide: el índice incluye `organization_id` |
| **Consistencia** | Cero filas con `document_number_enc` no nulo y `document_number_bidx` nulo, o al revés |

**Reversión**: el índice se **recalcula**, no se recuerda; volver a la clave anterior y reindexar otra vez
devuelve exactamente los mismos valores. Es la parte más reversible de todo esto, siempre que la clave anterior se
conserve hasta haber comprobado la nueva.

**El historial no se ve afectado**: `producer_versions.snapshot` **no guarda el índice ciego** (comprobado: sus
claves son `*_enc`, sin `document_number_bidx`). Reindexar no toca ninguna tabla inmutable.

## 5. Qué seguirá expuesto, pase lo que pase

Hay que decirlo sin rodeos, porque ninguna rotación lo cambia:

1. **Los respaldos existentes.** `2026-10-13-pretraslado` y `2026-10-15-qa16` contienen volcados cifrados con
   `k1` **y** un `claves.env` con `k1`. Siguen siendo legibles para quien tenga ambas cosas. **No se borran** —son
   la única vuelta atrás ante un desastre— y **no se les retira la clave** —sin ella no se restauran—.
2. **El historial `producer_versions`**, si se elige el camino B: 7 filas seguirán cifradas con `k1`, y por eso
   `k1` seguirá viva en el llavero.
3. **La transcripción de la sesión** donde se imprimió el valor. Rotar no borra lo escrito.

**Custodia propuesta para los respaldos** (no cambia su contenido):

- Cada carpeta de respaldo, con ACL restringida al usuario (`icacls … /inheritance:r`), ya previsto en `docs/20`;
  **verificarlo** en las tres carpetas, porque hasta ahora solo estaba escrito para `claves.env`.
- Un `LEEME-CLAVES.md` en cada respaldo que diga **qué clave hace falta** —por su `kid`, nunca por su valor— y que
  esa clave está expuesta desde el 2026-10-16.
- En el inventario de respaldos, marcar los dos afectados como **«cifrados con clave expuesta»**, de modo que si
  algún día salen del equipo se sepa qué se está moviendo.
- Para respaldos **nuevos**: se crean ya con `k2` activa, así que no heredan el problema.

## 6. Las cuatro decisiones

**Ninguna está aprobada.** Cada una se puede responder por separado; solo la 1 condiciona a las demás.

---

### D-43.1 — Alcance de la recodificación

**Pregunta**: ¿hasta dónde se recodifica lo ya cifrado con la clave expuesta?

| Opción | Qué hace | Consecuencia |
| --- | --- | --- |
| **A. Solo lo venidero** | Añadir `k2` al llavero y activarla. Ningún dato se toca | Protege **solo lo que se escriba desde ahora**. Siguen expuestos 6 productores, 7 versiones de historial y tres respaldos. `k1` sigue siendo necesaria y sigue en la configuración viva. Coste: minutos. Riesgo: ninguno |
| **B. A + datos mutables** | Recodificar `producers.*_enc` a `k2` | Protege el **estado actual** de los productores. Siguen expuestos el **historial** y los **respaldos**; `k1` sigue viva porque sin ella el historial no se lee. **No es remediación completa y no debe presentarse como tal.** Coste: una migración pequeña y sus comprobaciones |
| **C. B + historial** *(recomendada)* | Recodificar también `producer_versions.snapshot`, con las demostraciones de §3.2 | Único camino que permite **dejar de usar `k1` en el sistema vivo**. Siguen expuestos **los respaldos**, y solo ellos. Coste: la migración de §4.2.bis y sus comprobaciones. Riesgo controlado: reescribe los bytes de 7 filas append-only, con precedente propio (`0006`) y huella en `audit_logs` |

**Recomendación: C.** Mientras `k1` siga haciendo falta para leer algo del sistema vivo, la rotación no ha
reducido casi nada: la clave expuesta sigue en uso. No hay ningún hash, firma ni referencia que lo impida —
comprobado en §3— y el repositorio ya contiene el precedente de cómo hacerlo de forma controlada.

**B es una etapa intermedia legítima** si se prefiere avanzar hoy y decidir el historial después. En ese caso, la
condición es declararlo: cada informe debe decir que **la exposición del historial y de los respaldos sigue
abierta**.

**Consecuencia común a las tres**: ninguna toca los respaldos. Eso se trata en D-43.3.

---

### D-43.2 — ¿Se rota también `PII_INDEX_KEY`?

**Pregunta**: ¿se cambia la clave del índice ciego y se reindexa?

Qué habilita hoy la clave expuesta: no descifra nada, pero permite **recalcular el índice** de un número de
documento concreto y comprobar si está en la base. Sobre un espacio pequeño —una cédula son 10 dígitos— eso
equivale a poder confirmar por fuerza bruta qué documentos están registrados, **sin leerlos**.

| Opción | Qué hace | Consecuencia |
| --- | --- | --- |
| **Sí, reindexar** *(recomendada si se elige C en D-43.1)* | Clave nueva y recálculo de las 6 filas, **todo o nada, en una transacción** | Cierra esa vía en el sistema vivo. Obliga a las comprobaciones de §4.3: búsqueda por documento, apertura de caso duplicado, casos ya revisados, aislamiento entre organizaciones y consistencia del `CHECK`. **Riesgo si se hace a medias**: dos productores con el mismo documento dejan de coincidir y la detección de duplicados produce **falsos negativos silenciosos** — el peor resultado posible. Reversible: el índice se recalcula |
| **No rotar** | Se mantiene la clave | Se asume que quien tenga la clave puede **confirmar** qué documentos están registrados. No afecta al contenido: los datos siguen cifrados. Coste: cero |

**Recomendación: sí, junto con C**, y en una intervención distinta de la de D-43.1, para que un fallo del
reindexado no se mezcle con la recodificación. **No** tiene sentido reindexar si se elige A: quedaría una medida
suelta sobre un sistema cuyo contenido sigue legible con la clave expuesta.

**Dato que acota el riesgo**: el historial **no guarda el índice ciego** (comprobado: `producer_versions.snapshot`
no tiene `document_number_bidx`). Reindexar no toca ninguna tabla inmutable.

---

### D-43.3 — Custodia de los respaldos afectados

**Pregunta**: qué se hace con `2026-10-13-pretraslado` y `2026-10-15-qa16`, que contienen volcados cifrados con
`k1` **y** un `claves.env` con `k1`.

| Opción | Qué hace | Consecuencia |
| --- | --- | --- |
| **Custodia declarada** *(recomendada)* | No se borran ni se les retira la clave. Se restringe la ACL de cada carpeta, se añade un `LEEME-CLAVES.md` que nombre la clave **por su `kid`** y advierta de la exposición, y se marcan en el inventario como «cifrados con clave expuesta» | Siguen siendo restaurables, que es su razón de ser. La exposición **persiste** y queda declarada, de modo que si alguna vez salen del equipo se sepa qué se mueve. Coste: minutos |
| **Rehacer los respaldos con `k2`** | Tomar un respaldo nuevo tras la recodificación y conservar los antiguos igualmente | Un respaldo nuevo **sin** la exposición, pero los antiguos siguen ahí: no se puede restaurar un estado pasado sin su clave. Útil como complemento, **no** como sustituto |
| **Borrar los antiguos** | — | **No.** Son la única vuelta atrás ante un desastre, y uno de ellos es la evidencia de QA-16. Se descarta |

**Recomendación: custodia declarada**, y tomar un respaldo nuevo después de recodificar. La frase que debe
sobrevivir a este documento: **ninguna rotación de claves remedia un respaldo ya tomado.**

---

### D-43.4 — Cuándo

**Pregunta**: ¿antes de seguir con otra historia, o después?

| Opción | Consecuencia |
| --- | --- |
| **Ahora, antes de la próxima historia** *(recomendada)* | Cuanto más tarde, más datos escritos con `k1` habrá que recodificar. Hoy son **6 filas y 7 versiones**: el volumen más pequeño que va a haber nunca. Coste: una sesión |
| Después del piloto | El piloto escribe datos reales de productores reales. Recodificar entonces cuesta más, y hasta ese momento **todo lo nuevo se sigue cifrando con la clave expuesta** |
| No hacerlo | Decisión legítima si se asume que los datos son sintéticos y el entorno es local. Debe quedar **escrita como decisión**, no como olvido, y repetirse en cada informe que mencione protección de datos personales |

**Recomendación: ahora**, precisamente porque es barato. El argumento no es la gravedad —los datos son
sintéticos— sino el coste creciente: esta es la ventana más barata que va a existir.

---

**Mientras no se decida**: `k1` sigue activa, el sistema funciona igual y la exposición sigue siendo la descrita.
Ninguna de estas opciones habilita llamadas satelitales, `READY`, conclusiones regulatorias ni despacho.
