# Plan de QA y definición de terminado

Base: S1 §§70–74, 98–99, 115; todas las pruebas de esta entrega están especificadas, NO EJECUTADAS. No inferir números históricos de suites ni aprobación del repositorio.

## Orden de trabajo para un cambio funcional (acordado el 2026-10-15)

**Código terminado → commit → `npm run validate` sobre ESE SHA → documentación de resultados en un commit
posterior.** La corrida acredita entonces un **commit concreto**, y deja de hacer falta razonar sobre la
correspondencia entre el árbol probado y el guardado. Las entregas anteriores se hicieron al revés —validar y
después confirmar— y conservan su explicación de correspondencia; no se reescribe el historial.

## Estrategia

Unitarias para invariantes; integración con PostgreSQL/PostGIS reales para transacciones/autorización; contratos API para serialización/errores; UI/E2E para workflows; dispositivo Android para persistencia/GPS/fotos/offline. Dobles de proveedores externos identificados como tales. Datos de prueba sintéticos y organización A/B separadas.

## Casos de aceptación

| ID | Escenario | Resultado exigido |
| --- | --- | --- |
| QA-01 | Login, membresía, suspensión, rol efectivo e intento de asignar SUPER_ADMIN por org admin | Rechazo donde no hay permiso; auditoría sin secreto |
| QA-02 | A solicita IDs/listas/grafo/snapshot/plots/export/download/job de B; A envía FK de B; buyer con grant vencido | Sin datos cruzados, objeto privado y resultado consistente 403/404 según política |
| QA-03 | Productor nuevo/existente, mismo código dos tenants, Excel válido/erróneo/repetido | Unicidad por tenant; preview sin mutar; commit no duplica ni borra campos no incluidos |
| QA-04 | GPS/polígono/CRS/área/umbral/precisión desconocida/GeoJSON | Validación con motivos/regla, no superficie inventada de punto. **Ejecutado** en `apps/api/test/gis-evaluation.int-spec.ts` y `geometry-imports.int-spec.ts`; el **umbral** (debajo, **exactamente igual** y encima) y el **perfil técnico de destino** (D-05.A, 2026-10-15) en `apps/api/test/geo-profile.int-spec.ts`, con los dos dictámenes en pantalla en `e2e/tests/geojson.spec.ts`. **Cumplir el perfil técnico no es conformidad**, y no se ha probado contra el servicio real del destino |
| QA-05 | Entrega 500 kg, recepción parcial/completa, evento repetido, corrección | Peso declarado/real separados; hito/KDE y un único efecto. **Ejecutado** en `apps/api/test/deliveries.int-spec.ts`; el **cierre con diferencia y motivo** (D-33, 2026-10-15) en `apps/api/test/d32-d33.int-spec.ts` |
| QA-06 | Inputs 500 + 300 kg, pérdida 50, output 750; intento output 850; consumos/reservas concurrentes | Conservación; exceso rechazado; transacción impide saldo negativo/doble consumo. **Ejecutado** en `apps/api/test/lots.int-spec.ts` e `inventory.int-spec.ts`; el **cierre de secado con humedad obligatoria** (D-32, 2026-10-15) en `d32-d33.int-spec.ts` |
| QA-07 | Parcela → entrega → lote → proceso → output → embarque y recorrido inverso | Todos los orígenes conservados, cantidades/unidades, sin ciclos ni datos ocultos filtrados. **Ejecutado** en `apps/api/test/recorrido-integral.int-spec.ts` (base aislada, datos sintéticos); alcance y bloqueos en `docs/qa/MATRIZ_RECORRIDO_INTEGRAL.md` |
| QA-08 | Captura offline, cierre forzado, reboot, 7 días simulados, retry, adjunto interrumpido y conflicto | Persistencia sin pérdida, misma operación una vez, dependencias/conflicto visibles |
| QA-09 | Archivo limpio/malicioso/MIME engañoso, escáner caído, nueva versión y vencimiento | Cuarentena/estado correcto, descarga autorizada y evidencia vigente explícita |
| QA-10 | Inputs faltantes, score bajo con factor crítico, regla/dataset/geometría nueva, job antiguo | No conclusion automática; evaluación versionada reproducible, resultado antiguo no pisa nuevo. **Ejecutado** en `apps/api/test/risk.int-spec.ts`; los **mecanismos D-07** (adopción por organización, severidad por máximo con cobertura, A.2 sin hallazgos, desactualización) en `apps/api/test/d07-mecanismos.int-spec.ts` (16). **No hay score**: D-07.3 no aplica y el modelo no admite pesos |
| QA-11 | Crear/asignar mitigación, aportar soporte, verificar/rechazar y separación de funciones | Transiciones autorizadas; cola actualizada por acción real y reevaluación documentada |
| QA-12 | DD con datos faltantes, mitigación no verificada, READY, export, cambio posterior y timeout oficial | Guard bloquea; snapshot/manifest; STALE/nueva revisión; descarga no implica submission |
| QA-13 | Crear/corregir/aprobar/descargar/exportar/cambiar permiso; reporte | Historial con actor/tiempo/versiones, redacción y permiso de exportación |
| QA-14 | Home por permiso, links, sección 403, vacío/error/loading, teclado y acción My Work | UI distingue estados; navegación segura; tarea sale al resolver dominio |
| QA-15 | Satélite ok/timeout/rate limit/no coverage, redirects y URL maliciosa | Proveniencia; fallo explícito; credencial no sale a destino ajeno; ningún verde falso |
| QA-16 | Restaurar DB+objetos en entorno aislado y ejecutar recorrido | Snapshot consistente, archivos disponibles y tiempos/RPO/RTO medidos |
| QA-17 | Piloto una asociación con 20–50 productores, 20–100 parcelas y 1–3 lotes | Flujo con operadores, sin cambios DB manuales para completar operaciones |

