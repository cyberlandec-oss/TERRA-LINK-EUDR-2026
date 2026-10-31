# D-07 — Matriz del catálogo de reglas, APROBADA y publicada como `1.0.0`

Archivo: `docs/decisiones/D-07-MATRIZ-CATALOGO.md` · Revisión **2** (2026-10-15) · **Versión publicada: `1.0.0`**
(migración `0043`). La matriz describe lo que esa versión contiene.

Estado: **APROBADA para el MVP local y PUBLICADA globalmente** (`risk_rule_sets.approval_status = 'APPROVED'`).
Tres salvedades que no son matices de redacción:

1. **Publicar no es adoptar.** `1.0.0` no está adoptado por ninguna organización real (hay un ensayo local en la Cooperativa DEMO, ver §5), y sin adopción el motor no
   escribe ninguna severidad (`CHECK risk_evaluations_severity_backed`). Adoptarlo es una decisión de cada
   organización (D-07.1), y **no se adopta automáticamente en ninguna**.
2. **Publicar no es aprobar bajo la norma.** `risk_rule_sets.regulatory_profile` es `NULL` en todas las versiones:
   **D-07.5** (perfil jurídico) y **D-07.6** (quién concluye) siguen pendientes. El requisito
   `RISK_CATALOG_APPROVED` del expediente sigue `NOT_EVALUABLE` **incluso con el catálogo adoptado**, y la
   conclusión regulatoria sigue `UNDETERMINED` por `CHECK`. Esto **no habilita `READY` ni despacho**.
3. **La versión es inmutable.** Cambiar una severidad es publicar otra versión, no editar esta. Los catálogos
   `0.1.0` y `0.2.0` quedaron **intactos como históricos**, con todas sus reglas sin severidad.

**Corrección de la revisión 1.** La revisión anterior clasificaba solo **tres** asignaciones como decisión de
producto y presentaba las otras dos como derivadas de una fuente. **Era inexacto, y así se corrigió al aprobarla:
las CINCO severidades son decisiones de producto.** Las fuentes sostienen el **hecho** (qué datos exige el
Reglamento, qué significa un origen incompleto, qué bloquea) y el **límite** (qué no puede afirmarse), pero
**ninguna fuente gradúa** el riesgo en crítico/alto/medio. Esa graduación la decide Terra Link, y cada regla
publicada lo declara en su campo `source`.

---

## 0. Cómo leer esta matriz

| Columna | Qué significa |
| --- | --- |
| **Severidad propuesta** | La severidad **publicada** en `1.0.0` |
| **Respaldo** | La fuente sostiene el **hecho** y el **límite** de la regla. La **graduación** es, en las cinco, **decisión de producto** |
| **Si faltan datos** | Qué hace el motor cuando no puede evaluar la regla. **Nunca** un resultado favorable |
| **Efecto** | `BLOCKING` impide avanzar · `REVIEW_REQUIRED` exige revisión humana · `NOT_ASSESSED` solo informa |

Dos cosas que la matriz **no** hace, por diseño:

1. **No propone reglas nuevas.** Las ocho son las que ya existen. Inventar reglas para las cuatro categorías
   vacías sería fabricar criterios de riesgo sin fuente.
2. **No propone pesos ni cortes.** D-07.3 no aplica: la severidad se declara por regla y se agrega por **máximo**.

---

## 1. La matriz

### 1.1 `MATERIAL_OF_UNKNOWN_ORIGIN` — MIXING

| | |
| --- | --- |
| **Condición** | El lote, o algún lote de su grafo de origen, tiene `origin_status = INCOMPLETE` |
| **Datos necesarios** | Grafo de lotes y su `origin_status`; se recorre completo hacia arriba |
| **Si faltan datos** | No pueden faltar: el `origin_status` siempre existe. Si el grafo no se pudiera recorrer, `NOT_EVALUABLE` |
| **Efecto** | `BLOCKING` (ya vigente) |
| **Severidad propuesta** | **`CRITICAL`** |
| **Respaldo** | **El hecho y el límite son FUENTE**: el Art. 9(1)(d) exige la geolocalización de **todas** las parcelas, y docs/13 fija «Un saldo positivo no autoriza mezcla». **La graduación `CRITICAL` es PRODUCTO**: ninguna fuente gradúa. Motivo: un origen incompleto ya consumado impide declarar el lote, y eso no se corrige aportando un dato que no existe |
| **Casos de prueba** | Lote con insumo de origen incompleto → `HIT` + `CRITICAL` · lote con todo el grafo completo → `NOT_HIT` · lote formado con dos lotes, uno incompleto → `HIT` y la referencia nombra **cuál** |

