# Evidencia — P1-012 «Precio, prima y pagos informados» (2026-10-18)

**Validación**: `npm run validate` **APROBADA** sobre `4f94e7b` — **833** pruebas, **72** E2E, 0 fallos
(`validation-results/2026-10-18T18-35-27-104Z`). **Despliegue**: `/version` → `4f94e7b` (`BUILD_ARG`), esquema
**`0052`**. **Respaldo** hecho y **verificado por restauración aislada** (§9).

## 1. Qué piden los criterios originales, y qué se hizo con eso

| Criterio (referencia exacta) | Qué exige | Cómo se cumple |
| --- | --- | --- |
| **S3 §32** (`docs/sources/S3:1215`): añadir «**¿cuánto recibió el productor?**» con precio, prima y **pagos** | La pregunta que falta | Dato económico por entrega + pagos informados + resumen por productor |
| **RF-43** (`docs/03:59`): «precio, prima y pagos **informados**; **no ejecutar transferencias**; **moneda y privacidad**» | Registrar sin mover dinero | Pago = registro **informado** por una persona; **ninguna integración bancaria**; moneda guardada y **nunca convertida**; permisos propios |
| **P1-012** (`docs/18:213`): «dato **informado/versionado** y moneda; privacidad; **ninguna transferencia automática**» | Versionado y privado | Tablas **append-only**; corregir es otra versión con motivo; `economics:*` separado de `delivery:*` |
| `.claude/rules/00-domain.md`: «peso y dinero usan **decimales y unidades explícitas**» | Aritmética exacta | Enteros escalados a seis decimales, reutilizando `multiplicar`/`normalizar` de P1-010 |
| `.claude/rules/00-domain.md`: «no inventes datos ausentes» | Ausencia explícita | **Prima ausente ≠ cero**; importe **NO_CALCULABLE** con su razón |

## 2. Lo que se reutilizó en vez de duplicar

El dinero **cuelga de la entrega que ya existe**: productor, producto, fecha, cantidad y unidad ya estaban.
No se creó un segundo registro de la misma operación. Además se reutiliza:

- la **aritmética decimal** de P1-010 (`multiplicar`, `normalizar`) — sin coma flotante;
- el **patrón de corrección** de entregas: versión, motivo, idempotencia por `operation_id` y concurrencia
  optimista (aquí `expected_record_number`, allí `expected_version`);
- la **auditoría** existente (`economics.recorded`, `economics.corrected`, `economics.payment_informed`,
  `economics.payment_corrected`);
- el **catálogo de permisos** y su prueba de unión de roles.

## 3. Qué recorrido nuevo completa una persona

1. Desde la entrega, abre **Precio, prima y pagos** —el enlace solo existe si tiene el permiso—.
2. **Registra** el dato: precio con su moneda y unidad, **base declarada**, prima **opcional con fundamento**,
   y **procedencia** (quién lo afirma, sobre qué apoyo, a qué fecha corresponde).
3. **Consulta** el importe, la prima y el total, con lo que falta **señalado, no supuesto**.
4. **Corrige con motivo**: la versión anterior **se conserva** y se ve en el historial.
5. **Informa un pago** —y la pantalla le dice que **eso no ha movido dinero**—.

## 4. Las cinco distinciones, sostenidas por el código

1. **El presupuesto de P1-010 no es el precio del cacao.** Tablas distintas, permisos distintos, pantallas
   distintas; la respuesta lo dice en cada lectura (`not_the_same`) y no se suman nunca.
2. **Un precio registrado no demuestra un pago.** Los pagos son otra tabla y van **aparte** en la respuesta;
   informar uno **no cambia** el total acordado —comprobado antes y después—.
3. **Una prima ausente no es cero.** `NO_DECLARADA` deja el total **INCOMPLETO**; declarar **0 con fundamento**
   es un dato distinto que sí completa el total. Las dos cosas están probadas en la misma prueba.
4. **Una prima no se deduce.** Sin `premium_grounds` se rechaza con **422 `PREMIUM_GROUNDS_REQUIRED`**, y el
   CHECK `economics_premium_shape` lo impone también en la base. Probado además que **liberar la calidad de
   una recepción no hace aparecer ninguna prima**.
5. **Sin conversiones silenciosas.** Precio por **QQ** sobre base en **KG** → **NO_CALCULABLE** con su razón;
   precio en **USD** con prima en **EUR** → el total **no se suma**. Tampoco se suman recepciones en unidades
   distintas al tomar la base.

## 5. Aritmética y fechas

Dinero en **enteros escalados a seis decimales**: `0,1 × 3 = 0,3` —no `0.30000000000000004`— y
`0,123456 × 3 = 0,370368`. **Un decimal, un formato**: todo se normaliza al salir.

