# Evidencia — P1-009 «Simulador de preparación de lote» (2026-10-18)

**Validación**: `npm run validate` **APROBADA** sobre `0741bec` — 77 suites, **790** pruebas, **72** E2E, 0
fallos (`validation-results/2026-10-18T14-26-58-521Z`). **Despliegue**: `/version` → `0741bec` (`BUILD_ARG`),
esquema `0050` **sin cambios**. **Sin migración y sin intervención sobre datos**: no procede respaldo.

## 1. Qué recorrido nuevo completa una persona

Quien prepara una exportación entra en **«Simulación»**, elige un lote y, sin tocar nada:

1. ve el **veredicto** —hoy siempre **NO EXPORTABLE**— **con sus causas**;
2. ve **qué se miró y cuándo**: recuentos de productores, parcelas y entregas, cantidad, documentos,
   evidencias, versión de reglas, número de evaluación de riesgo y su vigencia, y versión del perfil jurídico;
3. ve el **estado real** del expediente, requisito a requisito;
4. **marca supuestos** —«imagina que esto estuviera resuelto»— y obtiene **qué seguiría bloqueado**, clasificado
   en **dato que falta**, **decisión pendiente** o **capacidad no implementada**;
5. comprueba que **suponerlo todo tampoco habilita nada**.

## 2. Criterios originales y cómo se cubren

| Criterio (referencia exacta) | Cómo se cumple | Evidencia |
| --- | --- | --- |
| **S3 §37**: «el exportador selecciona un lote» y el sistema simula «productores, parcelas, cantidades, riesgos, documentación, balance de masa, DDS» | Selector de lote; recuentos de los seis grupos y requisitos que cubren riesgo, documentación, balance (`QUANTITIES_CONSISTENT`) y DDS (`REGULATORY_CONCLUSION`) | `simulacion.mjs` («INPUTS Y FECHA») · `simulation.int-spec.ts` |
| **S3 §37**: «🟢 98 % listo» **o** «🔴 No exportable» **con las causas** | Se publica el porcentaje **y** el veredicto; el veredicto **sale de las causas**, no del porcentaje | `simulacion.mjs` («EL PORCENTAJE NO DECIDE») |
| **RF-40** (`docs/03:56`): «**solo lectura**» | No existe `POST` ni `PATCH` (**404**); ninguna tabla de escenarios; el listado de expedientes no cambia al simular | `simulation.int-spec.ts` («es SOLO LECTURA») · `simulacion.mjs` |
| **RF-40**: «**inputs/fecha visibles**» | `simulated_at` y `inputs` con versiones de reglas, evaluación, vigencia y perfil | `simulacion.mjs` («INPUTS Y FECHA») |
| **P1-009** (`docs/18:210`): «**mismas reglas/snapshot que preflight**» | `evaluateRequirements()` sobre el **mismo contenido** que el expediente, y las comprobaciones de lote del preflight: calidad, origen y paquete de diligencia | `simulacion.mjs` («MISMAS REGLAS»: `DD_PACKAGE,ORIGIN,QUALITY`) |
| **P1-009**: «**bloqueos aunque porcentaje alto**» | Con cualquier causa abierta el veredicto es `NO EXPORTABLE`, y el resumen lleva la advertencia de `summary()` | `simulation.int-spec.ts` · `simulacion.mjs` |

## 3. Las tres cosas que no se mezclan

| Bloque | Qué contiene | Garantía comprobada |
| --- | --- | --- |
| `real` | Estado del expediente hoy, con su causa | Un supuesto **no lo altera**: el requisito supuesto sigue sin cumplirse aquí |
| `scenario` | Qué se supuso resuelto | Cada supuesto lleva escrito **«SUPONER NO ES RESOLVER»** y el estado que tiene de verdad |
| `projected.still_blocked` | Lo que **seguiría** bloqueado | Excluye lo supuesto e incluye el resto, **con su clase y su motivo** |