### 1.2 `DATA_MISSING_ORIGIN` — TRACEABILITY

| | |
| --- | --- |
| **Condición** | Hay entregas en el grafo sin origen declarado |
| **Datos necesarios** | Entregas del grafo y sus orígenes (`delivery_origins`) |
| **Si faltan datos** | `NOT_EVALUABLE` si no se pueden leer las entregas |
| **Efecto** | `BLOCKING` (ya vigente) |
| **Severidad propuesta** | **`HIGH`** |
| **Respaldo** | **FUENTE** en cuanto al hecho (Art. 9(1)(d)). **PRODUCTO** en cuanto al grado: por qué `HIGH` y no `CRITICAL`. Propuesta: una entrega sin origen es **corregible** aportando el dato; mezclar material de origen desconocido ya consumado, no |
| **Casos de prueba** | Entrega sin origen → `HIT` + `HIGH` · todas con origen → `NOT_HIT` · dos entregas, una sin origen → `HIT` y se nombra la entrega |

### 1.3 `GEOMETRY_INVALID` — DATA_QUALITY

| | |
| --- | --- |
| **Condición** | La versión vigente de alguna parcela de origen es técnicamente inválida (`TL_GIS_TECH`) |
| **Datos necesarios** | Versión vigente de cada parcela y su evaluación `TL_GIS_TECH` |
| **Si faltan datos** | **`NOT_EVALUABLE`** si alguna parcela no tiene evaluación técnica vigente. **No se presume válida** |
| **Efecto** | `BLOCKING` (ya vigente) |
| **Severidad propuesta** | **`HIGH`** |
| **Respaldo** | **PRODUCTO.** docs/13 la trata como «bloqueo de análisis fiable», que es un efecto, no una severidad. Propuesta: `HIGH` porque invalida el análisis posterior sin afirmar nada sobre el terreno |
| **Casos de prueba** | Parcela con autointersección → `HIT` + `HIGH` · parcela válida → `NOT_HIT` · parcela **sin evaluar** → `NOT_EVALUABLE`, y la severidad del lote **no** se completa |

### 1.4 `MASS_BALANCE_INCONSISTENT` — TRACEABILITY

| | |
| --- | --- |
| **Condición** | La conciliación del ledger arroja diferencias |
| **Datos necesarios** | Movimientos del ledger del lote y su grafo |
| **Si faltan datos** | `NOT_EVALUABLE` |
| **Efecto** | `BLOCKING` (ya vigente) |
| **Severidad propuesta** | **`CRITICAL`** |
| **Respaldo** | **El hecho y el efecto son FUENTE**: docs/13 fija «Bloqueo de consumo/despacho». **La graduación `CRITICAL` es PRODUCTO**: que un texto mande bloquear sostiene el EFECTO, no el GRADO. Motivo: si las cantidades no cuadran, cualquier afirmación de trazabilidad sobre ese lote queda en el aire |
| **Casos de prueba** | Ledger conciliado → `NOT_HIT` · diferencia inyectada → `HIT` + `CRITICAL` · lote sin movimientos → `NOT_EVALUABLE` |

### 1.5 `DOCUMENT_EXPIRED` — DOCUMENT_CREDIBILITY

| | |
| --- | --- |
| **Condición** | Hay soportes documentales vencidos entre las entregas de origen |
| **Datos necesarios** | Soportes vinculados y su vigencia declarada |
| **Si faltan datos** | **`NOT_EVALUABLE`** cuando no hay soportes: «evidencia insuficiente, **no se presume vigente**» (ya implementado) |
| **Efecto** | `REVIEW_REQUIRED` (ya vigente) |
| **Severidad propuesta** | **`MEDIUM`** |
| **Respaldo** | **PRODUCTO.** docs/13 solo fija el límite: «comprobar alcance temporal». Propuesta: `MEDIUM` porque un documento vencido **no** prueba ilegalidad, y su efecto ya es revisión humana, no bloqueo |
| **Casos de prueba** | Soporte vigente → `NOT_HIT` · soporte vencido → `HIT` + `MEDIUM` · **sin soportes** → `NOT_EVALUABLE`, nunca `NOT_HIT` |

