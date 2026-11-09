# Evidencia — RF-33: referencia pública, QR y recorrido hasta el recurso (2026-10-17)

Séptima entrega agrupada. **RF-33 y P1-002 siguen ABIERTAS**: se entrega el recorrido completo de la
referencia y su representación visual, **no las vistas por audiencia**.

| | |
| --- | --- |
| Candidato | **`76ea920`** |
| Validación | `2026-10-17T22-07-56` — **APROBADA** |
| Pruebas | **72 suites, 721** unitarias e integración · **72** E2E · 0 fallos |
| Respecto de `5228c9d` | 716→**721** pruebas: las cinco de RF-33 |
| Migraciones | **49**, sin cambios: esta entrega **no toca el esquema** |
| Respaldo | **No corresponde**: sin migración, sin cambio criptográfico y sin intervención sobre datos |

## 1. Contraste con RF-47: qué faltaba de verdad

**S1 §49 «QR»** pide que `Producer`, `Plot`, `Delivery`, `Lot`, `Package` y `Shipment` puedan tener
`public_reference`, y que **nunca se expongan los identificadores internos**. **RF-47 ya entregó exactamente
eso** el 2026-10-16: registro central, emisión automática, unicidad entre tipos, estabilidad y resolución
autorizada con respuesta opaca.

| Criterio de RF-33 / P1-002 | Estado antes | En esta entrega |
| --- | --- | --- |
| Referencia pública **sin IDs ni PII** | **RF-47: hecho** | Se reutiliza, no se duplica |
| Resolución con permisos y alcance | **RF-47: hecho** | Se reutiliza **entera** |
| **QR / representación visual** | **No existía** | **Entregado** |
| **Obtener, copiar y abrir** desde la interfaz | **No existía** | **Entregado** |
| **Vistas por audiencia** | No existía | **Sigue sin entregarse** (§5) |
| «No sustituye DDS», «no expone PII» | Documentado | **Se dice en la pantalla**, no solo en los documentos |

**El QR pertenece al contrato original**: RF-33 se llama «QR/pasaporte digital por audiencia» y la sección de
la fuente se titula «49. QR». No es un añadido.

## 2. Qué se construyó

**Nada de registro nuevo.** El QR se apoya en `public_references` y en el resolver de RF-47, **con su misma
autorización**: `qr()` llama a `resolve()` y solo después dibuja. Quien no puede leer el recurso recibe la
**misma respuesta opaca**, no un QR.

| Pieza | Qué hace |
| --- | --- |
| `GET …/public-references/:ref/qr.svg` | SVG del QR, autorizado igual que resolver |
| `GET …/public-references/:ref/link` | El mismo enlace, para copiarlo |
| `lib/public-reference.tsx` | Ver la referencia, **copiar** el enlace y **desplegar** el QR |
| `/r/<referencia>` | **Abre la referencia hasta el recurso correcto** |

### 2.1 Qué codifica el QR, y qué no

Solo `<webOrigin>/r/<referencia>`. **Ni identificadores internos, ni el código operativo, ni la organización,
ni datos personales, ni tokens.** Comprobado en la prueba: el enlace no contiene el id del lote ni el de la
organización.

**Se genera en el servidor**, con `qrcode-generator` —**sin dependencias**, en memoria—. No se llama a ningún
generador de terceros: eso enviaría la referencia fuera del entorno. Y al ser texto (SVG), se puede comprobar
en una prueba sin comparar imágenes.

### 2.2 Un defecto que apareció al probarlo

El tipo de contenido estaba declarado en el decorador (`@Header`), así que **también se aplicaba a los
errores**: un `404` salía rotulado como `image/svg+xml` y el cliente no podía leer el error. Ahora el tipo se
fija **después de autorizar**, y una denegación es un error normalizado en JSON.

### 2.3 `DD_SNAPSHOT` se resuelve, pero no se enruta

La pantalla de diligencia se abre **por expediente** y la referencia identifica una **instantánea**. Mandar un
identificador de instantánea a una ruta de expediente daría una pantalla equivocada, así que **no se enruta**
y la pantalla lo dice. Es una limitación declarada, no un olvido.

## 3. Recorrido comprobado

`e2e/review/referencia-qr.mjs`, **15/15 APROBADO**, con dos cuentas DEMO reales y Chromium:

| Comprobación | Resultado |
| --- | --- |
| El enlace se obtiene autorizado | `200`, termina en `/r/<referencia>` |
| **Sin identificadores internos** y **declara sus límites** | confirmado sobre el enlace real |
| QR autorizado, SVG y **estable** | `200` · 7 876 bytes · **idéntico entre llamadas** |
| **DENEGACIÓN**: otra organización | `404` en QR y enlace, con **error legible** |
| **DENEGACIÓN**: inexistente **igual que** ajena | indistinguibles |
| **DENEGACIÓN**: sin sesión | `401` en ambas |
| **INTERFAZ**: referencia y enlace en la pantalla del lote | visibles |
| La pantalla declara «no concede acceso» y «no sustituye un DDS» | ambos avisos |
| **TECLADO**: copiar sin ratón | foco + Enter, y el portapapeles trae el enlace |
| **TECLADO**: desplegar el QR | Enter, SVG presente, `aria-expanded=true` |
| **ABRIR**: lleva al recurso correcto | termina en `/lotes/<id>` |
| **ABRIR**: inexistente no revela nada | explica que la respuesta es la misma en los tres casos |
| **ABRIR**: otra organización no llega | se queda en `/r/<referencia>` |
| **ABRIR**: sin sesión | pide iniciarla, **no abre** |
| **390 px** | sin desbordamiento y con el QR visible |

En integración, `public-references.int-spec.ts` suma **5** casos (17 en total): contenido del QR, autorización
idéntica a la resolución, **alcance asignado** —el QR acompaña exactamente a la decisión del resolver, sin
ampliarla ni restringirla—, sin sesión, y estabilidad.

## 4. Criterios cumplidos

| Criterio original | Estado |
| --- | --- |
| Referencia pública **sin IDs ni PII** | **Demostrado** (RF-47, reutilizado) |
| **QR** por recurso | **Demostrado** |
| Obtener, copiar y **abrir hasta el recurso** | **Demostrado** |
| El enlace **no concede acceso** | **Demostrado**: tres denegaciones con control autorizado |
| **Estabilidad** del identificador | **Demostrado** |
| **No sustituye DDS** | **Demostrado**: lo dice la API y la pantalla |
| **Vistas por audiencia** | **NO entregado** (§5) |

## 5. Lo que queda pendiente, y por qué no se inventó

**Las «vistas por audiencia» son la mitad que falta de RF-33**, y **P1-002 depende de P1-001 (Buyer Portal)**.
Esa dependencia no es burocrática: es **quién es la audiencia externa y qué proyección le corresponde**. El
contrato de concesiones entre organizaciones (**ADR-0002**) sigue propuesto, y sin él no hay audiencia que
servir.

**No se construyó un portal comprador** ni se inventó una proyección por destinatario. Lo que hoy existe es la
**audiencia interna**: quien ya puede leer el recurso obtiene su referencia, su enlace y su QR.

**Por eso RF-33 y P1-002 siguen ABIERTAS y las cifras no se mueven.**

`DD_SNAPSHOT` se resuelve pero no tiene pantalla propia a la que enrutar.

> **Corrección (2026-10-17).** Esta sección decía que «`Package` del listado de S1 §49 **no tiene referencia
> propia**», lo que contradecía dar RF-47 por completo respecto de la misma entidad. **La frase estaba mal
> planteada.** `Package` es el `DueDiligenceEvidencePackage` de S1 §44: su contenido **se genera desde la
> instantánea**, y hoy **queda identificado por ella**, que sí tiene referencia. No hay entidad sin
> identificador. El contraste completo —incluida la condición bajo la cual eso dejaría de ser cierto, y la
> prueba que lo vigila— está en `docs/qa/EVIDENCIA_P1001_P1002_PORTAL_2026-10-17.md` §2.

## 6. Validación, despliegue y demostración

**Validación APROBADA** sobre `76ea920`: 72 suites, **721** pruebas, 72 E2E, 0 fallos.

**Un despliegue**, con la revisión inyectada: `/version` declara `commit=76ea920+sucio (BUILD_ARG)`. El
`+sucio` corresponde a esta evidencia, escrita tras congelar el candidato.

**Demostración funcional sobre el despliegue**: `e2e/review/referencia-qr.mjs`, **15/15 APROBADO**, repetido
tras la reconstrucción. **Sin respaldo nuevo**: no hay migración, ni cambio criptográfico, ni intervención
sobre datos.

**Sin regresión en RF-47**: la suite de referencias pasa entera (17 casos, 12 originales + 5 de RF-33), de modo
que la emisión, la unicidad entre tipos, la estabilidad y la resolución siguen como estaban.

## 7. Métricas

**Sin cambio: 31/60 = 51,7 % y 30/44 = 68,2 %.** RF-33 no sube porque **le falta la mitad por audiencia**, que
es parte de su enunciado. Entregar el QR y el recorrido no cierra el requisito.
