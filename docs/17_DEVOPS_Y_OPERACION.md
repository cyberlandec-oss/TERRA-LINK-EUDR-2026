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
