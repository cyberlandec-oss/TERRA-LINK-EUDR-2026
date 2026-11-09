# Evidencia D-43 — Rotación de las claves de cifrado y del índice ciego (2026-10-16)

Entorno local de desarrollo, datos **sintéticos**. Procedimiento: `docs/decisiones/D-43-ROTACION-CLAVES-PII.md`.
Este documento **no contiene ninguna clave**, ningún valor personal **ni ningún hash de un valor personal**.

**Alcance adoptado**: **C** (incluye historial) · rotación del índice ciego · custodia de los respaldos
existentes · ejecución inmediata. **No elimina la exposición de los respaldos ni de la transcripción.**

## 1. Respaldo del estado actual

El respaldo más reciente que existía, `2026-10-15-qa16`, es de **39 migraciones**: no sirve como vuelta atrás de
un estado de **43**. Se tomó uno nuevo antes de tocar nada.

| | |
| --- | --- |
| Carpeta | `_respaldos/2026-10-16-pre-rotacion-pii/` |
| Escrituras | **Detenidas** (`api`, `web`, `worker` parados) durante el volcado |
| Contenido | `terra_link.dump` (569 KiB) · `object-data.tar.gz` · `claves.env` (ACL restringida) · `estado-actual.txt` (107 tablas con conteo exacto) · `SHA256SUMS.txt` |
| Migraciones | **43**, la más antigua `2026-10-13T15:14:19.119Z` |
| Integridad | `sha256sum -c` → los 4 archivos **OK** |

**Los respaldos anteriores se conservan íntegros.** Ninguno se borró, movió ni reescribió.

## 2. Ensayo sobre una copia aislada

`node infra/d43/ensayo-copia-aislada.mjs <respaldo> <claves-nuevas>`: PostgreSQL propio, volumen propio, puerto
5470, restaurado desde el volcado. **No toca la base de desarrollo, sus volúmenes ni los respaldos.** Al terminar
destruye contenedor y volumen.

**Resultado: APROBADO — 19/19 comprobaciones.**

| # | Comprobación | Resultado |
| --- | --- | --- |
| 0 | La copia es del estado actual | **43 migraciones** |
| 0 | Antes: todo el texto cifrado con la clave anterior | **`k1`**, 39 tokens |
| — | *(18 campos de productor y 21 de historial descifrados en memoria para comparar)* | — |
| 1 | **Contenido descifrado idéntico en productores** | **18 iguales, 0 distintos** |
| 2a | **Contenido descifrado idéntico en el historial** | **21 iguales, 0 distintos** |
| 2b | **Identidad, autoría, fechas, orden y contenido no cifrado del historial intactos** | **10 filas, huella idéntica** |
| 3a | Cada índice ciego es el que corresponde a la clave nueva | **6 correctos, 0 incorrectos** |
| 3b | Ningún índice conserva el valor anterior | **6 cambiados de 6** |
| 3c | **La búsqueda por documento encuentra al productor** | **1 coincidencia** |
| 3d | **La detección de duplicados sigue siendo posible** | 5 índices distintos, **1 con más de un productor** |
| 4 | **Ningún índice coincide entre organizaciones distintas** | **0 cruces** |
| 4b | El `CHECK` de consistencia cifrado↔índice se mantiene | **0 inconsistencias** |
| 5a | **La protección append-only quedó activa** | `tgenabled = O` |
| 5b | **Y rechaza una modificación del historial** | Rechazada |
| 6a | **Un fallo inducido aborta la operación** | Abortó |
| 6b | Y no deja nada a medias | Productores e historial **idénticos** |
| 6c | Ni el trigger desactivado | `tgenabled = O` |
| 7 | Conteos conservados | 9 productores, 10 versiones, 4 organizaciones, 3 lotes |
| — | Ningún token conserva la clave anterior | **`k2`: 39** |

**Cómo se comprobó la igualdad del contenido, y cómo no.** No se guardan hashes de los valores personales: un
hash de una cédula es otra vía para confirmarla por fuerza bruta, que es justo el problema que el índice ciego ya
plantea. El ensayo **descifra en memoria** antes y después y compara en tiempo constante; lo único que sale por
consola son conteos y veredictos. La huella que demuestra que los metadatos del historial no cambiaron se calcula
**excluyendo** los cuatro campos cifrados.

## 3. Intervención local

Ejecutada **solo** después de que el ensayo pasara las 19 comprobaciones.

### Orden de activación

