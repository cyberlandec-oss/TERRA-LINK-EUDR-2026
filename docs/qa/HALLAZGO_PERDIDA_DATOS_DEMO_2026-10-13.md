# Hallazgo: pérdida de los registros DEMO creados en las revisiones del 2026-10-12

Detectado el 2026-10-13 al verificar, antes de consolidar P0-029, que los registros DEMO documentados siguieran en la base
de desarrollo `terra_link`. **No es un defecto del producto ni de `npm run validate`**: es una pérdida de datos locales
causada por la reubicación del disco de Docker Desktop. No afecta a producción (no existe) ni al código versionado.

## 1. Qué falta (hecho comprobado)

| Registro documentado | Documento | Estado hoy |
| --- | --- | --- |
| `ENT-2026-00004`, `ENT-2026-00005` (borradores importados) | `docs/qa/importacion/PROCEDENCIA_DATOS_DEMO_IMPORTADOS.md` | **Ausente** |
| `ENT-2026-00006`, `ENT-2026-00007` (borradores con referencia `DEMO-REF-C`/`DEMO-REF-D`) | idem | **Ausente** |
| `LOT-2026-00004` (ABIERTO, origen conocido, referencia `DEMO-IMP-LOTE-1`) | idem; `EVIDENCIA_P0-026_LOTES_Y_CIERRE_2026-10-12.md` | **Ausente** |
| Parcelas `DEMO-IMP-PAR-001`, `DEMO-IMP-PAR-002` (y el punto SIMULADO de P0-027) | `EVIDENCIA_P0-026_PARCELAS_2026-10-12.md`, `EVIDENCIA_P0-027_2026-10-12.md` | **Ausente** |
| Comprador `DEMO-REV-COMPRADOR` y embarques `EMB-2026-00001`…`00003` (cancelados) | `EVIDENCIA_P0-029_2026-10-12.md` | **Ausente** |

Consultas de comprobación (2026-10-13):

```
deliveries → ENT-2026-00001..00003   lots → LOT-2026-00001..00003   plots → DEMO-PAR-001..006
import_batches = 0   import_rows = 0   buyers = 0   shipments = 0
```

Lo que queda es **exactamente** lo que crea `apps/api/src/db/seed-demo.ts`. Desapareció todo lo añadido por las revisiones
en navegador del 2026-10-12 (importaciones de P0-026, acción real de P0-027 y embarques de revisión de P0-029).

## 2. Causa (hecho comprobado)

La base de desarrollo no se vació: **se creó de cero**, sobre un almacenamiento de Docker nuevo.