Un supuesto que no procede **se rechaza** —código inexistente, o requisito ya cumplido— en vez de aceptarse en
silencio.

## 4. Clasificar el bloqueo, para no prometer que se arregla trabajando

| Clase | Ejemplo observado | Por qué importa |
| --- | --- | --- |
| **DECISION** | `LEGAL_PROFILE` (P1-005), `REGULATORY_CONCLUSION` (D-05.B, D-07.5, D-07.6) | No se resuelve cargando datos |
| **CAPACIDAD** | `DEFORESTATION_ANALYSIS`: no hay proveedor satelital contratado (P0-028, D-09 parte B) | **No es un pendiente de la organización** |
| **DATO** | El resto | Sí se resuelve en el módulo que corresponda |

Comprobado en el despliegue: las **tres clases** aparecen, y **todas** con su motivo escrito.

## 5. Lo que la simulación NO hace

- **No escribe.** Sin `POST` ni `PATCH`, sin tabla de escenarios y sin cambios en expedientes, instantáneas,
  inventario ni evidencias.
- **No habilita.** Suponerlo todo deja `still_blocked` vacío **y el veredicto sigue siendo `NO EXPORTABLE`**:
  READY y el despacho exigen decisiones abiertas y el preflight real de un embarque.
- **No simula lo que depende de un embarque.** `STATUS`, `RESERVATION` y `GATE` se **declaran no simulados** en
  vez de darse por cumplidos.
- **No sirve para inferir.** Exige `dd:read`; los recuentos no llevan identidades ni coordenadas; y los códigos
  de parcelas y entregas a los que apunta un requisito solo viajan a quien puede leer esos recursos. Un
  **centinela** falla si algún día existe un rol con expediente pero sin esas lecturas.

## 6. Comprobado **antes** de congelar

Como en la entrega anterior, el recorrido se verificó **sobre el árbol de trabajo desplegado** antes de
confirmar —enlaces del menú, permisos, estados de pantalla y recorrido entero— y después se repitió sobre el
SHA validado. **15/15** en ambos casos.

Durante esa comprobación previa corregí **dos defectos de mi propio arnés**, no del producto: un selector
ambiguo (`Lote` casaba también con la región «Elige un lote») y, más importante, una comprobación que **pasaba
en vacío**: comparaba dos respuestas **404** de una ruta inexistente (`/dd/cases` en vez de `/dd-cases`), que
difieren solo en `request_id`. Ahora exige **200** y compara el listado real.

## 7. Resultados

| Comprobación | Resultado |
| --- | --- |
| `simulation.int-spec.ts` | **10/10** |
| `node e2e/review/simulacion.mjs` | **15/15** sobre el despliegue |

## 8. P1-010 no se empieza, y por qué

**Qué entiende la fuente por «coste»** (S3 §33, «GAP 7»): **dinero por concepto y por productor**
—georreferenciación, validación, documentación, análisis satelital, administración— sumando un total con el que
negociar con el comprador. **Las cifras que aparecen son un «Ejemplo»**, no tarifas.

**En Terra Link no existe ninguna cifra monetaria medida.** Lo único parecido es
`satellite_providers.cost_note`, que es **texto** de la documentación de cada candidato, y **no hay proveedor
seleccionado ni contratado** (P0-028, D-09 parte B). Sin importes no hay «coste real», y usar el ejemplo de la
fuente sería **inventar tarifas**.

Las cuatro decisiones que faltan —de dónde salen los importes, qué cantidad mide cada concepto, cuál es el
denominador de la asignación y cómo se trata la moneda— quedan **juntas en D-51** (`docs/22`), con sus opciones,
su efecto y una recomendación. **P1-009 no depende de ellas** y se entrega sola.

## 9. Compuertas

`UNDETERMINED` (4 evaluaciones), `SATELLITE_LIVE_CALLS=disabled`, **0 instantáneas READY**, **0 embarques
despachados**. La simulación no toca ninguna.