| # | Paso | Reversión |
| --- | --- | --- |
| 1 | Escrituras detenidas (`api`, `web`, `worker` parados) | Arrancarlos |
| 2 | `.env`: `k2` **añadida** al llavero (`k1` + `k2`), activa `k2`, clave de índice nueva | `claves.env` del respaldo previo |
| 3 | `npm run rekey:pii -w apps/api -- --aplicar` | Restaurar el volcado previo; `k1` seguía en el llavero |
| 4 | Aplicación arrancada | — |
| 5 | Verificación de lectura, búsqueda e historial | — |
| 6 | **`k1` retirada** del llavero activo | Volver a añadirla desde `claves.env` del respaldo |

**En ningún momento el sistema atendió con claves e índices incompatibles**: el servicio estuvo parado entre los
pasos 1 y 4, y todo el paso 3 ocurrió en **una sola transacción**.

### Resultado de la recodificación

```
modo: APLICADO · clave activa: k2
productores : 6 filas · 18 campos · 18 contenido igual · 0 distintos
historial   : 7 filas · 21 campos · 21 contenido igual · 0 distintos · metadatos intactos
índice      : 6 recalculados · 3 sin documento
claves en uso después: k2:39
errores: []
```

### Verificación con el servicio en marcha

| Comprobación | Resultado |
| --- | --- |
| Contenedores | **7**, sanos |
| Puertos | 3000 → 200 · 3001 → 200 · 4000/api/docs → 200 |
| Fichas de productor leídas por la API | **8 / 8** |
| Documentos descifrados | **5** |
| **Encontrados por búsqueda exacta de su documento** | **5 / 5** |
| Historial legible | **8 / 8** |
| Claves en uso en la base | **`k2`: 39** — ninguna con `k1` |
| Trigger append-only | `tgenabled = O` |

## 4. El sistema vivo funciona sin `k1`

`k1` se retiró del llavero activo y el servicio se recreó. Comprobado **después**:

```
claves en el contenedor: k2        activa: k2
fichas leídas          : 8 / 8
documentos descifrados : 5
encontrados por búsqueda: 5 / 5
sistema vivo funciona sin k1: true
```

**`k1` ya no es necesaria para operar.** Sigue siendo necesaria para **restaurar los respaldos anteriores**, y por
eso no se destruye.

## 5. Custodia de las claves históricas

Fuera de la configuración activa y con acceso restringido. **Ningún respaldo se borró.**

| Respaldo | Clave necesaria | ¿Expuesta? | `claves.env` | ACL |
| --- | --- | --- | --- | --- |
| `2026-10-13-pretraslado` | `k1` | **Sí** | Sí | Restringida al usuario |
| `2026-10-13` | `k1` (no incluida) | **Sí** | No | — |
| `2026-10-15-qa16` | `k1` | **Sí** | Sí | Restringida al usuario |
| `2026-10-16-pre-rotacion-pii` | `k1` | **Sí** | Sí | Restringida al usuario |
| `2026-10-16-post-rotacion-pii` | **`k2`** | **No** | Sí | Restringida al usuario |

Cada carpeta lleva un `LEEME-CLAVES.md` que dice **qué clave hace falta, por su identificador**, si está expuesta
y por qué no se borra. **Ningún archivo contiene una clave escrita en esa ficha.**

Se tomó además un respaldo **posterior** a la rotación (43 migraciones, verificado con `sha256sum -c`), que es el
primero cifrado con la clave nueva.

Las copias temporales de claves usadas durante la intervención se **eliminaron** al terminar.

## 6. Lo que esta intervención NO resuelve

- **Los respaldos anteriores siguen expuestos.** `2026-10-13-pretraslado`, `2026-10-13`, `2026-10-15-qa16` y
  `2026-10-16-pre-rotacion-pii` contienen datos cifrados con `k1`, y `k1` se imprimió en una consola. Rotar la
  clave del sistema vivo **no cambia un archivo ya escrito**. No se borran porque son la única vuelta atrás ante
  un desastre, y uno de ellos es la evidencia de QA-16.
- **La transcripción de la sesión sigue siendo material sensible.** Rotar invalida el uso, no borra lo escrito.
- **No acredita nada regulatorio.** La conclusión sigue `UNDETERMINED`, el expediente `BLOCKED`, las llamadas
  satelitales deshabilitadas y `READY` sin habilitar.

## 7. Validación y pruebas

| | |
| --- | --- |
| Herramienta y pruebas | `2026-10-16T03-42-52-644Z` sobre **`ebd3ea1`** — **APROBADA** |
| Ensayo en copia aislada (script) | `2026-10-16T04-12-21-614Z` sobre **`3288e97`** — **APROBADA** |
| Pruebas | **63 suites, 585** unitarias e integración · **72** E2E |
| Pruebas nuevas | **4** en `test/rekey-pii.int-spec.ts`, contra PostgreSQL real |
| Ensayo en copia aislada (ejecución) | **19/19 APROBADO** |

