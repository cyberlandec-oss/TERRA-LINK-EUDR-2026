# Sesión 2026-10-12 (2): P0-026 plantilla de parcelas

## Ubicación

`D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025`, remoto https://github.com/cyberlandec-oss/TERRA-LINK-2025.git,
rama `feat/tech-001-ci-p0-002`. Mismo proyecto Compose `terra-link` y mismos volúmenes. `AGENTS.md` sin seguimiento, fuera de commits.

## Hecho

1. `PARCELAS_V1`: datos descriptivos y superficie declarada; **sin geometría**. Productor por código exacto; sin crear ni
   reasignar; parcelas de baja intactas; superficie solo en parcelas sin geometría (versión DECLARED nueva, anteriores
   intactas). Migración `0032_import_plots`.
2. `PlotsService.createInTx`/`updateInTx`/`declaredVersionInTx`; endpoints de parcelas sin cambios de comportamiento.
3. Permisos: `import:manage` + permiso de parcela con alcance por asignación; respuestas indistinguibles para referencias
   inexistentes, fuera de alcance o de otra organización; muestras de columnas sueltas solo con `plot:read_geometry` e identidad.
4. UI: opción «Parcelas» y aviso visible de que no se importa geometría.
5. `npm run validate` APROBADA (`validation-results/2026-10-12T04-15-47-909Z`). Evidencia:
   `docs/qa/EVIDENCIA_P0-026_PARCELAS_2026-10-12.md`.
6. Android: no se recompiló; cachés con rutas de C: identificadas y documentadas (`docs/20`), no borradas.

## Estado

P0-026 **ABIERTA**: faltan entregas y lotes; superficie declarada en parcelas con geometría sin caso de uso. P0-023/P0-024
abiertas por el ensayo físico.

## Servicios levantados

Web 3000, API 4000 (migración `0032_import_plots`), worker, escáner, S3 local y vista previa móvil 3001.

## Siguiente paso

1. Ensayo en teléfono físico (lo ejecuta el usuario).
2. P0-026: entregas o lotes, conservando estados de P0-012/P0-016 sin confirmar recepción, calidad, inventario ni DD.
3. Decidir el caso de uso «nueva superficie declarada conservando la geometría vigente» (afecta también al formulario de versión).
