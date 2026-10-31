# D-32 — Humedad: unidad, definición y efecto en el cierre de secado

**ADOPTADA como regla provisional del MVP local el 2026-10-15**, por instrucción del responsable de producto.
**No** es validación en campo ni aprobación para producción. Siguen pendientes, expresamente: los **límites de
aceptación de calidad** y las **unidades y conversiones generales** (el resto de D-32, ver al final).

## El texto de la decisión (lo que se adopta)

1. **Porcentaje en base húmeda**, declarado como **medición**, con **método** y **responsable**.
2. **Obligatorio para cerrar el secado**, según el contrato KDE.
3. **Se conserva la precisión recibida dentro de la capacidad del almacenamiento** (seis decimales). Un valor con
   más precisión **se rechaza explícitamente**: **no se redondea al escribir**. Dicho con claridad, porque
   `numeric(20,6)` no admite «cualquier precisión imaginable»: hasta seis decimales se guardan tal cual; el séptimo
   decimal no se acepta en silencio, se rechaza con su motivo.
4. **Un decimal es presentación**, y el detalle muestra el valor completo.
5. **No se deduce la humedad de la merma** ni se implementan conversiones de rendimiento por humedad.
6. **No se introducen límites de aceptación de calidad**: siguen pendientes.

---

## Fundamento (lo que se analizó antes de adoptarla)

## Qué dicen las fuentes, literalmente

- **S1 §18 (KDE)**: `MOISTURE` figura entre los datos clave exigibles, junto a `DELIVERY_WEIGHT`, `LOT_CODE` y
  `PLOT_ID`. La fuente lo nombra como dato **requerido en alguna etapa**, sin definir unidad ni método.
- **S1 §19 (CTE)**: cada entrega genera un evento con `quantity`, `unit`, `quality_status` y `moisture`.
- **S4** (ejemplo de pantalla de calidad): «Humedad 7,2 %», junto a fermentación e impurezas, con un
  «✓ Dentro de parámetros» que la fuente **no define**.
- **docs/06**: `quality_samples/results` → `moisture O` (opcional), con `method/unit/limits_version` condicionales.

**Lo que las fuentes NO dicen**, y es exactamente lo que falta decidir: en qué **base** se mide (húmeda o seca), con
qué **método**, con qué **precisión**, y si su ausencia **bloquea** el cierre de un secado.

## Qué hay implementado hoy

- La humedad se registra como **medición de calidad** con parámetro `MOISTURE`, valor y unidad declarados por quien
  mide (hoy se usa `%` en los datos sintéticos). No hay catálogo de parámetros ni límites verificados.
- El cierre de un secado exige la compuerta KDE `DRYING_MOISTURE`, que responde `DECISION_PENDING`: **se prepara y se
  inicia, pero no se cierra** (D-39.3, adoptada como regla provisional del MVP el 2026-10-10).
- Consecuencia observable, probada en el recorrido integral: el material queda **reservado** por el proceso abierto
  —no se pierde— y el proceso puede cancelarse.

## Las cuatro preguntas, con su propuesta

### 1. ¿En qué base se expresa la humedad?

| Opción | Qué implica | Riesgo |
| --- | --- | --- |
| **A. Base húmeda (`% m/m`, peso de agua sobre peso total)** | Es lo que miden los medidores de campo y lo que usa el comercio de cacao | Hay que **decirlo**: «7,2 %» sin base es ambiguo |
| B. Base seca | Usada en algunos laboratorios | Convertir entre bases no es trivial y nadie la pide aquí |
| C. Admitir ambas con etiqueta | Más fiel a la realidad | Dos bases conviviendo invitan a comparar lo incomparable |

**Propuesta: A, base húmeda**, declarada explícitamente en la unidad (`%BH`), no como un `%` suelto.

### 2. ¿Qué método y qué precisión?