Las cuatro pruebas de integración fijan lo mismo que el ensayo, con una fixture propia: contenido e historial
intactos, búsqueda y duplicados tras reindexar, aislamiento entre organizaciones, índice igual al esperado,
reversión ante fallo inducido, append-only restaurado y comprobado, y que ningún resultado publica datos
personales.

---

## Corrección de la evidencia de reversión (2026-10-16, posterior)

**La reversión a mitad de operación no estaba demostrada.** La prueba que se presentaba como tal inducía el
fallo poniendo `PII_ACTIVE_KEY_ID = 'k9'`, una clave activa fuera del llavero. Contrastado después:
`recodificar` llama a `parsePiiConfig` en su **primera línea** (`apps/api/src/db/rekey-pii.ts:62`) y esa función
lanza cuando la clave activa no está en `PII_KEYS` (`apps/api/src/crypto/pii.ts:35`), **antes** de abrir la
transacción (línea 73). Con `k9` no llegaba a escribirse nada, así que no había nada que revertir: las
aserciones de «todo sigue igual» se cumplían trivialmente. El comentario de la prueba —«`encrypt` revienta a
mitad del recorrido»— era incorrecto.

**Las dos comprobaciones, ahora distinguidas:**

| Prueba | Qué induce | Qué demuestra |
| --- | --- | --- |
| «una clave activa inexistente se rechaza antes de tocar nada **(comprobación previa, no reversión)**» | `PII_ACTIVE_KEY_ID = 'k9'` | Que un llavero inservible se rechaza **antes** de escribir. Es una propiedad real y útil —no se empieza con configuración inválida— pero **no es reversión**. Se afirma el mensaje exacto, `PII_ACTIVE_KEY_ID no está en PII_KEYS`, para que quede claro que el rechazo es previo |
| «un fallo **DESPUÉS** de escribir datos e historial revierte cifrados, índices y auditoría, y deja el trigger activo» | Un trigger `BEFORE INSERT` sobre `audit_logs` que lanza al insertarse la auditoría de éxito — **último paso antes del commit**, ya con productores e historial reescritos y con el trigger append-only desactivado y vuelto a activar | La reversión de verdad |

**Cómo se acredita que el fallo fue posterior a las escrituras.** La prueba parte recodificando todo a `k1`, de
modo que cualquier token `k2` que se observe solo puede venir de la transacción en curso. El trigger inyectado
cuenta, **dentro** de la transacción, los tokens ya reescritos y los incorpora al mensaje de la excepción, que
sobrevive al rollback. Observado en la corrida: **`FALLO_INDUCIDO productores_k2=3 historial_k2=4`**. Es decir,
3 productores y 4 filas de historial ya estaban reescritos cuando se produjo el fallo.

**Lo que se comprueba después del rollback**: que los cifrados y los índices vuelven **exactamente** a los de
antes (comparación fila a fila de las cuatro columnas cifradas y del índice ciego); que el historial vuelve
igual, con autoría, fechas y motivo; que **no queda auditoría de éxito** (`action = 'pii.rekeyed'` no aumenta);
que el trigger append-only queda en **`O`** y **muerde** (un `UPDATE` sobre `producer_versions` se rechaza).
Al terminar, la prueba deja el entorno en `k2` para el resto de la suite.

**Alcance**: base aislada `*_test` del arnés de integración. **No se repitió la rotación sobre la base de
desarrollo**, y esta corrección no la exige: lo que cambió es la prueba, no la intervención ya ejecutada.

| | |
| --- | --- |
| Commit | **`4cf28d2`** |
| Validación | `2026-10-17T01-44-22-107Z` sobre `4cf28d2` — **APROBADA** |
| Pruebas | **63 suites, 586** unitarias e integración · **72** E2E (585 → 586: la prueba de reversión añadida) |
| Pruebas en `test/rekey-pii.int-spec.ts` | **5** (4 anteriores, una de ellas renombrada, más la nueva) |

**Lo que esta corrección no cambia**: la rotación de claves ejecutada sobre desarrollo sigue siendo válida y su
evidencia anterior se conserva. Los cuatro respaldos cifrados con la clave expuesta siguen igual, con su
`LEEME-CLAVES.md` y su exposición declarada; la rotación del sistema vivo no remedia un respaldo ya tomado.
