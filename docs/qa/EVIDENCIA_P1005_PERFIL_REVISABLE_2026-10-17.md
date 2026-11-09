# Evidencia — P1-005: perfil jurídico revisable (2026-10-17)

Sexta entrega agrupada. Entrega el **mecanismo**; **no aprueba derecho** y **no cierra la historia**.

| | |
| --- | --- |
| Candidato | **`0fbc473`** |
| Validación | `2026-10-17T20-28-47` — **APROBADA** |
| Pruebas | **72 suites, 706** unitarias e integración · **72** E2E · 0 fallos |
| Respecto de `eaefd1b` | 71→**72** suites y 680→**706** pruebas |
| Migraciones | **49** (`0049_p1005_perfil_juridico`) |
| Respaldo | **Sí**: la migración cambia el estado persistente |

## 1. Lo primero, porque es lo que se puede leer de más

**Tener el mecanismo no es tener el perfil.** El perfil que se siembra es **PARCIAL** (tenencia y uso del
suelo) y su **revisión jurídica está PENDIENTE**. En consecuencia:

- **`LEGAL_PROFILE` devuelve `PENDING`**, no `MET`;
- `READY` exige que **todos** los requisitos estén cumplidos, así que **sigue bloqueado**;
- **P1-005 sigue abierta** y el porcentaje de requisitos demostrados **no sube**.

Completar el mecanismo técnico de una historia no la cierra.

## 2. Las dos correcciones de partida

### 2.1 «Desconocido» no es incumplimiento **ni** requisito satisfecho

Las dos lecturas equivocadas son simétricas, y la segunda es la peligrosa: tratar la incertidumbre como vía
libre. **Incertidumbre y bloqueo conviven**, y así está implementado:

| Situación | Qué **no** se concluye | Qué **sí** ocurre |
| --- | --- | --- |
| Aplicabilidad **desconocida** | Ni que aplica ni que no | **No evaluable**, y el requisito **no se acredita** |
| Aplicable y **sin evidencia** | **No** es una infracción | **Pendiente**, y el requisito **no se acredita** |
| Revisión necesaria **sin resolver** | Nada sobre el fondo | **Impide acreditar `READY`** |

### 2.2 El Registro de Tierra Rural **no** es «no público»

La matriz afirmaba que «el registro no es público ni consultable por API conocida». **No encontrar una API no
permite afirmar que un registro no sea público**, y el **Art. 43** dice lo contrario: la información «será de
**consulta abierta al público** en general […] en todas las oficinas de la Autoridad Agraria Nacional o por
medios electrónicos».

Queda corregido: lo que **no está verificado** es el **acceso operativo** —si hay canal electrónico en
servicio, con qué condiciones y si es consultable por programa—, que es otra cosa.

## 3. Qué se construyó

### 3.1 Patrones reutilizados, no inventados

| Necesidad | Qué se reutilizó |
| --- | --- |
| Catálogo versionado e inmutable + adopción por organización | El patrón de `risk_rule_sets` + `risk_rule_set_adoptions` (D-07.1) |
| Adoptar, retirar, revisar | **Append-only con decisión fechada**: filas, no `UPDATE` de estado |
| Evidencia | **`document_versions`**, versión exacta, con integridad de tenant por clave compuesta. **No** hay otro almacén |
| Permisos | El catálogo existente. **Ningún rol nuevo**: crear uno no acredita competencia profesional |
| Auditoría | `AuditService`, el mismo de siempre |
| Alcance por recurso | `plots.load()`, la autorización real de Parcelas |

**Permisos, separando competencia de aplicación de competencia jurídica**: `traceability:read_catalog` (leer el
catálogo) · `risk:approve_rules` (adoptar/retirar) · `dd:manage` (preparar) · `dd:read` (consultar) ·
`risk:review` (registrar el resultado).

### 3.2 Las tres cosas que no son lo mismo

| Estado | Qué significa | Hoy |
| --- | --- | --- |
| `document_obtained` | Se tiene el archivo, con su huella | **true** en las tres fuentes |
| `text_contrasted` | Se leyó y se comprobó contra el documento | **true** en las tres |
| `legal_validity_reviewed` | Alguien con competencia lo afirmó y fundamentó | **false** en las tres |

Un `CHECK` impide declararlas fuera de orden: no se contrasta lo que no se tiene, ni se revisa la vigencia de
lo que no se ha leído.

### 3.3 Aplicabilidad, evidencia y resultado: **tres ejes, impuestos por la base**

Las combinaciones incoherentes **no se pueden escribir**, y eso es una garantía de la base de datos, no una
validación de servicio que alguien pueda saltarse:

