# P0-030 — Estado por criterio frente a las fuentes (2026-10-16, cuarta revisión)

Contraste de **todos** los criterios de la historia con sus fuentes: **S1 §60** (dashboard técnico, los 11 KPI),
**S1 §97** (Sprint 11 — Reporting: reportes por entidad y exportación GeoJSON), **RF-30** (`docs/03_REQUISITOS.md`),
**docs/09** (contratos de API), **docs/17** (operación), **QA-13/14** (`docs/16_PLAN_QA.md`) y **`docs/UX_UI.md` §20.2**.

Tres estados, sin terceras lecturas: **DEMOSTRADO** (hay código y prueba que lo acreditan), **PENDIENTE** (falta hacerlo,
sin bloqueo externo) y **BLOQUEADO** (depende de una decisión o capacidad concreta que no está en esta historia).

La historia pasa a **DONE_LOCAL** (2026-10-16): todos sus criterios están demostrados con pruebas locales. Eso
**no** acredita producción, volumen de piloto ni conformidad EUDR.

### Qué quedaba bloqueado y qué queda hoy (contraste del 2026-10-16)

| Criterio que estaba bloqueado | Antes | Hoy |
| --- | --- | --- |
| `plots_valid` | BLOQUEADO por D-05 (criterio inexistente) | **DEMOSTRADO**: el criterio existe y tiene versión (`EUDR_GEO_V1 1.0.0`, D-05.A) y el indicador lo cuenta |
| Distribución por severidad de riesgo | BLOQUEADO por D-07 y por el catálogo `NOT_APPROVED` | **DEMOSTRADO**: con el catálogo `1.0.0` publicado y adoptado por una organización, el indicador clasifica y el lote **CRÍTICO** se publica aparte; sin adopción sigue `UNKNOWN` con su motivo real |
| GeoJSON — «perfil de destino regulatorio» | BLOQUEADO por D-05 | **NO ERA UN CRITERIO DE ESTA HISTORIA.** Ninguna fuente lo pide: ver §4.ter. El criterio literal, `GeoJSON export`, está **DEMOSTRADO** |

**Ya no queda ningún criterio de P0-030 bloqueado.** El estado de la historia pasa a **DONE_LOCAL** con la
evidencia de §1 a §3; ver §4.ter para por qué el tercer renglón no era un criterio y qué sigue dependiendo de
D-05.B fuera de esta historia.

## 1. S1 §60 — Dashboard técnico (11 KPI)

La instrucción literal de la fuente —«no empezar por un dashboard bonito; primero construir los indicadores desde
queries reales»— se cumple: los 11 salen de consultas SQL sobre la base, ninguno de un valor fijo.

| KPI | Estado | Evidencia o dependencia |
| --- | --- | --- |
| `producers_total` | **DEMOSTRADO** | `reports.int-spec.ts` «conteos de estado»: 2 vigentes con 1 baja declarada aparte |
| `plots_total` | **DEMOSTRADO** | ídem |
| `plots_valid` | **DEMOSTRADO** (2026-10-15) | Ya **no** es `CRITERION_UNDEFINED`: el criterio existe y tiene versión (`EUDR_GEO_V1 1.0.0`, D-05.A). Cuenta el dictamen de la versión **vigente** de cada parcela, declara el perfil y las versiones contadas, y separa cumple / no cumple / revisión / no evaluable / sin evaluar; las no evaluadas no entran en el denominador. **Qué significa cumplir el perfil frente al destino regulatorio sigue siendo D-05.B**, y es una dimensión distinta del indicador |
| `deliveries_total` | **DEMOSTRADO** | Por `delivery_date`, límites inclusivos; probado con períodos de un solo día |
| `lots_active` | **DEMOSTRADO** | Con desglose por estado |
| `traceability_completeness` | **DEMOSTRADO** | 1 de 2 lotes = 50,0 % con numerador y denominador a la vista |
| `risk_critical` (**extensión declarada**, no es de S1 §60) / `risk_high` / `risk_medium` / `risk_low` | **DEMOSTRADO** (2026-10-15) | Los cuatro estados se prueban **contra la base**, no solo en memoria: `NO_DENOMINATOR` sin sujetos evaluados; `UNKNOWN` con sujetos evaluados sin severidad —citando si falta catálogo, si falta **adopción** (D-07.1) o si los hallazgos no llevan severidad—; y `OK` tras adoptar el catálogo `1.0.0`, con el lote **CRÍTICO** contado por sí mismo, **sin diluirse en HIGH**, sobre la base de los clasificados y declarando que la distribución es parcial. Retirar la adopción vuelve a `UNKNOWN` sin reescribir lo ya evaluado. Ver §4.bis |
| `evidence_completeness` | **DEMOSTRADO** | Con desglose por estado de afirmación |
| `due_diligence_ready` | **DEMOSTRADO** | Cero observado con desglose `READY/IN_PROGRESS/BLOCKED/sin instantánea`. Contar bloqueados **sí** es calculable; lo que no se deduce es conformidad |

