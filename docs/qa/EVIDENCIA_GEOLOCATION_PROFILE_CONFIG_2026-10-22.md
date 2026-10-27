# Evidencia: configuración versionada de reglas para `GEOLOCATION_PROFILE` (2026-10-22)

**Mecanismo funcional terminado y demostrado; aceptación regulatoria pendiente por separado.** Esta evidencia acredita que el sistema sabe preparar, revisar, adoptar y aplicar una configuración de reglas de geolocalización. **No** acredita que exista una configuración revisada o aplicable en el entorno operativo (no la hay), ni conformidad EUDR, ni una conclusión regulatoria.

## 1. Candidatos y validaciones (registro completo, incluidos los fallos)

| Candidato | Contenido | `npm run validate` | Observación |
| --- | --- | --- | --- |
| `576aa53` | Migración `0063`, API de plataforma y de organización, aplicación al expediente, pantallas, pruebas (int, E2E) y demostración | **FALLIDA** (`2026-10-22T01-23-17-318Z`): 12 de 1060 pruebas, todas de `reports-entities` (`beforeAll` > 60 s) | **Ajena a la entrega.** Los registros muestran `commit` de 1 a 6 s y migración por suite de 16 s (frente a 11 s): latencia de disco del equipo. La suite pasa en aislado (31 s, dos veces) y hoy la latencia es normal. El E2E no llegó a correr |
| `967e1b9` | `576aa53` + arnés de pruebas con `synchronous_commit = off` en la base `*_test` | **FALLIDA** (`2026-10-22T02-11-36-054Z`): 1 de 1060, `gis-evaluation` | **Defecto propio.** La opción de URL sustituyó el `client_min_messages=warning` del producto (la URL manda sobre las opciones del Pool). Antes de confirmar solo corrí `reports-entities`, no la suite que verifica la sesión: lección registrada |
| `f0dd2f0` | `967e1b9` + las opciones de sesión del producto y la de commit combinadas | **APROBADA** (`2026-10-22T02-53-51-535Z`): 1060 pruebas, 127 E2E; árbol intacto | **Candidato final desplegado.** `/version` = `f0dd2f0`, esquema `0063_geo_configuracion_reglas_versionadas` |

Los dos registros fallidos se conservan. No se subieron timeouts ni se tocaron aserciones. El cambio del arnés solo afecta a la base desechable `*_test` (durabilidad de commit); la suite aprobada duró 2214 s en pruebas frente a 2387 s de la corrida fallida.

## 2. Qué se construyó

| Pieza | Contrato |
| --- | --- |
| **Configuración versionada** (`geo_requirement_configs`, `_sources`, `_rules`) | Inmutable. Cada regla es `ACTIVE` (el sistema sabe evaluarla con datos propios) o `CANDIDATE` (interpretación pendiente: **no se aplica**, declara qué falta). **Solo** `GEO_TECH_PROFILE` (usar la evaluación **vigente** del perfil técnico `EUDR_GEO_V1` por versión geométrica) puede estar activa; período y país de producción solo pueden ser candidatas: **no se deducen** de datos no vinculados por parcela (CHECK en base). Siembra `0.1.0` como **candidata, sin revisión ni adopción** (1 activa + 2 candidatas con sus preguntas) |
| **Revisión propia** (`geo_requirement_config_reviews` + soportes) | Es de **esta configuración y versión**: no es la revisión del perfil jurídico ni se convierte en ella (tablas, permiso y estados distintos). Registra persona revisora declarada, capacidad, fecha, fundamento, soportes y el **alcance de aplicabilidad** (organizaciones y nota de operación; vacío = ninguna): *revisada ≠ aplicable a todas*. `REVIEWED` exige soporte; vigente = la última; inmutable |
| **Adopción** (`geo_requirement_config_adoptions`) | Cada organización adopta/retira (`risk:approve_rules`). Adoptar no revisa ni declara aplicable |
| **Aplicación al expediente** | `GEOLOCATION_PROFILE` lee la configuración adoptada, su revisión vigente, la aplicabilidad **a esa organización** y las evaluaciones vigentes de `geo_profile_evaluations` (**sin evaluador paralelo**). `MET` solo con configuración adoptada + revisión favorable vigente + aplicable + **sin reglas candidatas** + todas las parcelas con evaluación vigente que cumple. Sin eso: `NOT_EVALUABLE` o `PENDING` con motivo concreto; no cumple → `INVALID`. Que la geometría cumpla el formato técnico **no basta** |
| **Trazabilidad e historia** | La instantánea guarda configuración, revisión vigente, aplicabilidad y, por parcela, la evaluación y su versión. Una objeción, retirada o evaluación nueva cambia el contenido (hash) y deja **desactualizadas** las instantáneas anteriores **sin reescribirlas** |
| **Permisos** | Plataforma `geo_config:manage` (solo `SUPER_ADMIN`: preparar y revisar). Sin permisos nuevos para concluir riesgo |
| **Pantallas** | `/plataforma/geolocalizacion` (preparar y revisar, borrador local) y `/organizaciones/{id}/geolocalizacion` (consultar, qué falta, adoptar). Español e inglés, teclado y 390 px, inspeccionados **antes** de congelar |