### 1.6 `MITIGATION_UNVERIFIED` — SUPPLY_CHAIN

| | |
| --- | --- |
| **Condición** | Hay mitigaciones abiertas sin verificar |
| **Datos necesarios** | Mitigaciones del sujeto y su estado |
| **Si faltan datos** | `NOT_HIT` si no hay mitigaciones (no es ausencia de dato: es ausencia de tarea) |
| **Efecto** | `BLOCKING` en `0.2.0`; era `NOT_ASSESSED` en `0.1.0` |
| **Severidad propuesta** | **Ninguna: `NULL`** |
| **Respaldo** | **PRODUCTO, y la propuesta es NO asignarla.** Una mitigación sin verificar es **trabajo pendiente**, no un hallazgo sobre el cacao. Darle severidad mezclaría la dimensión 1 (hallazgo) con el proceso de revisión. Su efecto `BLOCKING` ya impide cerrar la revisión, que es lo que debe hacer |
| **Casos de prueba** | Sin mitigaciones → `NOT_HIT` · mitigación abierta → `HIT`, **sin** aportar severidad · mitigación verificada → `NOT_HIT`, y **reevaluar** vuelve a mirar la causa original |

### 1.7 `SATELLITE_COVERAGE_UNKNOWN` — DEFORESTATION

| | |
| --- | --- |
| **Condición** | No hay cobertura satelital conocida para las parcelas de origen |
| **Datos necesarios** | Resultados satelitales por versión de parcela |
| **Si faltan datos** | **`NOT_EVALUABLE` siempre, hoy**: no hay proveedor en uso real (**D-09 parte B**) |
| **Efecto** | `NOT_ASSESSED` (ya vigente) |
| **Severidad propuesta** | **Ninguna: `NULL`, hasta D-09.B** |
| **Respaldo** | **FUENTE.** docs/13: «Sin alertas no prueba ausencia de deforestación». Asignarle severidad hoy sería clasificar algo que **no se ha podido mirar** |
| **Casos de prueba** | Sin resultados → `NOT_EVALUABLE` y la cobertura lo declara · con resultado sintético → sigue `NOT_EVALUABLE` (`is_synthetic` no satisface ningún requisito) |

### 1.8 `GEOLOCATION_PROFILE` — DEFORESTATION

| | |
| --- | --- |
| **Condición** | Perfil de destino de las parcelas de origen |
| **Datos necesarios** | Dictamen `EUDR_GEO_V1` de la versión vigente (existe desde D-05.A) |
| **Si faltan datos** | `NOT_EVALUABLE` |
| **Efecto** | `NOT_ASSESSED` (ya vigente) |
| **Severidad propuesta** | **Ninguna: `NULL`, hasta D-05.B** |
| **Respaldo** | **FUENTE.** Cumplir el perfil **técnico** no acredita el requisito regulatorio de geolocalización: eso es D-05.B. Convertir `MEETS_PROFILE` en factor favorable sería el salto que D-05 prohíbe expresamente |
| **Nota** | Si se quiere usar el dictamen del perfil, el camino honesto es una regla **nueva y distinta**, de **calidad del dato** (dimensión 2), que diga «esta parcela no está preparada para intercambio» y **nunca** «esta parcela cumple» |
| **Casos de prueba** | Parcela sin dictamen de perfil → `NOT_EVALUABLE` · parcela con `MEETS_PROFILE` → **sigue** `NOT_EVALUABLE` para esta regla, y la cobertura lo explica |

---

## 2. Resumen de respaldo (corregido al aprobar)

| Qué | Respaldo |
| --- | --- |
| **El hecho**: qué condición detecta cada regla y por qué importa | **FUENTE** citable (Reglamento, docs/13) en las ocho |
| **El límite**: qué NO puede afirmarse con el hallazgo | **FUENTE** citable en las ocho |
| **La graduación**: por qué `CRITICAL` y no `HIGH` | **PRODUCTO en las CINCO.** Ninguna fuente gradúa el riesgo |
| **No clasificar** (`MITIGATION_UNVERIFIED`, `SATELLITE_COVERAGE_UNKNOWN`, `GEOLOCATION_PROFILE`) | **PRODUCTO**, sostenido por el límite citable: no se clasifica lo que no se ha podido mirar ni lo que es trabajo pendiente |

