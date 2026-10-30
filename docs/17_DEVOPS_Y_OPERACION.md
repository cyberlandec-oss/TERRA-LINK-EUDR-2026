# DevOps, seguridad y operación

FUENTE: S1 §§75–81, 105, 115. Propuesta operativa que debe ajustarse a infraestructura y comandos detectados.

## Entornos

Development, staging y production separados: bases, objetos, colas, usuarios, secretos y credenciales externas independientes. Docker para reproducibilidad; no nombres de servicio asumidos. PostgreSQL/PostGIS y object storage con volúmenes conocidos, persistencia y health checks. Redis puede ser infraestructura de cola/cache, pero no historial definitivo.

No copiar PII de producción a desarrollo. Datos sintéticos/anonimizados y cuentas de QA locales. Contraseñas de ensayo no deben estar en Markdown ni commits. `.env.example` contiene nombres y valores de ejemplo no sensibles; validar presence/tipo sin imprimir valores.

## CI propuesto

Etapa vigente: validación local con `npm run validate` (docs/20). El workflow de GitHub Actions queda como referencia inactiva en `infra/ci/github-actions-ci.yml` y se podrá reactivar en una etapa posterior.

PR → lint/format-check → type/static-check → unitarias → integración DB/PostGIS → pruebas de seguridad pertinentes → contratos → build → staging → E2E → gate de producción. Usar checks concretos del repo y lockfile; cache no comparte datos/credenciales entre tenants.

Especificar qué pruebas requieren servicios externos y qué fixtures se usan. Pipeline rojo no se «arregla» ignorando tests o habilitando flags que omiten validación. Versiones de runtime/dependencias deben fijarse en manifests y mantenerse con actualización comprobada.

## Migraciones

Toda modificación del esquema va en migración versionada. Probar desde base vacía y esquema anterior; para cambios destructivos, estrategia expand/migrate/contract y backup/restauración. No editar una migración compartida ya aplicada. Separar migración de despliegue web; valorar compatibilidad API/worker/versiones en circulación.

El agente puede generar/revisar/probar migraciones en entorno aislado dentro del alcance autorizado. Producción requiere entorno y autorización explícitos; no ejecutar por copiar el paquete.

## Observabilidad

Logs estructurados con request/correlation/job/tenant IDs sin PII/secretos. Métricas de HTTP, DB, cola/retry/DLQ, sync/conflictos, objetos/escaneo, jobs satelitales y fallos de autorización. Health de vida del proceso, readiness de dependencias necesarias y version con commit/build real. Sin strings de conexión ni claves en mensajes públicos.

Métricas de negocio se obtienen de consultas reales y alcance autorizado. «Productores totales» puede contar entidad activa y no filas borradas; definir periodo/denominador. Alertar por corrupción/negativos, fallos de sync prolongados, escaneo caído y backup fallido.

## Restauración y continuidad

Backups DB, opción de PITR evaluada y object storage versionado. Probar restauración conjunta con manifest/checksums; snapshots de DB sin bytes referenciados no bastan. RPO/RTO propuestos se fijan con responsable según impacto/coste y se miden, no se prometen aquí. Ejercicio en ambiente aislado con evidencia QA-16.

**Definiciones de RNF-06 (no se mezclan).**
- **Objetivo** (RPO: cuánta pérdida de datos se tolera; RTO: cuánto tarda en volver a operar): lo fija un **responsable** según impacto y coste. Hoy **no hay ninguno fijado**; este repositorio no inventa valores.
- **Tiempo observado**: lo que midió una restauración concreta, con su volumen y su entorno. Describe esa ejecución; no es un objetivo ni se extrapola a otro volumen. Observados hoy: QA-16 (2026-10-15, dump de 538 KB, 2 objetos): volcado 3 s, arranque aislado 6-8 s, `pg_restore` 13-14 s, verificación < 2 min; respaldo `2026-10-20-a01-mapa-fotos-0057` (137 tablas, 1191 objetos): coherencia verificada, **sin tiempos registrados**. El **RPO observado** de un respaldo manual es la antigüedad del respaldo; no hay frecuencia declarada.
- **Aceptación**: decisión del responsable de que los tiempos observados cumplen el objetivo fijado, con el volumen que declare. Sin objetivo no hay qué aceptar; RNF-06 **no está aceptado**, aunque la restauración coherente de base y objetos sí está evidenciada.