| Restricción | Qué impide |
| --- | --- |
| `…_unknown` | Que una aplicabilidad **desconocida** figure como satisfecha o incumplida |
| `…_not_applicable` | Que «no aplica» se registre como «cumple» |
| `…_no_evidence` | Que una obligación **aplicable y sin evidencia** concluya algo que no sea *pendiente* |
| `…_satisfied` | Declarar satisfecha sin **evidencia + admisibilidad justificada + revisor + motivo** |
| `…_admissibility` | Marcar admisible sin justificarlo **por requisito** |
| `…_reviewed` | Concluir satisfecha o no satisfecha **en anónimo** |

**Admitir un archivo no lo vuelve auténtico, suficiente ni admisible**: la procedencia se distingue
(`OFFICIAL_DOCUMENT` / `PRODUCER_DECLARATION`) y la admisibilidad hay que justificarla.

### 3.4 La revisión jurídica **no tiene endpoint**, a propósito

No existe hoy un responsable con competencia acreditada, y fabricar uno sería **inventar el aprobador**. La
tabla existe y exige **responsable identificado** y **fundamento**; mientras nadie lo decida, el perfil
**permanece pendiente**. En pruebas se usa una **fila sintética escrita directamente en la base**, nunca un
endpoint.

### 3.5 La cartografía se guarda, pero **no decide**

`cartographic_indication` se registra con su fuente y su nota, y **no aparece en ningún `CHECK` de resultado**.
Es un indicio que abre revisión. **Ninguna geometría sale a ningún servicio externo.**

## 4. Pruebas

**`legal-profile.int-spec.ts` (21)** y **`requirements.spec.ts` (+5)**:

| Qué se prueba | Resultado |
| --- | --- |
| El catálogo declara **PARCIAL**, lo que falta y que las reglas son **candidatas** | Sí, y las fuentes identifican la copia por **huella, índice de PDF y página impresa** |
| Adoptar exige `risk:approve_rules` | EUDR **403**; administrador **201** (control) |
| Preparar exige `dd:manage`; consultar `dd:read` | Auditor **403** al preparar, **200** al consultar |
| Sin perfil adoptado no se prepara | **422** |
| Estado de partida | **Todo** en aplicabilidad desconocida y resultado no evaluable |
| **Desconocida** no puede estar satisfecha ni incumplida | **422** en los tres intentos; sí admite *no evaluable* |
| **Aplicable sin evidencia** | Solo *pendiente*: **422** al intentar satisfecha y al intentar no evaluable |
| **Satisfecha** exige justificación, revisor y motivo | **422** sin justificar; **200** con todo, y queda el revisor |
| Procedencia de la evidencia | Declaración del productor se distingue del documento oficial |
| Evidencia de **otra organización** | **422** |
| Aislamiento por organización | **404**, también inventando el identificador |
| Técnico de campo | **403** (sin `dd:read` ni `dd:manage`), con control autorizado sobre la misma evaluación |
| **Concurrencia** | Segunda escritura con versión obsoleta → **409** |
| **Reversión** | Se vuelve a pendiente, la evidencia se retira y la historia **conserva el estado anterior** |
| Historia **append-only** | `UPDATE` y `DELETE` rechazados por el disparador |
| **Versión documental sustituida** | Llega la v2 del mismo documento y la evidencia vinculada **sigue siendo la v1 exacta** |
| Revisión jurídica sin responsable | La base la **rechaza** |
| Retirar el perfil | La organización queda **sin perfil**, y la adopción anterior se conserva |

**Y el criterio que importa**, en `requirements.spec.ts`:

| Perfil | `LEGAL_PROFILE` | `READY` |
| --- | --- | --- |
| Sin adoptar | `NOT_EVALUABLE` | **BLOCKED** |
| **PARCIAL**, sin revisión | **`PENDING`** | **no READY** |
| **PARCIAL**, aunque esté revisado | **`PENDING`** | **no READY** |
| **COMPLETO**, sin revisión jurídica | **`PENDING`** | **no READY** |
| COMPLETO y revisado *(fixture sintética: hoy no existe)* | `MET` | — |

**Revisar no completa el alcance, y el mecanismo no sustituye la revisión.** Hacen falta las dos cosas.

## 5. Recorrido en la interfaz existente

`/organizaciones/:id/perfil-juridico`, dentro de **Trazabilidad**, sin crear otro sistema de documentos,
permisos ni auditoría: catálogo con el alcance parcial y las materias que faltan · adopción · preparar una
parcela · revisar aplicabilidad, evidencia y resultado · pendientes · **historial**. Los botones que un rol no
puede usar **no se pintan**, y el permiso lo sigue aplicando la API.

