# P1-008 — Integración ERP/API por webhooks (RF-39)

**SHA validado y desplegado: `fb46321`** · `npm run validate` **APROBADA**
(`validation-results/2026-10-19T11-52-40-054Z`): 86 suites, **913 pruebas**, E2E incluido.
Demostración sobre ese despliegue: `e2e/review/integracion.mjs` **26/26**.

> **Revisión del 2026-10-19 (tarde).** El cierre anterior, sobre `0bc57b8`, quedó
> **APROBADA** y acredita su propia versión. Al volver a contrastar los criterios aparecieron
> dos correcciones: «conciliación» **no** era una obligación incumplida (§5), y en cambio sí
> faltaba la **paginación** que `docs/09:7` exige (§5 bis).

Migración persistente **0055**, con respaldo verificado por restauración aislada. Esta
revisión **no añade migración**: no hay cambio persistente que respaldar de nuevo.

## 1. Contraste literal con los criterios originales

| Criterio, citado | Dónde | Estado |
| --- | --- | --- |
| «ERP/API/webhooks con asociación de referencias» · Restricción: «**Idempotencia y tenant**» | `docs/03:55` (RF-39) | **demostrado** |
| «**Firma/idempotencia/tenant/mapping**; **referencia de paquete/submission exacta**» | `docs/18:209` (aceptación mínima) | **demostrado** |
| «Contratos/webhook/idempotencia» | `docs/24:30` (docs 09/15) | **demostrado** |
| «Webhook con **firma/timestamp/deduplicación**; referencia externa no sustituye autorización interna» | `docs/15`, Seguridad de llamadas externas | **demostrado** |
| «Listas **paginadas con límites y orden estable**; filtros whitelist» | `docs/09:7` (documento que `docs/24` asigna a RF-39) | **demostrado** tras corregirlo (§5 bis) |
| «Contrato de evento, referencia, tenant y **conciliación**» | `docs/15`, fila ERP, columna *Condición de activación* | **no es criterio de esta historia** (§5) |
| Dependencia «P0-015/029» | `docs/18:209` | el bus **se reutiliza**: el envío es un consumidor más |

**El bus existente no demostraba por sí solo esta historia.** Tenía resuelta la entrega
*interna* —reintentos, arrendamiento, cola muerta, recibos—. Lo que faltaba era **salir de
la aplicación**: un destino configurado por la organización, una **firma que el receptor
pueda verificar** y el **resultado de cada intento** consultable. Por eso **no se construyó
otra cola**: `webhookConsumer` es un consumidor del bus y hereda todo lo anterior; la
migración 0055 solo añade **el destino** y **el resultado por intento**, ambos append-only.

## 2. La garantía de entrega, dicha como es

Un índice único impide que **Terra Link** reenvíe un evento **cuya entrega registró como
lograda**. **No** impide que el receptor procese dos veces:

> el receptor procesa → responde → **la respuesta se pierde** (conexión cortada, plazo
> agotado) → Terra Link no puede saber que se procesó, registra un **fallo** y el bus
> reintenta → el receptor **recibe el mismo mensaje otra vez**.

La garantía es **AL MENOS UNA VEZ**, y así se publica (`delivery_guarantee`). «Exactamente
una vez» **no la da el emisor**: la da el receptor, deduplicando por `X-Terra-Delivery-Id`,
que es el mismo en todos los reintentos de una entrega. La API lo dice y la pantalla lo
repite donde se configura, con el nombre de la cabecera que hay que guardar.

**Demostrado, no afirmado** (`webhooks.int-spec.ts` y `integracion.mjs`): un receptor que
**procesa y pierde la respuesta** recibe el mensaje **2 veces con 1 solo identificador**, y
deduplicando por él su efecto ocurre **una sola vez**; del lado de Terra Link constan
**intento 1 `ERROR_DE_RED`** e **intento 2 `ENTREGADO`** sobre esa misma entrega.

## 3. Recorrido demostrado contra un receptor LOCAL

El receptor lo levanta el propio arnés en este equipo. **No se contactó ningún destino
externo** — ni real ni de ejemplo. 21 entregas recibidas en la corrida.