## TECH-001 y piloto: objetivos que requieren decisión (D-15), propuesta y mediciones (2026-10-30)
**Nada de esta sección es un objetivo adoptado ni una aceptación.** Ninguna fuente fija p95, SLO, RPO ni RTO: S1 §98 fija la **escala** del piloto (1 asociación, 20–50 productores, 20–100 parcelas, 1 centro de acopio, 1–3 lotes) y S1 §99 su éxito como el recorrido productor → parcela → entrega → lote → riesgo → evidencia → paquete DD **sin intervención de los desarrolladores**; no mencionan latencia ni recuperación. Las filas «propuesta» son el método y la forma de decidir; los números los fija el responsable. Los criterios originales (RNF-05, RNF-06, QA-16) no cambian.

### 1. Tiempos ya observados (no son objetivos; no se extrapolan)
| Qué | Valor observado | Volumen y entorno | Límite |
| --- | --- | --- | --- |
| Restauración aislada QA-16 (2026-10-15) | volcado 3 s · arranque aislado 6-8 s · `pg_restore` 13-14 s · verificación < 2 min · API operativa 7 s | dump de 538 KB, 2 objetos | volumen muy inferior al piloto |
| Restauración del respaldo `2026-10-20-a01-mapa-fotos-0057` | coherencia verificada (137 tablas, 53 productores descifrados, 1191 objetos con la misma huella) | 1191 objetos | **no consigna tiempos** |
| Una traza real | `GET …/producers` 4 ms, 2 tramos de base | una petición, base de desarrollo | una sola observación, sin distribución ni carga |
| Volumen local actual | 11 productores, 14 parcelas, 7 lotes, base de 28 MB | base de desarrollo | por debajo del piso del piloto en productores y parcelas |
| Entorno de medición | el almacenamiento de Docker está en un **disco USB mecánico** (`docs/qa/DIAGNOSTICO_VALIDACION_INESTABLE_2026-10-13.md`) | este equipo | **no es representativo** de una operación real: medir p95 aquí no acredita nada del piloto |

No existe ninguna medición de carga ni de p95 con dataset de piloto.

### 2. RNF-05 (rendimiento): propuesta
- **Qué decide el responsable:** (a) las **clases de operación** con objetivo; (b) para cada una, el p95 admisible; (c) la **carga de referencia** (usuarios simultáneos) y (d) el entorno donde cuenta la medición.
- **Propuesta de clases** (los recorridos del piloto de S1 §99, interactivos y propios de Terra Link): iniciar sesión; listar y abrir productor/parcela/lote; descarga del dataset móvil (`GET /sync/pull`) y envío (`POST /sync/push`); importar y exportar GeoJSON; evaluación GIS; generar el paquete DD interno y descargarlo; descargar un documento. **Se excluye del objetivo propio** el análisis satelital externo (depende del proveedor; se informa su tiempo, no se compromete).
- **Orden de decisión (igual que en RNF-06):** (1) la **tolerancia del negocio** —cuánto espera una persona del piloto en cada acción y qué carga habrá—; (2) el **objetivo** p95 por clase, que fija el responsable; (3) la **estrategia** si hiciera falta (índices, caché, tamaño de página, recursos del servidor); (4) la **medición** y (5) la **aceptación**. La línea base con el dataset del piloto **informa** al responsable de lo que hoy hay, pero no sustituye a su tolerancia: un p95 fijado como «lo medido más un margen» solo es válido si el responsable lo adopta como su objetivo. Hasta entonces no hay umbral que aprobar.
- **Fundamento:** RNF-05 pide medir el dataset del piloto y la carga con budgets «acordados en TECH-001, sin promesa inventada»; la instrumentación necesaria ya existe (RNF-13: `/metrics` con histogramas por ruta en patrón y trazas por `request_id`, `docs/20`).
- **Mediciones que cierran RNF-05:** (1) línea base por clase con el dataset del piloto y un usuario; (2) carga con N usuarios simultáneos (N lo aporta la organización); (3) comparación con los p95 adoptados; (4) aceptación escrita del responsable. La herramienta de carga **ya existe y está comprobada** (sección siguiente); lo que falta es el dataset, N y los objetivos.

