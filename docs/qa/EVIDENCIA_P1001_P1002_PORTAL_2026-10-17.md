# Evidencia — P1-001 y P1-002: acceso del destinatario y pasaporte por audiencia (2026-10-17)

Octava entrega agrupada. **Esta vez la dependencia viene dentro**: P1-002 dependía de P1-001, y las dos se
entregan juntas.

| | |
| --- | --- |
| Candidato | **`7044cfe`** |
| Validación | `2026-10-17T23-18-37` — **APROBADA** |
| Pruebas | **72 suites, 728** unitarias e integración · **72** E2E · 0 fallos |
| Respecto de `76ea920` | 721→**728** pruebas |
| Migraciones | **49**, sin cambios: **no toca el esquema** |
| Respaldo | **No corresponde**: sin migración, sin cambio criptográfico, sin intervención sobre datos |

## 1. Contraste: qué exige cada criterio y qué faltaba de verdad

| Fuente | Qué exige | Estado al empezar |
| --- | --- | --- |
| **P1-001** (backlog) | «Recurso/fields/período compartidos; revocación bloquea nueva consulta; QA-02/14» | **API hecha** en P0-003; **faltaba la pantalla** |
| **P1-002** (backlog) | «Referencia pública sin IDs/PII, vistas por audiencia, no sustituye DDS» | Referencia y resolución **hechas** (RF-47/RF-33); **faltaba la audiencia externa** |
| **ADR-0002** | «Compartición mediante grants tipados, campos/vigencia/revocación y no joins implícitos por identidad» | **Satisfecho en sustancia** por `access_grants` |

**La decisión que parecía bloqueante no lo era.** ADR-0002 sigue marcado como PROPUESTO, pero lo que pedía
—concesiones tipadas con recurso, vigencia y revocación— **ya está implementado y probado** desde P0-003. Lo
que faltaba no era una decisión: era **construir el recorrido**.

**Decisión de alcance adoptada** (local, para desarrollo): la **audiencia externa inicial** es el
**destinatario autenticado de una concesión vigente**. **El rol `BUYER` por sí solo no concede acceso entre
organizaciones** — lo demuestra la primera comprobación del recorrido. No se amplió ningún campo de la
proyección: cualquier ampliación exigiría una decisión explícita, y no se tomó ninguna.

## 2. La identidad de `Package`, resuelta sin inventar un identificador

El informe anterior decía que «`Package` no tiene referencia propia» y a la vez daba RF-47 por completo. **Esa
contradicción era mía**, y así se resuelve:

| Paso | Qué dicen las fuentes y el código |
| --- | --- |
| **S1 §44** | Define `DueDiligenceEvidencePackage`: el paquete de evidencia de debida diligencia |
| **S1 §49** | Lo lista entre las entidades que pueden tener `public_reference` |
| **Implementación** | El paquete **se genera desde la instantánea** (`buildPackage` es una función pura del contenido), y `dd_exports` registra el **acto** de exportarlo |
| **El matiz** | La huella del paquete depende también del **perfil de redacción** de quien exporta (`plot:read_geometry`, `producer:read_identity`) |
| **Lo comprobado** | **Solo `ORG_ADMIN` y `EUDR_MANAGER`** pueden exportar, y **ambos tienen el mismo perfil completo** |

**Conclusión: hoy el paquete queda identificado por su instantánea**, que **sí** tiene referencia pública
(`DD_SNAPSHOT`). **No hay brecha demostrada**, así que **no se crea un identificador nuevo**.

**Y queda una alarma, no una nota al pie**: `catalog.spec.ts` comprueba que **todos** los roles capaces de
exportar comparten perfil de redacción. Si alguien añade un rol que exporte con un perfil más estrecho, dos
paquetes de la misma instantánea tendrían huellas distintas, la identidad dejaría de ser la instantánea, y
**la prueba falla diciéndolo**.

## 3. Qué se construyó

**Nada nuevo en el modelo de datos.** Se reutilizan `access_grants`, su revalidación y la proyección de
P0-003; el registro y el resolver de RF-47; el QR de RF-33.

### 3.1 La referencia reconoce la concesión

`resolve()` ya exigía membresía. Ahora, **si no hay membresía**, busca una **concesión vigente sobre ese
recurso exacto** antes de responder opaco, y declara la audiencia:

| Audiencia | Cuándo | Adónde lleva |
| --- | --- | --- |
| `MEMBER` | Miembro con permiso y alcance | Pantalla interna del recurso |
| `GRANTEE` | **Sin membresía**, con concesión viva de **ese** recurso y **lectura** concedida | **Su vista compartida** |

