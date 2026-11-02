# Propuesta: primer ensayo externo con Whisp usando geometría sintética (2026-10-15)

**PROPUESTA. NO EJECUTADA. NO AUTORIZADA.** D-09 parte B sigue pendiente. Este documento describe un ensayo que
**no se ha hecho** y que no debe hacerse hasta que esté aprobado. No se solicita ninguna clave aquí.

## La idea, y por qué separa dos problemas

Hoy hay dos preguntas mezcladas en una sola decisión:

1. **¿Funciona el adaptador contra el servicio real?** Su formato real, sus códigos, sus cuotas, su TLS.
2. **¿Podemos enviar geometrías de productores a un tercero?** Autorización de datos, términos, base del tratamiento.

La segunda es una decisión de datos personales y contratos. La primera es una comprobación técnica. **Con una
geometría sintética se responde la primera sin tocar la segunda**: un polígono inventado sobre una zona sin relación
con ninguna parcela, ningún productor y ninguna entrega del sistema no es dato de nadie.

Eso no convierte el ensayo en gratis —sigue siendo una llamada a un tercero con una clave— pero reduce lo que está en
juego a lo técnico y permite decidir la parte B con información real en la mano.

## Qué geometría

Un **polígono sintético** que cumpla tres condiciones, en este orden:

1. **Sin vínculo con el sistema**: no procede de ninguna parcela, no se registra como parcela, no se guarda en
   `plot_versions` y no aparece en ningún lote, entrega ni expediente. Vive solo en el ensayo.
2. **Sin relación con un predio real identificable**: no se usan coordenadas de una finca de la cooperativa ni de un
   productor DEMO. Un cuadrado de ~2 ha sobre una zona boscosa conocida y pública sirve: el objetivo es que el
   proveedor **tenga algo que analizar**, no que el resultado signifique algo.
3. **Rotulada como sintética** en todo lo que se conserve del ensayo.

Conviene preparar **dos geometrías distintas y separadas en el espacio**. Y aquí hay que ser preciso, porque la
primera versión de esta propuesta lo decía mal: **dos entradas distintas no tienen por qué producir resultados
ambientales distintos**. Pueden coincidir perfectamente —dos zonas con la misma cobertura dan los mismos
indicadores—, y eso no sería ningún fallo.

Lo que el ensayo comprueba con dos entradas es **correspondencia**: que cada respuesta corresponda a **su** entrada
y no a la otra. Es decir, que el adaptador no mezcle resultados, que el identificador de cada análisis case con la
geometría enviada y que el `request_fingerprint` de cada trabajo sea el suyo. Si además los indicadores difieren,
es información; si coinciden, tampoco invalida nada.

## Qué demostraría (y qué no)

| Demostraría | No demostraría |
| --- | --- |
| **Correspondencia**: cada respuesta corresponde a su entrada, sin mezclar análisis | Ningún resultado ambiental concreto; **no se espera ningún veredicto** |
| Que el contrato implementado (OpenAPI 2.3.0, consultado 2026-10-15) **coincide con el servicio vivo**: rutas, campos, códigos | Nada sobre parcelas reales ni sobre deforestación |
| Que el flujo `submit → status → descarga` funciona de verdad, con sus tiempos reales | Que el sistema pueda usar el resultado: eso es D-07 |
| **Procedencia**: qué campos declara de verdad el proveedor y cuáles quedan nulos, frente a lo que el adaptador supone | Que el resultado sea evidencia: eso es D-42 |
| **Estados incompletos**: si aparece `unavailable_datasets` o `risk_inputs_unavailable`, que el adaptador los conserve y guarde cobertura `PARTIAL` | Conformidad EUDR de nada |
| Que la autenticación por `x-api-key` y el TLS del proveedor funcionan con la defensa de salida puesta | Que la parte B esté aprobada más allá del propio ensayo |
| Cuotas y plazos reales frente a los publicados | Que el sistema esté listo para operar con el proveedor |

El resultado del ensayo se guardaría con `is_synthetic` en **false** (procede de un proveedor real) pero sobre un
sujeto que no existe en el dominio. Por eso el ensayo **no debe ejecutarse contra una parcela del sistema**: no habría
forma de distinguir después un resultado de prueba de uno de producción.

## Requisitos para poder ejecutarlo