**Corrección de esta revisión.** Antes, seis indicadores salían bajo una sola etiqueta `NOT_CALCULABLE`, que mezclaba
situaciones distintas. Ahora hay cinco estados y cada indicador declara el suyo: `OK` (un 0 es **cero observado**),
`NO_DENOMINATOR`, `UNKNOWN`, `CRITERION_UNDEFINED` y `RESTRICTED`. `due_diligence_ready` dejó de ser «no calculable»:
su cero es observado y se publica, porque **un resultado desfavorable no es motivo para declarar nada incalculable**.

## 2. S1 §97 — Sprint 11, Reporting

| Criterio de la fuente | Estado | Evidencia o dependencia |
| --- | --- | --- |
| Producer report | **DEMOSTRADO** | `GET /reports/entities/producers`. Parcelas, parcelas con geometría y entregas del período por productor; nombres solo con `producer:read_identity` |
| Plot report | **DEMOSTRADO** | `GET /reports/entities/plots`. Distingue sin versión / solo superficie declarada / geometría registrada; «SIN EVALUAR» no es «inválida» |
| Lot report | **DEMOSTRADO** | `GET /reports/entities/lots`. Cantidades **por unidad**, nunca un total único entre unidades |
| Risk report | **DEMOSTRADO** (con el dato bloqueado) | `GET /reports/entities/risk`. Los lotes sin evaluar aparecen como tales; los totales por severidad salen `DESCONOCIDO` mientras ninguno esté clasificado, y en cuanto haya clasificados se publican **sobre esa base**, no como distribución del tenant |
| Traceability report | **DEMOSTRADO** | `GET /reports/entities/traceability`. Completitud del origen declarado desde `lot_inputs.origin_known` |
| DD report | **DEMOSTRADO** | `GET /reports/entities/dd`. Preparación de la última instantánea, con los BLOCKED contados |
| GeoJSON export (técnico) | **DEMOSTRADO** | `GET /reports/entities/plots/geojson`. `FeatureCollection` RFC 7946 con la geometría guardada, sin reproyectar ni recortar; exige `plot:read_geometry` |
| *(«perfil de destino regulatorio»)* | **NO ES UN CRITERIO** | Ninguna fuente lo pide: S1 §97 dice «GeoJSON export» y S1 §16 pide dos rutas y un formato. Se había añadido por interpretación; ver **§4.ter**. La aplicabilidad jurídica es **D-05.B** y se registra en `docs/22`, no como condición de cierre de esta historia |

## 3. RF-30, docs/09, docs/17, QA-13/14 y UX_UI §20.2

