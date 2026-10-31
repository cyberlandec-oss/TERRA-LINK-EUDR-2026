# Evidencia — P1-014 «Indicadores comerciales» (2026-10-18)

**Validación**: `npm run validate` **APROBADA** sobre `1967366` — **849** pruebas, **72** E2E, 0 fallos
(`validation-results/2026-10-18T20-43-24-702Z`). **Despliegue**: `/version` → `1967366` (`BUILD_ARG`),
esquema **`0052`** (sin cambio). **Sin migración**: todo se deriva de tablas que ya existían, así que **no
corresponde respaldo**.

## 1. Contraste de los criterios originales, uno a uno

| Criterio (referencia exacta) | Qué exige | Estado |
| --- | --- | --- |
| **S3 §41** (`docs/sources/S3:1495`): seis preguntas comerciales | Responder lo que los datos permitan | **PARCIAL**: se responden las que no exigen inventar; las otras **tres se declaran con su condición exacta** (§5) |
| **RF-45** (`docs/03:61`): «métrica **independiente** del riesgo legal» | Separación estricta | **CUMPLIDO**: ningún indicador usa conclusión, severidad ni resultado técnico; hay prueba que lo exige |
| **P1-014** (`docs/18:215`): «métricas comerciales **separadas** del riesgo jurídico» | Lo mismo, en la pantalla | **CUMPLIDO**: el riesgo tiene su propia sección, rotulada «no es un indicador comercial» |
| **P1-014**: «**denominadores**» | Decir sobre qué se divide | **CUMPLIDO**: cada cociente publica su denominador con etiqueta y valor; sin denominador válido, **NO_CALCULABLE** |
| **P1-014**: «**permiso**» | Autorizar el agregado | **CUMPLIDO**: `analytics:read` abre la pantalla y **cada indicador exige el permiso de su dominio**; la descarga exige además `report:export` |
| **RF-45** (`docs/03:61`), columna **Capacidad**: «Analytics/**supplier score** comercial» | Nombra la capacidad; **no es la columna exigible** —en la tabla de **evolución** (`docs/03:45`) lo exigible es la **Restricción**— | **NO ES CRITERIO DE CIERRE**. No se publica score: exigiría **ponderar** con pesos que ninguna fuente fija. Queda como **evolución** en **D-53**, sin adoptar |

**RF-45 queda DEMOSTRADA.** El contraste literal de las columnas lo sostiene: la tabla de `docs/03:45` es de
**«Requisitos de evolución»** y su cuarta columna es **«Restricción»**, no «Validación»; la **aceptación
mínima** de `docs/18:215` enumera **tres** condiciones —separación, denominadores, permiso— en **plural** y
**sin score**. Las seis preguntas de **S3 §41** van precedidas de «**Podemos empezar a responder**»
(`docs/sources/S3:1503`), tras un condicional: son **posibilidades de evolución**. El único «score» de la
documentación interna (`docs/12:41`) advierte **contra** manipularlo.

**Corrección de un cierre anterior de esta misma evidencia**: en la primera versión del 2026-10-18 di RF-45
por PARCIAL exigiendo un score compuesto. Eso **añadía una condición de cierre por interpretación**, convirtiendo «métrica» en «score ponderado». Queda corregido aquí.

## 2. Qué se entregó

Siete indicadores, cada uno **autodescrito**: `what_it_measures`, `formula`, `unit`, `period`, `denominator`,
`coverage`, `provenance`, `limits` y —cuando no hay valor— `why`.

| Indicador | Procedencia | Exige |
| --- | --- | --- |
| Precio medio ponderado por cantidad, **por grupo compatible** | DECLARADO | `economics:read` |
| Cobertura del dato económico | REGISTRADO | `economics:read` |
| Pagos informados sobre lo acordado, **por moneda** | INFORMADO | `economics:read` |
| Volumen recibido, **por unidad y producto** | OBSERVADO | `delivery:read` |
| Decisiones de calidad | REGISTRADO | `delivery:read` |
| Presupuesto de preparación estimado | ESTIMADO | `cost:read` |
| Parcelas con geometría vigente | REGISTRADO | `plot:read` |

Más un **resumen por productor** —que **no es un score**— y una **descarga** con fórmulas, denominadores,
cobertura, límites y advertencias.

## 3. Reutilización, sin sistemas paralelos

Precio y prima (P1-012), cantidades recibidas y calidad (P0-012), costes guardados (P1-010), versiones de
geometría (P0-007), evaluaciones de riesgo (solo como **contexto**), la aritmética decimal de P1-010
(`normalizar`) y el escritor XLSX de importaciones. **No hay tabla nueva ni migración.**

## 4. Lo que el código impide, no solo el texto

- **Solo se agrega lo compatible**: moneda, unidad, producto y período. Un precio por **QQ** sobre base en
  **KG** se **excluye y se cuenta**; **EUR** forma su **propio grupo**; otro producto, otro grupo. **Nunca se
  convierte nada.**
- **Ausencia no es cero**: la entrega sin dato económico entra en el **denominador** de la cobertura, no en el
  precio. Probado con un caso discriminante.
- **Tres ausencias distintas**: `SIN_DATOS` (con su porqué), `NO_CALCULABLE` (con su razón) y `RESTRINGIDO`
  (sin valor, **sin denominador y sin cobertura**: ni un recuento se filtra).
- **Precio ≠ pago ≠ presupuesto**: cada uno con su `provenance` y su advertencia. Un presupuesto **no
  demuestra eficiencia operativa**; un pago informado **no acredita una transferencia**.
- **Truncado declarado**: el cociente se calcula en decimal exacto y **se trunca** a seis decimales, como en
  P1-010, y cada indicador con cociente **lo dice**.
- **Período sin inventar**: sin `from`/`to` se usa **todo lo registrado** y se rotula; un período invertido es
  **422**; uno vacío es **SIN_DATOS con su porqué**, nunca ceros.

## 5. Lo que NO se responde, con su condición exacta

| Pregunta de S3 §41 | Condición para responderla |
| --- | --- |
| ¿Qué comprador paga mejor? | **No existe ningún precio de VENTA**: lo registrado es lo que la organización acuerda con el **productor**. Atribuirlo a un comprador exigiría una **relación explícita** que no existe. Condición: registrar precio de venta por embarque o comprador (**D-53 §3**) |
| ¿Qué fincas pueden aumentar producción? | **No hay serie de rendimiento** por parcela ni superficie productiva verificada. Responderlo sería inventarlo (**D-53 §4**) |
| ¿Qué productores tienen menor riesgo? (como métrica comercial) | RF-45 **prohíbe** que la conclusión regulatoria alimente un indicador comercial. Un «riesgo comercial» propio sería un modelo nuevo con factores y pesos no decididos (**D-53 §1**) |
| Score compuesto de proveedor | Exige **ponderar**; los pesos no están en ninguna fuente (**D-53 §1**) |

## 6. La pantalla no dice «sin datos» por construcción

La prueba y la revisión usan **casos positivos y negativos discriminantes** sobre una **fixture sintética
controlada**: dos entregas comparables (2 USD/KG sobre 100 KG y 3 USD/KG sobre 200 KG → **2,666666 USD/KG**
truncado, con denominador **300**), una incompatible por unidad, otra por moneda, otra por producto, una sin
dato económico y una con solo prima. Cada cálculo **responde**, **excluye** lo que debe y **explica** lo que
no puede cerrar.

**Dato del entorno**: con la fixture cargada, **8 de 8** indicadores quedan CALCULADOS; con un período vacío,
todos pasan a **SIN_DATOS con su porqué**. Las dos caras están demostradas.

## 7. Permisos sobre agregados, denominadores, filtros y descargas

- El **técnico de campo** no abre la pantalla (**403**) y no ve la entrada en el menú.
- El **auditor** la abre, pero el **presupuesto** le sale **RESTRINGIDO** —no tiene `cost:read`— **sin valor,
  sin denominador y sin cobertura**. El admin lo recibe con su estado real (control autorizado).
- La **descarga** exige además `report:export`: el técnico recibe **403**.
- **Otra organización es 404 opaco**: comparar asociaciones **no** autoriza consultas cruzadas.

## 8. Lo que NO hace

- **No publica un score** ni un umbral de «datos suficientes».
- **No convierte** monedas ni unidades, y **no suma** lo incompatible.
- **No usa** el riesgo regulatorio como métrica comercial. **`UNDETERMINED` no es riesgo bajo.**
- **No escribe nada**: no hay `POST` en esta superficie (404) y leer no cambia el dominio.
- **No levanta** READY ni el despacho.
- **Los datos sintéticos de revisión no sustentan conclusiones** sobre compradores, regiones ni productores
  reales, y la respuesta lo dice en cada lectura.

## 9. Resultados

| Comprobación | Resultado |
| --- | --- |
| `analytics.int-spec.ts` (fixture sintética discriminante) | **16/16** |
| `src/authz/catalog.spec.ts` | **9/9** |
| `node e2e/review/indicadores.mjs` | **22/22** sobre el despliegue |
| `node e2e/review/economia.mjs` (regresión de P1-012) | **18/18** |
| `node e2e/review/estados-web.mjs` · `web-por-rol.mjs` | **APROBADOS** |
| `npm run validate` sobre `1967366` | **APROBADA**: 849 pruebas, 72 E2E, 0 fallos |
| `node e2e/review/indicadores.mjs` sobre el despliegue de `1967366` | **22/22** |

## 10. Evoluciones abiertas (D-53, **no bloqueantes**)

Composición del score y sus pesos, umbral de «datos suficientes», atribución de precio a un comprador y serie
de rendimiento. **Ninguna es criterio de RF-45**, ninguna está adoptada y ninguna se resolvió en silencio.