**Propuesta**: el método se **declara por muestra** (texto libre controlado: medidor portátil, estufa, laboratorio),
igual que ya se hace con el resto de mediciones. No se inventa un método obligatorio: las fuentes no lo fijan y el
equipamiento varía por asociación.

**Precisión — aclaración, porque la primera versión de esta propuesta decía «un decimal» sin precisar y eso podía
leerse como truncar el dato:**

| | Qué se hace |
| --- | --- |
| **Almacenamiento** | **La precisión que informó el instrumento, íntegra.** La columna ya es `numeric(20,6)`: un `7,23 %` se guarda como `7,23`, no como `7,2`. **Nunca se redondea al escribir**: el dato original de una medición no se descarta |
| **Presentación** | **Un decimal** en pantallas y exportaciones de lectura rápida (`7,2 %`), que es como se lee en campo y como lo muestra la fuente (S4: «Humedad 7,2 %») |
| **Comparaciones** | Siempre sobre el valor almacenado, nunca sobre el presentado |

Dicho de otro modo: «un decimal» es una **regla de presentación**, no de almacenamiento. Si alguna vez se definen
límites de aceptación (pregunta 4), se evaluarán contra el valor íntegro.

**Lo que no se propone**: deducir la humedad del peso perdido en el secado. Es tentador —hay cantidades de entrada y
salida— pero mezclaría merma con evaporación y produciría un número que parece medido sin serlo.

### 3. ¿La humedad bloquea el cierre del secado?

| Opción | Qué pasa | Para quién es peor |
| --- | --- | --- |
| **A. Sí, obligatoria para cerrar** | El secado no se cierra sin medición | Para quien opera: si el medidor falla, el proceso queda abierto |
| B. No, opcional | El secado cierra y la humedad queda pendiente | Para el expediente: un lote «seco» sin dato de humedad no acredita nada |
| C. Obligatoria con excepción registrada | Cierra sin medición solo con motivo y responsable | Más complejo, pero es lo que pasa en campo |

**Propuesta: A**, obligatoria. Secar es precisamente lo que cambia la humedad: cerrar un secado sin saber a cuánto se
llegó deja el proceso sin su único resultado propio. Si en el piloto resulta impracticable, se revisa a **C** con
datos reales, no antes.

### 4. ¿Hay límites de aceptación?

**Propuesta: no, todavía.** Que «7,2 % está dentro de parámetros» (S4) exige un catálogo de límites por producto y
destino que **ninguna fuente aprueba**. El valor se registra y se muestra; la decisión de liberar sigue siendo
**humana y explícita**, como ya ocurre en calidad. Un límite inventado aquí se convertiría en un «✓» automático.

## Qué desbloquea cada elección

| Si se decide… | Se desbloquea |
| --- | --- |
| Unidad y base (1) + método (2) | El **catálogo de parámetros de calidad** puede fijar `MOISTURE` con unidad real |
| Efecto en el cierre (3) | **P0-016**: cerrar un secado, y con ello el estado `CACAO_SECO` en la cadena; la transición 10 de la matriz del recorrido |
| Límites (4) | Nada hoy; conviene **no** decidirlo para no crear una aprobación automática |

Y lo que **no** desbloquea: la conclusión regulatoria del expediente. La humedad es un dato de calidad, no de
legalidad.

## Alcance más amplio de D-32 (no confundir)

D-32 tal como está escrita en `docs/22` pregunta también por **unidades y conversiones en general**: hoy solo `KG`
está definido y no hay conversiones. Esta propuesta **no** resuelve eso. Si alguien necesita quintales o libras,
hace falta el factor exacto y la regla de redondeo, y es una decisión distinta de la humedad.

## Decisión mínima que hace falta

Tres líneas: **(1)** unidad y base, **(2)** si bloquea el cierre, **(3)** quién puede registrarla. Con eso se
implementa el cierre de secado y se cierra la transición 10. Los límites de aceptación pueden esperar.

**Estas aclaraciones no son una aprobación.** D-32 sigue siendo una propuesta: nada de lo anterior está decidido.