| Criterio | Estado | Evidencia o dependencia |
| --- | --- | --- |
| RF-30: KPI con **denominadores** reales | **DEMOSTRADO** | Cada indicador publica numerador y denominador, o declara por qué no hay |
| RF-30: KPI con **permisos** reales | **DEMOSTRADO** | `report:read` abre la pantalla, no los datos; cada indicador exige el permiso de su dominio |
| Permiso del dominio de **cada dato agregado**, no solo de la entidad | **DEMOSTRADO** | El reporte de productores exige `producer:read` + `plot:read` + `delivery:read` porque cuenta parcelas y entregas; trazabilidad exige los tres por el mismo motivo. Probado en memoria con permisos arbitrarios (`reports-catalog.spec.ts`), sin tocar roles reales |
| docs/09: contrato publicado y OpenAPI al día | **DEMOSTRADO** | `apps/api/openapi.json` regenerado y validado (183 rutas); fila de `docs/09` actualizada |
| docs/17: operación sin trabajos largos ni colas | **DEMOSTRADO** (por diseño) | Los reportes son consultas sincrónicas acotadas; no hay jobs diferidos, y por eso no aplica el patrón «aceptación, no resultado» |
| UX_UI §20.2: alcance, filtros y formato; organización, período, unidades, versión/fecha y autor | **DEMOSTRADO** | Cabecera del CSV con organización, período, catálogo, generación y notas; unidades explícitas en los reportes de lotes |
| UX_UI §20.2: permisos de campo **también en la exportación** | **DEMOSTRADO** | La identidad del productor y las coordenadas se gobiernan igual en pantalla y en CSV/GeoJSON |
| QA-13/14: pruebas con valores conocidos, aislamiento y permisos | **DEMOSTRADO** | 42 pruebas: 16 de integración de indicadores, 12 de reportes por entidad, 8 del catálogo de permisos y 6 del reparto por severidad (las dos últimas, en memoria) |
| Accesibilidad: teclado, 390 px y zoom 200 % | **DEMOSTRADO** | Pruebas E2E de navegador sobre la pantalla de reportes |
| Paginación y acceso al conjunto completo | **DEMOSTRADO**, con el tope declarado | Cursor sobre la clave natural, página máxima 500, totales siempre del conjunto completo y exportación que recorre todas las páginas en una instantánea **hasta 20 000 filas**, rotulando el archivo como «conjunto completo» o «TRUNCADO». Probado con 520 filas, sin duplicados ni omisiones |
| Lectura consistente de filas y totales | **DEMOSTRADO**, con su alcance declarado | Una transacción `REPEATABLE READ` de solo lectura **por petición**, y la exportación recorre sus páginas dentro de ella. **No** hay instantánea compartida entre peticiones distintas: navegar entre páginas abre una nueva, y así se dice en pantalla, en la respuesta y en el CSV. Ver `P0-030-REPORTES.md` §7.bis |
| Comparación de actividad entre períodos | **DEMOSTRADO** | `compare_from`/`compare_to` sobre los indicadores de ACTIVIDAD, por fecha operativa, con la equivalencia de tramos declarada |

## 3.bis Pendientes: qué exige cada fuente, exactamente

El encargo pedía citar la fuente de cada pendiente y separar **requisito de la historia**, **mejora posterior** y
**bloqueo externo**. Hecho, sin añadir condiciones de cierre nuevas ni retirar requisitos existentes.

| Pendiente | ¿Lo exige alguna fuente? | Clasificación | Qué se hizo |
| --- | --- | --- | --- |
| Acceso al conjunto completo de filas | **Sí, implícito en la fuente**: S1 §97 pide «Producer report», «Plot report», «Lot report»… sin acotar a una muestra; `docs/09` §grafo fija la regla del repositorio: cursor y **«distinguir truncamiento técnico»**; UX_UI §20.2 exige «seleccionar alcance… generar y descargar con estado real» | **Requisito de la historia** | **Implementado**: paginación por cursor y exportación del conjunto completo. El corte mudo de 500 filas era un defecto, no un límite declarado |
| Comparación entre períodos | **No literalmente**: S1 §60 enumera 11 KPI y no pide series. Pero comparar actividad solo necesita la fecha operativa, que ya existe | **Mejora posterior, implementada** | **Implementada** porque es factible y útil; **no** se añade como condición de cierre de la historia |
| Saldo/existencias a una fecha pasada | **No.** Ningún KPI de §60 es de tipo «saldo a una fecha» y la búsqueda literal (`saldo a|stock histor|existencia.*fecha|as of date|historical stock`) no devuelve nada en las fuentes ni en RF-30 | **Capacidad distinta, sin contrato** | **No se implementa ni se aproxima.** Reconstruir el ledger a una fecha exige su propio contrato: qué movimientos, qué correcciones y qué versiones cuentan. **Comparar actividad no es esto**, y por eso la comparación sí se implementó |
| Reportes programados o envío periódico | **No.** Comprobado por búsqueda literal sobre las cuatro fuentes y los documentos de requisitos, contratos, operación y UI: `grep -rniE "programad|periodic|scheduled|cron|recurrente|suscripci" docs/sources/*.md docs/03 docs/09 docs/17 docs/UX_UI.md`. Las únicas coincidencias son ajenas: «eventos asíncronos» (S1 §54), «ingresos recurrentes» (S2, negocio), sincronización móvil, y «Programadas 8» (S4), que es un **estado de embarques**, no un reporte programado | **Mejora posterior, sin fuente que la exija** | **No se implementa**, y **no** se añade como condición de cierre. Si algún día se adoptara, exigiría autorización vigente al ejecutar **y** al descargar, para no entregar datos a quien perdió el acceso entre una cosa y otra |
| Volumen de piloto medido | **Sí**: S1 §98 fija el piloto (20–50 productores, 20–100 parcelas, 1–3 lotes) | **Requisito de otra historia (P0-031)** | Fuera de P0-030; la paginación ya sostiene ese orden de magnitud y se probó con 520 filas |