| # | Qué se demostró | Resultado observado |
| --- | --- | --- |
| 1 | Configuración autorizada | técnico → **403**; administrador → **201** con secreto de 43 caracteres |
| 2 | Secreto entregado **una** vez | ausente de la lista, de la base en claro y de la auditoría; solo huella de 16 |
| 3 | Tipo de evento inexistente | **422 `EVENT_TYPE_UNKNOWN`**; catálogo de **24 tipos** publicado |
| 4 | Dirección no admisible | URL inválida **422**; host que no resuelve **422**; el modo local se **declara** |
| 5 | Evento real → entrega firmada | el receptor **verifica la firma con su secreto**; con otro secreto **no** valida |
| 6 | Firma inválida | cuerpo alterado → inválida; marca de tiempo cambiada → inválida |
| 7 | Asociación de referencias | `ProducerRegistered` / agregado `PRODUCER`; **no inventa** paquete |
| 8 | **Referencia de paquete y submission** | paquete **`DD-2026-00001 #5`**, huella `dbb2a8f16b5b…`, **`submission = NOT_SUBMITTED`** |
| 9 | Consulta del resultado | `ENTREGADO` HTTP 200, intento 1, 49 ms |
| 10 | Duplicados | el evento ya entregado **no** se reenvía; identificador estable |
| 11 | Fallo y recuperación | 503 «receptor en mantenimiento» en el intento 1 → **ENTREGADO en el 2, mismo `delivery_id`** |
| 12 | **Al menos una vez** | 2 llegadas, 1 identificador, **1 efecto**; garantía publicada `AL_MENOS_UNA_VEZ` |
| 13 | **Apagar alcanza a los reintentos pendientes** | con entrega sin lograr: se apaga, el receptor se repone, y **0 entregas logradas** |
| 14 | Apagar un destino | evento nuevo tras apagar: **no llega**; destino en versión 2, `activo=false` |
| 15 | **Listas paginadas** | **165 intentos en 55 páginas**, ninguno repetido, orden estable; `limit` excesivo → **400**; cursor inválido → **400** |
| 16 | Permisos | técnico: lista **403**, intentos **403**; CONTROL administrador **200** |
| 17 | Aislamiento | organización ajena **404 opaco** para leer y para configurar |
| 18 | Verificar firma | propia → válida; ajena → inválida |
| 19 | Pantalla | destinos con su huella; **el secreto no está a la vista**; «al menos una vez» y la cabecera, sí |
| 20 | Pantalla | intentos con su resultado, **incluido el rechazado** y lo que contestó el receptor |
| 21 | **Pantalla: la lista se continúa** | **50 → 100** intentos al pulsar «Cargar más»; la pantalla **dice** que quedan más |
| 22 | Pantalla | **solo** los 24 tipos que existen |
| 23 | Permisos en pantalla | el técnico no ve el enlace y por URL recibe **aviso de acceso**, no «sin datos» |
| 24 | Teclado | primer foco alcanzable; campos enfocables por su etiqueta |
| 25 | 390 px | sin desborde horizontal; tablas desplazables |

**Arranque del despliegue**: API y worker arrancan (`worker-9db18754`). **Las claves no
aparecen en los registros**: 0 coincidencias de `PII_KEYS`, `JWT_SECRET` y `PII_INDEX_KEY`
en los registros de ambos contenedores. Al terminar, **los 24 destinos de ensayo quedan
desactivados** (`activos: 0`), y `WEBHOOK_ALLOW_LOCAL` vuelve a **false**: la API publica
`local_destinations_allowed = false` y el aviso de que los destinos internos se rechazan.

## 4. Defectos encontrados y corregidos durante esta entrega

1. **Precargar pdf.js a nivel de módulo rompía ocho suites de integración**
   («import after teardown»). La decodificación pasa a **otro proceso**, lo que además hace
   que los **límites interrumpan de verdad**.
2. **El intento fallido no dejaba rastro**: se escribía dentro de la transacción del bus y
   se iba con el `ROLLBACK` que provocaba el propio fallo.
3. **Un tipo de evento inexistente se admitía en silencio**: el destino quedaba suscrito a
   nada y parecía bien configurado.
4. **`active` era un interruptor que no apagaba**: se guardaba y se publicaba, y el
   consumidor no lo miraba.
5. **El worker no habría arrancado en el despliegue**: descifra el secreto de firma y el
   compose no le pasaba las `PII_*`.
6. **Tres comprobaciones propias que no comprobaban**: una ruta inexistente leída como «no
   hay expedientes», una recuperación que admitía cualquier entrega en vez de la misma, y
   destinos de ensayo que quedaban encendidos contra un receptor muerto.
7. **Las listas se cortaban en silencio** a 100 filas sin cursor (§5 bis).
8. **Una prueba ajena dependía del bucket compartido**: `storage-sweeper` fallaba porque
   `discover()` llena el lote de 50 con huérfanos acumulados y deja sin reclamar la tarea
   recién encolada. No era un defecto del producto —el archivo nunca se borró—, pero sí una
   prueba que se volvía más frágil con cada corrida.

## 5. Lo que esto NO acredita, y lo que falta

- **No se ha conectado ningún ERP real.** Todo el recorrido es contra un receptor local.
- **«Mapping» se cumple como contrato declarado** del documento entregado más el catálogo
  de tipos de evento. **No hay correspondencia de campos con el esquema propio de un ERP
  concreto**: eso exige un ERP concreto, que aquí no existe.
### «Conciliación»: por qué NO es una obligación incumplida de P1-008

La primera versión de este documento la listaba junto a los criterios, y eso creaba la duda
de si el cierre era legítimo. El contraste literal dice otra cosa:

