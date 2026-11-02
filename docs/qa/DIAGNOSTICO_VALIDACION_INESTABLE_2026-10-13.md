# Diagnóstico: `npm run validate` inestable desde el 2026-10-12

Cinco corridas con veredicto el 2026-10-13, **todas FALLIDAS**, cada una con **una sola suite** distinta cayendo mientras
las otras 48 pasaban. Este documento separa lo medido de lo supuesto y deja la siguiente hipótesis comprobable.
No se modificó ningún timeout, prueba ni código de producto en ninguna corrida.

## 1. El patrón

| Corrida | Tests | Suite caída | Tipo de fallo |
| --- | --- | --- | --- |
| `19-49-57` | 1587 s | `producer-identity-encryption` | timeout 60 s (suite 1049 s) |
| `20-59-32` | 872 s | `auth-rate-limit` | timeout 60 s en `setupHarness` (357 s) |
| `21-15-51` | 1303 s | `evidence` | timeout 60 s (844 s) |
| `21-40-09` | 832 s | `plot-declared-area` | timeout 60 s (308 s) |
| `21-56-41` | 533 s | `auth-rate-limit` | `expected 429, got 200` en 21,7 s (sin timeout) |
| **Reproducción dirigida** | **542 s** | **ninguna** | **49/49 suites, 380/380 pruebas** |

`shipments.int-spec.ts` (P0-029) pasó en las seis. Ninguna suite caída toca embarques. Todas pasan en aislamiento.

## 2. Causa raíz: el almacenamiento de Docker está en un disco USB mecánico

**Hecho medido.** `pg_test_fsync` sobre el volumen de datos de PostgreSQL y, como referencia, sobre el disco interno:

| Ubicación | `fdatasync` | Por operación |
| --- | --- | --- |
| Volumen de Docker — **D:** | **181 ops/s** | **5510 µs** |
| Disco interno — **C:** (medido a través de un montaje Windows, penalizado; el real es mejor) | 794 ops/s | 1260 µs |

**Hecho medido.** Los discos del equipo:

| Disco | Modelo | Tipo | Bus |
| --- | --- | --- | --- |
| 0 → **C:** | WD PC SN740 SDDPNQD-256G | **SSD** | **NVMe** |
| 1 → **D:** | **Seagate BUP Slim** | — | **USB** |

`D:` es una unidad **externa USB** (Seagate Backup Plus Slim, portátil). 181 fsync/s es cifra de disco mecánico.
El 2026-10-12 a las 15:51 el disco de imágenes de Docker se trasladó a
`D:\DOCKER DESCKTOP\DockerDesktopWSL\disk\docker_data.vhdx`.
**El repositorio también está en D:.** Desde entonces PostgreSQL hace cada fsync sobre un disco USB mecánico.

**Hecho medido.** La fase del harness que se degradó es exactamente la que depende de fsync. Por suite
(`api-test-timings/harness-timings.jsonl`, p50):

| Fase | 12-oct (corrida APROBADA, disco interno) | 13-oct (disco USB) |
| --- | --- | --- |
| `schema_reset_ms` | 210 | 210 (sin cambio) |
| **`migrate_ms`** | **2789** | **7172 (2,6×)** |
| `app_init_ms` | 135 | 66 (sin cambio) |
| cierre app + pool | 5 | 4 (sin cambio) |

Cada suite hace `DROP SCHEMA public CASCADE` + `CREATE SCHEMA` + las 37 migraciones (`apps/api/test/helpers.ts:56-63`).
Son 49 suites × ~7,2 s = **~353 s de los 542 s del paso de pruebas (65 %) solo migrando**. El 12-oct eran 49 × 2,8 ≈ 137 s.
La migración es DDL masivo (CREATE TABLE/INDEX/FUNCTION/TRIGGER): un `fsync` por relación creada.

## 3. Qué descartan las mediciones

Muestreo de `pg_stat_activity` cada 2 s durante la reproducción (291 muestras, 584 s; reloj monótono junto a UTC; sin
texto de consultas ni parámetros). Registro en `validation-results/diagnostico-2026-10-13/`.

- **No son bloqueos.** Solo **3 muestras** con `pg_blocking_pids` no vacío, todas **subsegundo** (0,02–0,30 s), en pruebas
  de concurrencia que los esperan. `Lock/transactionid` 3 muestras, `Lock/tuple` 2.
- **No son conexiones residuales ni fuga de pools.** Máximos en `terra_link_test`: 3 activas, 7 ociosas, **2 `idle in
  transaction`** (media 0,15). `max_connections` = 100. El cierre del harness tarda p50 4 ms. No hay interferencia entre
  suites por conexiones vivas.
- **No es memoria ni swap.** Host entre 6,9 y 8,7 GB libres; swap usado entre 51 y 89 MB.
- **No fue una congelación del host durante esta reproducción.** El propio muestreador, con reloj monótono, **no registró
  ni un hueco >4 s** (cadencia 2 s). Si el proceso se hubiera congelado, el delta monótono lo habría delatado.