## 4. Qué depende realmente de D-05 (y qué no)

La revisión anterior atribuía a D-05 un bloqueo general sobre la exportación GeoJSON. **No es exacto.** Separando:

**No depende de D-05 y está implementado** — la exportación técnica: leer la geometría vigente tal como se guardó,
entregarla en RFC 7946 (WGS84 longitud/latitud), con `plot_code`, `producer_code`, versión, método de levantamiento,
estado de validación, superficie declarada y calculada, `geometry_hash` y el sha256 del archivo de importación de origen.
Esto reutiliza lo construido en **P0-009** (`exportVersion` de una versión concreta) y lo extiende a la colección de la
organización, con el mismo permiso `plot:read_geometry`, la misma ausencia de reproyección y el mismo aviso.

**Resuelto el 2026-10-15 por D-05.A**, que añadió una **segunda** exportación sin tocar la técnica:

1. **Qué geometría exige cada caso** → umbral **estricto** de 4 ha; exactamente 4 ha se admite.
2. **Precisión del destino** → **6 decimales**, escritos como números. La exportación **técnica** sigue con 17
   dígitos a propósito: entrega lo guardado sin recortar. Son dos archivos con dos propósitos.
3. **Qué propiedades espera el destino** → `ProductionPlace` y `Area` (solo puntos, como número). **Sin
   `ProducerName`** (dato personal) ni **`ProducerCountry`** (no se registra país de producción).
4. **Qué parcelas quedan calificadas** → las que el perfil marca `MEETS_PROFILE`; el resto **se lista con su
   motivo**, y «no evaluada» tiene código propio.

**`plots_valid` ya se calcula** (2026-10-15). Cuenta el dictamen del perfil `EUDR_GEO_V1` de la versión
**vigente** de cada parcela, y:

- **declara contra qué criterio cuenta**, con su versión, en un campo propio (`criterion`), separado de los
  conteos; si hay dictámenes de **más de una versión** lo avisa, porque entonces el total no es comparable consigo
  mismo;
- separa las cinco situaciones: **cumple**, **no cumple**, **en revisión**, **no evaluable** y **sin evaluar**;
- **las sin evaluar no entran en el denominador**: desconocido no es incumplimiento;
- un dictamen de una versión geométrica **anterior no se hereda** a la vigente;
- salió de `CRITERION_UNDEFINED` —el criterio ya existe y tiene versión— y pasa a **`UNKNOWN`** mientras no se
  haya ejecutado. Son dos cosas distintas y el indicador no las confunde;
- respeta el permiso del dominio: sin `plot:read` queda `RESTRICTED`, **sin valor y sin desglose parcial**.

**Sigue dependiendo de D-05.B**, la aplicabilidad jurídica: qué **significa** el resultado. Cumplir el perfil
técnico **no es conformidad** ni habilita presentar nada, y el propio indicador lo dice. Nada de esto se ha
probado contra el **servicio real** del destino.

**Actualización del 2026-10-16**: la distribución de riesgo dejó de estar bloqueada —el catálogo `1.0.0` está
publicado y una organización lo adoptó— y el «perfil de destino regulatorio» resultó no ser un criterio de esta
historia (§4.ter). Con eso, P0-030 queda **DONE_LOCAL**. Lo que **no** cambia: cumplir el perfil técnico no es
conformidad, nada se ha probado contra el servicio real del destino y **D-05.B** sigue pendiente.

