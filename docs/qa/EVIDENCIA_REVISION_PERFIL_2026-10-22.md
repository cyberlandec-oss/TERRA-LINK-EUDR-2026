# Evidencia: acto de revisión del perfil jurídico (P1-005), 2026-10-21/22

**Implementación demostrada ≠ aceptación regulatoria.** Esta evidencia acredita un **mecanismo** (registrar, consultar y aplicar consecuencias técnicas de una revisión). **No** acredita contenido jurídico revisado, **no** hay ninguna revisión real registrada y no cambia ningún requisito de ningún expediente real.

## 1. Candidatos y validaciones (cada uno sobre su propio SHA, árbol intacto durante la corrida)

| Candidato | Contenido | `npm run validate` | Despliegue |
| --- | --- | --- | --- |
| `b0c70eb` | Migración `0062`, API de plataforma, pantalla, pruebas de integración y E2E | **APROBADA** (1039 pruebas, 119 E2E) | Desplegado; demostración 10/10 |
| `95b6e87` | Dos defectos de presentación hallados en las capturas a 390 px: radios de «Resultado» a ancho completo y fundamento del historial fuera de la vista. La E2E exige tamaño de control, etiqueta en su línea y fundamento dentro del ancho | **APROBADA** (1039 pruebas, 119 E2E; `validation-results/2026-10-21T23-30-18-601Z/`) | **Final**: `/version` = `95b6e87`, esquema `0062_p1005_acto_revision_perfil` |

**Trazabilidad del despliegue:** el primer despliegue de `95b6e87` salió marcado `+sucio` porque se editó el script de demostración antes de desplegar. Se guardó ese cambio fuera del repositorio, se restauró el archivo y se **redesplegó limpio**; el cambio del script (no funcional) entra en el commit de resultados. Lección aplicada: la inspección visual y responsive se completa **antes** de congelar el candidato.

## 2. Demostración sobre el despliegue final — 10/10, sin registrar ninguna revisión

`e2e/review/revision-perfil-demostracion.mjs` (los perfiles reales no cambian): permiso (403 organización / 200 plataforma), `0.1.0` publicado y `0.2.0` borrador **sin revisión y no elegibles**, rechazos sin escritura (petición incompleta, estado inexistente, versión inexistente, fecha futura), favorable sin soporte y soporte de otra versión (422), retirar sin revisión favorable vigente (422), la base rechaza una favorable sin soporte (también en la copia restaurada), estado de datos idéntico (0 revisiones, 0 soportes, 13 adopciones, 0 actos, 2 versiones).
**Visual a 390 px:** en inglés (captura `validation-results/revision-perfil-2026-10-21/pantalla-en-390.png`) y en español (comprobación medida): radios de 20 px con su etiqueta en la misma línea, consecuencia técnica y motivos dentro del ancho, sin desborde horizontal. El **fundamento y el historial** con revisiones se comprueban con datos sintéticos aislados (E2E `revision-perfil.spec.ts`): en el entorno operativo el historial está vacío a propósito.

## 3. Recorrido completo con datos sintéticos aislados

`test/legal-profile-review.int-spec.ts` (9) y `e2e/tests/revision-perfil.spec.ts` (5): revisión favorable (persona, capacidad, fecha, fundamento, soportes) → elegible; objeción posterior → la anterior queda **reemplazada** y **no se reescribe**; la organización que adoptó el perfil deja de ver revisión vigente; el acto de vinculación pasa a «ya no vigente»; retirada solo sobre una favorable vigente; revisión posterior restablece; control de revisión vigente (`REVIEW_SUPERSEDED`), idempotencia, auditoría, append-only. El borrador de la pantalla es **solo local del navegador** y no crea ninguna revisión.

## 4. Respaldo de `0062` y restauración aislada

`_respaldos/2026-10-22-revision-perfil-0062/` (base, objetos, `claves.env` restringido, `estado-actual.txt`, `SHA256SUMS.txt`). Restauración en contenedor y volumen propios, sin seed ni migraciones: 62 migraciones; conteos idénticos (22 organizaciones, 23 lotes, 2 versiones legales, 0 revisiones, 0 soportes, 0 actos); 3 triggers del acto presentes; `0.2.0` = `DRAFT`; la copia rechaza una favorable sin soporte. Entorno de restauración eliminado; **27 volúmenes intactos**.

## 5. Tres cosas distintas que no se confunden (y registros anteriores)

| Concepto | Dónde vive | Qué significa |
| --- | --- | --- |
| **Persona revisora declarada** | `reviewer_name` + `reviewer_capacity` + `reviewed_on` | Quien, según lo declarado al registrar, hizo la revisión; puede no tener cuenta. Es una **declaración**, no una identidad verificada |
| **Usuario que registra el acto** | `reviewer_id` **desde `0062`** (SUPER_ADMIN, siempre de la sesión) | Quién lo **escribió** en el sistema; auditoría `legal_profile.review_*` |
| **Fuentes y citas de soporte** | `legal_profile_review_supports` | Fuentes del **propio perfil** (misma versión) o citas con enlace/huella opcionales; no son documentos de organizaciones |

**Registros anteriores a `0062` (comprobación):** `legal_profile_reviews` tenía **0 filas** en el entorno operativo antes y después (vectores de estado 0/…), en las copias de respaldo previas, y solo contenía fixtures sintéticos en bases de prueba. **No existe ningún registro real cuya interpretación de `reviewer_id` cambie.** Si algún dato anterior hubiera existido, conservaría su sentido histórico de `0049` («responsable identificado») y se reconocería por `reviewer_name = 'No declarado (anterior a 0062)'` (relleno de la migración): documentar el campo con otro significado **no transforma quién hizo una revisión anterior**. Si en el futuro se quisiera una separación estructural (columna propia del usuario que registra), sería una migración nueva con su candidato.

## 6. Qué NO se hizo

No se registró ninguna revisión real; no se publicó ni adoptó ningún perfil; no se vinculó ningún catálogo; no hay conclusión jurídica del sistema; no se asignó permiso de concluir; no se activó ningún servicio externo. Android pospuesto; roles y compuertas sin cambio.