### 3. RNF-06 (recuperación): propuesta
- **Orden de decisión (no se invierte):** (1) la **tolerancia del negocio** —cuánta pérdida de datos y cuánto tiempo sin el sistema soporta la organización, por jornada y por temporada—; de ella salen (2) los **objetivos** RPO y RTO que fija el responsable; después (3) la **estrategia** capaz de cumplirlos (frecuencia y tipo de respaldo, restauración); y por último (4) la **medición** que comprueba si la estrategia los cumple y (5) la **aceptación**. Una estrategia disponible (por ejemplo, el respaldo manual que ya existe) **no** define el objetivo: se evalúa contra él.
- **Propuesta para el RPO:** partir de la tolerancia declarada por la organización (cuánto trabajo de campo ya sincronizado es aceptable repetir). **Con esa cifra**, elegir la estrategia: respaldo manual por jornada, programado diario o PITR (esta última «evaluada» en esta sección y no probada) y fijar su frecuencia. Con D-40 en A (captura hasta 1 h; los pendientes se conservan en el teléfono hasta enviarse) lo no sincronizado **no** se pierde por un fallo del servidor, lo que reduce lo que la estrategia debe cubrir; no fija el objetivo.
- **Propuesta para el RTO:** partir de cuánto tiempo sin el sistema tolera la organización (jornada de acopio, plazos de entrega). Con esa tolerancia fijar el objetivo; **después** medir una restauración con el volumen que declare el responsable, con el procedimiento ya verificado (QA-16, `docs/20`): volcado, arranque, restauración, verificación y aplicación operativa, cada fase con su tiempo, y compararla con el objetivo. Una única restauración a ese volumen, no repetidas por rutina.
- **Mediciones que cierran RNF-06:** restauración coherente de base y objetos (**ya evidenciada**); tiempos por fase al volumen declarado; RPO observado (antigüedad del último respaldo al instante del fallo simulado); comparación con los objetivos adoptados; aceptación escrita del responsable.

### 4. Lo que debe aportar la organización piloto
| Dato | Para qué sirve |
| --- | --- |
| Productores, parcelas, lotes y documentos reales o su cifra (S1 §98: 20–50 / 20–100 / 1–3) | Dataset de medición de RNF-05 y volumen de RNF-06 |
| Usuarios simultáneos esperados y sus roles, y las horas pico (cosecha, entrega, cierre) | Carga de referencia N |
| Condiciones de conectividad en campo y modelos de teléfono | Ensayo físico y sincronización realista |
| Tolerancia a perder trabajo y a estar sin el sistema (por jornada, por temporada) | Insumo para fijar RPO y RTO |
| Responsable nombrado que acepta o rechaza los objetivos | Sin él no hay aceptación |
| Entorno de operación (alojamiento, almacenamiento de respaldos, retención) | Dónde cuenta la medición; la de este equipo no vale |
| Participantes y fecha de capacitación | P0-031 |

### 5. Qué sigue pendiente (no se declara aceptado)
Objetivos p95/SLO y RPO/RTO sin fijar; sin medición con dataset de piloto; sin carga; sin organización piloto. RNF-05 y RNF-06 **no están aceptados**.

