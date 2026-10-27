# D-07 — Qué puede concluir el motor de riesgo, y con qué reglas. Contrato para decidir (NO APROBADO)

| | Estado |
| --- | --- |
| **D-07.1 · aprobación** | **MECANISMO ADOPTADO** para el MVP local (2026-10-15): usuario autenticado, permiso `risk:approve_rules`, fecha, motivo y auditoría. **Publicación global** y **adopción por organización** quedan separadas |
| **D-07.2 · severidad** | **MECANISMO ADOPTADO**: declarada por regla y versión, agregada por **máximo**, presentada **con su cobertura**. **A.2**: sin hallazgos, `NOT_ASSESSED` |
| **D-07.3 · score** | **NO APLICA.** No hay pesos, cortes ni puntuaciones, y el modelo no los admite |
| **D-07.4 · vigencia** | **MECANISMO ADOPTADO**: desactualización por cambio de datos o de reglas; una evaluación `STALE` no sostiene un requisito satisfecho |
| **D-07.5 y D-07.6** | **PENDIENTES.** La conclusión regulatoria sigue `UNDETERMINED` por `CHECK`. Paquete de revisión (significado exacto, opciones, ejemplos sintéticos, responsables): **§11** |

**Lo que la adopción de los mecanismos NO hace:**

- **No aprueba ningún catálogo.** `0.1.0` y `0.2.0` siguen **`NOT_APPROVED`** en publicación global, **sin
  severidades** y **sin adopción en ninguna organización**.
- **No asigna ninguna severidad.** La matriz que habría que revisar para hacerlo está en
  `docs/decisiones/D-07-MATRIZ-CATALOGO.md` y **tampoco está aprobada**.
- **No migra ninguna evaluación anterior.** La migración falla si encuentra una con severidad.
- **No habilita `READY` ni despacho**, y **no toca** ningún otro requisito del expediente.
- **No amplía `SUPER_ADMIN` ni resuelve D-04**: el permiso nuevo es de ámbito de organización.

El resto de este documento es el análisis que sostiene esas decisiones.

Revisión 2 — 2026-10-15. §7 desarrollado: cada decisión con su pregunta, sus alternativas, la recomendación y su
fundamento, qué comportamiento cambiaría, qué desbloquea y qué seguiría pendiente.

Qué es y qué no:

- **Es** el contrato que hay que decidir **antes** de tocar el motor: qué factores, con qué datos, qué produce cada
  hallazgo, cómo se tratan la ausencia y la contradicción, qué manda sobre qué, qué significa cada dimensión y
  quién puede publicar y aprobar reglas.
- **No es** una propuesta de pesos, umbrales ni puntuaciones. Donde la fuente no fija un número, **aquí no hay
  número**.
- **No es** un cambio de motor. El motor actual (P0-020) ya hace lo que debe hacer sin D-07: calcula factores
  técnicos, los explica y se niega a concluir.

> **Lo que D-07 NO es, dicho de una vez.** Cambiar `NOT_APPROVED` por `APPROVED` y quitar el `CHECK` no decide
> nada: solo deja que el sistema afirme cosas que nadie ha decidido. El candado **es** la decisión pendiente, no
> el obstáculo.

---

## 1. Las cuatro dimensiones, separadas

La confusión que D-07 tiene que evitar es tratarlas como grados de una misma escala. **No lo son**: se calculan con
datos distintos, las decide gente distinta y fallan de maneras distintas.

| # | Dimensión | Qué es | Quién la produce | Estado hoy |
| --- | --- | --- | --- | --- |
| 1 | **Hallazgo técnico observable** | Un hecho comprobable sobre los datos: «el lote tiene origen incompleto», «la geometría es inválida» | **El motor**, de forma determinista | **Implementado** (P0-020): `HIT` / `NOT_HIT` / `NOT_EVALUABLE` por factor |
| 2 | **Calidad y completitud de los datos** | Si había con qué evaluar: cobertura, vigencia, versión, ausencias | **El motor**, sobre la instantánea | **Implementado** en parte: `NOT_EVALUABLE` y `INCOMPLETE` existen; falta nombrar *por qué* falta cada dato |
| 3 | **Severidad de riesgo** | Cuánto importa un hallazgo, en una escala | **Una decisión de producto/regulatoria**, no el motor | **NO EXISTE**: `NOT_ASSESSED` fijado por `CHECK` |
| 4 | **Conclusión regulatoria** | Si el riesgo es insignificante o no, en el sentido de la norma | **Una revisión autorizada**, bajo un perfil jurídico | **NO EXISTE**: `UNDETERMINED` fijado por `CHECK` |

**Las cuatro reglas que no deben romperse:**

1. **Un hallazgo técnico no es severidad.** Que el origen esté incompleto es un hecho; cuánto pesa es una decisión.
2. **La calidad de datos no es riesgo bajo.** No haber podido evaluar nunca produce un resultado favorable.
3. **La severidad no es la conclusión.** `LOW` no significa «insignificante» en el sentido jurídico — lo dice la
   propia fuente (S1 §35: «no debemos convertir automáticamente LOW = insignificante legalmente»).
4. **La clasificación de riesgo de un país no es el riesgo de una parcela ni de un lote.** Ecuador figura como
   **riesgo estándar** (verificado el 2026-10-15, `docs/sources/eudr-norma-2026-10-15/`). Eso es una categoría del
   Art. 29 sobre un **territorio**, y **no** rellena ninguna de las cuatro dimensiones de un sujeto concreto. Si
   alguna regla futura quiere usarlo como **entrada**, tendrá que decirlo y decir con qué efecto.

---

## 2. Qué dice cada fuente, y qué no dice

| Fuente | Qué aporta | Qué **no** resuelve |
| --- | --- | --- |
| **S1 §33** | El riesgo no es un campo `risk = 72`: exige `risk_assessments`, `risk_factors`, `risk_evidence`, `risk_actions`, `risk_reviews` | Qué produce cada factor |
| **S1 §34** | Las **10 categorías** (ya implementadas como `CHECK` en `risk_rules`) | Qué reglas van en cada una |
| **S1 §35** | Los estados `NOT_ASSESSED`…`CRITICAL`, y **la advertencia**: no convertir `LOW` en «insignificante legalmente» sin reglas jurídicas configurables | Cuándo algo es `LOW` |
| **S1 §36** | El modelo de factor, con campos `weight` y `score` **existentes en el modelo** | Qué peso tiene nada |
| **S1 §37** | Un **ejemplo ilustrativo** de riesgo explicable: `+25 geometría incompleta, +30 alerta de cobertura, +15 evidencia legal insuficiente, +10 cadena compleja → score 80 = ALTO` | **Nada.** Es un ejemplo de *presentación*, no una tabla de pesos aprobada |
| **docs/13** | Dimensiones, categorías, registro de regla, evaluación reproducible, mitigación | Dice expresamente: «**No se aprueban pesos, umbrales ni lista jurídica definitiva en este paquete**» |
| **Reglamento (UE) 2023/1115** | Art. 10 (evaluación de riesgo) y Art. 11 (mitigación) como marco | El criterio operativo concreto para un lote de cacao ecuatoriano |

> **El punto incómodo de §37.** Es la única fuente con números, y es un **ejemplo**. Adoptar `+25/+30/+15/+10`
> sería una **decisión de producto presentada como derivación de la fuente**, que es justo lo que no se puede
> hacer. Si se quieren pesos, hay que decidirlos y firmarlos (§7, decisión **D-07.3**).

---

## 3. Factores exigidos y sus fuentes

El catálogo publicado (`0.2.0`, **NO APROBADO**) tiene **ocho** reglas. Esto es lo que hay, no lo que haría falta:

| Código | Categoría | Entrada | Efecto hoy | Depende de |
| --- | --- | --- | --- | --- |
| `DATA_MISSING_ORIGIN` | TRACEABILITY | Entregas sin origen declarado | BLOCKING | — |
| `MATERIAL_OF_UNKNOWN_ORIGIN` | MIXING | Lote con `origin_status = INCOMPLETE` | BLOCKING | — |
| `GEOMETRY_INVALID` | DATA_QUALITY | Evaluación `TL_GIS_TECH` de la versión vigente | BLOCKING | — |
| `MASS_BALANCE_INCONSISTENT` | TRACEABILITY | Conciliación del ledger | BLOCKING | — |
| `DOCUMENT_EXPIRED` | DOCUMENT_CREDIBILITY | Vigencia de soportes | REVIEW_REQUIRED | — |
| `MITIGATION_UNVERIFIED` | SUPPLY_CHAIN | Estado de mitigaciones | BLOCKING (en 0.2.0) | P0-021 |
| `SATELLITE_COVERAGE_UNKNOWN` | DEFORESTATION | Cobertura satelital | NOT_ASSESSED | P0-028 / D-09.B |
| `GEOLOCATION_PROFILE` | DEFORESTATION | Perfil de destino | NOT_ASSESSED | D-05 |