No amplía nada: exige recurso exacto, concesión viva (ni vencida ni revocada), `can_read`, y cuenta activa.
**Al vencer o revocarse, deja de resolver.**

### 3.2 El portal del destinatario

`/compartido`, **fuera del espacio de trabajo** porque quien entra **no es miembro**: no tiene organización
activa, ni menú de operación, ni permisos de tenant. Montarlo dentro daría a entender una pertenencia que no
existe.

Encuentra lo concedido · abre su vista · ve **solo códigos, estados y agregados** · descarga **cuando tiene esa
acción**. La pantalla declara que **la concesión no levanta la clasificación** y que lo descargado es una
**vista compartida interna**, no un paquete DD ni una declaración oficial.

### 3.3 Un defecto de interfaz, encontrado al probar a 390 px

El portal reutilizaba el contenedor de la **tarjeta de ingreso** (`max-width: 440px`, sin `min-width: 0`). El
ancho mínimo de la tabla estiraba el contenedor y **la página desbordaba**. Ahora tiene su propio contenedor.
Lo encontró la comprobación de 390 px, no la revisión a ojo.

## 4. Recorrido comprobado

`e2e/review/portal-comprador.mjs`, **12/12 APROBADO**, con **tres** cuentas DEMO de **tres** organizaciones:

| Comprobación | Resultado |
| --- | --- |
| **Sin concesión**: el rol BUYER por sí solo | resolución **404** |
| **Con concesión**: resuelve **sin membresía** | **200**, `audience=GRANTEE` |
| El QR también se le entrega | **200** |
| La vista **no trae identidad, geometrías ni documentos** | **0 fugas**, agregados presentes |
| **Aislamiento**: tercera organización sin concesión | **404** en resolución y vista |
| **Portal**: encuentra lo concedido | 1 concesión listada |
| Declara que no levanta clasificación ni sustituye paquete DD | ambos avisos |
| **TECLADO**: abre su vista sin ratón | foco + Enter, sin identidad en pantalla |
| **DESCARGA** | `vista-compartida-lot-…json` |
| **ENLACE**: `/r/<ref>` lleva al destinatario a **su** vista | termina en `/compartido` |
| **390 px** | sin desbordamiento |
| **REVOCACIÓN** | resolución **404**, vista **404**, **portal vacío** |

En integración: `access-grants.int-spec.ts` (**17**) suma cinco casos de audiencia externa —resolución con
concesión, **revocación**, **vencimiento real por reloj del servidor**, alcance de **un solo recurso** y
**sin lectura concedida**—; y `public-references.int-spec.ts` (**18**) añade la **decodificación del QR**.

### 4.1 El vencimiento se probó de verdad

Adelantar la fecha en la base **no es posible**: el disparador de P0-003 impide editar los términos de una
concesión, que es lo correcto. Así que la prueba **concede con vencimiento en 2,5 segundos y espera**: vence
**con el reloj del servidor**, no con un `UPDATE`.

### 4.2 El QR se verifica DECODIFICÁNDOLO

No basta con que el SVG tenga trazados. Se rasteriza a partir de su propia geometría y se decodifica con
**`jsqr`**, que **no es el codificador** usado para generarlo —si lo fuera, coincidiría por construcción y no
demostraría nada—. Lo decodificado es exactamente el enlace esperado, y **no contiene** el identificador del
lote ni el de la organización.

## 5. Criterios cumplidos

| Criterio | Estado |
| --- | --- |
| **P1-001** recurso/campos/período compartidos | **Demostrado** |
| **P1-001** revocación bloquea nueva consulta | **Demostrado**: resolución, vista y portal |
| **P1-002** referencia sin IDs ni PII | **Demostrado** (RF-47 + decodificación) |
| **P1-002** vistas por audiencia | **Demostrado** para la audiencia **destinatario de concesión** |
| **P1-002** no sustituye DDS | **Demostrado**: lo dice la API, la pantalla y el archivo |
| QA-02 aislamiento | **Demostrado**: tercera organización sin concesión |

## 6. Lo que NO se cierra, y por qué

**P1-001, P1-002 y RF-33 siguen ABIERTAS.** Lo entregado cubre **una** audiencia externa —la del destinatario
de una concesión— y el recorrido completo para ella. Queda fuera, y **sin decisión tomada**:

