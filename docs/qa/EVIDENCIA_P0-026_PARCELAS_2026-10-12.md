# Evidencia P0-026: plantilla de parcelas (2026-10-12)

Repositorio `D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025`, remoto `cyberlandec-oss/TERRA-LINK-2025`, rama
`feat/tech-001-ci-p0-002`. Equipo local, Docker (proyecto `terra-link`, mismos volúmenes), PostGIS real, datos DEMO y
**archivos sintéticos**. No acredita producción, uso con un Excel real de una asociación, validación GIS ni D-05.

## Resultados

| Verificación | Resultado | Registro |
| --- | --- | --- |
| `npm run validate` (servicios, typecheck, lint, build, OpenAPI validado, unitarias + integración, E2E) | **APROBADA** | `validation-results/2026-10-12T04-15-47-909Z` |
| Integración parcelas (`test/imports-plots.int-spec.ts`, incluye fixtures de autorización) | 13/13 | dentro de la validación |
| Importación de productores, productos, fixtures y lector XLSX | 11 + 11 + 3 + 7 | dentro de la validación |
| Regresión de parcelas, GeoJSON, captura de ubicación y polígonos tras extraer `createInTx`/`updateInTx` | aprobada (87/87 con las anteriores) | ejecución previa a la validación |
| Navegador, parcelas (`e2e/review/importaciones-parcelas.mjs`) | 9/9 | `docs/qa/importacion/revision-parcelas.json`, capturas `pa01`–`pa08` |
| Navegador, regresión de productores y productos | aprobadas | `revision.json`, `revision-productos.json` |

## Casos de integración

Plantilla: admin y MANAGER autorizados; técnico y auditor (sin `import:manage`) 403; otra organización 404; sin columnas
de coordenadas · errores por fila: código repetido, productor inexistente, productor de baja, cultivo y productor
obligatorios en altas, «2,5» (sin interpretar la coma), superficie 0, `#BORRAR` en cultivo y superficie · alta: parcela
activa y versión `DECLARED` sin geometría ni superficie calculada, `NOT_VALIDATED`; sin superficie no hay versión;
procedencia en historial y eventos; vista previa sin escrituras · reimportación sin cambios: sin versiones, historial ni
eventos · mapeo parcial: `#BORRAR` vacía el nombre, vacío no cambia, sin mapear se conserva; superficie nueva = versión 2 y la
versión 1 idéntica · **geometría conservada**: con un polígono registrado, la superficie importada es error de fila y una
edición descriptiva deja la versión vigente y todas las versiones idénticas; ninguna coordenada en la vista previa · no
reasigna productor ni reactiva parcelas · **fixtures de autorización**: productor inexistente, fuera de la asignación y de
otra organización → respuesta idéntica sin id ni datos; parcela fuera de alcance e inexistente (rol sin alta) → respuesta
idéntica; sin `plot:read_geometry` no hay muestras de la columna sintética de coordenadas · revalidación al confirmar:
asignación retirada → `PREVIEW_STALE`; permiso de parcela retirado → 403; versión cambiada → `PREVIEW_STALE` · **rollback**:
fallo inyectado al crear la versión de la segunda fila deshace también el alta de la primera; luego se confirma completo ·
concurrencia: dos lotes con el mismo código nuevo, uno confirma y el otro se revierte entero · aislamiento: lote ajeno 404,
el mismo código es otra parcela y un productor de otra organización no está disponible.

## Hallazgos de la revisión visual (corregidos)

- El aviso «esta plantilla no importa coordenadas ni geometría» solo estaba dentro del desplegable de reglas (oculto por
  defecto). Ahora se muestra visible en el paso 1 al elegir «Parcelas».
- La confirmación con teclado se probó en la primera ejecución (captura `pa04-admin-resultado-parcelas.png`); la segunda
  ejecución, que generó `revision-parcelas.json`, encontró el archivo ya importado y la marca «no aplicable».

## Registros DEMO creados

`DEMO-IMP-PAR-001` (versión DECLARED 1.75 ha) y `DEMO-IMP-PAR-002` (sin versión), productor `DEMO-RV-008`. Procedencia en
`docs/qa/importacion/PROCEDENCIA_DATOS_DEMO_IMPORTADOS.md`.

## Android

No se recompiló (no era necesario). Cachés con rutas de C: identificadas, ignoradas por git y regenerables; no se borraron.
APK `APTO-ensayo-fisico-9996a9b4.apk` intacta (SHA-256 `9996a9b419508fdbd3b225a08aae39333b705ef125a68b527507c0efd6f46ab2`).
Ensayo físico: NO EJECUTADO.