| Dónde aparece | Texto | A quién obliga |
| --- | --- | --- |
| `docs/18:207` | «mapeo … **conciliación** que no escribe datos» | criterio de **P1-006** |
| `docs/18:208` | «recibos auténticos, **reconciliation ante timeout**» | criterio de **P1-007** |
| `docs/18:209` | «Firma/idempotencia/tenant/mapping; referencia de paquete/submission exacta» | **no la nombra** |
| `docs/15`, benchmark | «Canal autorizado, mapeo y **conciliación**» → **P1-006** | asignada a P1-006 |
| `docs/15`, benchmark | «Grants explícitos y conexión por contrato» → **P1-001/008** | lo que toca a P1-008 |
| `docs/15`, fila ERP | columna *Condición de activación* | condición para declarar **real** la integración con un tercero |

Esa última columna es la misma que, para WHISP, exige «parte B» (términos, autorización de
datos, custodia de la clave) con **P0-028 cerrada**, y para GUIA exige un canal oficial con
**P1-006 entregada**. Declarar activa una integración con un tercero y cerrar la historia
que la construye son cosas distintas.

### §5 bis — Lo que SÍ faltaba: listas paginadas (`docs/09:7`)

> «Listas **paginadas con límites y orden estable**; filtros whitelist.»

`docs/24` asigna `docs/09` a RF-39, y la primera entrega devolvía `LIMIT 100` sin cursor:
**un corte invisible, no una página** —quien integra no podía saber que faltaba algo—.
Corregido en **ambas** listas con la convención que ya usan productores, parcelas y
productos: `limit` con tope, `next_cursor` y **orden estable**. En los intentos el orden es
por instante descendente **con el identificador como desempate**: sin él, dos intentos del
mismo microsegundo harían que una página repitiera u omitiera filas. Límite excesivo y
cursor inválido responden **400**, no se ignoran. La pantalla continúa la lista con «Cargar
más» y publica qué significa el cursor, en vez de mostrar un recorte como si fuera todo.

Demostrado: **165 intentos en 55 páginas, ninguno repetido**, orden estable; y en pantalla
**50 → 100** al continuar.
- **Recibir un evento no acredita conformidad EUDR ni presentación oficial.** Cuando el
  evento lleva referencia de paquete, su `submission.status` es siempre `NOT_SUBMITTED`:
  descargar no es presentar.
- **P1-007 (EUDR-IS) conserva su bloqueo externo**; nada de esto la desbloquea.
- `UNDETERMINED`, el satélite deshabilitado y las compuertas de READY y despacho quedan
  **igual**: esta historia no levanta ninguna.

## 6. Qué puede hacer ahora una persona

1. Entrar como administrador → **Administración › Integración (webhooks)**.
2. Configurar un destino: nombre, dirección `https` y los eventos a los que suscribirse
   (solo los que existen). **Copiar el secreto en ese momento**: no vuelve a mostrarse.
3. En su sistema: verificar la firma `X-Terra-Signature` sobre `«<instante>.<cuerpo>»` y
   **guardar el `X-Terra-Delivery-Id` de lo ya procesado** para descartar repetidos.
4. Ver en la misma pantalla **cada intento con su resultado**, incluidos los fallidos y lo
   que contestó el receptor.
5. Para retirar la integración: volver a configurar el destino como **inactivo, con
   motivo**. Deja de recibir, **también los reintentos pendientes**, y el historial se
   conserva.

## 7. Pruebas

- `apps/api/test/webhooks.int-spec.ts` — **18** casos contra PostgreSQL real y receptor local.
- `apps/api/src/extraction/extraction.spec.ts` — **22**, incluidos los nuevos de límite real
  y descompresión acotada.
- `e2e/review/integracion.mjs` — **26/26** sobre el despliegue de `fb46321`.
- `npm run validate` sobre `fb46321`: **APROBADA**, 913 pruebas.

El candidato intermedio `c7a1f83` quedó **FALLIDA** y su registro se conserva. La causa no
estaba en la paginación: `storage-sweeper` depende del **bucket de pruebas compartido**
—1068 objetos acumulados—, cuyo `discover()` llena el lote de 50 y deja sin reclamar la
tarea que la propia prueba acababa de encolar. Se corrigió acotando el barrido a su clave
(`onlyKeys`, que ya existía) y quitando la suposición de temporización, **añadiendo** la
comprobación de la pasada siguiente. El producto se comportó bien en todo momento: el
archivo nunca se borró.

Corridas conservadas: `94b4336` (APROBADA, 910) y `ee0e74e` (APROBADA, 910) acreditan **sus
propias versiones**, no las correcciones posteriores. La corrida
`2026-10-19T02-29-15-226Z` está **ANULADA** y no acredita ningún SHA: el árbol se modificó
mientras se ejecutaba (ver su `ANULADA.md`).