**Lo que falta, y que D-07 tiene que decidir si entra o no:** de las diez categorías, **cuatro no tienen ninguna
regla** — `LEGALITY`, `EVASION`, `HUMAN_RIGHTS`, `INDIGENOUS_RIGHTS` — y `SUPPLY_CHAIN` solo tiene la de
mitigación. No se proponen reglas nuevas aquí: proponerlas sin fuente sería inventar criterios de riesgo.

**`GEOLOCATION_PROFILE` cambia de situación, pero no de efecto.** Desde D-05.A el perfil técnico **sí** se evalúa
(`EUDR_GEO_V1`). Aun así la regla **sigue en `NOT_ASSESSED`**, y debe seguir: lo que el perfil acredita es que la
geometría está **bien formada para el destino**, no que la geolocalización satisfaga el requisito regulatorio. Esa
segunda cosa es D-05.B. **Convertir `MEETS_PROFILE` en un factor favorable sería exactamente el salto que D-05
prohíbe.** Si D-07 quiere usarlo, el camino honesto es un factor **nuevo y distinto**, sobre la calidad del dato
(dimensión 2), nunca sobre la conclusión.

---

## 4. Datos y versiones que exige una evaluación

Ya implementado y **no** se propone cambiarlo: la evaluación fija una **instantánea** (productores, parcelas,
entregas, lotes), guarda su **hash**, la versión del catálogo y los parámetros, y es **append-only**. Reevaluar
crea otra evaluación enlazada a la anterior.

Lo que D-07 debe decidir **sobre los datos**:

| # | Pregunta | Por qué importa |
| --- | --- | --- |
| 4.1 | **Qué versión de cada entrada cuenta**: ¿la vigente al evaluar, o la vigente al producirse el hecho? | Un lote de 2025 evaluado hoy contra la geometría de hoy puede no decir nada del cacao que salió |
| 4.2 | **Qué antigüedad invalida un dato** (evaluación GIS, soporte documental, resultado satelital) | Sin esto, un dato de hace dos años cuenta igual que uno de ayer |
| 4.3 | **Qué hace una evaluación `STALE`** cuando cambia la instantánea | Ya existe el mecanismo; falta decidir si una evaluación obsoleta puede sostener un expediente |
| 4.4 | **Alcance del grafo**: ¿hasta dónde se recorre el origen de un lote formado con lotes? | Hoy se recorre el grafo completo; decidir si eso se mantiene con volumen real |

---

## 5. Condiciones, ausencia, contradicción y precedencia

### 5.1 Qué produce cada hallazgo

Por factor, el motor ya produce `HIT` / `NOT_HIT` / `NOT_EVALUABLE`, con explicación y referencias. **Eso no
cambia.** Lo que D-07 añade es **qué significa** un `HIT`: hoy cada regla declara un `effect`
(`BLOCKING` / `REVIEW_REQUIRED` / `NOT_ASSESSED`) y **ahí se acaba**.

### 5.2 Información ausente

Regla que ya está implementada y que **debe conservarse explícitamente en el contrato**:

> **Un dato ausente nunca produce un resultado favorable.** Como mucho produce `INCOMPLETE` y una tarea de
> recopilación. Score insuficiente es `null` / `NOT_ASSESSED`, **no cero** (docs/13 §Dimensiones).

Lo que falta decidir: **distinguir por qué falta**. Hoy todo es `NOT_EVALUABLE`. No es lo mismo:

| Tipo de ausencia | Ejemplo | Tratamiento propuesto |
| --- | --- | --- |
| **Nunca se capturó** | Parcela sin geometría | `NOT_EVALUABLE` + tarea de captura |
| **Se capturó y no se evaluó** | Geometría sin evaluación GIS vigente | `NOT_EVALUABLE` + tarea de evaluación (es trabajo interno, no falta de dato) |
| **Depende de una decisión** | `SATELLITE_COVERAGE_UNKNOWN` (D-09.B), `GEOLOCATION_PROFILE` (D-05.B) | `NOT_EVALUABLE` **y no mitigable**: no se simula la resolución de una decisión ajena |
| **Restringido por permisos** | El evaluador no ve una parte del grafo | **Decisión pendiente**: ¿evaluación parcial declarada, o rechazo? Hoy no está resuelto |

### 5.3 Información antigua

**Sin decidir.** Hoy un soporte vencido dispara `DOCUMENT_EXPIRED` (REVIEW_REQUIRED), pero **no hay umbral de
antigüedad** para una evaluación GIS, un resultado satelital ni una mitigación verificada. Poner un número aquí
sin fuente sería inventarlo: es la decisión **D-07.4**.

### 5.4 Información contradictoria

**Sin tratar hoy, y es un hueco real.** Casos que ya pueden darse:

- Superficie **declarada** y **calculada** a distinto lado del umbral → D-05.A lo manda a **revisión humana**. El
  motor de riesgo **no lo ve**: no hay factor que lo recoja.
- Dos evaluaciones GIS de la misma versión con resultados distintos (posible si cambió la regla).
- Un soporte documental que afirma algo que el ledger contradice.

**Propuesta de principio, no de regla**: una contradicción **no se resuelve eligiendo**. Produce
`REVIEW_REQUIRED` con las dos cifras a la vista. Es la misma regla que ya se adoptó en D-05.A, y conviene que el
motor la herede en vez de inventar otra.

### 5.5 Precedencia

Ya implementado, y el contrato debe **ratificarlo tal cual**:

```
BLOCKED  >  REVIEW_REQUIRED  >  INCOMPLETE  >  NO_FINDINGS_IN_EVALUATED_RULES
```

- **Un factor bloqueante no se diluye.** No hay promedio que lo compense. Esto es lo que impide que un `score`
  bajo tape un hallazgo crítico (docs/13: «bloqueos se evalúan independientemente del promedio»).
- `NO_FINDINGS_IN_EVALUATED_RULES` **no es «sin riesgo»**: es «sin hallazgos **en lo que se evaluó**». El nombre
  está elegido para que no se pueda leer de otra manera, y **no debe acortarse**.

---

## 6. Severidad, conclusión, revisión y mitigación

### 6.1 Severidad (dimensión 3)

Hoy: `NOT_ASSESSED` por `CHECK`. Para que exista hace falta decidir **una** de estas tres vías — y son
**excluyentes**:

| Vía | Cómo funciona | A favor | En contra |
| --- | --- | --- | --- |
| **A · Severidad por regla** | Cada regla declara su severidad en el catálogo (`risk_rules.severity`, hoy forzada a `NULL`) | Explicable, sin aritmética opaca, trazable a la regla | No dice qué pasa con varias reglas a la vez: hace falta una regla de agregación (la máxima, propuesta) |
| **B · Score con pesos** | Suma ponderada estilo S1 §37 | Es lo único que la fuente ilustra | **Los pesos no están en ninguna fuente**; un score oculta factores; exige además umbrales de corte |
| **C · Sin severidad** | Se queda en `NOT_ASSESSED` indefinidamente | Honesto | Deja dos indicadores de reportes y un requisito del expediente muertos para siempre |

**Recomendación (no aprobada): vía A, con agregación por máximo.** Es la que mejor encaja con la precedencia ya
implementada, no introduce números sin fuente, y mantiene la explicabilidad que exige S1 §37 — que pide *riesgo
explicable*, no necesariamente *riesgo sumado*.

Si se elige **B**, los pesos **deben firmarse como decisión de producto**, con su fundamento, y hay que probar
explícitamente que **ningún peso puede tapar un bloqueante** (docs/13 lo exige por escrito).

### 6.2 Conclusión regulatoria (dimensión 4)

Hoy: `UNDETERMINED` por `CHECK`. **Esta no la puede producir el motor en ningún caso.** Exige:

1. Un **perfil jurídico** aprobado (hoy `LEGAL_PROFILE`, requisito abierto, P1-005) que diga qué requisitos
   aplican a un operador de cacao en Ecuador.
2. Una **revisión humana autorizada**, con actor, fecha y motivo.
3. Que **D-05.B** esté resuelta, porque la geolocalización es un requisito de información del Art. 9(1)(d) y hoy
   no se sabe a qué actor obliga.

**Propuesta de principio**: la conclusión **nunca** se deriva de la severidad. `CRITICAL` no implica
`NON_NEGLIGIBLE`, y ningún `LOW` implica `NEGLIGIBLE`. El motor puede **proponer** y una persona autorizada
**concluye**, dejando registro.

### 6.3 Qué hace de verdad una mitigación verificada

**La pregunta más fácil de responder mal.** Hoy, `MITIGATION_UNVERIFIED` está en `BLOCKING` (catálogo 0.2.0) y
verificar una mitigación lo apaga. Lo que **no** hace, y el contrato debe decirlo:

- **No cambia el hallazgo original.** Si el origen estaba incompleto, sigue incompleto.
- **No produce una conclusión favorable.** Resuelve una **tarea**, no un hecho.
- **No cierra la revisión por sí sola**: docs/13 pide reevaluar **después** de verificar, no en lugar de.
- **`RESOLVED` puede significar que se investigó y se rechazó el material**, no que pasó a ser elegible.

