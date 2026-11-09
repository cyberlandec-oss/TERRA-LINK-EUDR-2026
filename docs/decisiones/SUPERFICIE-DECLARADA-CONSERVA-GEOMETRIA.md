# Superficie declarada que conserva la geometría vigente

**Estado:** ADOPTADA PARA DESARROLLO LOCAL (2026-10-12). **Procedencia:** instrucción del responsable del proyecto en la
sesión del 2026-10-12 («adoptemos para el MVP que actualizarla conserva la geometría vigente; son datos distintos; la
operación tampoco debe heredar una validación GIS»). No es una decisión de producto ratificada ni un requisito regulatorio.

## Problema

`POST /plots/{id}/geometry-versions` con método `DECLARED` creaba una versión solo con superficie, sin geometría, que pasaba
a ser la vigente: registrar la superficie declarada de una parcela con ubicación o polígono la dejaba, en la práctica,
sin geometría vigente. La importación de parcelas (P0-026) lo rechazaba para no sustituirla.

## Regla adoptada

Un único caso de uso, `PlotsService.updateDeclaredAreaInTx`, usado por:
- el formulario (`POST /plots/{id}/declared-area`, y `geometry-versions` con método `DECLARED`, que ahora delega en él);
- la importación de parcelas (`PARCELAS_V1`).

Efectos:
1. Crea una **versión nueva** (append-only) que pasa a ser la vigente; las anteriores no cambian.
2. Si la versión vigente tiene geometría, la nueva **copia** geometría, hash, superficie calculada y datos de captura
   (método, fecha, precisión) y apunta a la versión **capturada** (`geometry_origin_version_id`, migración 0033; siempre la
   captura original, nunca una copia). La base comprueba misma parcela y mismo hash.
3. **No es una captura nueva**: `change_kind = DECLARED_AREA_UPDATE`, historial `DECLARED_AREA`, evento
   `PlotDeclaredAreaUpdated` (no `PlotGeometryVersionCreated`), auditoría `plot.declared_area_update`. No crea muestras de
   ubicación; la muestra y el original importado se muestran desde la versión capturada.
4. Superficie declarada y calculada **separadas**: la calculada se copia (misma geometría), la declarada es la nueva.
5. `validation_status = NOT_VALIDATED`. **No hereda** evaluaciones GIS ni aprobaciones: las evaluaciones existentes siguen
   ligadas a su versión y la nueva queda sin evaluar (riesgo usa la evaluación de la versión vigente).
6. Sin geometría vigente: versión `DECLARED` solo con superficie (comportamiento anterior).
7. Misma superficie → `NO_CHANGE`; versión de parcela obsoleta → `VERSION_CONFLICT`; parcela de baja → `PLOT_INACTIVE`.
8. Permisos: `plot:update` o `plot:update_assigned` con el alcance de la parcela; no exige `plot:read_geometry` porque no
   escribe coordenadas; la respuesta solo incluye coordenadas con ese permiso. Eventos y auditoría no llevan coordenadas.

## Verificación

`test/plot-declared-area.int-spec.ts` (geometría exacta byte a byte, origen de captura, muestras, historial, eventos,
superficies separadas, GIS no heredado, conflicto y concurrencia, rollback, permisos, rechazo en base de una copia con otra
geometría) y `test/imports-plots.int-spec.ts`.

## Pendiente

Ratificar la regla para producción. Decidir si una superficie declarada nueva debe invalidar o marcar como obsoletas
evaluaciones de riesgo ya calculadas sobre la versión anterior (hoy simplemente no se heredan).
