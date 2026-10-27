# Evidencia — Restauración del entorno de desarrollo (2026-10-16)

**Qué ocurrió**: al reanudar la sesión, los volúmenes del proyecto `terra-link` no estaban presentes en el motor
Docker consultado y la base `terra_link` existía vacía, sin `kysely_migration`. El entorno se reconstruyó
restaurando el respaldo `2026-10-16-post-rotacion-pii`.

**Lo que esta evidencia acredita**: que el contenido restaurado coincide con el respaldo. **No** acredita
continuidad con los volúmenes anteriores, ni explica su ausencia.

---

## 1. Los volúmenes actuales son nuevos y restaurados

Los tres volúmenes del proyecto —`terra-link_postgres-data`, `terra-link_object-data`,
`terra-link_scanner-db`— **se crearon en esta sesión** al levantar la infraestructura, y su contenido **se
restauró desde el respaldo**. No son los volúmenes anteriores conservados, y no deben describirse como tales en
ningún informe posterior.

## 2. Causa de la ausencia de los volúmenes anteriores: indeterminada

> No se encontró evidencia que explique la ausencia de los volúmenes anteriores. Los contextos actuales apuntan
> al mismo motor y el VHDX observado conserva la ruta y fecha indicadas. La causa permanece indeterminada. Los
> volúmenes actuales son nuevos y fueron restaurados desde el respaldo.

Lo observado, sin extraer de ello más de lo que dice:

| Observación | Qué se vio |
| --- | --- |
| Contextos Docker | `default` y `desktop-linux`, ambos hacia el mismo motor `docker-desktop`, con idéntico listado de volúmenes |
| Motor | Server 29.8.2 · `DockerRootDir=/var/lib/docker` · driver `overlayfs` · `Name=docker-desktop` |
| Almacenamiento | `D:\DOCKER DESCKTOP\DockerDesktopWSL\disk\docker_data.vhdx` (12,01 GB), creado 2026-10-12 |

**Lo que estas observaciones no demuestran**: que no haya habido cambios anteriores de contexto, motor o
almacenamiento. La equivalencia de los contextos es **actual**, no histórica; y la ruta y la fecha de creación
del VHDX, por sí solas, no demuestran continuidad íntegra de su contenido. La investigación **no se amplía**:
la causa queda registrada como indeterminada.

## 3. Cotejo de la base: 107 tablas

`pg_restore` terminó con código 0 y sin mensajes. Los conteos por tabla de la base restaurada se compararon,
una a una, contra `estado-actual.txt` del respaldo: **las 107 coinciden sin una sola diferencia**.

Comprobaciones específicas del estado que el respaldo acredita:

| Comprobación | Esperado | Obtenido |
| --- | --- | --- |
| Migraciones | 43 | **43** |
| Marca de migración más antigua | `2026-10-13T15:14:19Z` | **`2026-10-13T15:14:19.119Z`** |
| Tokens cifrados, total | 39 | **39** (18 en `producers` + 21 en `producer_versions`) |
| Tokens con `k1` | ninguno | **ninguno**; `PII_KEYS` contiene solo `k2` |
| Filas de historial recodificadas | 7 | **7** |
| Índices ciegos poblados | 6 | **6** |
| Trigger `producer_versions_no_mutation` | activo | **`O`** |
| Catálogo de riesgo | `0.1.0`/`0.2.0` `NOT_APPROVED`, `1.0.0` `APPROVED`, ninguno con perfil jurídico | **coincide** |
| Adopciones del catálogo | 1, solo la Cooperativa DEMO | **1** |

**Corrección al documento de continuidad**: `REANUDAR_2026-10-16.md` §0.4 indica esperar `k2|5` en `producers`;
son **6**. El total de 39 tokens que reporta la evidencia de D-43 solo cuadra con 6 (6 × 3 = 18, más 21 del
historial); con 5 darían 36. El valor correcto es **6**.

## 4. Cotejo de los objetos, por referencia, tamaño y SHA-256

El `SHA256SUMS.txt` del respaldo cubre el `object-data.tar.gz` **completo** (verificado: `OK` en los cuatro
archivos), no cada objeto una vez desplegado. Esta comprobación es la que faltaba: contrastar cada objeto
restaurado contra la referencia que guarda la base (`document_versions.object_key` y `document_versions.sha256`).

Resultado, sobre el depósito de desarrollo `terra-link-private`:

| Referencia (`object_key`) | Tamaño observado | SHA-256 en la base | SHA-256 del objeto | ¿Coincide? |
| --- | ---: | --- | --- | --- |
| `organizations/e8db…ca28/documents/3e5a4c9b-fe70-4c1a-b4ca-ddae6bedf266.bin` | 63 B | `356557d5…31647b` | `356557d5…31647b` | **Sí** |
| `organizations/e8db…ca28/documents/e6e68a7f-a850-47ac-9cd8-0cc1c7ba4e01.bin` | 64 B | `102b1e48…581181` | `102b1e48…581181` | **Sí** |

Los **dos** objetos referenciados por la base existen en el volumen restaurado y su SHA-256 es idéntico al que
la base registra. Depósitos presentes tras la restauración: `terra-link-private`, `terra-link-e2e`,
`terra-link-test`, `terra-link-seedcheck`.

**Límite de esta comprobación**: `document_versions` no almacena el tamaño, así que el tamaño se reporta como
**observado** y no contrastado contra una referencia guardada. Lo contrastado es la **referencia y el
SHA-256**, que es lo que acredita que el contenido no cambió.

## 5. Estado del entorno tras la restauración

| | |
| --- | --- |
| Contenedores | 7 `healthy` + `migrate` `Exited (0)` |
| Migraciones tras `migrate` | **43**, sin cambios: no aplicó ninguna |
| Web 3000 · Swagger 4000/api/docs · Móvil 3001 | **200** · **200** · **200** |
| `http://localhost:4000/` | **404**, que es lo esperado |
| Revisión web por rol | **APROBADO**: 22 combinaciones de 19 cuentas |
| Errores de consola en la revisión visual | ninguno |
| `SATELLITE_LIVE_CALLS` en api y worker | `disabled`; `live_calls_enabled: false` en la respuesta de la API |

Restricciones conservadas: conclusión regulatoria **`UNDETERMINED`**, expediente **`BLOCKED`**, **`READY`** y
despacho **sin habilitar**, llamadas satelitales **deshabilitadas**, catálogo `1.0.0` adoptado **solo** por la
Cooperativa DEMO.

## 6. Limpieza realizada, y lo que se conservó

Contenedores e imágenes eliminados para forzar reconstrucción limpia. **Los volúmenes no se borraron**: los dos
del proyecto ajeno `terra-link-dev` (de `D:\TERRA-LINK-EUDR-main\refactor\infraestructure`) y los dos anónimos
siguen intactos. Los cinco respaldos de `_respaldos\` están **completos y sin tocar**.

Los dos proyectos Compose se mantienen **separados**: `terra-link` (3000/4000/5440/6379/9000) y `terra-link-dev`
(3400/4400/5434/6380/9400). Cualquier operación futura se limita al proyecto y a los recursos expresamente
identificados.

**No se vuelve a restaurar ni se hace más limpieza.**

## 7. Validación posterior

`npm run validate` sobre **`4cf28d2`**: **APROBADA**. 63 suites, **586 pruebas**, **72 E2E**, 0 fallos.
Registros en `validation-results/2026-10-17T01-44-22-107Z`.