## 3. Comportamiento demostrado con datos sintéticos aislados

`test/geo-config.int-spec.ts` (12), `src/dd/requirements.spec.ts` (9 casos nuevos) y `e2e/tests/geolocalizacion-config.spec.ts` (8): configuración revisada y aplicable con datos completos → `MET` (condición técnica; **no** `READY`, `REGULATORY_CONCLUSION` sigue no evaluable); parcela sin evaluación vigente o con geometría nueva → `PENDING`; no cumple → `INVALID`; sin geometría → `NOT_EVALUABLE`; sin configuración, sin revisión, objetada o retirada → `NOT_EVALUABLE`; revisada pero declarada aplicable solo a otra organización → `NOT_EVALUABLE` (**fuera de alcance**); reglas candidatas → `PENDING` aunque todo cumpla; perfil técnico distinto → `NOT_EVALUABLE`; aislamiento (una organización no ve ni deduce a qué otras se declaró; adopción no cruza; 404 entre organizaciones); obsolescencia de instantáneas con conservación de lo capturado; la revisión de la configuración no cambia la jurídica ni viceversa.

## 4. Despliegue final (`f0dd2f0`) — demostración 14/14, sin aprobar nada

`e2e/review/geo-config-demostracion.mjs`: permisos (403/200), `0.1.0` conserva su estado (candidata, sin revisión, `NO_REVIEW` + `CANDIDATE_RULES_PENDING`), rechazos sin escritura al preparar y revisar, 403 a la administración, adopción de versión inexistente rechazada, **9 instantáneas existentes siguen con `GEOLOCATION_PROFILE = NOT_EVALUABLE`** (valores guardados), la base rechaza una regla activa de período/país y una favorable sin soporte, estado de datos idéntico (1 configuración, 3 reglas, 0 revisiones, 0 adopciones, 13 instantáneas, 0 revisiones jurídicas), pantallas es y en a 390 px (radios de 20 px, motivos y botones dentro del ancho, sin desborde ni códigos internos) y control de permiso de rol. Un primer intento del guion falló por un defecto del propio guion (medía una caja tras cerrar la página); se corrigió y se repitió sobre el mismo despliegue.

## 5. Respaldo de `0063`

`_respaldos/2026-10-22-geo-config-0063/` (base, objetos, `claves.env` restringido, `estado-actual.txt`, `SHA256SUMS.txt`). Restauración aislada sin seed ni migraciones: 63 migraciones; conteos idénticos (22 organizaciones, 23 lotes, 1 configuración, 3 reglas, 0 revisiones, 0 adopciones); 10 triggers del mecanismo; `0.1.0` con 2 candidatas; la copia rechaza una regla activa de período. Entorno eliminado; 27 volúmenes intactos.

## 6. Qué NO se hizo (y queda pendiente por separado)

No se preparó, revisó ni adoptó ninguna configuración real; ningún expediente real cambió de estado; no se decidió Q4 (qué es «satisfecho»: período, país): sigue siendo decisión del revisor, y cuando se resuelva se prepara una **versión nueva** sin candidatas. Pendientes de aceptación: la revisión real y su aplicabilidad (`INDICE-REVISION-REGULATORIA.md` Q1–Q7), D-09.B (satélite real, deshabilitado), D-07.6. Android pospuesto; roles y compuertas sin cambio.