## Ejemplo de conservación y concurrencia

Recepciones 500 + 300 = 800 kg. Proceso consume 800, produce 750 y registra 50 de merma. Output con reserva 300 deja 450 no reservados. Despachar 300 reduce físico a 450 y elimina esa reserva, sin volver a descontar 300 por cancelarla. Dos solicitudes simultáneas de 500 del output no pueden ambas aceptarse. Verificar con DB real y barrera concurrente; un mock secuencial no demuestra protección.

Secado cambia contenido de agua; inputs/outputs pueden ser estados distintos del producto. El rendimiento se conserva por transformación y pérdida documentada, no por una conversión de unidades inventada.

## Comprobaciones críticas de seguridad

Enumerar métodos GET/POST/PATCH/DELETE de recursos operativos, vistas agregadas, referencias de body, snapshots, GeoJSON, objetos, jobs y webhooks. Prueba positiva A→A junto a negativa A→B, para evitar «seguridad» obtenida rompiendo todo acceso. Buyer y auditor según grants; superadmin con elevación explícita. Mutación dirigida del tenant filter o del guard de stock puede demostrar que el test detecta el fallo; no exigir mutation testing general para cada cambio menor.

## Evidencia requerida

Por ejecución: commit/rama, entorno, comando exacto, hora, resultado, versión relevante, dataset sintético y artefacto/log redactado. Prueba no ejecutable por dependencia faltante se marca BLOQUEADA con motivo. Fotos/screenshots de Android cuando demuestran captura y persistencia, evitando datos personales reales.

## Definition of Done

Historia ligada a RF y fuente/ADR; criterio demostrado; dominio/API/persistencia/autorización/auditoría integrados; UI/offline cuando aplica; migraciones revisadas; errores recuperables; pruebas pertinentes verdes; documentación y comandos actualizados; limitaciones declaradas. Compilar no demuestra DB/GIS/offline.

Gates de conformidad regulatoria, integración oficial, Android real y producción se registran separadamente. Nunca usar «todas las pruebas pasan» si no se ejecutaron todas las requeridas o si solo pasó una suite unitaria.

## Validación local (etapa vigente)

**QA por cuenta y cadena (2026-10-30).** `e2e/review/qa-cuentas-matriz.mjs` (todas las cuentas del archivo de credenciales vigente × su organización activa: permisos = catálogo, menú = esperado, lectura permitida, rechazos con cuerpo válido sin efecto en los datos) y `e2e/review/qa-cadena-distribuida.mjs` (productor → técnico → acopio → calidad → lote → expediente → soportes → comprador → auditoría y la autorización satelital). Resultados y límites en `qa/EVIDENCIA_QA_INTEGRAL_CUENTAS_Y_CADENA_2026-10-30.md`. Un 400 por validación no acredita autorización: los sondeos usan cuerpos válidos y se acompañan de un control autorizado.

La verificación de cierre se ejecuta en el equipo local con `npm run validate` (docs/20): servicios de desarrollo, typecheck, lint, build, OpenAPI validado, unitarias + integración contra PostgreSQL/PostGIS y Redis reales (base `terra_link_test`) y E2E en Chromium (base `terra_link_e2e`). Resultados en `validation-results/<fecha>/resumen.md`. Las mismas comprobaciones que el workflow de Actions inactivo (`infra/ci/github-actions-ci.yml`), ejecutadas localmente. DONE_LOCAL no sustituye los gates de producción, Android real ni conformidad.
