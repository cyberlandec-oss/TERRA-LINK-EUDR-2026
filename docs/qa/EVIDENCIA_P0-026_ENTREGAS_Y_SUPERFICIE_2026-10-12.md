# Evidencia: superficie declarada que conserva la geometría y plantilla de entregas (2026-10-12)

Repositorio `D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025`, remoto `cyberlandec-oss/TERRA-LINK-2025`, rama
`feat/tech-001-ci-p0-002`. Equipo local, Docker (proyecto `terra-link`, mismos volúmenes), PostGIS real, datos DEMO y
**archivos sintéticos**. No acredita producción, validación GIS, D-05, uso con un Excel real ni conformidad EUDR.

## Resultados

| Verificación | Resultado | Registro |
| --- | --- | --- |
| `npm run validate` (servicios, typecheck, lint, build, OpenAPI validado, unitarias + integración, E2E) | **APROBADA** | `validation-results/2026-10-12T05-08-43-805Z` |
| Superficie declarada (`test/plot-declared-area.int-spec.ts`) | 7/7 | dentro de la validación |
| Importación de entregas (`test/imports-deliveries.int-spec.ts`, con fixtures de autorización) | 11/11 | dentro de la validación |
| Importación de parcelas actualizada (superficie sobre geometría ya no se rechaza) | 13/13 | dentro de la validación |
| Regresión parcelas, GIS, captura, GeoJSON, sync, riesgo, entregas, lotes, inventario, KDE, DD e importaciones | aprobada (74 + 76) | ejecuciones previas a la validación |
| Navegador, entregas (`e2e/review/importaciones-entregas.mjs`) | 10/10 | `docs/qa/importacion/revision-entregas.json`, capturas `en01`–`en08` |
| Navegador, regresión de productores, productos y parcelas | aprobadas | `revision*.json` |

## Superficie declarada (adopción para desarrollo local)

Polígono: versión nueva con geometría idéntica byte a byte, mismo hash, misma superficie calculada, mismos datos de
captura y origen en la versión capturada; versión anterior intacta; una segunda actualización apunta a la captura original
· punto capturado: conserva la muestra de ubicación de la captura (no se crea otra) · sin geometría: versión DECLARED
como antes · el formulario `geometry-versions` DECLARED usa el mismo caso de uso · historial `DECLARED_AREA`, evento
`PlotDeclaredAreaUpdated` sin coordenadas · evaluaciones GIS anteriores intactas y la nueva versión sin evaluar ·
NO_CHANGE, VERSION_CONFLICT y concurrencia (una gana) · rollback por fallo en auditoría · auditoría 403, técnico fuera de
asignación 404 · la base rechaza una copia con otra geometría.

## Entregas

Plantilla y permisos (admin y MANAGER sí; recepción y técnico sin `import:manage` 403; otra organización 404) · periodos
día, intervalo de días, mes, intervalo de meses y desconocido guardados como se declaran; sin periodo no se deduce de la
fecha · errores por fila: productor inexistente o en borrador, producto inexistente o inactivo, centro inexistente,
parcela de otro productor, cantidad sin unidad, LB, «1,5», cero, fecha numérica, filas idénticas sin código, periodos
inválidos · alta de borradores con peso declarado en KG y orígenes, **sin** recepción, pesaje, compuerta de registro,
soporte, muestra, inventario ni eventos de entrega · reimportación: «ya importada», sin duplicar · actualización por
código: mapeo parcial, vacío no borra, `#BORRAR` quita, orígenes reemplazados; sin cambios no hay efectos; el productor no
cambia · registrada: igual → sin cambios, distinta → `DELIVERY_REGISTERED` y nada cambia · fixtures: entrega y productor
fuera de la asignación e inexistentes → respuestas idénticas · revalidación: versión cambiada y asignación retirada →
`PREVIEW_STALE`, permiso retirado → 403 · rollback forzado en la segunda fila · concurrencia: una sola entrega ·
aislamiento entre organizaciones.

## Navegador

Entregas: plantilla y aviso «solo borradores»; archivo con 4 errores no confirmable; archivo válido confirmado **solo con
teclado** («Creados 2 (estado borrador)»); en la base, recepciones/pesajes/muestras/inventario/eventos de
entrega/compuertas sin cambios (`2/2/1/7/2/7 → 2/2/1/7/2/7`); 390 px: reimportación «ya se importó», 0 px de
desplazamiento; MANAGER habilitado; recepción y técnico denegados.

## Observaciones

- Anomalía de tiempo no reproducida en la primera ejecución de la prueba de entregas (690 s, fuera del arnés); ver `docs/20`.
- Durante la preparación se mostraron por error en la salida de un comando local dos contraseñas DEMO de
  `CREDENCIALES.csv` (cuentas `recepcion.acopio` y `calidad.acopio`). No se versionaron. Rotación disponible con
  `npm run seed:demo -w apps/api -- --rotar=<cuenta>`; no se ejecutó (las credenciales se conservan salvo instrucción).

## Registros DEMO creados

`ENT-2026-00004` y `ENT-2026-00005` (borradores). Procedencia en `docs/qa/importacion/PROCEDENCIA_DATOS_DEMO_IMPORTADOS.md`.
APK `9996a9b4…` intacta; no se recompiló Android. Ensayo físico: NO EJECUTADO.