**Defecto corregido durante la implementación**: `agreed_on`, `paid_on` y la fecha de entrega salían como
marca de tiempo con zona (`2026-10-18T05:00:00.000Z`). Una **fecha pura que gana hora y zona puede cambiar de
día**: se publican ya como fecha (`::text`).

## 6. Privacidad (RF-43), comprobada por los dos lados

- `economics:read` / `record` / `correct` son **permisos propios**: **leer una entrega no da acceso a su
  dinero**. ORG_ADMIN y MANAGER registran y corrigen; **AUDITOR solo lee**; el **técnico de campo no accede**.
- La **vista de la entrega no publica** ningún campo económico, y en la pantalla **ni siquiera aparece el
  enlace** sin permiso —se muestra el **motivo**, no una pantalla vacía—.
- El **expediente de debida diligencia** y la **vista del comprador** no reciben campos nuevos:
  `portal-comprador.mjs` sigue en **17/17**.

## 7. Correcciones, historial y concurrencia

Corregir **exige motivo** (sin él, **400**) y **conserva** la versión anterior con su importe original. Las dos
tablas son **append-only por disparador**: un `UPDATE` o un `DELETE` directo son **rechazados** —probado—.
Dos correcciones simultáneas sobre la misma versión dan **201 y 409**, y queda **una sola** versión nueva.
Repetir la misma `operation_id` **no** crea una segunda versión; registrar dos veces responde **409
`ALREADY_RECORDED`**: se corrige, no se registra de nuevo.

## 8. Lo que NO hace

- **No ejecuta ninguna transferencia** ni consulta banco o pasarela alguna.
- **No precarga** precios de mercado, tarifas ni primas, y **no llama a ningún servicio externo**.
- **No deduce** una prima de la calidad, la trazabilidad ni la conformidad.
- **No convierte** unidades ni monedas, y **no suma** lo incompatible: lo dice y lo cuenta aparte.
- **No toca** la entrega, la recepción, el inventario, el riesgo ni los expedientes —comprobado por igualdad
  de `row_version`, cantidades y número de eventos de dominio—.
- **No levanta** `UNDETERMINED`, READY ni el despacho.

## 9. Respaldo

Hay migración (**0052**), así que corresponde: `_respaldos/2026-10-18-p1012-migracion-0052/`, capturado con
**la aplicación detenida** (`api`, `web` y `worker` retirados) y **verificado por restauración aislada** en un
contenedor `tl-restore`, esperando al **arranque definitivo** —no a la fase de inicio de la imagen, que fue el
error del que ya quedó constancia en P1-010—.

| Comprobación | Resultado |
| --- | --- |
| Restauración aislada | **0 errores** |
| Migraciones | **52**, la última `0052_p1012_precio_prima_pagos` |
| Conteos por tabla | **97 tablas con datos, idénticas** |
| Restricciones | **331** FK, **422** CHECK, **204** UNIQUE |
| Objetos del esquema | **487**, igual que el origen |
| Filas económicas restauradas | **32** registros y **12** pagos |
| Append-only en la copia | **2** disparadores, y un `DELETE` sobre `delivery_economics` **es rechazado** |

Incluye también `object-data.tar.gz`, `claves.env` con ACL restringida y `SHA256SUMS.txt`.

## 10. Resultados

| Comprobación | Resultado |
| --- | --- |
| `economics.int-spec.ts` | **16/16** |
| `src/authz/catalog.spec.ts` (unión de permisos del rol) | **9/9** |
| `node e2e/review/economia.mjs` | **18/18** sobre el despliegue |
| `node e2e/review/portal-comprador.mjs` | **17/17** (el comprador no recibe campos nuevos) |
| `node e2e/review/estados-web.mjs` · `web-por-rol.mjs` | **APROBADOS** |
| `npm run validate` sobre `4f94e7b` | **APROBADA**: 833 pruebas, 72 E2E, 0 fallos |
| `node e2e/review/economia.mjs` sobre el despliegue de `4f94e7b` | **18/18** |
| Respaldo verificado por restauración aislada | **0 errores**, 97 tablas idénticas, 487 objetos |

## 11. Decisiones de producto (D-52, **adoptada el 2026-10-18**)

Base del precio, significado de la prima y quién registra **no las fija la fuente**: son decisiones de
producto, y se adoptó la **opción (A) en las tres**. La adopción **ratifica** el comportamiento ya validado en
`4f94e7b`, así que **no cambia código** ni repite validación. Las tres quedan **escritas en el propio dato**
—`basis_kind` con su cantidad y unidad, `premium_kind` con su fundamento, y el autor de cada versión—, sobre
tablas append-only: **adoptar otra opción más adelante no reescribe lo ya registrado**.
