# Evidencia P0-026: plantilla de productos y protecciones de productores (2026-10-12)

Repositorio en `D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025` (confirmado con `git rev-parse
--show-toplevel`), remoto `cyberlandec-oss/TERRA-LINK-2025`, rama `feat/tech-001-ci-p0-002`. Equipo local, Docker
(proyecto Compose `terra-link`, mismos volúmenes), datos DEMO y **archivos sintéticos**. No acredita producción, uso con un
Excel real de una asociación ni conformidad EUDR.

## Resultados

| Verificación | Resultado | Registro |
| --- | --- | --- |
| `npm run validate` (servicios, typecheck, lint, build, OpenAPI validado, unitarias + integración, E2E) | **APROBADA** | `validation-results/2026-10-12T03-50-08-390Z` |
| Integración productos (`test/imports-products.int-spec.ts`) | 11/11 | dentro de la validación |
| Fixtures de autorización (`test/imports-authz-fixtures.int-spec.ts`) | 3/3 | dentro de la validación |
| Integración productores (`test/imports.int-spec.ts`) tras generalizar el pipeline | 11/11 | dentro de la validación |
| Lector XLSX | 7/7 | dentro de la validación |
| Regresión productos, productores y lotes tras extraer `createInTx`/`updateInTx` de productos | 26/26 | ejecución previa a la validación |
| Navegador, productos (`e2e/review/importaciones-productos.mjs`) | 7/7 | `docs/qa/importacion/revision-productos.json`, capturas `p01`–`p06` |
| Navegador, productores (regresión de la UI generalizada) | 10/10 | `docs/qa/importacion/revision.json` |

## Casos de productos

MANAGER con `import:manage` y sin `product:manage`: 403 en plantilla, carga, lote, vista previa, informe y confirmación; sus
listas no muestran lotes de productos · errores por fila: código repetido, código en minúsculas, unidad `LB` (sin
conversión), «kg» y estado fuera de catálogo (código exacto), nombre ausente en un alta, `#BORRAR` en nombre y unidad · alta
ACTIVA con versión `CREATED`, procedencia en motivo, evento y auditoría · reimportación sin cambios: ni versiones ni eventos;
confirmación rechazada · cambio de estado/presentación: `PRODUCT_FIELD_IMMUTABLE` y el lote no escribe la otra fila válida ·
mapeo parcial: vacío no borra, `#BORRAR` vacía la variedad, sin mapear se conserva · desactivado: ni se reactiva ni se edita
· **rollback forzado**: fallo inyectado en la segunda fila deshace el alta de la primera y el lote queda «mapeado»; después
se confirma completo · versión cambiada tras la vista previa: `PREVIEW_STALE` · rol retirado antes de confirmar: 403 ·
concurrencia: dos lotes con el mismo código nuevo, uno confirma y el otro se revierte entero · otra organización: 404 y el
mismo código es otro producto.

## Fixtures de autorización (productores)

Permisos sintéticos sustituidos **en memoria** para dos usuarios de prueba (ningún rol de producción ni la tabla de roles
cambia): (1) alcance «solo asignados» sin `producer:create`: un código ocupado fuera de alcance y uno inexistente producen
respuestas idénticas (`CODE_NOT_AVAILABLE`, mismo mensaje, columna y campo) y ni la vista previa ni el informe contienen id
ni datos del productor ajeno; (2) sin `producer:read_identity`: sin muestras de columnas no mapeadas, mapeo de identidad
→ 403 `MAPPING_IDENTITY_NOT_ALLOWED`, y la vista previa de un lote ajeno con identidad enmascara esos valores.

Cambio de comportamiento: antes, el código inexistente sin permiso de alta respondía `PERMISSION_DENIED_CREATE` y era
distinguible del código fuera de alcance; ahora ambos responden `CODE_NOT_AVAILABLE`.

## Defecto encontrado y corregido por la revisión visual

El botón «Guardar mapeo» exigía siempre `producer_code`; con productos nunca se habilitaba. Ahora usa la clave de la
plantilla (`key_field`). Lo detectó la primera ejecución de la revisión de productos (fallo registrado, captura descartada).

## Navegador (productos)

Administración (1280 px): elige «Productos», descarga la plantilla, archivo con errores (3 filas con error, no confirmable,
descartado), archivo válido confirmado **solo con teclado** («Creados 2 (estado activo)»). 390 px: reimportación = 2 sin
cambios y 0 px de desplazamiento horizontal. Supervisión: «Productos» deshabilitado con el motivo y la API responde 403.

## Registros DEMO creados

Conservados y documentados en `docs/qa/importacion/PROCEDENCIA_DATOS_DEMO_IMPORTADOS.md` (dos productores en BORRADOR del
2026-10-11 y dos productos ACTIVOS del 2026-10-12).

## APK para el ensayo físico

`apps/mobile/dist-apk/APTO-ensayo-fisico-9996a9b4.apk` sin cambios: SHA-256
`9996a9b419508fdbd3b225a08aae39333b705ef125a68b527507c0efd6f46ab2` (coincide con su `.sha256`). Ensayo físico: NO EJECUTADO.