- **Sí es E/S de sincronización.** Eventos de espera por número de muestras:
  `Timeout/CheckpointWriteDelay` 241 · `IO/DataFileImmediateSync` 103 · `IO/WALSync` 44 · `IO/DataFileSync` 29 ·
  `LWLock/WALWrite` 8. La consulta activa más larga de toda la ventana fue de **4,84 s**, y era un **autovacuum**
  (`Timeout/VacuumTruncate`), no una consulta de la aplicación.

## 4. Hechos, indicios e hipótesis

**Hechos**

- D: es un disco USB; su fsync es 4,4× más lento que C: incluso midiendo C: con penalización.
- `migrate_ms` se multiplicó por 2,6 tras el traslado del disco; las demás fases no cambiaron.
- El perfil de espera de PostgreSQL es de sincronización a disco; bloqueos y conexiones quedan descartados con datos.
- Las corridas rápidas y aprobadas son **todas** anteriores al traslado del 12-oct 15:51.
- La reproducción dirigida pasó 49/49 sin atasco: **el fallo es intermitente y no se reprodujo**.

**Indicios**

- En las corridas 1 y 3 el `SelfCheck` de ClamAV —temporizador fijo de 600 s en un contenedor ocioso— se desfasó a 2235,
  1371 y 878 s. Sugiere parones que alcanzan a procesos ajenos a las pruebas; **no demuestra** congelación total de la VM.
- El visor de eventos registra `Kernel-Processor-Power` id 37 (limitación del procesador por firmware). Indicio, no causa.

**Hipótesis no confirmadas**

- **H1 (principal)**: los timeouts de 60 s son picos de latencia del disco USB (reposo de cabezales, reinicio del bus,
  gestión de energía), que detienen a PostgreSQL y, cuando son largos, a toda la VM.
- **H2**: la fragilidad de `auth-rate-limit` (ventana de 2 s) es consecuencia, no causa: con el equipo lento, tres logins
  con hash de contraseña no caben en 2 s. Es fragilidad **de la prueba**, no del limitador, y pertenece a TECH-001/P0-002,
  no a P0-029.

## 5. Siguiente hipótesis comprobable

**Probar H1 sin tocar la máquina.** Dejar el muestreador armado y repetir el paso de pruebas hasta capturar un atasco.
Entonces clasificar por el `wait_event` del backend atascado:

| Lo que se observe en el atasco | Conclusión |
| --- | --- |
| `IO/*` (`DataFileImmediateSync`, `WALSync`, `DataFileSync`) | **H1 confirmada**: latencia del disco |
| `Lock/*` con bloqueador | H1 refutada: contención en la aplicación |
| Hueco monótono >4 s **en el propio muestreador** | El host se detiene: por encima de PostgreSQL |
| Sin actividad en PostgreSQL durante el atasco | El atasco está fuera de la base (Node, red, Docker) |

Es una prueba que distingue las cuatro causas con el mismo registro y sin modificar nada.

## 6. Propuesta de cambio (NO ejecutada; requiere autorización)

**Devolver el disco de imágenes de Docker al disco interno C: (NVMe).**

- **Valores**: de 181 a ≥794 fsync/s (medido; en volumen nativo sobre NVMe, previsiblemente bastante más).
- **Efecto esperado**: `migrate_ms` de ~7,2 s a ~2,8 s por suite; el paso de pruebas de ~542 s a ~350 s; y, si H1 es
  correcta, desaparición de los timeouts de 60 s.
- **Espacio**: C: tiene 72,1 GB libres; el disco actual ocupa 6,9 GB.
- **Riesgo, y es serio**: **este mismo movimiento ya destruyó los datos el 12-oct.** No debe hacerse sin respaldo previo
  verificado. El respaldo del 2026-10-13 ya existe (base + objetos + hashes) en `TERRA LINK EUDR 2026\_respaldos\`, pero
  **le faltan las claves `PII_*`**, que viven solo en `.env` y deben custodiarse aparte antes de mover nada.
- **Reversión**: volver a apuntar la ubicación del disco a D: desde los ajustes de Docker Desktop y restaurar desde el
  respaldo. Reversible, con la misma precaución.

**Alternativas consideradas y descartadas como solución**: `.wslconfig` ajusta memoria, CPU y swap — **no es un control de
latencia de disco** y no corrige el cuello de botella medido. Subir los timeouts de las pruebas ocultaría el problema.

No se tocó el disco de Docker, WSL, la paginación, el firmware ni la configuración de seguridad.

## 7. Qué significa para P0-029

Nada de esto afecta a los criterios de la historia. P0-029 sigue **ABIERTA por su despacho** (D-34, DD READY inalcanzable,
calidad pendiente), que es un pendiente **funcional y de producto**. La validación inestable es un pendiente **de entorno**.
Son dos cosas distintas y no deben mezclarse al evaluar el estado de la historia.