| Pendiente | Por qué no se hizo |
| --- | --- |
| **Más audiencias** (p. ej. pública o anónima) | No hay decisión que las defina. Inventarlas sería publicar sin contrato |
| **Ampliar campos** de la proyección | Exige **decisión explícita**; no se tomó |
| **ADR-0002 sigue PROPUESTO** | Lo implementado lo satisface en sustancia, pero **ratificarlo es una decisión**, no código |
| Período compartido como **rango de fechas** | La concesión tiene **vencimiento**, no un período de datos acotado |

## 7. Validación, despliegue y demostración

**Validación APROBADA** sobre `7044cfe`: 72 suites, **728** pruebas, 72 E2E, 0 fallos.

**Un despliegue**, con la revisión inyectada: `/version` declara `commit=7044cfe+sucio (BUILD_ARG)`.

**Demostración sobre el despliegue**, repetida tras la reconstrucción:

| Recorrido | Resultado |
| --- | --- |
| `e2e/review/portal-comprador.mjs` | **12/12 APROBADO** |
| `e2e/review/referencia-qr.mjs` (**sin regresión**) | **15/15 APROBADO** |

**Sin respaldo nuevo**: no hay migración, ni cambio criptográfico, ni intervención sobre datos. Los recorridos
**dejan el entorno como lo encontraron**: revocan las concesiones que crean.

## 8. Métricas

**Sin cambio.** Las historias no se cierran por entregar una audiencia de las varias que su enunciado admite.


---

# Addendum — Contraste de aceptación y cierre de RF-33 / P1-002 (2026-10-17)

Contraste **documental**, sin validación ni reconstrucción, más **una cobertura técnica** que ya estaba
definida y autorizada.

## A.1 Lo que el contraste encontró

**«Por audiencia» no está en las fuentes.** La palabra «audiencia» aparece **una vez** en las cuatro fuentes, y
es la cabecera de lectores de S1. La redacción «QR/pasaporte digital **por audiencia**» es de `docs/03`, un
documento **derivado**. Las únicas audiencias que las fuentes describen son **la interna** y **el comprador con
acceso controlado** (S3 §22.8), y las dos están implementadas.

**Corrijo lo que dije en la entrega anterior**: mantener RF-33 y P1-002 abiertas «porque faltan audiencias» era
**una interpretación añadida durante el desarrollo**, no un criterio de la fuente.

La tabla completa, criterio por criterio con su referencia exacta, está en
`docs/decisiones/CONTRASTE_ACEPTACION_RF32_RF33_2026-10-17.md`.

## A.2 Resultado

| Historia / requisito | Estado | Condición pendiente |
| --- | --- | --- |
| **RF-33** | **DEMOSTRADO** | — |
| **P1-002** | **DONE_LOCAL** | — |
| **RF-32** | **ABIERTA** | Indicadores de **S3 §22.8**, incluida «evidencias» → **decisión D-48** |
| **P1-001** | **ABIERTA** | La misma, más aclarar «período» (vigencia del acceso, cumplida, frente a rango de datos, inexistente) |

**Cifras**: catálogo **32 de 60 = 53,3 %** (sube RF-33). **MVP sin cambio: 30 de 44 = 68,2 %**, porque RF-33 es
**P1** y no entra en el alcance del MVP. Historias del MVP **25 de 32**, sin cambio: P1-002 es una historia P1.

## A.3 La cobertura que faltaba, cerrada

El contraste destapó que **lote, embarque e instantánea** estaban implementados pero **solo el lote estaba
demostrado**. Era un hueco de verificación de algo **ya autorizado**, sin campos nuevos, así que se cerró:

| Caso añadido | Qué comprueba |
| --- | --- |
| Concesión de **EMBARQUE** | Entrega código, estado, destino **declarado** e ítems; **sin** comprador, identidades ni identificador interno; la referencia resuelve como `GRANTEE`; al revocar deja de resolver y de leerse |
| Concesión de **INSTANTÁNEA** | Entrega expediente, número, preparación, huella y **requisitos como código y estado**; **sin** contenido, geometrías ni documentos; declara que **no acredita presentación de DDS** |

`access-grants.int-spec.ts` pasa de 17 a **19**. **Solo se añadieron pruebas**: ninguna línea de producción
cambió, y por eso **no se repitió `validate` ni se reconstruyó**, conforme a la instrucción de este cierre.

## A.4 ADR-0002, actualizado sin ratificar de más

Se marcó **PARCIALMENTE ADOPTADO**, cláusula por cláusula: `organization_id`, autorización por acción y
recurso, integridad por tenant, membresías, **grants tipados con vigencia y revocación** y «sin joins
implícitos» quedan **adoptados y ejecutados**. **Siguen siendo propuesta** la **RLS** —que no existe y cuya
propia cláusula la condiciona a un contexto seguro probado— y los **campos compartidos configurables**.