**Propuesta**: una mitigación verificada **habilita reevaluar**; el resultado lo decide la reevaluación, no la
mitigación. Y el ejecutor **no** puede ser el verificador (ya implementado, y debe conservarse).

### 6.4 Revisión humana

Existe (`START_REVIEW` / `RESOLVE` con motivo). Lo que falta decidir: **qué puede cambiar una revisión**. Hoy
cambia el proceso, no el resultado. La propuesta es que siga así: una revisión **no reescribe un factor técnico**,
y si hay que cambiar un hecho, se corrige el dato y se **reevalúa**.

---

## 7. El mínimo conjunto de decisiones para que D-07 sea implementable

Seis decisiones. **Las tres primeras bastan para desbloquear la severidad**; las tres últimas son la conclusión
regulatoria, que puede ir después y **no bloquea a las primeras**.

| # | Decisión | Quién | Desbloquea |
| --- | --- | --- | --- |
| **D-07.1** | Quién aprueba un catálogo de reglas y con qué registro | Producto | Nada por sí sola; **sin ella ninguna otra se puede aplicar** |
| **D-07.2** | Vía de severidad: por regla, por score, o ninguna | Producto | `risk_high` / `risk_medium` / `risk_low` de **P0-030** |
| **D-07.3** | Si se elige score: pesos y umbrales, firmados | Producto | Lo mismo que D-07.2 |
| **D-07.4** | Qué vuelve obsoleto un dato y qué pasa entonces | Producto + regulatorio | Parte de `RISK_CATALOG_APPROVED` de **P0-022** |
| **D-07.5** | Perfil jurídico aplicable | **Regulatorio** | `LEGAL_PROFILE` de **P0-022** |
| **D-07.6** | Quién concluye y bajo qué condiciones | **Regulatorio** | `REGULATORY_CONCLUSION` de **P0-022** |

---

### D-07.1 — Quién aprueba un catálogo de reglas, y con qué registro

**Pregunta concreta.** Hoy `risk_rule_sets.approval_status` solo admite `NOT_APPROVED` o `APPROVED`, y un `CHECK`
exige que `APPROVED` traiga `approved_by`. Ese campo es **texto libre**. ¿Quién puede aprobar un catálogo, qué se
guarda de esa aprobación y qué pasa con las evaluaciones hechas con catálogos anteriores?

**Alternativas.**

| | Opción | Qué implica |
| --- | --- | --- |
| **A** | **Aprobación nominal en el propio catálogo**: `approved_by` queda como texto con nombre y cargo del responsable, más fecha y motivo | Lo mínimo. No exige cambios de modelo. No impide que alguien escriba cualquier cosa |
| **B** | **Aprobación por permiso**: un permiso nuevo (`risk:approve_rules`) y el registro del usuario que aprueba, con auditoría | Trazable a una persona del sistema. Exige tocar el catálogo de permisos y asignarlo a algún rol |
| **C** | **Aprobación con doble firma**: dos aprobadores distintos, ninguno de los cuales redactó las reglas | El más estricto. Probablemente desproporcionado para un MVP local con un solo responsable |

**Recomendación: B.** Fundamento: el proyecto ya exige en otros sitios que una afirmación con consecuencias tenga
actor identificado y auditado —cerrar una entrega con diferencia exige `delivery:correct`, verificar una
mitigación exige un verificador distinto del ejecutor—. Un catálogo de riesgo aprobado es, como mínimo, tan
consecuente como eso. **A** deja una afirmación fuerte apoyada en texto libre; **C** no tiene a quién asignarse
hoy.

**Qué comportamiento cambiaría.** Aparece un permiso nuevo y la aprobación queda ligada a un usuario, con entrada
de auditoría. **El catálogo seguiría `NOT_APPROVED` hasta que alguien con ese permiso lo apruebe**: la decisión
habilita el acto, no lo ejecuta.

**Qué desbloquea.** Por sí sola, **nada visible**. Es el prerrequisito de D-07.2, D-07.3 y D-07.4: todas ellas se
materializan publicando un catálogo nuevo, y sin aprobador no hay catálogo aprobable.

**Qué seguiría pendiente.** Todo lo demás. Aprobar el catálogo `0.2.0` **tal como está** no produciría ninguna
severidad: sus reglas llevan `severity NULL` y el `CHECK` de `risk_rules` lo fuerza. Aprobar sin D-07.2 solo
cambiaría la etiqueta del requisito `RISK_CATALOG_APPROVED`, que es justamente el riesgo que hay que evitar:
**sería un `MET` sin contenido**.

**Qué prueba lo demostraría.**

1. Un usuario sin el permiso intenta aprobar → **denegado y explicado**.
2. Un usuario con el permiso aprueba → queda `approved_by`, fecha y entrada de auditoría.
3. **Las evaluaciones anteriores no cambian**: siguen citando su `rule_set_version` y su resultado, fila por fila.
4. Aprobar un catálogo cuyas reglas no declaran severidad **no produce ninguna severidad**: el indicador sigue en
   `UNKNOWN`. (Esta es la prueba que impide confundir D-07.1 con D-07.2.)

---

### D-07.2 — Cómo se define la severidad

**Pregunta concreta.** *(Redactada antes de adoptar el mecanismo; se conserva como el análisis que lo sostuvo.)*
Entonces `risk_evaluations.severity` era siempre `NOT_ASSESSED`, forzado por
`CHECK (conclusion = 'UNDETERMINED' AND severity = 'NOT_ASSESSED')`, y `risk_rules.severity` estaba forzada a
`NULL`. ¿De dónde sale la severidad de un lote: de cada regla, de una suma de pesos, o de ningún sitio?

#### Las alternativas

**Vía A — severidad declarada por regla, agregada por máximo.**

Cada regla del catálogo declara su severidad (`LOW` / `MEDIUM` / `HIGH` / `CRITICAL`). La severidad del lote es
**la mayor entre las reglas que resultaron `HIT`**. Sin ningún `HIT`, no hay severidad asignada (ver «el piso»,
más abajo).

- A favor: explicable sin aritmética —se puede señalar *qué regla* produjo la severidad—; encaja con la
  precedencia que ya existe; **no introduce ningún número sin fuente**.
- En contra: no distingue «un `HIGH`» de «seis `HIGH`». Es una pérdida deliberada: agregar por conteo exigiría
  umbrales, que es la vía B.

**Vía B — score con pesos y umbrales de corte.**

Cada regla aporta un peso; se suman; el total cae en una banda. Es lo que **ilustra** S1 §37
(`+25/+30/+15/+10 → 80 = ALTO`).

- A favor: es la única forma que la fuente **dibuja**; permite graduar acumulación.
- En contra: **los pesos no están en ninguna fuente** — §37 es un ejemplo de presentación, no una tabla
  aprobada—; un score **oculta** qué factor lo produjo, que es justo lo que S1 §37 dice no querer («no queremos un
  algoritmo opaco»); y exige además decidir los cortes (D-07.3). docs/13 obliga a probar que «sumar factores y
  limitar un score no oculta un factor crítico».

**Vía C — no definir severidad.**

Se queda en `NOT_ASSESSED` indefinidamente.

- A favor: es la postura más honesta si nadie puede fundamentar una escala.
- En contra: deja tres indicadores de reportes muertos de forma permanente y convierte un «todavía no» en un
  «nunca».

**Recomendación: vía A.** Fundamento: es la única que satisface a la vez las tres exigencias escritas —riesgo
**explicable** (S1 §37), **sin pesos ni umbrales** (docs/13) y **sin diluir un bloqueante** (docs/13)—. La vía B
no puede adoptarse sin inventar números o sin una decisión firmada que los fundamente, y la vía C renuncia.

#### Cómo se define exactamente, en la vía A

1. **Dónde vive.** En `risk_rules.severity`, por regla y por versión de catálogo. Es un dato **del catálogo**, no
   del motor: cambiar una severidad es publicar una versión nueva.
