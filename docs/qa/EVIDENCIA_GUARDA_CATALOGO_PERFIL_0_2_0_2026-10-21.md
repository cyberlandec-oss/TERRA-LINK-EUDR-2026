# Evidencia: guarda de `RISK_CATALOG_APPROVED` y perfil jurídico `0.2.0` en borrador (2026-10-21)

Candidato `f40b9f4` (rama `feat/tech-001-ci-p0-002`). **Es una guarda técnica y una preparación de borrador: no aprueba ningún perfil, no concluye nada y no cambia porcentajes, requisitos de ningún expediente ni compuertas.**

## 1. Validación y despliegue

| Qué | Resultado |
| --- | --- |
| `npm run validate` sobre `f40b9f4` (una vez, código congelado) | **APROBADA**: typecheck, lint, build, OpenAPI validado, **1018** pruebas unitarias + integración, **109** E2E (`validation-results/2026-10-21T19-11-34-234Z/`; el «1 archivo sin confirmar» es `AGENTS.md`, sin seguimiento) |
| Despliegue (`node scripts/desplegar.mjs`) | `/version`: commit `f40b9f4`, esquema `0060_p1005_perfil_0_2_0_borrador`; servicios sanos; `SATELLITE_LIVE_CALLS=disabled` |
| Respaldo | `_respaldos/2026-10-21-guarda-catalogo-0059-0060/` (base, objetos, `claves.env` restringido, `estado-actual.txt`, `SHA256SUMS.txt`). Se tomó **después** de aplicar 0059–0060 (las migraciones solo añaden un trigger y filas de catálogo; no tocan datos de organizaciones) |
| Restauración aislada | Contenedor y volumen propios, sin seed ni migraciones: 60 migraciones, conteos idénticos (22 organizaciones, 23 lotes, 2 versiones legales, 11 reglas, 3 conjuntos de reglas de riesgo sin perfil), trigger presente, `0.2.0` = `DRAFT`, 0 adopciones de `0.2.0`; el trigger rechaza una etiqueta también en la copia. Entorno de restauración eliminado |
| Demostración en el entorno desplegado | `e2e/review/guarda-catalogo-demostracion.mjs`: **9/9** (ver §4) |

## 2. Cuatro dimensiones que NO se mezclan

| Dimensión | Qué se comprobó | Qué NO significa |
| --- | --- | --- |
| **Referencia válida al perfil** | `regulatory_profile` solo admite (trigger `0059`) una versión **existente, PUBLICADA, COMPLETA y con revisión vigente**. Etiqueta, referencia inexistente, `0.1.0` (parcial, sin revisión) y `0.2.0` (borrador) se rechazan | Que exista una referencia: **ninguna versión real la lleva** |
| **Perfil adoptado y revisión vigente** | El requisito exige además que la organización haya **adoptado** esa misma versión, con alcance completo y última decisión `REVIEWED`. Versión distinta, sin perfil adoptado, parcial, sin revisión u objetada/retirada → pendiente con explicación | Que la revisión sea jurídicamente correcta: no hay ninguna revisión real (`legal_profile_reviews` = 0) |
| **Estado de `RISK_CATALOG_APPROVED`** | Hoy `NOT_EVALUABLE` (referencia nula) en las 9 instantáneas existentes (valores guardados, **no reevaluados**). `MET` solo se logra en pruebas con datos sintéticos | Que el expediente esté aprobado |
| **Conclusión regulatoria y demás requisitos de `READY`** | `REGULATORY_CONCLUSION` sigue `UNDETERMINED` por `CHECK`; `GEOLOCATION_PROFILE`, `DEFORESTATION_ANALYSIS`, `LEGAL_PROFILE` y `SHIPMENT_LINK` siguen sus propias reglas | Ninguna comprobación aislada de este documento aprueba un expediente ni lo acerca a `READY` |

## 3. Revisión posterior objetada o retirada (con las pruebas existentes)

`apps/api/test/risk-catalog-profile.int-spec.ts`, caso «CONTROL POSITIVO SINTÉTICO», sobre base real de prueba:
- con una referencia ya existente (`7.2.0 → 9.9.9`), se **registra** una revisión `OBJECTED`: el INSERT no se bloquea (el trigger vigila `risk_rule_sets`, no `legal_profile_reviews`; en el entorno desplegado hay un solo trigger de guarda y ninguno de validación sobre las revisiones);
- a partir de ahí **no se puede escribir una referencia nueva** a esa versión (`revisión jurídica vigente`), y en el requisito (`requirements.spec`, «revisión invalidada») deja de cumplirse: pendiente y explicado;
- el catálogo y las filas históricas quedan intactos: `risk_rule_sets` y `legal_profile_reviews` son append-only (un UPDATE se rechaza), y la fila `7.2.0` conserva su valor. Una revisión `REVIEWED` posterior restablece el mecanismo por el mismo camino.
Limitación: esta evidencia es de fixture sintética en bases `*_test`; no hay revisión real que objetar.

## 4. Demostración desplegada (9/9, todas aisladas)

`0.2.0` borrador parcial con 7 reglas · EC-7 a EC-9 con procedencia, interpretación propuesta y preguntas · `0.1.0` publicado con 4 reglas y 3 fuentes · adopción de `0.2.0` → 422 `LEGAL_PROFILE_NOT_PUBLISHED` sin escribir · ningún conjunto de reglas con `regulatory_profile` · la base rechaza `aprobado`, `0.1.0` y `0.2.0` (transacción revertida) · el trigger solo está en `risk_rule_sets` · 9 instantáneas con `RISK_CATALOG_APPROVED` = `NOT_EVALUABLE` · adopciones (13) y revisiones (0) sin cambio. Nota para no confundir: `risk_rule_sets` tiene versiones `0.1.0`, `0.2.0` y `1.0.0` **del catálogo de riesgo**, que nada tienen que ver con las versiones del perfil jurídico.

## 5. Qué NO se hizo

No se aprobó ni adoptó ningún perfil; no se reevaluó ningún expediente; no se asignó el permiso de «concluir» ni se cambiaron roles; no se ejecutó el ensayo externo ni se llamó a ningún tercero. Android posterga su prueba real; los volúmenes siguen intactos (27).
