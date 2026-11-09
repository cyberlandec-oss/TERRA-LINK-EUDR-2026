# Evidencia — Catálogo de riesgo `1.0.0` y críticos en reportes (2026-10-15)

Equipo local, contenedores del proyecto `terra-link`, datos **sintéticos**. Contratos:
`docs/decisiones/D-07-MATRIZ-CATALOGO.md` y `docs/decisiones/P0-030-REPORTES.md`.
**No acredita producción, conformidad EUDR ni aprobación regulatoria de ninguna regla.**

## 1. Validación

Dos corridas aprobadas y **una fallida, conservada**. La vigente es la última.

| | Catálogo y reportes | Corrección E2E | **Seed DEMO (vigente)** |
| --- | --- | --- | --- |
| Corrida | `2026-10-15T21-32-43-407Z` | `2026-10-15T21-49-08-998Z` | **`2026-10-15T22-10-02-135Z`** |
| Commit | `c290bc5` | `ba78752` | **`f993e9b`** |
| Resultado | **FALLIDA** | APROBADA | **APROBADA** |
| Pasos (s) | 1 / 16,6 / 9,7 / 22,5 / 14,6 · pruebas 750,5 · E2E 142,2 | 1 / 18,2 / 11,8 / 24,1 / 18,7 · pruebas 771,4 · E2E 151,3 | 1 / 16,9 / 11,9 / 24 / 19 · pruebas 762,1 · E2E 165,3 |
| Pruebas | 581 unitarias e integración · **56 E2E en verde, 1 en rojo y 5 sin ejecutar** | 581 · 62 E2E | **62 suites, 581 · 62 E2E** |

**Corrida fallida conservada** (`2026-10-15T21-32-43-407Z`): todo en verde salvo **una** prueba E2E,
`productos.spec.ts:644` (las 5 restantes no llegaron a ejecutarse por el corte). El catálogo `1.0.0` escribe «La ausencia de alertas **NO** prueba ausencia de
deforestación» y la prueba buscaba «no prueba» en minúsculas. Se corrigió la prueba **sin relajarla**: sigue
exigiendo esa frase en la pantalla del lote. El mismo tropiezo apareció antes en `risk.int-spec.ts` y se corrigió
igual. Es el tercer caso de una aserción que copiaba un texto literal del catálogo: conviene no anclar pruebas a
mayúsculas de un texto editorial.

Partía de **62 suites y 563 pruebas** (corrida `2026-10-15T20-04-51-326Z` sobre `2430053`); quedan **62 suites y
581 pruebas**: **18 nuevas**, sin suites nuevas. Las E2E siguen siendo **62**: las comprobaciones del crítico se
añadieron dentro de la prueba de reportes que ya existía.

## 2. Qué se publicó

Migración `0043_catalogo_riesgo_1_0_0.ts`. Comprobado contra el despliegue:

```
select version, approval_status, regulatory_profile is null from risk_rule_sets order by published_at
  0.1.0 | NOT_APPROVED | t
  0.2.0 | NOT_APPROVED | t
  1.0.0 | APPROVED     | t
```

| Regla | Efecto | Severidad |
| --- | --- | --- |
| `MATERIAL_OF_UNKNOWN_ORIGIN` | BLOCKING | **CRITICAL** |
| `MASS_BALANCE_INCONSISTENT` | BLOCKING | **CRITICAL** |
| `DATA_MISSING_ORIGIN` | BLOCKING | **HIGH** |
| `GEOMETRY_INVALID` | BLOCKING | **HIGH** |
| `DOCUMENT_EXPIRED` | REVIEW_REQUIRED | **MEDIUM** |
| `MITIGATION_UNVERIFIED` | BLOCKING | — |
| `SATELLITE_COVERAGE_UNKNOWN` | NOT_ASSESSED | — |
| `GEOLOCATION_PROFILE` | NOT_ASSESSED | — |

Reglas históricas con severidad: **0**. Nada se migró ni se recalculó; la migración **falla a propósito** si
encontrara una evaluación anterior con severidad.

## 3. Tres actos distintos, comprobados por separado

Publicar, adoptar y aprobar bajo perfil jurídico son cosas diferentes, y cada una se prueba sola:

| Acto | Dónde | Estado comprobado |
| --- | --- | --- |
| Publicación global | `risk_rule_sets.approval_status` | `1.0.0` = `APPROVED` |
| Adopción por organización | `risk_rule_set_adoptions` | **Solo la Cooperativa DEMO**, como ensayo local |
| Aprobación bajo perfil jurídico | `risk_rule_sets.regulatory_profile` | **`NULL` en las tres versiones** (D-07.5 pendiente) |

La columna `regulatory_profile` se añadió en esta entrega **porque hacía falta**: sin ella, publicar el catálogo
técnico habría puesto el requisito `RISK_CATALOG_APPROVED` del expediente en `MET` —solo miraba
`approval_status`— y el expediente habría avanzado hacia `READY` por la puerta de atrás. Se detectó porque
`dd.int-spec.ts` falló al publicar el catálogo. Ahora el requisito exige **adopción** *y* **perfil jurídico**, y
hay una prueba que comprueba que sigue `NOT_EVALUABLE` **incluso con el catálogo adoptado**.

## 4. Pruebas añadidas

**Integración, `d07-mecanismos.int-spec.ts` (24, antes 23):**

