# Evidencia — P1-010 «Presupuesto de preparación» (2026-10-18)

**Validación**: `npm run validate` **APROBADA** sobre `e0f9071` — 79 suites, **807** pruebas, **72** E2E, 0
fallos (`validation-results/2026-10-18T15-45-45-024Z`). **Despliegue**: `/version` → `e0f9071` (`BUILD_ARG`),
esquema **`0051`**. **Respaldo** hecho y **verificado por restauración aislada** (§8).

## 1. Qué entiende la fuente por «coste», y qué se hizo con eso

**S3 §33** pide responder *«¿cuánto me cuesta cumplir EUDR por productor?»* con una tabla de conceptos e
importes que suma un total por productor. **Las cifras que muestra van precedidas de «Ejemplo»**: no son
tarifas. Y en Terra Link **no existe ninguna cifra monetaria medida**.

**D-51, adoptada el 2026-10-18**, resuelve de dónde sale el dinero: **lo declara la organización** como
**parámetros presupuestarios**. Lo implementado sigue ese contrato **literalmente**, y lo dice en cada
respuesta: *no son precios oficiales, ni costes medidos, ni ofertas de proveedores*.

**Comprobado**: ningún importe del ejemplo de S3 aparece precargado, y los cinco conceptos empiezan
**pendientes de presupuestar**.

## 2. Qué recorrido nuevo completa una persona

1. **Registra los parámetros**: concepto, importe en USD, vigencia y —en Validación— **qué revisión** se
   presupuesta. Corregir uno es **registrar otra versión**; la anterior se conserva.
2. **Elige el lote** y **declara las cantidades**, que quedan marcadas como **estimadas**.
3. Obtiene **subtotales y total**, con los conceptos que faltan **señalados, no sumados como cero**.
4. Ve el **reparto**: por productor distinto y por tonelada, con el peso **del ledger** y su fecha.
5. Ve **lo observado** —parcelas sin ubicación, documentos, requisitos pendientes— **en una sección aparte**.
6. **Guarda** la estimación y la **descarga** con sus supuestos.

## 3. Criterios originales y cómo se cubren

| Criterio (referencia exacta) | Cómo se cumple | Evidencia |
| --- | --- | --- |
| **RF-41** (`docs/03:57`): «costes **medidos** y asignación explicada» | No hay cifra medida, y **no se finge** que la haya: los importes se declaran, con autor, versión y vigencia, y la asignación se explica en la propia respuesta | `presupuesto.mjs` («CONTROL») · `cost.int-spec.ts` |
| **P1-010** (`docs/18:211`): «**coste real/moneda**» | Importes **declarados** en **USD**, sin conversiones (D-51 §4) | `cost.int-spec.ts` |
| **P1-010**: «asignación por **productor/tonelada**» | Por **productor distinto del alcance** —recorriendo el **grafo de origen**— y por **tonelada del peso físico del ledger**, con cantidad, unidad y fecha | `presupuesto.mjs` («DENOMINADORES») |
| **P1-010**: «**supuestos visibles**» | Cada línea lleva su nota de qué **no** demuestra la observación; la descarga incluye una hoja «supuestos» | `cost.int-spec.ts` («la descarga lleva los supuestos») |
| **D-51 §1**: no precargar, no consultar servicios externos | Nada precargado; **ninguna llamada de red** | `presupuesto.mjs` («CONTROL») |
| **D-51 §2**: cantidades declaradas y **marcadas como estimadas** | `quantity_kind: DECLARADA_ESTIMADA`; lo observado va **aparte y con su fecha**, y **no se convierte** en cantidad | `presupuesto.mjs` («LO DECLARADO y LO OBSERVADO») |
| **D-51 §3**: «no calculable», nunca cero ni infinito | Divisor cero → `null` → `NO_CALCULABLE` | `cost.spec.ts` (divisor cero) · `presupuesto.mjs` |
| **Ausencia no es cero** | Concepto sin importe o sin cantidad: **no suma**; total **INCOMPLETO** separando lo conocido | `presupuesto.mjs` («AUSENCIA NO ES CERO»: total 13, 4 pendientes) |
| **Reproducible; una tarifa nueva no reescribe lo guardado** | La estimación lleva dentro los parámetros con su versión; las dos tablas son **append-only** | `presupuesto.mjs` («REPRODUCIBLE»: guardada sigue en 13, cálculo nuevo da 36) |
| **No modifica expedientes, inventario ni riesgo** | Comprobado por igualdad de filas antes y después | `cost.int-spec.ts` |
| **Permisos y alcance** | `cost:manage` fija importes, `cost:read` consulta y estima; otra organización **404** | `presupuesto.mjs` («PERMISOS») · `cost.int-spec.ts` |