**Las cinco severidades son decisiones de producto.** La revisión 1 decía «tres», tratando `CRITICAL` como
derivable de la fuente: no lo es. Que un texto diga «bloqueo de consumo/despacho» sostiene el **efecto**
`BLOCKING`, no el **grado** `CRITICAL`. Efecto y severidad son dimensiones distintas, y confundirlas presentaría
como exigencia de la norma algo que decidió el equipo. Cada regla publicada cierra su `source` con
«Graduación X: DECISIÓN DE PRODUCTO (2026-10-15)», y hay una prueba que lo comprueba regla por regla.

---

## 2.bis El caso mixto: qué sale cuando se juntan las tres situaciones

La pregunta que decide si la matriz es segura: **un lote con hallazgos clasificados, hallazgos sin severidad
declarada y reglas que no se pudieron evaluar, ¿qué devuelve?**

Con esta matriz y el mecanismo ya implementado:

| Qué entra | Qué sale |
| --- | --- |
| Hallazgos **con** severidad declarada | **Se clasifican**: la severidad del lote es el **máximo** de ellos |
| Hallazgos **sin** severidad declarada | **No aportan severidad**, pero **siguen siendo hallazgos**: cuentan para el resultado técnico y se listan en `hits_without_declared_severity` |
| Reglas **no evaluables** | **No aportan nada**: no se sabe qué habrían dado. Se listan en `not_evaluable_codes` |
| Categorías **sin ninguna regla** | Se listan en `categories_without_rules` |

Y entonces:

- **La severidad se emite igual.** Un hallazgo conocido **no desaparece** porque otra regla no se pudiera
  evaluar. Callarlo sería peor que publicarlo con su contexto.
- **La cobertura marca `complete: false`** y el motivo empieza por «**Clasificación PARCIAL**», enumerando qué
  quedó fuera y cerrando con «**No es una evaluación completa del riesgo del lote**».
- **El resultado técnico no cambia**: sigue decidido por precedencia
  (`BLOCKED > REVIEW_REQUIRED > INCOMPLETE > NO_FINDINGS_IN_EVALUATED_RULES`), y un bloqueante **no se diluye**
  por mucha severidad baja que haya alrededor.
- **La conclusión regulatoria sigue `UNDETERMINED`**, pase lo que pase.

**Ejemplo concreto con esta matriz.** Un lote con origen incompleto (`CRITICAL`), con `MITIGATION_UNVERIFIED`
abierta (hallazgo **sin** severidad por decisión) y sin cobertura satelital (**no evaluable**):

| Campo | Valor |
| --- | --- |
| Severidad | **`CRITICAL`** |
| `hits` | 2 |
| `hits_without_declared_severity` | `['MITIGATION_UNVERIFIED']` |
| `not_evaluable_codes` | `['SATELLITE_COVERAGE_UNKNOWN', 'GEOLOCATION_PROFILE']` |
| `categories_without_rules` | `['LEGALITY','EVASION','HUMAN_RIGHTS','INDIGENOUS_RIGHTS']` |
| `complete` | **`false`** |
| Resultado técnico | **`BLOCKED`** |
| Conclusión | **`UNDETERMINED`** |

**Caso límite que conviene mirar antes de aprobar**: si **todos** los hallazgos fueran de reglas sin severidad
declarada, el lote sale **`NOT_ASSESSED`** aunque esté **bloqueado**. No es un error —no hay con qué
clasificar—, pero significa que un lote puede estar `BLOCKED` y «sin clasificar» a la vez. **Severidad y
resultado técnico son dimensiones distintas**, y la pantalla las muestra por separado precisamente por esto.

**Probado en** `apps/api/test/d07-mecanismos.int-spec.ts`: «clasificación PARCIAL: un hallazgo conocido no
desaparece porque otra regla no se pueda evaluar» y «un hallazgo cuya regla no declara severidad no clasifica, y
se dice cuál».

## 3. Lo que esta matriz deja fuera, y hay que saberlo al aprobarla