2. **Qué valores.** Los de S1 §35 que ya están en el `CHECK` de `risk_evaluations`:
   `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, más `NOT_ASSESSED` como ausencia.
3. **Agregación: el máximo**, nunca el promedio ni la suma. Orden: `CRITICAL > HIGH > MEDIUM > LOW`.
4. **Solo cuentan las reglas `HIT`.** Una regla `NOT_HIT` no aporta severidad, y una `NOT_EVALUABLE` **tampoco**:
   no se sabe si habría dado `HIT`.
5. **La severidad no sustituye a la precedencia.** El `technical_result`
   (`BLOCKED > REVIEW_REQUIRED > INCOMPLETE > NO_FINDINGS_IN_EVALUATED_RULES`) se sigue calculando igual y **manda
   sobre lo que se puede hacer con el lote**. La severidad es una etiqueta adicional, no un sustituto.
6. **Una regla sin severidad declarada no asigna ninguna**, aunque resulte `HIT`. Entonces el lote queda
   `NOT_ASSESSED` **con el motivo**: «la regla X dio HIT pero no declara severidad en el catálogo N».

#### El piso: qué pasa cuando no hay ningún hallazgo

**Esta es la pregunta donde un resultado favorable puede colarse**, y por eso va explícita.

| | Opción | Consecuencia |
| --- | --- | --- |
| **A.1** | Sin ningún `HIT` → **`LOW`** | **Convierte la ausencia de hallazgos en una afirmación favorable.** Y la ausencia puede deberse a que la mitad de las reglas no se pudieron evaluar |
| **A.2** | Sin ningún `HIT` → **`NOT_ASSESSED`**, con motivo | Nunca se afirma algo favorable por ausencia. Precio: muchos lotes se quedan sin clasificar |
| **A.3** | Sin ningún `HIT` **y con todas las reglas evaluadas** → `LOW`; si alguna quedó `NOT_EVALUABLE` → `NOT_ASSESSED` | Intermedio: solo se afirma `LOW` cuando **se evaluó todo** |

**Recomendación: A.3.** Fundamento: respeta la regla de docs/13 —«un dato ausente nunca produce un resultado
favorable»— sin convertirla en «nunca se afirma nada». `LOW` solo aparece cuando el `technical_result` es
`NO_FINDINGS_IN_EVALUATED_RULES` **y** no hay ningún factor `NOT_EVALUABLE`. Y aun entonces, **`LOW` no significa
«riesgo insignificante» en el sentido jurídico**: lo prohíbe S1 §35 expresamente, y esa es la dimensión 4.

> Con el catálogo de hoy, **A.3 casi nunca asignaría `LOW`**: `SATELLITE_COVERAGE_UNKNOWN` y `GEOLOCATION_PROFILE`
> son `NOT_EVALUABLE` por dependencias abiertas (D-09.B y D-05.B). **Eso es correcto, no un defecto**: significa
> que hoy no se puede afirmar que un lote sea de riesgo bajo, y el sistema lo dirá en vez de inventarlo.

#### Qué universo cuenta cada indicador, y cómo se conservan los sujetos sin evaluar

Esto **ya está implementado y probado** (`reports-risk.ts`, módulo puro) y **D-07.2 no lo cambia**. Se reproduce
aquí porque es parte del contrato que se está decidiendo:

| Magnitud | Qué es |
| --- | --- |
| `lotes_del_tenant` | **Todos** los lotes. Es el universo conocido |
| `lotes_evaluados` | Lotes con **al menos una** evaluación de riesgo. Se cuenta solo la **última** de cada sujeto |
| `sin_severidad_asignada` | Evaluados cuya última evaluación quedó `NOT_ASSESSED` |
| `con_severidad_asignada` | Evaluados con severidad real. **Este es el denominador** |

Los tres estados posibles, y lo que cada uno se niega a decir:

| Situación | Estado | Por qué |
| --- | --- | --- |
| Ningún lote evaluado | **`NO_DENOMINATOR`** | El cociente no existe. Que no haya evaluaciones es un hecho observado, no un cero |
| Evaluados, ninguno clasificado | **`UNKNOWN`** | «0 lotes de riesgo alto» sería una cifra favorable inventada sobre sujetos sin clasificar |
| Al menos uno clasificado | **`OK`** | Numerador y denominador reales |

**Cómo se conservan los sujetos sin evaluar** — las tres reglas que no deben romperse:

1. **No entran en el denominador.** El denominador son los lotes **con severidad asignada**, no los del tenant.
   Meterlos diluiría el porcentaje y convertiría «desconocido» en «bajo».
2. **No desaparecen.** Se publican en `observed` —`lotes_del_tenant`, `lotes_evaluados`,
   `sin_severidad_asignada`— para que se vea cuántos quedan fuera y nadie lea la cifra como si cubriera todo.
3. **Se dice por escrito** en el motivo del indicador: «esta cifra **NO** es la distribución de los N lotes del
   tenant».

**Qué cambiaría hoy, en concreto.** Hoy la rama `UNKNOWN` está **permanentemente activa**: el `CHECK` impide que
exista una sola fila con severidad. Con D-07.2 + un catálogo aprobado con severidades, la rama `OK` se activa por
primera vez. **La lógica de universo y denominador ya está escrita y probada con conjuntos sintéticos**,
precisamente para que ese día no haya que improvisarla.

**Qué desbloquea.** Los tres indicadores `risk_high` / `risk_medium` / `risk_low` de **P0-030**. **No** desbloquea
el expediente: `RISK_CATALOG_APPROVED` y `REGULATORY_CONCLUSION` dependen de D-07.5 y D-07.6.

**Qué seguiría pendiente.**

- La **conclusión regulatoria** (D-07.5, D-07.6): `CRITICAL` no implica `NON_NEGLIGIBLE` ni `LOW` implica
  `NEGLIGIBLE`.
- `SATELLITE_COVERAGE_UNKNOWN` seguiría `NOT_EVALUABLE` hasta **D-09 parte B**.
- `GEOLOCATION_PROFILE` seguiría `NOT_ASSESSED` hasta **D-05.B**.
- Las **cuatro categorías sin reglas** (`LEGALITY`, `EVASION`, `HUMAN_RIGHTS`, `INDIGENOUS_RIGHTS`) seguirían
  vacías: una severidad calculada sobre ocho reglas no cubre diez categorías, y el indicador no debe insinuar que
  sí.

**Qué pruebas lo demostrarían.**

1. Lote con dos `HIT` de severidad distinta → **gana la mayor**.
2. Lote con un factor `BLOCKING` y varios leves → el bloqueante **no se diluye**: `technical_result` sigue
   `BLOCKED` sea cual sea la severidad.
3. Lote con un `HIT` cuya regla **no declara** severidad → `NOT_ASSESSED` **con el motivo**, no `LOW`.
4. Lote sin `HIT` pero **con** un factor `NOT_EVALUABLE` → `NOT_ASSESSED` (opción A.3), **nunca** `LOW`.
5. Lote sin `HIT` y con **todo** evaluado → `LOW`, y la pantalla dice que `LOW` **no es** «insignificante»
   jurídicamente.
6. Reportes: un tenant con 10 lotes, 3 evaluados y 2 clasificados → denominador **2**, y `observed` publica los
   otros 8; el motivo dice que no es la distribución del tenant.
7. Reevaluar un lote **no reescribe** la evaluación anterior: ambas quedan, cada una con su catálogo.

---

### D-07.3 — Si se elige la vía B: pesos y umbrales

**Pregunta concreta.** Qué peso aporta cada regla y en qué puntos se corta la escala.

**Alternativas.** (B.1) Adoptar los números del ejemplo de S1 §37 tal cual. (B.2) Derivar pesos de una fuente
metodológica externa citada. (B.3) Fijarlos por decisión de producto, firmados y fundamentados.

**Recomendación: ninguna, salvo que se descarte la vía A.** Si hay que elegir, **B.3**: al menos es honesta sobre
su origen. **B.1 no es aceptable**: tomar un ejemplo ilustrativo como tabla de pesos es presentar una decisión de
producto como derivación de la fuente, que es el error que D-05 ya obligó a corregir una vez.

**Qué cambiaría.** Un modelo de score y cortes, más la obligación de mostrar la descomposición (S1 §37 pide
riesgo explicable).

**Qué desbloquea.** Lo mismo que D-07.2, por otra vía.

**Qué seguiría pendiente.** Lo mismo que D-07.2, más una prueba adicional obligatoria: **que ningún peso pueda
tapar un bloqueante**, y que el score **no sustituya** la precedencia.

---

### D-07.4 — Antigüedad: qué vuelve obsoleto un dato

**Pregunta concreta.** Hoy `DOCUMENT_EXPIRED` mira la vigencia declarada de un soporte, pero **no hay ninguna
regla de antigüedad** para una evaluación GIS, un dictamen de perfil, un resultado satelital o una mitigación
verificada. ¿Cuándo un dato deja de servir, y qué pasa entonces?

**Alternativas.**

| | Opción | Qué implica |
| --- | --- | --- |
| **A** | **Sin antigüedad**: un dato vale mientras no cambie | Lo de hoy. Un dictamen de hace dos años cuenta igual que uno de ayer |
| **B** | **Antigüedad por tipo de dato**, declarada en el catálogo | Exige **números**, que hoy no tienen fuente |
| **C** | **Solo `STALE` por cambio**, sin plazo: una evaluación se marca obsoleta cuando cambia su instantánea, y eso ya existe | No inventa plazos; cubre el caso real de «los datos cambiaron» |

**Recomendación: C ahora, B cuando haya operación real.** Fundamento: el mecanismo `STALE` **ya está
implementado** y cubre lo que de verdad puede comprobarse hoy —que la instantánea cambió—. Fijar un plazo «6
meses» sin fuente sería inventarlo, y con datos sintéticos no hay forma de calibrarlo.

Lo que **sí** hay que decidir ahora, y es parte de C: **qué efecto tiene que una evaluación esté `STALE`**. Hoy se
marca y no pasa nada más. Propuesta: una evaluación `STALE` **no puede sostener** un requisito del expediente, y
se dice con ese motivo.

**Qué desbloquea.** Parte de `RISK_CATALOG_APPROVED`: un catálogo aprobado cuyas evaluaciones pueden estar
obsoletas sin consecuencia no acredita gran cosa.

**Qué seguiría pendiente.** Los plazos por tipo de dato (B), que necesitan operación real para calibrarse.

**Qué prueba lo demostraría.** Cambiar la geometría de una parcela de origen → la evaluación del lote queda
`STALE` → el requisito del expediente que dependía de ella pasa a **no satisfecho**, con el motivo, **sin**
reescribir la evaluación anterior.

---

### D-07.5 — Perfil jurídico aplicable

> **Errata (2026-10-21), el texto de abajo se conserva:** esta sección es anterior a P1-005 y atribuye a D-07.5 el requisito `LEGAL_PROFILE`. Desde P1-005 ese requisito lo sostiene el perfil jurídico de `P1-005-MATRIZ-OBLIGACIONES.md` (§6); a D-07.5 le **queda** vincular una versión del catálogo con un perfil revisado (`regulatory_profile`, que sostiene `RISK_CATALOG_APPROVED`). Ver §11.1.

**Pregunta concreta.** Qué requisitos legales aplican a un operador de cacao con origen en Ecuador, con qué
autoridad, artículo, versión y vigencia. Hoy el requisito `LEGAL_PROFILE` del expediente es `NOT_EVALUABLE` y la
categoría `LEGALITY` del catálogo **no tiene ninguna regla**.

**Alternativas.** (A) Perfil completo antes de habilitar nada. (B) Perfil **mínimo** con los requisitos que el
responsable confirme como aplicables, versionado y ampliable. (C) Dejarlo fuera del alcance del MVP.

**Recomendación: B.** Fundamento: es la que permite empezar sin fingir completitud, y encaja con lo que docs/13 ya
pide —«registrar temas de tenencia, uso de suelo, derechos laborales/humanos/indígenas **cuando el revisor
confirme pertinencia**»—. Un perfil mínimo versionado **dice lo que cubre y lo que no**.

**Quién.** **Responsable regulatorio.** No es decidible por el equipo, y tampoco por producto.

**Qué seguiría pendiente.** D-10 (requisitos legales de Ecuador) sigue siendo la fuente; un título documental **no
prueba por sí solo** vigencia ni legalidad (docs/13).

**Qué prueba lo demostraría.** Con perfil aprobado, `LEGAL_PROFILE` pasa a evaluable y cita **qué versión de
perfil** aplicó; sin él, sigue `NOT_EVALUABLE` con motivo.

---

### D-07.6 — Quién concluye, y bajo qué condiciones

**Pregunta concreta.** `risk_evaluations` lleva hoy `risk_evaluations_conclusion_undetermined` (migración `0042`,
antes parte del `CHECK` único de 0025): **ninguna fila puede llevar conclusión**.
¿Quién puede afirmar `NEGLIGIBLE` o `NON_NEGLIGIBLE`, y con qué condiciones previas?

**Alternativas.**

| | Opción | Qué implica |
| --- | --- | --- |
| **A** | **El motor concluye** a partir de la severidad | **Prohibido por la fuente**: S1 §35 dice expresamente que no se convierta `LOW` en «insignificante legalmente» |
| **B** | **Una persona autorizada concluye**, sobre una evaluación concreta, con motivo y registro | El motor puede **proponer**; la afirmación es humana y trazable |
| **C** | **Nadie concluye en el MVP**: el expediente nunca llega a `READY` | Honesto, pero deja el producto sin su punto final |

**Recomendación: B.** Fundamento: es lo que exige la fuente y lo que ya hace el resto del sistema cuando una
afirmación tiene consecuencias —la calidad se libera por **decisión humana**, la mitigación la verifica alguien
distinto del ejecutor—.

**Condiciones previas, acumulativas**, antes de que una conclusión sea siquiera posible:

1. Catálogo **aprobado** (D-07.1) con severidades (D-07.2).
2. **Perfil jurídico** aprobado (D-07.5).
3. Evaluación **no `STALE`** (D-07.4).
4. Revisor **autorizado**, distinto de quien evaluó.
5. **Motivo escrito**. Una conclusión sin motivo no se guarda.

**Qué cambiaría.** El `CHECK` dejaría de ser absoluto y pasaría a admitir conclusión **solo** cuando exista una
revisión autorizada que la respalde. **No se retira: se sustituye por uno más preciso.** Mientras tanto sigue tal
cual.

**Qué desbloquea.** `REGULATORY_CONCLUSION` de **P0-022**, y con él una de las seis condiciones del `READY`.

**Qué seguiría pendiente.** Las otras cinco del expediente: `GEOLOCATION_PROFILE` (D-05.B),
`DEFORESTATION_ANALYSIS` (D-09.B), `LEGAL_PROFILE` (D-07.5), `RISK_CATALOG_APPROVED` y `SHIPMENT_LINK` (D-34).
**Decidir D-07.6 no abre el expediente por sí solo**, y conviene decirlo antes de que alguien lo espere.

**Qué prueba lo demostraría.** Conclusión sin revisor autorizado → **rechazada**; con revisor pero sin perfil
jurídico → **rechazada**; sobre evaluación `STALE` → **rechazada**; con todo en regla → registrada con actor,
fecha y motivo, **sin** modificar la evaluación original.

### 7.1 Lo que NO hay que decidir para avanzar

**D-07.2 no depende de D-07.5 ni de D-07.6.** Se puede tener severidad explicable mucho antes de poder concluir
nada en términos regulatorios. Separarlas evita el bloqueo general: hoy, **D-07.1 + D-07.2 desbloquean tres
indicadores de reportes** sin tocar la conclusión ni el expediente.

### 7.2 Qué revisión especializada hace falta, y para qué exactamente

No «una revisión regulatoria» en abstracto:

| Para | Hace falta | Para qué NO hace falta |
| --- | --- | --- |
| **D-07.5** y **D-07.6** | Un **responsable regulatorio** con criterio sobre EUDR y legislación ecuatoriana aplicable | No hace falta para D-07.1, D-07.2 ni D-07.3 |
| **D-07.1**, **D-07.2**, **D-07.3** | **Responsable de producto**, con el equipo | No hace falta un jurista para decidir si la severidad se declara por regla o se suma |
| **D-07.4** | Producto ahora (opción C); regulatorio y operación real para los plazos (opción B) | — |
| `SATELLITE_COVERAGE_UNKNOWN` | **D-09 parte B** | No bloquea las demás reglas |
| `GEOLOCATION_PROFILE` | **D-05.B** | El perfil **técnico** ya está, y no sirve para esto |

---

## 8. Conservación de las evaluaciones históricas

Ya implementado, y el contrato lo **ratifica como requisito**, no como detalle:

- `risk_evaluations` es **append-only**, numerada por sujeto y enlazada a la anterior.
- Cada evaluación guarda **su** `rule_set_version`, su instantánea y su hash. Publicar un catálogo nuevo **no
  reescribe** ni recalcula nada.
- Una evaluación hecha con `0.2.0` seguirá diciendo `0.2.0` para siempre, aunque exista `1.0.0` aprobado.
- Un trabajo atrasado **no pisa** una evaluación posterior: se comprueba la versión objetivo.

**Lo que falta**: decidir **cómo se presenta** un conjunto de evaluaciones hechas con versiones distintas. Es el
mismo problema que D-05.A resolvió en `plots_valid` declarando `mixed_versions`, y conviene resolverlo igual.

---

## 9. Qué NO se hace en esta propuesta

- **No** se aprueba ningún catálogo, ni se cambia `NOT_APPROVED`.
- **No** se retira el `CHECK` de `risk_evaluations`, ni el de `risk_rules.severity`.
- **No** se proponen pesos, umbrales ni puntuaciones.
- **No** se añaden reglas a las categorías vacías: inventarlas sería fabricar criterios de riesgo.
- **No** se toca el expediente ni el despacho, ni se fuerza ningún `READY`.
- **No** se usa la clasificación de país como riesgo de un sujeto.

---

## 10. Estado de las piezas, para quien decida

| Pieza | Estado | Qué falta |
| --- | --- | --- |
| Motor de factores, explicación y referencias | **Implementado** (P0-020) | Nada para D-07.2 |
| Precedencia sin promedio | **Implementado** | Ratificarla |
| Instantánea, hash, append-only, `STALE` | **Implementado** | Efecto de `STALE` (D-07.4) |
| Catálogo versionado y publicable | **Implementado**, `0.1.0` y `0.2.0` `NOT_APPROVED` | Aprobador (D-07.1) |
| Severidad | **Bloqueada por `CHECK`** | D-07.2 (y D-07.3 si procede) |
| Conclusión regulatoria | **Bloqueada por `CHECK`** | D-07.5 y D-07.6 |
| Mitigación con ejecutor ≠ verificador | **Implementado** (P0-021) | Ratificar que **habilita reevaluar**, no concluir |
| Cuatro categorías sin reglas | **Vacías** | Decidir si entran, con fuente |

---

## 11. Paquete de revisión de D-07.5 y D-07.6 (2026-10-21)

**No aprueba nada.** Contrasta el significado de ambas decisiones con sus fuentes vigentes, completa sus opciones y fija quién decide qué. `UNDETERMINED` se conserva y ninguna clasificación parcial se convierte en conclusión.

### 11.1 Significado exacto: las fuentes no dicen lo mismo, y hay que fijarlo antes de decidir
| Fuente | Qué llama «D-07.5» | Qué dice que desbloquea |
| --- | --- | --- |
| §7 de esta propuesta (rev. 2, 2026-10-15) | «Perfil jurídico aplicable»: qué requisitos legales aplican a un operador de cacao en Ecuador | `LEGAL_PROFILE` de P0-022 |
| `docs/13` (mecanismos adoptados) y `docs/22` (tabla del bloque regulatorio) | «**Aprobación bajo perfil jurídico**» de una versión del catálogo de riesgo (`risk_rule_sets.regulatory_profile`) | `RISK_CATALOG_APPROVED`; poder concluir |
| Código (`dd/requirements.ts`) y comentario de la columna (migración `0043`) | `regulatory_profile` = «perfil jurídico bajo el que esta versión fue aprobada para concluir (D-07.5). `NULL` = publicada técnicamente, sin aprobación regulatoria» | `RISK_CATALOG_APPROVED` (a `MET` solo con catálogo adoptado **y** `regulatory_profile` no nulo) |
| `docs/23` | Ambas lecturas a la vez | `LEGAL_PROFILE` y `RISK_CATALOG_APPROVED` |

**Hallazgo (errata, el texto original de §7 se conserva):** el §7 es **anterior** a P1-005 (2026-10-17). Desde entonces `LEGAL_PROFILE` lo sostiene el perfil jurídico de P1-005 (qué obligaciones legales, con qué fuente y evidencia), y lo que **queda** de D-07.5 es otra cosa:
**con qué perfil jurídico revisado se aprueba una versión del catálogo para poder concluir**. Por tanto D-07.5 se descompone en dos preguntas que no son la misma:
- **D-07.5(a) — contenido del perfil jurídico** (qué obligaciones): es el paquete P1-005 (`P1-005-MATRIZ-OBLIGACIONES.md` §6). Las alternativas A/B/C de §7 se aplican **aquí**.
- **D-07.5(b) — vinculación catálogo ↔ perfil**: qué valor puede llevar `regulatory_profile`, quién lo fija y qué debe cumplir el perfil referenciado.

**Hallazgo técnico que importa a (b):** hoy `RISK_CATALOG_APPROVED` pasa a `MET` con **cualquier texto no nulo** en `regulatory_profile`: el código **no comprueba** que ese valor corresponda a un perfil con revisión jurídica registrada. Tampoco existe un camino de API para fijarlo (solo una migración). La protección actual es que **nadie lo fija**. Si se adopta la opción (b-1) de abajo, esa comprobación es implementación **original pendiente**.

### 11.2 Cuatro dimensiones que no se mezclan (estado real)
| Dimensión | Qué es | Dónde vive | Estado | Quién la decide |
| --- | --- | --- | --- | --- |
| **Configuración técnica del riesgo** | Reglas, efectos, severidad por regla, agregación por máximo, vigencia (D-07.1/.2/.4) | `risk_rule_sets` `1.0.0`, adopción por organización | **Adoptada** para el MVP local (adopción de ensayo en la Cooperativa DEMO) | Producto |
| **Cobertura del catálogo** | Qué categorías tienen alguna regla | Catálogo `1.0.0`: ocho reglas; **sin regla** `LEGALITY`, `EVASION`, `HUMAN_RIGHTS`, `INDIGENOUS_RIGHTS` | Toda clasificación es **PARCIAL** y lo dice | Producto, con revisión de qué falta (depende de P1-005) |
| **Revisión del perfil legal** | Que alguien competente revisó las obligaciones | `legal_profile_reviews` | **Ninguna** | Responsable jurídico (P1-005) |
| **Conclusión regulatoria** | `NEGLIGIBLE` / `NON_NEGLIGIBLE` | `risk_evaluations.conclusion` (`CHECK`: solo `UNDETERMINED`) | **Bloqueada** | Revisor autorizado bajo perfil (D-07.6) |
Una severidad (p. ej. `CRITICAL`) **no** es una conclusión; un perfil adoptado **no** es un perfil revisado; un catálogo publicado **no** es un catálogo aprobado bajo perfil.

### 11.3 Opciones completas
**D-07.5(a) — contenido del perfil (misma pregunta que P1-005).**
| Opción | Qué implica | Efecto en `LEGAL_PROFILE` |
| --- | --- | --- |
| **A** Perfil completo antes de habilitar nada | Cubrir todas las materias del art. 2(40) con fuente | `MET` posible solo con `COMPLETE` + revisión + sujeto resuelto; plazo largo |
| **B** *(recomendación existente)* Perfil **mínimo** versionado que declare lo que cubre y lo que no | Versión `PARTIAL` revisada por competente; ampliable | Sigue `PENDING` mientras sea `PARTIAL`: **dice la verdad sobre su alcance** |
| **C** Fuera del alcance del MVP | No se revisa perfil | `LEGAL_PROFILE` permanece `PENDING`/`NOT_EVALUABLE`; `READY` inalcanzable |

**D-07.5(b) — vinculación catálogo ↔ perfil (`regulatory_profile`).** *(opciones nuevas, para decidir; no figuraban en §7)*
| Opción | Qué implica | Qué habría que implementar |
| --- | --- | --- |
| **b-1** `regulatory_profile` = **referencia a una versión del perfil jurídico con revisión `REVIEWED`**, fijada por un acto autorizado | El valor solo es válido si esa versión tiene revisión registrada; `RISK_CATALOG_APPROVED` verifica ambas cosas | Verificación en el requisito + camino para fijarlo (hoy solo una migración). Como las versiones publicadas no se editan, lo coherente es **publicar una versión nueva del catálogo** (p. ej. `1.1.0`) que lo declare, no modificar `1.0.0` |
| **b-2** Etiqueta de texto libre fijada por un acto autorizado | Simple, pero **no está atada a revisión alguna**: el riesgo descrito en 11.1 | Camino para fijarlo |
| **b-3** Mantener `NULL` en el MVP | `RISK_CATALOG_APPROVED` permanece `NOT_EVALUABLE`; conclusión inalcanzable | Nada |

**D-07.6 — quién concluye.**
| Opción | Qué implica | Estado |
| --- | --- | --- |
| **A** El motor concluye a partir de la severidad | **Prohibida por la fuente** (S1 §35): `LOW` no es «insignificante» | Descartada |
| **B** *(recomendación existente)* Una **persona autorizada** concluye sobre una evaluación concreta, con motivo y registro; el motor puede **proponer** | Condiciones previas acumulativas (abajo) | Pendiente |
| **C** Nadie concluye en el MVP | `READY` inalcanzable | Pendiente |
Condiciones previas de B (acumulativas): (1) catálogo aprobado y adoptado, con severidades; (2) **perfil jurídico revisado** y catálogo aprobado bajo él (D-07.5); (3) evaluación **no** `STALE`; (4) revisor **autorizado y distinto** de quien evaluó; (5) **motivo escrito**. Hoy **no existe** un permiso de «concluir» ni un endpoint: el `CHECK` lo impide por diseño. **Decisión asociada:** qué permiso lo gobierna (nuevo, p. ej. separado de `risk:review`) y quién lo recibe — decisión del propietario **después** de que el revisor identifique la capacidad requerida.

### 11.4 Ejemplos sintéticos (NO ejecutados sobre ningún expediente)
Catálogo `1.0.0` adoptado; severidades por regla: `MATERIAL_OF_UNKNOWN_ORIGIN` CRITICAL, `DATA_MISSING_ORIGIN` HIGH, `GEOMETRY_INVALID` HIGH, `MASS_BALANCE_INCONSISTENT` CRITICAL, `DOCUMENT_EXPIRED` MEDIUM; `MITIGATION_UNVERIFIED`, `SATELLITE_COVERAGE_UNKNOWN` y `GEOLOCATION_PROFILE` **sin** severidad.
| Caso sintético | Resultado técnico y severidad (ya ocurre hoy) | Conclusión según opción |
| --- | --- | --- |
| **S1** Lote con origen declarado en todo su grafo, geometrías válidas, ledger conciliado y documentos vigentes | Ningún `HIT`; severidad `NOT_ASSESSED` (**sin hallazgos no es «bajo»**); cobertura **parcial** | **D-07.6 B con todo cumplido**: un revisor *podría* registrar `NEGLIGIBLE`. **A/C:** `UNDETERMINED`. Aun así `READY` sigue bloqueado por `GEOLOCATION_PROFILE`, `DEFORESTATION_ANALYSIS`, `LEGAL_PROFILE`, `SHIPMENT_LINK` |
| **S2** Lote con un insumo de origen desconocido | `MATERIAL_OF_UNKNOWN_ORIGIN` `HIT`, severidad `CRITICAL`, efecto `BLOCKING` | **B:** un revisor puede registrar `NON_NEGLIGIBLE` con motivo; **el motor no lo deduce** de `CRITICAL`. **C:** `UNDETERMINED` |
| **S3** Lote con una parcela sin evaluación técnica de geometría | `GEOMETRY_INVALID` → `NOT_EVALUABLE`; la severidad del lote **no se completa** y se dice qué regla faltó | Ninguna opción convierte lo no evaluable en favorable |
| **S4** Misma evaluación que S1, pero cambió una geometría después | Evaluación `STALE` | **B:** la conclusión se **rechaza** (condición 3). La anterior permanece como historia |
| **S5** Catálogo adoptado con `regulatory_profile = NULL` | `RISK_CATALOG_APPROVED` = `NOT_EVALUABLE` | **b-3:** se mantiene. **b-1/b-2:** pasa a `MET` solo cuando el campo se fija; con **b-2** bastaría un texto cualquiera (el riesgo de 11.1) |
| **S6** Revisor que es la misma persona que evaluó | — | **B:** rechazada (condición 4) |

### 11.5 Dependencias, evidencia y responsable
| Decisión | Depende de | Evidencia necesaria | Responsable |
| --- | --- | --- | --- |
| **D-07.5(a)** contenido del perfil | P1-005 §6; fuentes oficiales | Revisión jurídica registrada del perfil, con revisor identificado | **Responsable jurídico/regulatorio competente** |
| **D-07.5(b)** vinculación | (a) resuelta; decisión de producto sobre b-1/b-2/b-3 | Perfil `REVIEWED` referenciable; acto autorizado de fijación | Propietario (opción) + implementación posterior |
| **D-07.6** quién concluye | D-07.5, D-07.1/.2/.4 (hechos), D-05.B y el resto de requisitos para `READY` | Capacidad y fundamento del revisor; permiso nuevo y su asignación | **Responsable regulatorio** (competencia) + propietario (permisos) |
Ninguna se desbloquea con solo decidir D-07.6: `READY` sigue necesitando `GEOLOCATION_PROFILE` (D-05.B), `DEFORESTATION_ANALYSIS` (D-09.B), `LEGAL_PROFILE`, `RISK_CATALOG_APPROVED` y `SHIPMENT_LINK` (D-34).

### 11.6 Integración con el desarrollo
| | |
| --- | --- |
| **Implementación existente** | Mecanismos D-07.1/.2/.4; catálogo `1.0.0`; adopción por organización; severidad con cobertura; `CHECK` que fija `UNDETERMINED`; requisitos `RISK_CATALOG_APPROVED` y `REGULATORY_CONCLUSION` (hoy `NOT_EVALUABLE`); `regulatory_profile` (nulo) |
| **Implementación original pendiente** | Fijar `regulatory_profile` (solo por migración hoy) y comprobar que corresponda a un perfil revisado (si b-1); el permiso, el endpoint y el `CHECK` sustituto para **registrar una conclusión** |
| **Puede completarse sin resolver la decisión** | **Nada inequívoco**: ambas piezas dependen de la opción elegida y de qué capacidad exige el revisor; implementarlas antes sería fabricar la condición de aprobación |
| **Condición externa exacta** | Un responsable regulatorio/jurídico competente que (1) revise el perfil (P1-005) y (2) defina la capacidad y fundamento para concluir; luego, decisión del propietario sobre b-1/b-2/b-3 y el permiso |

## 12. Estado tras la guarda técnica de `RISK_CATALOG_APPROVED` (2026-10-21)

**Implementado (guarda técnica del requisito original; no decide el contenido jurídico):**
- `RISK_CATALOG_APPROVED` ya **no** pasa a `MET` con cualquier `regulatory_profile` no nulo. Solo con una **referencia `x.y.z`** igual a la versión del perfil que la organización **adoptó**, con alcance **COMPLETO** y última revisión **REVIEWED**. Una cadena arbitraria, una referencia inexistente o de otra versión, un perfil sin revisar, **parcial**, o cuya revisión fue luego **objetada/retirada**, dejan el requisito en `PENDING` y el detalle dice qué falta. `NULL` sigue `NOT_EVALUABLE`.
- La base lo impone (`0059`): `risk_rule_sets.regulatory_profile` solo admite una versión **existente, PUBLICADA, COMPLETA y con revisión vigente**. No hay API que lo fije y hoy **ninguna versión lo lleva**; el control positivo existe solo con datos sintéticos en bases de prueba.
- No define qué es un perfil «suficiente»: reutiliza el contrato de `LEGAL_PROFILE`.

**Sigue pendiente de decisión (no se adopta ninguna opción).** Las tres opciones de D-07.5(b), con su efecto técnico:

| Opción | Texto | Efecto técnico |
| --- | --- | --- |
| **b-1** | `regulatory_profile` = **referencia a una versión del perfil jurídico con revisión `REVIEWED`**, fijada por un acto autorizado | La guarda ya comprueba la referencia; falta el **acto autorizado** que la fije (hoy solo migración). Como las versiones publicadas no se editan, lo coherente es **publicar una versión nueva del catálogo** (p. ej. `1.1.0`) que la declare |
| **b-2** | Etiqueta de texto libre fijada por un acto autorizado | **Qué parte contradice la guarda autorizada:** que esa etiqueta, **por sí sola**, haga cumplir `RISK_CATALOG_APPROVED`: la guarda exige una referencia a un perfil adoptado, completo y con revisión vigente, y una etiqueta no está atada a ninguna revisión (es el defecto que se corrigió). **Qué parte sigue abierta (decisión de producto):** si se quiere, además de la referencia, un texto descriptivo informativo (p. ej. el nombre del marco bajo el que se redactó el catálogo), quién lo fija con qué acto y con qué rótulo que diga que **no acredita revisión**. Esa variante no satisface el requisito y no estaba excluida por el código. **No se marca como rechazada:** el código nuevo solo impide la lectura que hacía la etiqueta suficiente |
| **b-3** Mantener `NULL` en el MVP | `RISK_CATALOG_APPROVED` permanece `NOT_EVALUABLE`; conclusión inalcanzable | Nada |

**D-07.6 — quién concluye.**
| Opción | Qué implica | Estado |
| --- | --- | --- |
| **A** El motor concluye a partir de la severidad | **Prohibida por la fuente** (S1 §35): `LOW` no es «insignificante» | Descartada |
| **B** *(recomendación existente)* Una **persona autorizada** concluye sobre una evaluación concreta, con motivo y registro; el motor puede **proponer** | Condiciones previas acumulativas (abajo) | Pendiente |
| **C** Nadie concluye en el MVP | `READY` inalcanzable | Pendiente |
Condiciones previas de B (acumulativas): (1) catálogo aprobado y adoptado, con severidades; (2) **perfil jurídico revisado** y catálogo aprobado bajo él (D-07.5); (3) evaluación **no** `STALE`; (4) revisor **autorizado y distinto** de quien evaluó; (5) **motivo escrito**. Hoy **no existe** un permiso de «concluir» ni un endpoint: el `CHECK` lo impide por diseño. **Decisión asociada:** qué permiso lo gobierna (nuevo, p. ej. separado de `risk:review`) y quién lo recibe — decisión del propietario **después** de que el revisor identifique la capacidad requerida.

### 11.4 Ejemplos sintéticos (NO ejecutados sobre ningún expediente)
Catálogo `1.0.0` adoptado; severidades por regla: `MATERIAL_OF_UNKNOWN_ORIGIN` CRITICAL, `DATA_MISSING_ORIGIN` HIGH, `GEOMETRY_INVALID` HIGH, `MASS_BALANCE_INCONSISTENT` CRITICAL, `DOCUMENT_EXPIRED` MEDIUM; `MITIGATION_UNVERIFIED`, `SATELLITE_COVERAGE_UNKNOWN` y `GEOLOCATION_PROFILE` **sin** severidad.
| Caso sintético | Resultado técnico y severidad (ya ocurre hoy) | Conclusión según opción |
| --- | --- | --- |
| **S1** Lote con origen declarado en todo su grafo, geometrías válidas, ledger conciliado y documentos vigentes | Ningún `HIT`; severidad `NOT_ASSESSED` (**sin hallazgos no es «bajo»**); cobertura **parcial** | **D-07.6 B con todo cumplido**: un revisor *podría* registrar `NEGLIGIBLE`. **A/C:** `UNDETERMINED`. Aun así `READY` sigue bloqueado por `GEOLOCATION_PROFILE`, `DEFORESTATION_ANALYSIS`, `LEGAL_PROFILE`, `SHIPMENT_LINK` |
| **S2** Lote con un insumo de origen desconocido | `MATERIAL_OF_UNKNOWN_ORIGIN` `HIT`, severidad `CRITICAL`, efecto `BLOCKING` | **B:** un revisor puede registrar `NON_NEGLIGIBLE` con motivo; **el motor no lo deduce** de `CRITICAL`. **C:** `UNDETERMINED` |
| **S3** Lote con una parcela sin evaluación técnica de geometría | `GEOMETRY_INVALID` → `NOT_EVALUABLE`; la severidad del lote **no se completa** y se dice qué regla faltó | Ninguna opción convierte lo no evaluable en favorable |
| **S4** Misma evaluación que S1, pero cambió una geometría después | Evaluación `STALE` | **B:** la conclusión se **rechaza** (condición 3). La anterior permanece como historia |
| **S5** Catálogo adoptado con `regulatory_profile = NULL` | `RISK_CATALOG_APPROVED` = `NOT_EVALUABLE` | **b-3:** se mantiene. **b-1/b-2:** pasa a `MET` solo cuando el campo se fija; con **b-2** bastaría un texto cualquiera (el riesgo de 11.1) |
| **S6** Revisor que es la misma persona que evaluó | — | **B:** rechazada (condición 4) |

### 11.5 Dependencias, evidencia y responsable
| Decisión | Depende de | Evidencia necesaria | Responsable |
| --- | --- | --- | --- |
| **D-07.5(a)** contenido del perfil | P1-005 §6; fuentes oficiales | Revisión jurídica registrada del perfil, con revisor identificado | **Responsable jurídico/regulatorio competente** |
| **D-07.5(b)** vinculación | (a) resuelta; decisión de producto sobre b-1/b-2/b-3 | Perfil `REVIEWED` referenciable; acto autorizado de fijación | Propietario (opción) + implementación posterior |
| **D-07.6** quién concluye | D-07.5, D-07.1/.2/.4 (hechos), D-05.B y el resto de requisitos para `READY` | Capacidad y fundamento del revisor; permiso nuevo y su asignación | **Responsable regulatorio** (competencia) + propietario (permisos) |
Ninguna se desbloquea con solo decidir D-07.6: `READY` sigue necesitando `GEOLOCATION_PROFILE` (D-05.B), `DEFORESTATION_ANALYSIS` (D-09.B), `LEGAL_PROFILE`, `RISK_CATALOG_APPROVED` y `SHIPMENT_LINK` (D-34).

### 11.6 Integración con el desarrollo
| | |
| --- | --- |
| **Implementación existente** | Mecanismos D-07.1/.2/.4; catálogo `1.0.0`; adopción por organización; severidad con cobertura; `CHECK` que fija `UNDETERMINED`; requisitos `RISK_CATALOG_APPROVED` y `REGULATORY_CONCLUSION` (hoy `NOT_EVALUABLE`); `regulatory_profile` (nulo) |
| **Implementación original pendiente** | Fijar `regulatory_profile` (solo por migración hoy) y comprobar que corresponda a un perfil revisado (si b-1); el permiso, el endpoint y el `CHECK` sustituto para **registrar una conclusión** |
| **Puede completarse sin resolver la decisión** | **Nada inequívoco**: ambas piezas dependen de la opción elegida y de qué capacidad exige el revisor; implementarlas antes sería fabricar la condición de aprobación |
| **Condición externa exacta** | Un responsable regulatorio/jurídico competente que (1) revise el perfil (P1-005) y (2) defina la capacidad y fundamento para concluir; luego, decisión del propietario sobre b-1/b-2/b-3 y el permiso |

## 12. Estado tras la guarda técnica de `RISK_CATALOG_APPROVED` (2026-10-21)

**Implementado (guarda técnica del requisito original; no decide el contenido jurídico):**
- `RISK_CATALOG_APPROVED` ya **no** pasa a `MET` con cualquier `regulatory_profile` no nulo. Solo con una **referencia `x.y.z`** igual a la versión del perfil que la organización **adoptó**, con alcance **COMPLETO** y última revisión **REVIEWED**. Una cadena arbitraria, una referencia inexistente o de otra versión, un perfil sin revisar, **parcial**, o cuya revisión fue luego **objetada/retirada**, dejan el requisito en `PENDING` y el detalle dice qué falta. `NULL` sigue `NOT_EVALUABLE`.
- La base lo impone (`0059`): `risk_rule_sets.regulatory_profile` solo admite una versión **existente, PUBLICADA, COMPLETA y con revisión vigente**. No hay API que lo fije y hoy **ninguna versión lo lleva**; el control positivo existe solo con datos sintéticos en bases de prueba.
- No define qué es un perfil «suficiente»: reutiliza el contrato de `LEGAL_PROFILE`.

**Sigue pendiente de decisión (no se adopta ninguna opción).** Las tres opciones de D-07.5(b), con su efecto técnico:

| Opción | Texto | Efecto técnico |
| --- | --- | --- |
| **b-1** | `regulatory_profile` = **referencia a una versión del perfil jurídico con revisión `REVIEWED`**, fijada por un acto autorizado | La guarda ya comprueba la referencia; falta el **acto autorizado** que la fije (hoy solo migración). Como las versiones publicadas no se editan, lo coherente es **publicar una versión nueva del catálogo** (p. ej. `1.1.0`) que la declare |
| **b-2** | Etiqueta de texto libre fijada por un acto autorizado | **Ya no es posible tal cual**: la guarda rechaza cualquier valor que no sea una referencia revisada. Adoptarla exigiría **retirar** la guarda |
| **b-3** | Mantener `NULL` en el MVP | `RISK_CATALOG_APPROVED` permanece `NOT_EVALUABLE`; la conclusión sigue inalcanzable. Nada que implementar |

No se asigna ningún permiso para «concluir» ni se cambian responsabilidades de los roles canónicos; D-07.6 sigue pendiente.

## 13. D-07.5(b) — opción **b-1 ADOPTADA** como contrato técnico (2026-10-21)

**Decisión del propietario:** `regulatory_profile` es una **referencia explícita a una versión del perfil jurídico revisado**, fijada mediante un **acto autorizado** que forma parte de una **versión nueva** del catálogo. Adoptar b-1 no aprueba contenido jurídico ni resuelve D-07.5(a) (el contenido del perfil) ni D-07.6 (quién concluye).

**Implementación (migración `0061`, `apps/api/src/risk/risk-profile-link.ts`, pantalla `/plataforma/catalogo-riesgo`):**
| Aspecto | Contrato |
| --- | --- |
| Acto | `POST /api/v1/platform/risk-catalog/profile-links`: crea una versión **nueva** del catálogo, copia **exacta** de las reglas de una versión base, con `regulatory_profile` = versión exacta (x.y.z) de `legal_profile_versions` |
| Registro | `risk_rule_set_profile_links` (append-only): autor (sesión), fecha, motivo, versión nueva y base, perfil y **revisión exacta** (`review_id`) que lo sustenta; idempotente por `operation_id` |
| Quién | Acto **de plataforma**: permiso `risk_catalog:link_profile` (solo `SUPER_ADMIN`), porque el catálogo es global. No hay permiso nuevo para adoptar ni para concluir; adoptar sigue siendo de cada organización (`risk:approve_rules`) |
| Condición (API **y** base) | Perfil **publicado**, alcance **completo** y última decisión de revisión **REVIEWED** (la misma de `LEGAL_PROFILE`). La revisión citada debe ser la vigente (si cambió: 409 `REVIEW_CHANGED`). Una etiqueta se rechaza (400/422). La base lo repite (`0059`, `0061`): una referencia sin acto no puede quedar escrita |
| Versionado | No modifica `1.0.0` ni sus adopciones. La versión nueva nace `NOT_APPROVED` (la aprobación técnica de la base **no se hereda**) y **no se adopta** en ninguna organización |
| Frescura | La referencia histórica permanece. Si la revisión se objeta o retira, el historial marca el acto «ya no vigente», `RISK_CATALOG_APPROVED` pasa a pendiente y las instantáneas anteriores quedan **desactualizadas** (mecanismo existente) sin reescribirse |

**Límites:** no hay ninguna versión real vinculada (no existe un perfil completo y revisado: `0.1.0` es parcial y sin revisión, `0.2.0` es borrador); la pantalla lo explica y no ofrece confirmar. El caso positivo está demostrado **solo con datos sintéticos aislados**. El acto no crea ni cambia reglas, no es una conclusión regulatoria y no hace `READY` alcanzable (siguen `GEOLOCATION_PROFILE`, `DEFORESTATION_ANALYSIS`, `LEGAL_PROFILE`, `SHIPMENT_LINK` y `REGULATORY_CONCLUSION`). **La etiqueta opcional de b-2 no se implementa.** Decisión de producto abierta dentro de esta implementación: se eligió el permiso de plataforma por ser el catálogo global; si se prefiriera otro responsable, es un cambio de permiso, no de modelo.