## 4. Aritmética, probada aparte

Todo el dinero se opera con **enteros escalados a seis decimales**: nunca hay coma flotante. `0,1 × 3 = 0,3`
—no `0.30000000000000004`—, `0,123456 × 2 = 0,246912`, y `13 / 0,25 = 52`. Dividir por cero **no** devuelve
cero ni infinito: devuelve `null`, que la respuesta publica como `NO_CALCULABLE`.

**Un decimal, un formato**: `numeric` de Postgres devuelve «250.000000» y el cálculo propio «250». Publicar los
dos haría dudar de si son el mismo número, así que **todos se normalizan al salir**.

## 5. Vigencia

Se aplica **la versión más nueva que esté en vigor hoy**, no la última registrada. Comprobado: una versión
**ya vencida** y otra **futura** no desplazan a la que sigue vigente; y un concepto cuya **única** versión está
vencida vuelve a **pendiente de presupuestar**, conservando su historial.

## 6. Dos defectos encontrados **antes** de congelar

Ambos aparecieron al revisar el despliegue del árbol de trabajo, no en las pruebas:

1. **El mismo decimal se publicaba de dos maneras** (`250.000000` frente a `250`). Corregido normalizando toda
   salida.
2. **En un lote de PROCESO los productores salían 0** y el reparto quedaba «no calculable», porque solo se
   miraban sus **recepciones directas** —un lote de proceso no tiene—. Los productores están **aguas arriba**.
   Corregido recorriendo el **grafo de origen que el expediente ya calcula**, con su **prueba de regresión**.

El segundo es el que más importa: el sistema no mentía —decía «no calculable»—, pero **se quedaba corto**
cuando sí se podía responder.

## 7. Lo que NO hace

- **No inventa tarifas ni horas**: sin parámetro declarado, el concepto queda pendiente.
- **No convierte lo observado en coste**: una versión de geometría **no** demuestra una visita, una evaluación
  automática **no** demuestra una revisión humana, un trabajo satelital **no** demuestra un servicio facturado.
- **No reparte entre productores concretos**: no hay regla de asignación individual, y se dice.
- **No es contabilidad**: es una **distribución del presupuesto de un escenario**.
- **No toca** expedientes, inventario, riesgo ni decisiones operativas, y **no levanta** ninguna compuerta.

## 8. Respaldo, verificado

Hay migración (**0051**), así que corresponde:
`_respaldos/2026-10-18-p1010-migracion-0051/`, con la aplicación detenida durante la captura.

| Comprobación | Resultado |
| --- | --- |
| Restauración aislada | **0 errores** |
| Migraciones | **51**, la última `0051_p1010_presupuesto_preparacion` |
| Conteos por tabla | **95 tablas con datos, idénticas** |
| Restricciones | **322** FK, **405** CHECK, **152** UNIQUE |
| Append-only del presupuesto | **2** disparadores, y un `DELETE` sobre `cost_estimates` **es rechazado** en la copia |
| Objetos | **880**, igual que el inventario capturado |

**Nota sobre el procedimiento**: el primer intento de verificación **no fue válido** —el contenedor seguía en
su fase de inicio, en la que la imagen arranca y detiene un servidor temporal— y se repitió esperando al
arranque definitivo. Se deja escrito para que el próximo no caiga en lo mismo.

## 9. Resultados

| Comprobación | Resultado |
| --- | --- |
| `cost.int-spec.ts` | **14/14** |
| `cost.spec.ts` (aritmética y divisor cero) | **3/3** |
| `node e2e/review/presupuesto.mjs` | **13/13** sobre el despliegue |
| `node e2e/review/simulacion.mjs` | **15/15** (regresión de P1-009) |

## 10. Compuertas

`UNDETERMINED` (4 evaluaciones), satélite deshabilitado, READY y despacho **sin tocar**. El presupuesto no
acredita ningún compromiso económico.