## A.5 ¿Exige el portal un paquete DD?

**No.** S3 §22.8 lo presenta como pantalla de indicadores «con acceso controlado», y **«DDS» es un indicador,
no una descarga**. El criterio «descarga autorizada» queda cumplido con la vista compartida, **y la distinción
se conserva**: una vista compartida interna **no sustituye un paquete DD**. Si alguna vez se decidiera
entregarlo, sería **otro criterio**, con dependencia exacta en la aprobación del expediente (hoy bloqueada por
D-05.B, D-07.5, D-07.6 y P1-005).

## A.6 La única decisión pendiente

**D-48 — Indicadores del Buyer Portal**, registrada en `docs/22` con tres opciones, recomendación y efecto. Es
**lo único** que separa a RF-32 y P1-001 de su cierre.


---

# Addendum II — D-48(A) implementada: RF-32 y P1-001 CERRADAS (2026-10-17)

| | |
| --- | --- |
| Candidato | **`7082799`** |
| Validación | `2026-10-18T00-31-52` — **APROBADA** |
| Pruebas | **72 suites, 735** unitarias e integración · **72** E2E · 0 fallos |
| Migraciones | **49**, sin cambios |
| Respaldo | **No corresponde**: sin migración, sin cambio criptográfico, sin intervención sobre datos |

## B.1 Los once indicadores, sin motor nuevo

Cada indicador se deriva de **`evaluateRequirements()`** sobre el contenido que el expediente ya calcula para
ese lote. **No se construyó otro motor** de riesgo, legalidad ni balance: si mañana cambia una regla, el
indicador cambia con ella.

| Indicador | De dónde sale |
| --- | --- |
| Origen identificado | `ORIGIN_DECLARED` |
| Productores · Parcelas | Agregados que la proyección ya daba |
| Geolocalización validada **(técnica)** | `GEOMETRY_TECHNICAL`, con aviso de que **no acredita el perfil jurídico** |
| Deforestación revisada | `DEFORESTATION_ANALYSIS`, con aviso de que **no es conclusión regulatoria** |
| Legalidad revisada | `LEGAL_PROFILE` |
| Trazabilidad completa | `origin_status` del lote |
| Balance de masa | `QUANTITIES_CONSISTENT` |
| Evidencias | Recuento **por estado** de revisión |
| Riesgo final | `REGULATORY_CONCLUSION`, y **`DESACTUALIZADO`** si la evaluación ya no es vigente |
| DDS presentada | **`NO_EVALUABLE` por límite del producto**, no por un pendiente del lote |

## B.2 Seis estados, porque son seis cosas distintas

`FAVORABLE` · `DESFAVORABLE` · `PENDIENTE` · `DESACTUALIZADO` · `NO_EVALUABLE` · `SIN_EVALUAR`.

**Lo desconocido no se convierte en conforme**, y hay una prueba que lo vigila: hoy **deforestación, legalidad
y riesgo final no pueden salir favorables** —sin satélite, sin perfil aprobado y con la conclusión en
`UNDETERMINED`—, y si algún día salen, esa prueba falla.

## B.3 Las tres distinciones, escritas en cada indicador

| Distinción | Dónde se dice |
| --- | --- |
| Geolocalización **técnica** ≠ perfil jurídico | En la etiqueta y en la nota del indicador |
| Análisis de deforestación ≠ conclusión regulatoria | En su nota |
| Preparación del expediente ≠ **DDS presentada** | En el indicador de DDS |

**Evidencias** comunica **disponibilidad y revisión**, nunca suficiencia: «que una evidencia esté cargada y
supere el análisis antimalware no la vuelve suficiente. No da acceso a los originales». La redacción evita las
palabras que la prueba de fugas documentales prohíbe — **antes que relajar esa comprobación, se reescribió el
texto**.

**Fecha y versión que sustentan cada resultado**: el riesgo lleva su número de evaluación y versión de reglas;
la geolocalización, las versiones de geometría. Una evaluación histórica no puede parecer actual.

## B.4 «Período», aclarado con las fuentes — y **corregido el 2026-10-17 (adenda III)**

Es el **período de producción** de **S1 §44** (`production_period`), **no** un filtro temporal del portal. La
**vigencia del acceso** es otra cosa, y es `expires_at`. **Los dos conceptos no se mezclan.**

**Lo que esta sección decía mal.** Afirmaba que las fechas `harvest_derived_*` se deducían **de la fecha de
entrega** y que bastaba marcarlas `DERIVED`. **Las dos cosas estaban equivocadas**, y así se corrige:

1. **Procedencia real.** `harvest_derived_*` **no sale de la fecha de entrega**: el CHECK
   `deliveries_harvest_shape` (migración 0021) solo las admite cuando **expanden la cosecha declarada** —un
   `DAY` se copia, un `MONTH` se abre a los límites de ese mes— para poder consultar por rango. Con la cosecha
   `UNKNOWN` o sin declarar, **el propio CHECK las obliga a ser NULL**. Son un índice de la declaración.
2. **Etiquetar no cumple el contrato.** El contrato prohíbe **deducir** el período de la fecha de entrega;
   rastrear la procedencia no autoriza a publicar lo deducido **en el lugar del dato declarado**. La función
   tenía una rama que lo habría hecho. **Se eliminó**: `periodoDeProduccion()` ya **no** puede devolver una
   precisión deducida, y `DERIVED` desapareció del contrato publicado.

**Comportamiento vigente** (`precision ∈ {DAY, MONTH, UNKNOWN, NONE}`):

| Caso | Qué publica |
| --- | --- |
| **Cosecha declarada** | Las **fechas y la precisión originales**. Un `MONTH 2026-03` se publica como `2026-03`, **no** como `2026-03-01 – 2026-03-31` |
| Precisiones mezcladas | Manda **la más gruesa**; y si solo parte de las entregas declaró, **se dice cuántas** y que el resto sigue desconocido |
| **Cosecha desconocida, entrega conocida** | `UNKNOWN`, sin fechas: «el período de producción sigue desconocido: la fecha de entrega no lo sustituye, porque entregar no es producir» |
| Sin cosecha declarada | `NONE`, sin fechas, diciendo que **no se deduce de la fecha de entrega** |
| **Límites heredados sin declaración** | Se conservan en `inherited_range`, **separados** del período y con su procedencia escrita: **no** acreditan producción ni son cosecha declarada. El período permanece desconocido |

**Comprobado en el despliegue** (`3257028`, `portal-comprador.mjs` **17/17**), con los dos casos decisivos que
los datos DEMO ya contenían:

| Lote DEMO | Lo declarado | Lo que publica la vista |
| --- | --- | --- |
| `LOT-2026-00001` | cosecha `MONTH 2026-09` (límites guardados `2026-09-01`/`2026-09-30`), entregada el `2026-10-13` | `MONTH`, `2026-09 – 2026-09`. **Sin** `2026-09-01` y **sin** la fecha de entrega |
| `LOT-2026-00002` | cosecha `UNKNOWN`, entregada el `2026-10-13` | `UNKNOWN`, **sin fechas**. **Sin** la fecha de entrega y **sin** `DERIVED` |

**Pruebas dirigidas**: `indicadores.spec.ts` **8/8** (incluye el caso de los límites heredados) y
`access-grants.int-spec.ts` **PERÍODO 1/3–3/3** más el de lectura y descarga (**27/27** en la suite).

**No se reconstruyó ni se corrigió ningún dato histórico**: no hubo migración ni escritura. Comprobado sobre la
base real: **0** entregas y **0** correcciones con límites derivados sin declaración, y **0** con un límite
derivado igual a la fecha de entrega.

## B.5 Comprobado

**Integración** (`access-grants.int-spec.ts`, **24**): los once presentes; lo desconocido nunca favorable; las
tres distinciones; **sin fugas** de identidad, coordenadas, contenido documental ni identificadores —tampoco en
**la descarga**, que usa la misma proyección—; y el período con su precisión.

**Despliegue** (`portal-comprador.mjs`, **15/15**): nueve indicadores de estado más los dos recuentos en
pantalla, el aviso de que «no evaluable» y «sin evaluar» **no significan conforme**, el período con su
precisión, **teclado**, **390 px**, aislamiento, vencimiento y revocación. Sin regresión: `referencia-qr.mjs`
**15/15**.

## B.6 Cierre

| Historia / requisito | Estado |
| --- | --- |
| **RF-32** | **DEMOSTRADO** |
| **P1-001** | **DONE_LOCAL** |
| **RF-33** · **P1-002** | Ya cerradas en el addendum I |

**Cobertura: 33 de 60 = 55,0 %.** **MVP sin cambio: 30 de 44 = 68,2 %** —RF-32 y RF-33 son **P1**—. Historias
del MVP **25 de 32**, sin cambio: P1-001 y P1-002 son historias P1.

**Evolución, no criterio pendiente**: más audiencias, campos configurables por concesión, entrega de un
`DD_PACKAGE` al comprador y la **RLS** de ADR-0002. Ninguna la exige la fuente para estas historias.