1. **Cuatro categorías siguen sin ninguna regla**: `LEGALITY`, `EVASION`, `HUMAN_RIGHTS`, `INDIGENOUS_RIGHTS`.
   Con este catálogo, **toda clasificación será PARCIAL** y el sistema lo dirá en la cobertura de cada evaluación.
   Es correcto: una severidad calculada sobre seis reglas no cubre diez categorías.
2. **Tres de las ocho reglas no clasifican nunca** con esta propuesta. En la práctica, la severidad saldrá de
   cinco reglas como mucho.
3. **Una severidad `CRITICAL` no es una conclusión regulatoria.** Sigue `UNDETERMINED` por `CHECK`, y D-07.5 y
   D-07.6 siguen pendientes.
4. **Adoptar este catálogo no recalcula nada.** Las evaluaciones anteriores conservan su versión y su resultado;
   para que la adopción surta efecto hay que **reevaluar**, que crea un registro nuevo.

---

## 4. Qué se hizo al aprobarla, y qué sigue pendiente

| # | Paso | Estado |
| --- | --- | --- |
| 1 | Firmar las asignaciones de producto, corrigiendo que son **cinco** y no tres | **HECHO** (2026-10-15) |
| 2 | Confirmar que `MITIGATION_UNVERIFIED` **no** lleve severidad | **HECHO**: sigue sin severidad y con efecto `BLOCKING` |
| 3 | Publicar la versión, con número | **HECHO**: `1.0.0`, migración `0043`, inmutable |
| 4 | Adoptarla en cada organización que vaya a usarla (D-07.1) | **NO HECHO.** Ninguna organización la ha adoptado, y **no se adopta automáticamente en ninguna** |
| 5 | Aprobar una versión bajo **perfil jurídico** para poder concluir | **PENDIENTE: D-07.5 y D-07.6.** `regulatory_profile` es `NULL` en todas |

Publicar esta versión **no** habilita `READY`, despacho ni conclusión regulatoria, y el paso 4 es de cada
organización, no de esta matriz.

---

## 5. Adopción de `1.0.0` por organización (2026-10-20) — **ADOPTADA la opción B como configuración técnica de ayuda a la revisión interna**

> **Adoptado el 2026-10-20 por el propietario del producto.** Alcance exacto: se **autoriza** que cada organización adopte
> `1.0.0` por su propio acto (D-07.1) como ayuda de revisión interna. **No** es validación jurídica, **no** adopta nada en
> organizaciones reales por sí misma, **no** reevalúa en masa y **no** cambia conclusiones. La adopción de ensayo de la
> Cooperativa DEMO se conserva (una fila; no se duplica). La clasificación parcial muestra versión, reglas, categorías sin
> cobertura y limitaciones. `UNDETERMINED`, `RISK_CATALOG_APPROVED` (`NOT_EVALUABLE`), `READY` y despacho siguen igual.
> El texto siguiente es la propuesta previa, conservada.

**Qué requisito original sostiene esto.** `docs/18` P0-020: severidad explicable y conclusión `UNDETERMINED`; `docs/13`
(«Sin alertas no prueba ausencia…», «Un saldo positivo no autoriza mezcla»); S1 §35 («no convertir `LOW` en
“insignificante legalmente”»). La graduación no la exige ninguna fuente (§2): es decisión de producto.

**Qué se propone adoptar, completo.** Exactamente las ocho reglas de §1, sin cambiar ninguna. Resumen verificable:

| Regla | Efecto | Severidad | Si faltan datos | Procedencia de la graduación |
| --- | --- | --- | --- | --- |
| `MATERIAL_OF_UNKNOWN_ORIGIN` | BLOCKING | CRITICAL | NOT_EVALUABLE | Producto (hecho: Art. 9(1)(d)) |
| `DATA_MISSING_ORIGIN` | BLOCKING | HIGH | NOT_EVALUABLE | Producto |
| `GEOMETRY_INVALID` | BLOCKING | HIGH | NOT_EVALUABLE | Producto |
| `MASS_BALANCE_INCONSISTENT` | BLOCKING | CRITICAL | NOT_EVALUABLE | Producto |
| `DOCUMENT_EXPIRED` | REVIEW_REQUIRED | MEDIUM | NOT_EVALUABLE (sin soportes) | Producto |
| `MITIGATION_UNVERIFIED` | BLOCKING | ninguna | NOT_HIT (sin tareas) | Producto: es trabajo pendiente |
| `SATELLITE_COVERAGE_UNKNOWN` | NOT_ASSESSED | ninguna hasta D-09.B | NOT_EVALUABLE | Fuente (docs/13) |
| `GEOLOCATION_PROFILE` | NOT_ASSESSED | ninguna hasta D-05.B | NOT_EVALUABLE | Fuente (D-05) |