## 6. Validación, despliegue y respaldo

**Validación APROBADA** sobre `0fbc473`: 72 suites, **706** pruebas, 72 E2E, 0 fallos.

**Un despliegue**, con la revisión inyectada: `/version` declara `commit=0fbc473+sucio (BUILD_ARG)` y esquema
`0049_p1005_perfil_juridico`. El `+sucio` corresponde a esta evidencia, escrita tras congelar el candidato.

**Recorrido en el despliegue**: `e2e/review/perfil-juridico.mjs`, **10/10 APROBADO**, con tres cuentas DEMO:

| Comprobación | Resultado |
| --- | --- |
| Catálogo | perfil `0.1.0` **PARTIAL**, revisión **PENDING**, **4 candidatas**, **3 fuentes con vigencia sin revisar** |
| Adoptar con rol EUDR | **403** |
| **CONTROL**: administrador adopta | **201** |
| Preparar | **4 requisitos, todos desconocidos**; `satisfies_legal_profile: false` |
| Desconocida → satisfecha | **422** |
| Aplicable sin evidencia | **200**, y solo `PENDING` |
| Concurrencia con versión obsoleta | **409** |
| Historial consultado por el auditor | **200**, con el cambio registrado |
| El auditor intenta registrar resultado | **403** |
| El expediente tras la revisión | **sigue sin acreditar** el requisito |

El recorrido **deja el entorno como lo encontró**: retira el perfil que adopta.

**Respaldo**: `_respaldos/2026-10-17-post-p1005-perfil`, con QA-16 — **49 migraciones**, perfil `0.1.0`
**PARTIAL con 0 revisiones jurídicas**, `SHA256SUMS` verificado y ACL restringida. **Los nueve anteriores se
conservan**, y las **22 referencias públicas siguen con la huella `93d21b4c…0ec9`**, idéntica desde RF-47.

## 7. Contraste de los criterios originales de P1-005

Criterio: «Fuente/requisito/aplicabilidad/documento/regla/versión/aprobador; pruebas de vigencia».

| Criterio | Estado | Por qué |
| --- | --- | --- |
| **Fuente** | **Demostrado** | Tres fuentes oficiales con autoridad, publicación, URL, hash y páginas identificadas |
| **Requisito** | **Parcial** | Cuatro reglas candidatas, **en borrador**, solo de tenencia y uso del suelo |
| **Aplicabilidad** | **Demostrado como mecanismo** | Eje propio, con desconocido por defecto y condición por regla |
| **Documento** | **Demostrado** | Versión exacta de `document_versions`, con procedencia y admisibilidad justificada |
| **Regla** | **No demostrado** | Ninguna regla está aprobada: todas son candidatas |
| **Versión** | **Demostrado** | Catálogo versionado, inmutable, con adopción y retirada fechadas |
| **Aprobador** | **NO demostrado** | **No hay responsable con competencia jurídica**, y no se inventa |
| **Pruebas de vigencia** | **No demostrado** | Sin consolidación oficial; dos reformas localizadas no prueban que sean todas |

**P1-005 sigue ABIERTA.** Faltan los dos criterios que no son técnicos —**regla aprobada** y **aprobador**— y
las pruebas de vigencia.

## 8. Métricas

**Sin cambio: 31/60 = 51,7 % del catálogo y 30/44 = 68,2 % del MVP.**

**RF-36 no sube** y **P1-005 no se cierra**: lo entregado es el mecanismo de preparación y revisión, no el
perfil jurídico aprobado que ambos exigen. Subir el porcentaje por haber construido la maquinaria sería
exactamente el error que el contrato prohíbe.

## 9. Lo que sigue pendiente

1. **Reconstruir la vigencia** desde el Registro Oficial, más allá de las dos reformas ya verificadas.
2. **Barrer el COA** (patrimonio forestal y cambio de uso del suelo) y obtener los **reglamentos**.
3. **Verificar el acceso operativo** del Registro de Tierra Rural (Art. 43).
4. **Identificar y verificar la cartografía oficial**; sin ella, EC-2 y EC-4 no son evaluables.
5. **Decidir las ocho decisiones** de `P1-005-MATRIZ-OBLIGACIONES.md` §4.
6. **Designar un responsable con competencia jurídica.** Sin él, nada de esto se aprueba.

---

# Addendum — Comprobaciones dirigidas y corrección de un defecto (2026-10-17)