- El catálogo publica cinco severidades y tres reglas sin ella, y los históricos quedan intactos.
- La graduación se declara **decisión de producto** en las cinco reglas y en las notas de la versión.
- `MATERIAL_OF_UNKNOWN_ORIGIN` se describe por su condición real, sin imputar mezcla ilegal ni fraude.
- **Publicar no adopta**: con `1.0.0` `APPROVED`, una organización que no lo adopta no clasifica nada.
- Adoptado: el hallazgo crítico permanece visible y la **cobertura sigue incompleta** (cuatro categorías sin regla).
- Retirar la adopción devuelve a «sin clasificar» **sin reescribir** la evaluación anterior.
- **Ninguna versión declara perfil jurídico.**
- **Nada de esto habilita `READY`**, ni siquiera con el catálogo adoptado y un crítico clasificado: el expediente
  sale `BLOCKED` y `RISK_CATALOG_APPROVED` sigue `NOT_EVALUABLE` citando D-07.5.

**Integración, `reports.int-spec.ts` (23, antes 19):** el crítico tiene indicador propio marcado como extensión;
sin `risk:read` se restringe igual que los demás; en una organización **sin adoptar** los cuatro indicadores citan
el motivo real (publicar no es adoptar); tras adoptar, `risk_critical = 1` y `risk_high = 0` sobre el mismo
denominador —el crítico **no se diluye**—; el valor viaja al CSV igual que a la pantalla; retirar la adopción
vuelve a desconocido sin tocar lo ya evaluado.

**Unitarias, `reports-risk.spec.ts` (10, antes 6):** publicado-pero-no-adoptado, adopción de una versión antigua
con aviso de la nueva, reparto `CRITICAL`/`HIGH`/`MEDIUM`/`LOW` sobre la misma base y una severidad desconocida
que **no se reparte** entre las conocidas.

**Unitarias, `requirements.spec.ts` (10, antes 9):** publicar globalmente no cumple `RISK_CATALOG_APPROVED`; hacen
falta adopción y perfil jurídico, y sin el segundo el expediente queda `BLOCKED`.

**E2E (62):** la tabla de indicadores tiene **12** filas —los 11 de S1 §60 más **una** extensión declarada—, la
fila del crítico está rotulada como extensión de Terra Link, ninguna otra lo está, y el crítico recibe el mismo
trato que los demás (nunca se publica como cero).

## 5. Despliegue comprobado

```
docker ps                                    7 contenedores; api/web/postgres/redis/scanner healthy
localhost:3000 → 200 · localhost:3001 → 200 · localhost:4000/api/docs → 200
select count(*) from kysely_migration        43   (la 0043, aplicada 2026-10-15T22:06:27Z)
min(timestamp) de kysely_migration           2026-10-13T15:14:19Z   (sin recrear el volumen)
```

**Qué prueba y qué no**: que la marca más antigua se conserve demuestra que el volumen **no se recreó vacío**;
**no acredita que todos los datos sigan ahí**. Para eso está QA-16. Conteos observados tras el despliegue:
4 organizaciones, 20 usuarios, 3 lotes, 3 entregas.

**Recorrido real en el despliegue** (Cooperativa DEMO, tras `seed:demo`):

```
risk_critical | TERRA_LINK | OK | 1 | num 1 | den 1
risk_high     | S1_60      | OK | 0 | num 0 | den 1   «Cero observado…», no «no hay críticos»
evaluación crítica: rules = 1.0.0 · APPROVED · adoptada=true · regulatory_profile=null
  severidad: CRITICAL «Crítico (de los hallazgos evaluados)»
  cobertura: PARCIAL — 4 reglas no evaluables, 1 hallazgo sin severidad, 4 categorías sin regla
  categorías sin regla: LEGALITY, EVASION, HUMAN_RIGHTS, INDIGENOUS_RIGHTS
  conclusión: UNDETERMINED
expediente DEMO: BLOCKED · RISK_CATALOG_APPROVED = NOT_EVALUABLE
```

Las evaluaciones anteriores (`0.2.0`, `NOT_ASSESSED`) **siguen ahí** con su número: reevaluar creó registros
nuevos, no reescribió los viejos.

**Whisp real sigue deshabilitado**: `SATELLITE_LIVE_CALLS` no está definido en el entorno del despliegue, y el
proveedor sigue en `SELECTED_FOR_DEVELOPMENT`.

## 6. Incidencias de esta entrega

- **`CREDENCIALES.csv` bloqueado al sembrar.** `seed:demo` terminó su trabajo y **falló al escribir el archivo**
  (`EBUSY`): está abierto en otro programa. Dejó `CREDENCIALES.pendiente.csv`. El código de salida 1 es de la
  escritura del archivo, no de las operaciones de datos. Contraste completo de qué creó y qué no, con sus
  límites: `docs/qa/EFECTO_SEED_DEMO_2026-10-15.md`.
- **Se imprimió la columna `contrasena` de `CREDENCIALES.csv` en la sesión**, al listar las tres primeras columnas
  para preparar una consulta a la API. Cinco cuentas DEMO, incluida la de plataforma. **Rotadas y verificadas** el
  2026-10-16, con la corrección de fondo del procedimiento:
  `docs/qa/ROTACION_CREDENCIALES_DEMO_2026-10-16.md`.

## 7. Lo que esta entrega NO acredita

- **Ninguna aprobación regulatoria.** `regulatory_profile` es `NULL` en todas las versiones.
- **Ninguna conclusión.** Sigue `UNDETERMINED` por `CHECK`; **D-07.5** y **D-07.6** siguen pendientes.
- **Ningún `READY` ni despacho.** El expediente sigue `BLOCKED`, también con el catálogo adoptado.
- **Ninguna evaluación completa del riesgo.** Cuatro categorías siguen sin regla: un lote sin severidad **no** es
  un lote sin riesgo.
- **Ninguna adopción fuera de la Cooperativa DEMO.** Adoptar es decisión de cada organización.
- **P0-030 sigue ABIERTA**: queda bloqueado el perfil de destino regulatorio del GeoJSON (**D-05.B**).