**Umbrales.** No hay pesos, cortes ni puntuaciones (D-07.3 NO APLICA): la severidad del lote es el **máximo** de las
reglas que clasifican. El único umbral numérico del sistema de riesgo es el de GIS (4 ha, `EUDR_GEO_V1`) y es otro
dictamen. **Consecuencia de cada clasificación:** el efecto (BLOCKING / REVIEW_REQUIRED / NOT_ASSESSED) ya vigente
decide el resultado técnico; la severidad solo informa y **no concluye**.

**Estado real contrastado el 2026-10-20 (solo lectura de `terra_link`).** `1.0.0` está `APPROVED` y publicada;
`0.1.0` y `0.2.0` `NOT_APPROVED`; `regulatory_profile` NULL en las tres. Existe **una** adopción: Cooperativa DEMO,
«Ensayo local del MVP… No es aprobación regulatoria» (`risk_rule_set_adoptions`). Es dato de demostración, no la
decisión de una organización real. `docs/22` y §0 deben leerse como «ninguna organización **real** la ha adoptado».

| Opción | Qué implementaría | Efecto en el alcance |
| --- | --- | --- |
| **A. No adoptar** (hoy, salvo el ensayo DEMO) | Ninguna organización clasifica; todo sale `NOT_ASSESSED`; distribución de riesgo de P0-030 en `UNKNOWN` | Ninguno; no avanza la visibilidad del riesgo |
| **B. Adoptar `1.0.0` en cada organización que la elija, como ayuda de revisión interna (recomendada)** | Cada responsable de organización registra `ADOPT` con motivo; tras **reevaluar**, la evaluación nueva escribe severidad (máximo) con `complete:false` por las 4 categorías sin reglas; `WITHDRAW` devuelve a `NOT_ASSESSED`. No recalcula lo anterior | Activa P0-030 `risk_critical` y la clasificación. **No** cambia `READY`, `RISK_CATALOG_APPROVED` (sigue `NOT_EVALUABLE`) ni `UNDETERMINED` |
| **C. Revisar graduaciones o añadir reglas antes** | Publicar `1.1.0` (inmutabilidad: nunca editar `1.0.0`), p. ej. una regla de **calidad del dato** para parcelas sin dictamen de perfil (§1.8 Nota) o cubrir una categoría vacía | Más trabajo; no desbloquea nada que B no desbloquee. Las categorías `LEGALITY`/`EVASION`/`HUMAN_RIGHTS`/`INDIGENOUS_RIGHTS` dependen de D-07.5 |

**Recomendación: B**, porque convierte en uso real un mecanismo ya implementado sin afirmar nada regulatorio, es
reversible (`WITHDRAW`) y conserva la historia. **Quién:** el propietario del producto decide la configuración
técnica; cada organización decide su adopción (D-07.1). **No es una validación regulatoria:** usar la severidad
como base de una conclusión o de `READY` exige D-07.5/D-07.6 y revisión competente.

**Pruebas que lo demostrarían** (ya existen las del mecanismo en `d07-mecanismos.int-spec.ts`; faltarían, al
adoptar de verdad, comprobaciones de despliegue y no código nuevo): adopción con motivo auditada; otra organización
no afectada; reevaluación escribe severidad = máximo con `hits_without_declared_severity` y `not_evaluable_codes`;
retiro vuelve a `NOT_ASSESSED`; conclusión sigue `UNDETERMINED`; `READY` sigue bloqueado.

**Dependencias que siguen pendientes tras adoptar:** D-07.5, D-07.6, D-05.B, D-09.B, P1-005; ver
`DECISIONES-MINIMAS-PARA-CERRAR.md`. **No se ejecutó nada sobre expedientes** al preparar esta propuesta.