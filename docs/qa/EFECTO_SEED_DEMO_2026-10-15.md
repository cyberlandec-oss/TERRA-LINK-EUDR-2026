# Qué modificó realmente el seed DEMO del 2026-10-15 (revisión posterior)

El `seed:demo` de esa tarde terminó con **código de salida 1** y el mensaje
«No se pudo escribir CREDENCIALES.csv (EBUSY)». De ahí **no** se sigue ni que toda la operación fallara ni que los
datos quedaran intactos: son dos conclusiones distintas y ninguna estaba demostrada. Esto es el contraste.

## 1. De dónde viene el código de salida 1

En el camino normal del seed hay exactamente **dos** sitios que ponen `process.exitCode = 1`:

| Causa | ¿Ocurrió? |
| --- | --- |
| No poder escribir `CREDENCIALES.csv` | **Sí.** `EBUSY`: el archivo está abierto en otro programa |
| Alguna cuenta sin login verificado (`ok !== verified.size`) | **No.** La salida dice `login verificado 19/19` |

El código 1 es **de la escritura del archivo**, no de las operaciones de datos, que ocurren antes y no se
revierten por ello. El propio mensaje lo dice: deja `CREDENCIALES.pendiente.csv` y pide cerrar y renombrar.

## 2. Qué archivo logró guardar

| Archivo | Última escritura | Estado |
| --- | --- | --- |
| `CREDENCIALES.csv` | **2026-10-14 19:08** | **Bloqueado** (abierto en otro programa). No se actualizó en ninguna de las dos ejecuciones del 2026-10-15 |
| `CREDENCIALES.pendiente.csv` | **2026-10-15 17:07** | **Escrito correctamente**. Es el archivo vigente |

El resumen del seed dice «22 filas en `CREDENCIALES.csv`»: describe **lo que compuso**, no dónde quedó. Fue a
parar al pendiente.

## 3. Qué creó

Ventana desde las 21:50 UTC del 2026-10-15 (inmediatamente antes de la primera ejecución):

| Evento / tabla | Cantidad | Cuándo (UTC) |
| --- | --- | --- |
| `RiskRuleSetAdopted` · `risk_rule_set_adoptions` | **1** | 22:07:51 — primera ejecución |
| `RiskEvaluationRecorded` · `risk_evaluations` | **2** | 22:09:05 — segunda ejecución |
| `users`, `organizations`, `lots`, `deliveries`, `plots`, `producers`, `mitigation_actions`, `dd_snapshots` | **0** | — |

Y en la bitácora, en esa misma ventana: `risk.rule_set_adopt` ×1, `risk.evaluate` ×2, y nada más aparte de
inicios de sesión (las verificaciones `19/19` de cada ejecución).

Esto encaja con lo observado: la **primera** ejecución adoptó el catálogo pero no evaluó nada, porque el seed solo
evaluaba lotes **sin** evaluación; la **segunda**, ya con el seed corregido, reevaluó los dos lotes que la
adopción había dejado `STALE`.

## 4. Qué actualizó

**No se observa ninguna actualización** fuera de las altas anteriores: ningún evento de dominio ni acción de
bitácora distintos de los listados, y ninguna fila nueva en las tablas operativas.

### Límite declarado: `updated_at` no sirve como testigo

La comprobación evidente —«¿qué filas tienen `updated_at` reciente?»— devuelve **cero** en las ocho tablas que
tienen esa columna. **No es prueba de nada**, y se puede demostrar: la rotación de credenciales del 2026-10-16
cambió `password_hash` y `token_version` de **cinco** usuarios, y `users.updated_at` **no se movió**. Esa columna
no la mantiene toda escritura.

Por tanto, la afirmación sostenible es la de arriba: **no hubo altas fuera de las tres, ni eventos, ni acciones
auditadas**. Una actualización de columnas que no emita evento, no quede en bitácora y no cree filas **no puede
descartarse con esta evidencia**.

### Lo que falta para cerrarlo del todo

**No existe un estado previo suficiente**: no se tomó una instantánea completa de la base inmediatamente antes de
la primera ejecución, y el respaldo disponible es anterior. Sin eso, un cotejo fila a fila no es posible. Se
declara el límite en vez de presentarlo como comprobado.

**No se revierte nada ni se reconstruyen registros.** Lo creado —una adopción y dos evaluaciones— es exactamente
lo que el seed debía crear, y las evaluaciones anteriores (`0.2.0`, `NOT_ASSESSED`) siguen en su sitio con su
número: reevaluar crea registros nuevos, no reescribe los viejos.

## 5. Qué cambiar para la próxima vez

El mensaje final del seed informa de lo que **compuso**, no de dónde quedó, y eso fue lo que indujo a leer «22
filas en `CREDENCIALES.csv`» como un hecho. Merece decir el archivo real. Queda anotado; no se cambia aquí para no
mezclarlo con la corrección de credenciales.