| Evidencia | Valor | Significado |
| --- | --- | --- |
| `docker volume inspect terra-link_postgres-data` (y `object-data`, `scanner-db`) | `CreatedAt = 2026-10-13T15:04:06Z` | Los tres volúmenes del proyecto son de hoy |
| `select min(timestamp), max(timestamp), count(*) from kysely_migration` | `2026-10-13T15:14:19Z` … `15:14:38Z`, 37 filas | Las 37 migraciones (incluidas 0001–0036, aplicadas originalmente días antes) se ejecutaron hoy en 19 s: esquema construido desde cero |
| `min/max(created_at)` de `organizations`, `users`, `producers`, `plots`, `deliveries`, `lots` | 2026-10-13 15:15–15:19 Z | Todo el DEMO vigente se sembró hoy |
| Registro WSL, distro `docker-desktop` | `BasePath = \?\D:\DOCKER DESCKTOP\DockerDesktopWSL\main` | El almacenamiento de Docker ya no está en `%LOCALAPPDATA%` |
| `D:\DOCKER DESCKTOP\DockerDesktopWSL\disk\docker_data.vhdx` | creado **2026-10-12 15:51**, 6,9 GB | Disco de datos actual, nacido el 2026-10-12 por la tarde |
| `%LOCALAPPDATA%\Docker\wsl\disk\` | carpeta **vacía**, fecha 2026-10-12 15:51 | El disco anterior ya no existe en su ruta original |
| `%LOCALAPPDATA%\Docker\install-cli-log.txt` | `2026-10-12T20:39:24Z` (15:39 local), rutas `…\AppData\Local\Programs\DockerDesktop\…` | Reinstalación de Docker Desktop esa misma tarde |
| `wsl -l -v` | solo `docker-desktop` | No queda la distro `docker-desktop-data` del layout anterior |

**Secuencia de los hechos:**

1. 2026-10-12 ~13:02 local — último commit (`4688335`, P0-027) y, después, el trabajo de P0-029 (archivos de
   `apps/api/src/shipments/` con fecha 13:20) con sus revisiones en navegador sobre la base DEMO de entonces.
2. 2026-10-12 15:39–15:51 local — reinstalación de Docker Desktop y **cambio de la ubicación del disco de imágenes** a
   `D:\DOCKER DESCKTOP`. La carpeta de disco anterior queda vacía.
3. 2026-10-13 15:04 Z — al levantar la pila sobre el almacenamiento nuevo, Docker crea los tres volúmenes **vacíos**.
4. 2026-10-13 15:14 Z — `migrate` construye el esquema desde cero (37 migraciones).
5. 2026-10-13 15:19 Z — se siembra el DEMO base (`seed:demo`).

### Hecho frente a hipótesis

- **Hecho**: los volúmenes actuales, el esquema y todos los datos DEMO nacieron el 2026-10-13; el disco de datos de Docker
  es del 2026-10-12 15:51 y la ruta anterior está vacía; hubo una reinstalación de Docker Desktop el 2026-10-12.
- **Hipótesis** (no demostrable ya): que el contenido anterior se descartara **durante** el cambio de ubicación del disco
  en lugar de migrarse. El disco antiguo no existe, así que no se puede inspeccionar lo que contenía.
- **Descartado como causa**: la sesión del 2026-10-13 posterior a las 19:00 Z (`docker compose down --remove-orphans`,
  `docker image prune -f`, `docker builder prune -f`). Ninguno borra volúmenes con nombre, y los volúmenes ya existían
  desde las 15:04 Z, casi cuatro horas antes. `npm run validate` tampoco: usa solo `terra_link_test` y `terra_link_e2e`
  (comprobado durante la corrida: `terra_link_test` con 15 932 transacciones y `terra_link` solo con el sondeo del worker).

## 2.bis Impacto sobre documentos, evidencias e instantáneas

El volumen `terra-link_object-data` (S3 local, donde viven los binarios de documentos y evidencias) se recreó **en el mismo
acto** que `postgres-data`: ambos tienen `CreatedAt = 2026-10-13T15:04:06Z`. Las consecuencias, separadas:

| Qué | Estado |
| --- | --- |
| Documentos, versiones y análisis antivirus anteriores al 2026-10-13 | **Perdidos** (filas y binarios) |
| Evidencias, fuentes y decisiones anteriores | **Perdidas** |
| Expedientes DD, instantáneas y exportaciones anteriores | **Perdidos** |
| Evaluaciones de riesgo y mitigaciones anteriores | **Perdidas** |
| Base actual | `documents` 2 · `document_versions` 2 · `evidence` 1 · `evidence_sources` 1 · `dd_cases` 1 · `dd_snapshots` 1 · `dd_exports` 0 · 201 objetos (528 KB) en el S3 local |

**Consecuencia favorable, y conviene dejarla escrita**: como base de datos y almacén de objetos se perdieron a la vez, **no
hay referencias rotas**. No existe ninguna fila que apunte a un binario ausente ni ninguna instantánea DD que cite un
documento inexistente. El estado actual es internamente coherente; lo que no tiene es historia. Por eso el hallazgo no
degrada la integridad del producto y no bloquea la validación: solo invalida, como *dato vivo*, lo que las evidencias
del 2026-10-12 describen.

Las tres poblaciones deben mantenerse separadas y nunca presentarse como una sola:

1. **Datos originales desaparecidos** — los del 2026-10-12, descritos en `docs/qa/importacion/PROCEDENCIA_DATOS_DEMO_IMPORTADOS.md`
   y en las evidencias de P0-026/P0-027/P0-029. Siguen siendo evidencia histórica válida de que aquellas revisiones se
   hicieron; **no** son el contenido de la base de hoy.
2. **Datos actuales del seed** — exactamente lo que crea `apps/api/src/db/seed-demo.ts`, sembrado el 2026-10-13 15:19 Z.
3. **Reconstrucciones futuras** — si se decide regenerar, deben rotularse como segunda generación, con su fecha y sus
   códigos nuevos, y nunca sustituir en la documentación a los registros del punto 1.

## 3. Respaldos

- **Anteriores**: **no se localizó ninguno en las ubicaciones inspeccionadas**. Se buscaron `*.dump`, `*.sql` y `*.backup`
  mayores de 10 KB en el árbol del repositorio y en la ruta antigua `C:\Users\mario\TERRA LINK 2025` (que ya no existe):
  sin resultados. Los volúmenes de Docker son todos del 2026-10-13 y los dos anónimos solo contienen `dump.rdb` de Redis.
  **Esto no demuestra que no exista una copia en otro sitio**: no se inspeccionaron discos externos, otras cuentas de
  usuario, copias del sistema (Historial de archivos, puntos de restauración, instantáneas de volumen), almacenamiento en
  la nube ni otros equipos. Si aparece una copia anterior, revisar este hallazgo y la propuesta de recuperación.
- **Nuevo (este hallazgo)**: respaldo privado del estado actual, creado con `pg_dump -Fc` sobre `terra_link` **antes** de
  cualquier reparación y **fuera del repositorio**, en el directorio temporal de la sesión (no versionado, ignorado por
  git por ubicación). Contiene datos DEMO sintéticos y material cifrado de identidad; no se reproduce aquí su contenido ni
  su ruta completa. La base de desarrollo no se modificó para crearlo.

## 4. Propuesta de recuperación (pendiente de decisión; NO ejecutada)

Los registros perdidos eran **sintéticos de revisión**, no datos de cliente. Lo que se perdió no es el producto sino la
*evidencia viva* que acompañaba a `docs/qa/importacion/PROCEDENCIA_DATOS_DEMO_IMPORTADOS.md`.

1. **No recrearlos con el seed y llamarlo conservación.** Un `seed:demo` no devuelve `LOT-2026-00004`: lo perdido lo
   crearon recorridos de importación en navegador, con sus lotes de importación, filas y huellas.
2. **Opción A (recomendada)**: volver a ejecutar los recorridos que los produjeron
   (`e2e/review/importaciones-*.mjs`, `embarques-web.mjs`) y **anotar en la procedencia** que los registros vigentes son de
   una segunda generación del 2026-10-13, con códigos y fechas nuevos. La evidencia anterior queda como histórica.
3. **Opción B**: dejar constancia del vacío y no regenerar, aceptando que la procedencia documenta registros que ya no
   existen en la base local.
4. **Prevención, independiente de A o B**: respaldo `pg_dump -Fc` de `terra_link` antes de cualquier operación sobre
   Docker Desktop (actualización, reinstalación o cambio de ubicación del disco), y comprobación de `kysely_migration`
   al levantar la pila: si las 37 migraciones comparten minuto, la base es nueva.

Mientras no haya decisión, este hallazgo queda **abierto** y separado de P0-029: no bloquea la validación ni el commit,
porque el código y las pruebas no dependen de esos registros (la integración usa `terra_link_test`, que se recrea).
