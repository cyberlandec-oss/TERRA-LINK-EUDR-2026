# Sesión 2026-10-12 (3): superficie declarada y plantilla de entregas

## Ubicación

`D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025`, rama `feat/tech-001-ci-p0-002`, proyecto Compose `terra-link`.

## Hecho

1. **Superficie declarada conserva la geometría** (adopción para desarrollo local): caso de uso único
   `updateDeclaredAreaInTx` (formulario, `geometry-versions` DECLARED e importación), migración 0033, evento
   `PlotDeclaredAreaUpdated`, sin herencia GIS. Decisión: `docs/decisiones/SUPERFICIE-DECLARADA-CONSERVA-GEOMETRIA.md`.
2. **`ENTREGAS_V1`**: solo borradores con `createDraftInTx`/`updateDraftInTx`; periodo como se declara; KG sin
   conversiones; clave = código asignado o huella de la fila; registradas no se editan; sin efectos físicos. Migración 0034.
3. UI: opción «Entregas (borradores)» con aviso; formulario de superficie declarada con la nueva regla.
4. `npm run validate` APROBADA (`validation-results/2026-10-12T05-08-43-805Z`). Evidencia:
   `docs/qa/EVIDENCIA_P0-026_ENTREGAS_Y_SUPERFICIE_2026-10-12.md`.

## Estado

P0-026 **ABIERTA** por la plantilla de lotes. P0-012 sin cambios de estado. P0-023/P0-024 abiertas (ensayo físico).

## Servicios

Web 3000, API 4000 (migración `0034_import_deliveries`), vista móvil 3001.

## Siguiente paso

1. Ensayo en teléfono físico.
2. P0-026: plantilla de lotes (P0-016) sin confirmar procesos, inventario ni DD.
3. Ratificar para producción la regla de superficie declarada.