Lo que **no** se hace mientras tanto: inventar una geometría para las parcelas que solo tienen superficie declarada. Se
excluyen del archivo y su número se declara en el propio GeoJSON (`counts.solo_superficie_declarada`), de modo que nadie
lea un archivo incompleto como si fuera completo.

## 4.ter El «perfil de destino regulatorio» NO es un criterio de P0-030

Este documento llegó a listar «GeoJSON export (**perfil de destino regulatorio**)» como un criterio **BLOQUEADO**
de la historia. **No lo es.** Se añadió por interpretación, y conviene deshacerlo citando el texto literal.

### Lo que dicen las fuentes, palabra por palabra

| Fuente | Texto literal | Qué pide |
| --- | --- | --- |
| **S1 §97** (Sprint 11 — Reporting) | «Producer report · Plot report · Lot report · Risk report · Traceability report · DD report · **GeoJSON export**» | Una **exportación GeoJSON**. Nada más: ni perfil, ni validación contra un destino, ni aceptación |
| **S1 §16** (GeoJSON) | «La plataforma debe tener exportador: `GET /plots/{id}/geojson` y `GET /plots/export/geojson`. La guía de trazabilidad señala GeoJSON como **formato interoperable requerido** para EUDR» | Dos rutas y un **formato**. «Formato interoperable requerido» describe el formato del archivo, **no** acredita que un archivo concreto sea aceptado por nadie |
| **RF-30** (`docs/03`) | «Reportes/KPI calculados con **denominadores y permisos reales**» | Denominadores y permisos |
| **Aceptación de P0-030** (`docs/18`) | «filtro tenant/periodo, denominador/definición, datos reales, export autorizado con snapshot y audit; reporte no filtra PII ni confunde readiness con conformidad» | Seis condiciones, ninguna regulatoria |
| **QA-13 / QA-14** (`docs/16`) | «Crear/corregir/aprobar/descargar/exportar/cambiar permiso; reporte» · «Home por permiso, links, sección 403, vacío/error/loading, teclado» | Permisos, historial y estados de UI |

**Ninguna de las cinco menciona un perfil de destino, una validación contra el sistema oficial ni una aceptación
jurídica.** El criterio literal es «GeoJSON export», y está **DEMOSTRADO**.

### Tres alcances que se habían fundido en uno

| # | Alcance | Qué es | Estado | De quién depende |
| --- | --- | --- | --- | --- |
| 1 | **Exportación técnica** | Entregar la geometría guardada en RFC 7946, sin reproyectar ni recortar, con permiso `plot:read_geometry` y los omitidos declarados | **DEMOSTRADO** — es el criterio de S1 §97 | P0-030 (esta historia) |
| 2 | **Compatibilidad documentada** con el destino | Una segunda exportación que aplica el perfil `EUDR_GEO_V1 1.0.0`: umbral de 4 ha, 6 decimales, propiedades esperadas y parcelas calificadas | **IMPLEMENTADO** (D-05.A, 2026-10-15), y **nunca probado contra el servicio real** | D-05.A, ya adoptada |
| 3 | **Aceptación jurídica** | Que cumplir el perfil **acredite** el requisito de geolocalización frente al destino | **PENDIENTE** | **D-05.B**, que es una decisión regulatoria, no un criterio de reporting |

Fundirlos convertía una decisión regulatoria abierta en una condición de cierre de una historia de reportes. Es el
mismo error que este documento ya corrigió dos veces —atribuir el bloqueo de la severidad a P0-021 y P0-028—, y se
corrige igual: **el criterio es el que está escrito**, y lo demás se registra donde corresponde.

### Qué falta realmente, y dónde se registra

- **D-05.B** sigue pendiente, y su efecto está donde debe estar: en `docs/22` y en lo que la exportación **dice de
  sí misma**. La respuesta declara `regulatory_profile: { status: "PENDING", depends_on: "D-05.B", technical_profile:
  "EUDR_GEO_V1 1.0.0 (D-05.A, provisional)" }`, y la pantalla lo rotula. Nadie puede leer el archivo como una
  acreditación.
- **Nada se ha probado contra el servicio real del destino.** El perfil se construyó sobre documentación fechada
  (`docs/sources/eudr-is-2026-10-15/`) y así lo declara: `verification: DOCUMENTED_NOT_TESTED_AGAINST_SERVICE`.
