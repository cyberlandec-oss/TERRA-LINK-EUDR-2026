# Evidencia: identidad de entregas, vigencia, plantilla de lotes y cierre local de P0-026 (2026-10-12)

Repositorio `D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025`, rama `feat/tech-001-ci-p0-002`. Equipo local,
Docker (proyecto `terra-link`, mismos volúmenes), PostgreSQL/PostGIS real, datos DEMO y **archivos sintéticos**. No acredita
producción, uso con un Excel real de una asociación ni conformidad EUDR.

## Resultados

| Verificación | Resultado | Registro |
| --- | --- | --- |
| `npm run validate` (servicios, typecheck, lint, build, OpenAPI validado, unitarias + integración, E2E) | **APROBADA** | `validation-results/2026-10-12T15-43-09-518Z` |
| Lotes (`test/imports-lots.int-spec.ts`) | 10/10 | dentro de la validación |
| Entregas con referencia (`test/imports-deliveries.int-spec.ts`) | 14/14 | dentro de la validación |
| Vigencia (`test/dd.int-spec.ts`, caso nuevo) y GIS | 15/15 | dentro de la validación |
| Regresión lotes e inventario tras `createLotInTx` | 12/12 | ejecución previa |
| Navegador: lotes 10/10, entregas 10/10; productores, productos y parcelas aprobadas | aprobadas | `docs/qa/importacion/revision-*.json` |

## Rotación DEMO

`recepcion.acopio` y `calidad.acopio` rotadas con el mecanismo del seed (`--rotar`): credencial guardada primero en los CSV
locales (4 filas de membresía actualizadas), login nuevo verificado, anterior rechazado y sesiones previas invalidadas. El
primer intento falló con EBUSY porque `CREDENCIALES.csv` estaba abierto en Excel; el mecanismo no activó nada y se repitió tras
cerrarlo. Ninguna contraseña se mostró ni se versionó. Las demás cuentas no cambiaron.

## Identidad de entregas

Referencias distintas con contenido idéntico → dos entregas; misma referencia → sin duplicar (y actualización del mismo
borrador); procedencia en `import_references` (append-only); sin identidad → `REFERENCE_REQUIRED`; concurrencia: misma
referencia en dos lotes → una entrega; referencias distintas → dos. Leer todas las entregas no concede editarlas
(`PERMISSION_DENIED_UPDATE`). Los borradores importados antes conservan referencia `LEGACY_CONTENT_FINGERPRINT`.

## Vigencia

Edición descriptiva de la parcela: riesgo, expediente y GIS siguen vigentes. Superficie declarada nueva: riesgo y expediente
`STALE` (sección `plots`), GIS con motivo `PLOT_VERSION_CHANGED_SAME_GEOMETRY`; filas de riesgo, instantánea y evaluación GIS
idénticas antes y después; la versión nueva no tiene evaluación GIS (nada favorable se atribuye). Recapturar coordenadas
idénticas sigue siendo `GEOMETRY_CHANGED`.

## Lotes

Lote nuevo por referencia con dos recepciones (ledger: lote 90 kg, recepciones descontadas; eventos con `source`) · vista
previa con movimientos explicados y sin escrituras · reimportación sin asignaciones, cantidades, versiones ni eventos ·
errores: recepción faltante (lote histórico sin recepción), inexistente, verificación cruzada, exceso individual y acumulado,
mezcla de origen y de producto, duplicados, fila sin identidad, asignación existente con otra cantidad, formato y cero ·
origen incompleto en lote separado · lote existente por código · lote cerrado no se reabre · revalidación: disponibilidad
consumida y lote cerrado en paralelo → `PREVIEW_STALE` · concurrencia importación/asignación directa: nunca se supera lo
disponible; reintento sin duplicar · sin alcance de entregas: recepción no disponible (respuesta idéntica a inexistente) ·
permiso retirado → 403 · rollback forzado · aislamiento entre organizaciones.

## Navegador (lotes)

Plantilla con aviso; archivo con 4 errores no confirmable; vista previa que explica «mueve 20 kg de la recepción de
ENT-2026-00001»; confirmación **solo con teclado**; en la base, `LOT-2026-00004` abierto con origen conocido y la recepción
50 → 30 kg sin lote; 390 px sin desbordamiento y reimportación «ya está asignada»; MANAGER autorizado; cuentas sin acceso
denegadas (la de trazabilidad DEMO es de otra organización; la denegación por rol dentro de la organización está en la integración).

## Observaciones

- Episodio de 690 s (primera ejecución de la prueba de entregas): **causa no determinada**; no se cambiaron timeouts.
- Solo archivos sintéticos: no se ha probado un Excel real de una asociación.
- No se recompiló Android; APK `9996a9b4…` intacta. Ensayo físico: NO EJECUTADO.