Las tres comprobaciones pedidas sobre lo ya entregado. **La primera encontró un defecto funcional real**, así
que se corrigió y se aplicó el cierre completo sobre un SHA nuevo.

| | |
| --- | --- |
| Candidato corregido | **`5228c9d`** |
| Validación | `2026-10-17T21-14-34` — **APROBADA** |
| Pruebas | **72 suites, 716** unitarias e integración · **72** E2E · 0 fallos |
| Respecto de `0fbc473` | 706→**716** pruebas |
| Migraciones | **49**, sin cambios: la corrección **no toca el esquema** |
| Respaldo | **No se repite**: sin migración, sin cambio criptográfico y sin intervención sobre datos |

## A.1 El defecto: el catálogo acreditaba por sí solo

**Confirmado, y era real.** `LEGAL_PROFILE` devolvía `MET` mirando **solo el catálogo adoptado**. Un perfil
COMPLETO y jurídicamente revisado habría acreditado el requisito aunque el sujeto del expediente tuviera
**todas sus obligaciones desconocidas**, **sin evidencia**, o con **evidencia de otra parcela**.

**Un catálogo revisado dice que existe una lista de obligaciones exigibles. No dice que ESTE lote las cumpla.**

### Qué se corrigió

El requisito mira ahora, además del catálogo, la **cobertura del sujeto parcela a parcela del lote**:

| Condición | Si no se cumple |
| --- | --- |
| Existe evaluación de la parcela | `PENDING` — «sin evaluación legal» |
| Se hizo con la **versión adoptada** | `PENDING` — «evaluada con otra versión del perfil» |
| No quedan obligaciones sin resolver | `PENDING` — las nombra |
| Ninguna declarada **no satisfecha** | **`INVALID`** — no «pendiente» |
| La evidencia es la **versión vigente** del documento | `PENDING` — «evidencia SUSTITUIDA» |
| La evidencia es **del propio sujeto** | `PENDING` — «evidencia de OTRO sujeto» |

Y en la escritura: la evidencia de otro sujeto se **rechaza** (`EVIDENCE_FOREIGN_SUBJECT`). El documento debe
ser de la parcela evaluada o de su productor; **un título de otra parcela es un documento válido que no
acredita esta**.

### Demostración

**Once casos de requisito**, todos con catálogo **COMPLETO y REVISADO**, y **ninguno produce `MET`**:

| Caso | Resultado |
| --- | --- |
| Sujeto **sin evaluar** | `PENDING` |
| Obligaciones **desconocidas o pendientes** | `PENDING` |
| Evidencia **faltante** | `PENDING` |
| Evidencia **sustituida** por una versión posterior | `PENDING` |
| Evidencia de **otro sujeto** | `PENDING` |
| Evaluado con **otra versión** del perfil | `PENDING` |
| Obligación **no satisfecha** | **`INVALID`** (bloquea) |
| Sin parcelas de origen | `NOT_EVALUABLE` |
| **CONTROL POSITIVO** (fixture **sintética**) | `MET` |

El control positivo está **rotulado como fixture sintética** en el propio nombre de la prueba y en su
comentario: esa combinación **hoy no existe** en el producto, y sirve para demostrar que el requisito *puede*
cumplirse, no que se cumpla. **No es una aprobación jurídica.**

En integración (`legal-profile.int-spec.ts`, **25**): la evidencia ajena se rechaza al escribirla; sustituir la
versión documental deja la evidencia **desactualizada conservando la histórica**; y una parcela sin evaluación
**no se presume resuelta**.

## A.2 Vigencia e historial

| Qué cambia | Qué ocurre |
| --- | --- |
| **Cambia el perfil adoptado** | Las evaluaciones hechas con la versión anterior **dejan de acreditar** (`assessed_version` ≠ adoptada) |
| **Se sustituye una versión documental usada** | La evidencia queda **desactualizada** y el requisito vuelve a pendiente |
| **Se detecta una reforma relevante** | Entra como **versión nueva** del perfil; lo evaluado con la anterior deja de acreditar |

**Conservar la evidencia histórica no hace que una evaluación desactualizada siga acreditando.** Las dos cosas
conviven: la historia es append-only y el requisito deja de darse por satisfecho.

## A.3 Interfaz y respaldo: qué se verificó de verdad

### Navegador, no solo HTTP

**El 10/10 del recorrido HTTP no es una revisión de interfaz**, y se distingue. `e2e/review/perfil-juridico-navegador.mjs`,
**11/11**, con Chromium real y cuenta DEMO:

| Comprobación | Resultado |
| --- | --- |
| La pantalla se abre desde el menú | «Perfil jurídico (P1-005)» |
| Avisa de entrada que **no acredita** | parcial + revisión pendiente + lo declara |
| Las fuentes distinguen obtenido / contrastado / **vigencia revisada** | y la copia va identificada por **huella y página impresa** |
| Las reglas se presentan como **candidatas** | 4 |
| El rol EUDR **no ve** el botón de adoptar | ausente, y la pantalla lo explica |
| Preparar | **4 requisitos en aplicabilidad desconocida** |
| **TECLADO** | foco en «Aplicable» y **Enter** lo activa; aparece «Pendiente» |
| **HISTORIAL** | 1 entrada con su motivo y la nota de conservación |
| **390 px** | **sin desbordamiento horizontal**; 4 tablas en contenedor desplazable |

### Respaldo: qué se comprobó, y qué no se declara

Generar un respaldo **no demuestra restauración**. Lo verificado:

| Comprobación | Cómo | Resultado |
| --- | --- | --- |
| **Integridad de archivos** | `sha256sum -c SHA256SUMS.txt` | **OK** en los tres archivos |
| **Restauración aislada** | `scripts/ensayo-retorno.mjs` sobre base propia creada y eliminada | **12/12 APROBADO** |
| **Referencias** | huella del conjunto, no el recuento | **22 · idéntica** (`93d21b4c…0ec9`) |
| Esquema y tablas | contra lo declarado | **49 migraciones, 118 tablas** |
| Identidad cifrada e historial | clave activa y disparador | `k2=6, k1=0` · trigger `O` |
| **Objetos** | lista del tar frente al volumen vivo | **799 archivos en ambos, 0 ausentes**; de ellos **2** son objetos del bucket, el resto metadatos de MinIO |
| Fallo inducido | `pg_restore` interrumpido | identificado, base reconocible y **reintento exacto** |

## A.4 Lo que esto NO cambia

**P1-005 sigue ABIERTA** y las cifras siguen en **31/60 = 51,7 %** y **30/44 = 68,2 %**. Se corrigió un defecto
de un requisito ya contado; no se añadió ninguno. `UNDETERMINED`, `READY`, riesgo y despacho intactos; satélite
deshabilitado.

---

## Cierre de la entrega técnica de P1-005 (2026-10-17)

**La entrega técnica queda cerrada sobre `5228c9d`.** No se repite validación, despliegue ni respaldo por este
cierre documental.

### Lo que queda registrado, porque es la lección

**`0fbc473` aprobó todas sus pruebas y contenía un defecto de acreditación.** Su validación fue real —72
suites, 706 pruebas, 72 E2E, 0 fallos— y aun así `LEGAL_PROFILE` podía acreditar un lote **sin comprobar sus
obligaciones**: bastaba un catálogo completo y revisado. Las pruebas que yo había escrito cubrían el catálogo y
**no el sujeto**, así que el verde era cierto y la propiedad que faltaba no estaba probada.

Es el mismo patrón que `8f54b71` en P0-003: **una validación verde no acredita el contrato**. En los dos casos
el defecto apareció en una **revisión externa dirigida**, no en la suite. Por eso quedan los dos registrados.

| Candidato | Validación | Qué pasó |
| --- | --- | --- |
| `0fbc473` | **APROBADA** | **Defecto de acreditación por catálogo.** Corregido, no desplegado como definitivo |
| **`5228c9d`** | **APROBADA** | Corrección verificada: 716 pruebas, recorridos 10/10 y 11/11 |

### Estado al cerrar

**P1-005 y RF-36 siguen ABIERTAS.** Lo entregado es el **mecanismo**; lo que falta no es técnico:

| Pendiente jurídico | Por qué no lo cierra el código |
| --- | --- |
| **Revisión jurídica del contenido** | Exige pronunciarse sobre la vigencia y el alcance de cada regla candidata |
| **Cobertura del perfil** | Hoy tenencia, uso del suelo y ambiente; faltan laboral, penal ambiental, tributario, aduanero, anticorrupción y CLPI |
| **Responsable con competencia jurídica** | Es una designación. **Sin él nada se aprueba**, y no se inventa |
| **Pruebas de vigencia** | No hay consolidación oficial; las reformas verificadas **no prueban que sean todas** |

**No se continúa con el barrido artículo por artículo del Reglamento del COA**: concentraría el desarrollo en
investigación normativa. Queda anotado como trabajo disponible, no como siguiente paso.

Las **ocho decisiones de diseño están ADOPTADAS** (`docs/decisiones/P1-005-MATRIZ-OBLIGACIONES.md` §4) y **no
vuelven a pedirse**.