- Cerrar P0-030 **no** afirma conformidad EUDR, ni que el archivo sea aceptado, ni que exista perfil jurídico.

## 4.bis Qué bloquea realmente la severidad de riesgo (y qué no)

La revisión 1 decía que la severidad llegaría «cuando cierren D-05, P0-028 (satélite) y P0-021 (mitigaciones)».
**Era inexacto.** P0-021 **está implementada**, y verificar una mitigación no asigna severidad ni produce una conclusión
favorable: entra en el resultado **técnico** del factor `MITIGATION_UNVERIFIED`, que es otra dimensión.

Lo que realmente lo determina:

1. **D-07** (`docs/22`: «Severidad/proceso/conclusión riesgo — enums reales, mapping y regla aprobada»).
2. El **catálogo `risk_rule_sets`**, hoy en `NOT_APPROVED` (versiones 0.1.0 y 0.2.0), que declara por escrito no tener
   «pesos, umbrales, severidades ni lista jurídica». El motor (P0-020) escribe `NOT_ASSESSED` en toda evaluación.
3. **La base lo impide a nivel de esquema**: `risk_evaluations` lleva
   `CHECK (conclusion = 'UNDETERMINED' AND severity = 'NOT_ASSESSED')` desde la migración `0025_risk.ts`. No es solo que
   el motor no asigne severidad: ninguna fila puede llevarla, venga de donde venga.

Consecuencia para las pruebas: el **caso mixto** —sujetos clasificados y sin clasificar a la vez— no se puede construir
contra la base hoy. Se prueba en memoria (`src/reports/reports-risk.spec.ts`) y la prueba de integración comprueba que
el candado del esquema existe y rechaza el intento. Cuando hay clasificados, el conteo se publica **sobre la base de los
clasificados**, nunca como distribución de todos los lotes del tenant.

## 5. Cobertura histórica: qué se corrigió

La redacción anterior afirmaba que «toda serie anterior al 2026-10-13 está vacía por pérdida de almacenamiento». Era
**incorrecta como afirmación general**: la pérdida fue del almacenamiento, no de las fechas operativas. Un registro
conservado o creado después puede declarar una entrega de septiembre, y debe contar en septiembre.

Lo que ahora se declara, en pantalla, en la respuesta y en el CSV: **cobertura histórica incompleta**, con la fecha del
suceso, la advertencia de que un período antiguo puede devolver menos de lo ocurrido, y la regla explícita de que los
registros disponibles se incluyen **por su fecha operativa declarada**, aunque sea anterior a la pérdida. Se mantiene sin
cambios lo que sí era correcto: **no se reconstruye ninguna cifra a partir de los informes de QA**, que son evidencia
histórica y no registros operativos.

Probado en `reports.int-spec.ts`: dos entregas con fecha operativa de septiembre, registradas después de la pérdida,
cuentan en un período de septiembre; y el texto de cobertura ya no afirma que lo anterior esté vacío.

## 6. Lo que esta historia sigue sin acreditar

- **Conformidad EUDR**: ningún reporte la acredita. `READY` es preparación interna y `EXPORTED` es descarga.
- **Producción**: todo es validación local sobre datos sintéticos.
- **Volumen real**: los reportes no se han probado con el volumen de un piloto (P0-031).
- **Riesgo clasificado para quien no adopta**: el catálogo `1.0.0` está publicado, pero una organización que no lo
  adopte seguirá viendo `NOT_ASSESSED` y una distribución desconocida. Eso es la decisión D-07.1 funcionando, no un
  defecto del indicador.
- **Riesgo clasificado para quien sí adopta**: la clasificación es **de los hallazgos evaluados** y es **parcial**:
  `LEGALITY`, `EVASION`, `HUMAN_RIGHTS` e `INDIGENOUS_RIGHTS` no tienen ninguna regla. Un lote sin severidad **no**
  es un lote sin riesgo.
- **Conclusión regulatoria**: sigue `UNDETERMINED` por `CHECK`. Clasificar severidades no concluye nada, y el
  requisito `RISK_CATALOG_APPROVED` del expediente sigue `NOT_EVALUABLE` incluso con el catálogo adoptado, porque
  ninguna versión está aprobada bajo perfil jurídico (D-07.5).