### Herramienta de carga (RNF-05): comprobada como herramienta; rendimiento de la plataforma **no medido**
- **Qué hay:** `scripts/carga-piloto.mjs` (sin dependencias), su prueba `scripts/carga-piloto.test.mjs` y la plantilla `scripts/carga-piloto.plantilla.json`. Comandos: `npm run carga:prueba` (comprueba la herramienta) y `npm run carga -- --config <archivo.json> [--salida <carpeta>] [--validar]`.
- **Comprobado (2026-10-30):** 10/10 pruebas contra un servidor **controlado** creado por la propia prueba (puerto efímero, sin DEMO, sin servicios externos, sin usuarios ni tokens reales): percentiles; latencias, muestras y causas de fallo; **un fallo rápido (HTTP 500 en ~1 ms) no cuenta como respuesta satisfactoria**; timeouts y errores de red; el p95 «penalizado» (cada fallo cuenta con el timeout completo) es el que se compara con un objetivo; sin objetivos **informa y no emite veredicto**; con objetivos compara con los de entrada y **nunca dice «aprobado»**; rechaza el DEMO local (puertos 3000/4000), destinos no locales sin confirmación y escrituras sin declarar; no corre si falta una entrada; el token se usa pero no aparece en ninguna salida. **No comprueba el rendimiento de Terra Link.**
- **Entradas explícitas (sin valores por defecto):** entorno y si es representativo del piloto, dataset declarado (productores, parcelas, lotes), concurrencia, duración, calentamiento, timeout, operaciones con su estado esperado y peso, y objetivos opcionales (`p95_ms`, `max_tasa_error`, `min_muestras`). La plantilla trae todo en `null`: no es utilizable tal cual y **ningún valor suyo es un objetivo aprobado**.
- **Operaciones de la plantilla** (rutas de `apps/api/openapi.json`; todas GET, sin escribir en el destino): listar productores, parcelas y lotes; descarga del dataset móvil (`sync/pull`); exportar GeoJSON; consultar evaluaciones GIS; abrir un expediente DD; descargar un documento. **Fuera de la plantilla, por escribir datos o por ser externas:** inicio de sesión, `sync/push`, importar GeoJSON, crear la evaluación GIS, generar y exportar el paquete DD y el análisis satelital externo. Se añaden con `mutante: true` y `permitir_mutaciones: true` solo en un entorno de piloto desechable.
- **Ejecución posterior con el dataset y la concurrencia del piloto:** (1) un entorno de piloto representativo, **no** el equipo de desarrollo ni el DEMO; (2) cargar allí el dataset declarado; (3) un token de una cuenta del piloto en la variable de entorno indicada (nunca en el archivo); (4) completar la plantilla con los identificadores y las entradas; (5) `--validar`; (6) primero una línea base con concurrencia 1, luego con la concurrencia N que aporte la organización; (7) el resultado queda en `validation-results/carga-<fecha>/` (`resultado.json`, `resumen.md`; ignorado por Git: se archiva la evidencia que corresponda); (8) el responsable acepta o rechaza frente a los objetivos que haya fijado.
- **Límites:** cada ejecución mide el entorno que se declaró, no «la plataforma»; carga con trabajadores en bucle cerrado desde un solo proceso Node (suficiente para la escala del piloto de S1 §98; una carga mayor exigiría otra herramienta); el servidor y el cliente en la misma máquina se influyen entre sí.

## Seguridad mínima

TLS, autenticación vigente, autorización de recurso, rate limits, input/schema validation, consultas parametrizadas, protección XSS y CSRF según auth elegida, escaneo de archivos, aislamiento, secrets manager, auditoría, mínimo privilegio DB/objects. Cookies/sesión y CORS según flujo real; no wildcard con credenciales por comodidad.

Jobs y providers aplican egress y defensa SSRF. Las reglas Markdown no sustituyen políticas de red ni pruebas. Auditar permisos de admin, acceso soporte, claves, invitaciones y compartición. No registrar secretos en before/after.

## Checklist previo a operación real

- Despliegue reproducible con commit, runtime y versiones conocidos.
- Migraciones/rollback y restauración ejecutados, con datos/objetos coherentes.
- Aislamiento/privacidad y permisos probados, incluido comprador/exports.
- Monitoreo/alertas y responsable de respuesta activos.
- Sesión offline y dispositivo real aceptados; incidentes tienen recuperación.
- Perfil regulatorio revisado; funcionalidad y conformidad acreditadas por separado.
- Manual operacional y capacitación, contratos de proveedores, límites/costes y canal de soporte.

Este listado es parte del alcance productivo del proyecto, no autorización para desplegar o presentar declaraciones oficiales durante una tarea de código.