| # | Requisito | Estado |
| --- | --- | --- |
| 1 | **Aprobación explícita de D-09 parte B**, aunque sea acotada a este ensayo | **Pendiente** |
| 2 | **Términos del servicio** leídos y aceptados por el responsable | **Pendiente** |
| 3 | **Clave de API** obtenida por registro y guardada por el responsable **fuera del chat** (se registra cifrada por organización con el mecanismo existente) | **Pendiente** |
| 4 | `SATELLITE_LIVE_CALLS=enabled` solo en el entorno del ensayo y solo mientras dure | **Pendiente** |
| 5 | Marcar `WHISP` como `SELECTED` con responsable y referencia de la decisión | **Pendiente** |
| 6 | Las dos geometrías sintéticas acordadas y escritas antes de ejecutar | Preparable sin autorización |
| 7 | Alcance temporal acotado: una ventana corta, un número máximo de llamadas, y apagar el interruptor al terminar | — |

Lo que **no** hace falta y conviene no tocar: parcelas reales, productores, datos DEMO y la base de desarrollo.
El ensayo puede correr contra una base aislada.

## Cómo se registraría

Como cualquier otra evidencia del proyecto: comando exacto, hora, commit, entorno, respuesta original con su SHA-256,
desenlace y límites. Más dos cosas propias de este ensayo:

- **Qué se envió**: la geometría sintética literal, en el propio informe. No hay nada que redactar porque no es dato
  de nadie — y eso es justamente lo que lo hace apto para un primer ensayo.
- **Qué se apagó después**: el interruptor, con la hora.

Si el ensayo revela que el contrato vivo difiere del publicado, el resultado del ensayo es **corregir el adaptador y
la referencia fechada**, no «ajustar» la documentación para que encaje.

**Criterio de éxito, escrito antes de ejecutar**: el ensayo es satisfactorio si cada entrada obtiene una respuesta
que le corresponde, conforme al contrato, con su procedencia conservada y su incompletitud declarada si la hay.
**No** hay ningún resultado ambiental esperado: si las dos geometrías dan indicadores iguales, el ensayo es
igualmente satisfactorio. Fijar de antemano qué «debería» responder el proveedor convertiría la comprobación técnica
en una profecía, que es justo lo que este proyecto evita en todo lo demás.

## Entradas y comprobaciones esperadas, preparadas (2026-10-21) — NO ejecutado

Esto **prepara** el ensayo; no lo ejecuta, no contacta a ningún tercero, no usa clave ni acepta términos. El interruptor
`SATELLITE_LIVE_CALLS` sigue en `disabled`. Ejecutarlo exige las decisiones (1)–(4) de `P0-028-SATELITE.md` §J.

**Dos geometrías sintéticas (propuesta; el propietario puede cambiarlas antes del ensayo).** Dos cuadrados de unas
2 ha (lado ≈ 141 m, ≈ 0,00127°), orden GeoJSON `[longitud, latitud]`, anillo cerrado, separados ≈ 5,5 km. No proceden de
ninguna parcela, no se registran como parcela y se rotulan `SINTETICA-ENSAYO-A` / `SINTETICA-ENSAYO-B`:

| Id | Anillo (lon, lat) |
| --- | --- |
| `SINTETICA-ENSAYO-A` | (-76.00000, -1.00000) → (-75.99873, -1.00000) → (-75.99873, -0.99873) → (-76.00000, -0.99873) → (-76.00000, -1.00000) |
| `SINTETICA-ENSAYO-B` | (-75.95000, -1.00000) → (-75.94873, -1.00000) → (-75.94873, -0.99873) → (-75.95000, -0.99873) → (-75.95000, -1.00000) |

**Comprobaciones esperadas** (cada una con evidencia al ejecutar; hoy todas pendientes):

| # | Comprobación | Resultado esperado |
| --- | --- | --- |
| 1 | Contrato vivo frente a `whisp-openapi.json` (2.3.0) | Mismas rutas, campos y códigos; si difiere, se corrige el adaptador y la referencia fechada |
| 2 | Cada trabajo conserva su `request_fingerprint` y su identificador | El de A no coincide con el de B; cada respuesta casa con su entrada |
| 3 | Flujo `submit → status → descarga` | Termina o falla con un estado explícito; se registran tiempos reales |
| 4 | Indicadores ausentes (`unavailable_datasets`, `risk_inputs_unavailable`) | Se conservan y la cobertura queda `PARTIAL`; sin incidencias → `UNKNOWN`, nunca `COVERED` |
| 5 | Autenticación `x-api-key` y TLS con la defensa de salida puesta | Acepta con la clave de prueba; rechaza sin ella; la clave no aparece en registros |
| 6 | Ninguna geometría en registros ni en la base | Búsqueda de las coordenadas en registros y tablas: sin coincidencias |
| 7 | Interruptor | Con `disabled`, `LIVE_CALLS_DISABLED`; se apaga al terminar |
| 8 | Resultado | Puede coincidir entre A y B; no se interpreta ambientalmente ni se usa como evidencia |

Whisp sigue siendo el **primer adaptador técnico existente**; eso no es aceptación de sus términos ni autorización de
llamadas externas.
