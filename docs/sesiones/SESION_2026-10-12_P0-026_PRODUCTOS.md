# Sesión 2026-10-12: P0-026 plantilla de productos y protecciones de productores

## Ubicación

`D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025` (`git rev-parse --show-toplevel`), remoto
https://github.com/cyberlandec-oss/TERRA-LINK-2025.git, rama `feat/tech-001-ci-p0-002`. Sin cambios ajenos salvo `AGENTS.md`
(sin seguimiento, fuera de commits). Mismo proyecto Compose `terra-link` y mismos volúmenes; no se levantó otro proyecto.

## Hecho

1. Protecciones de productores con fixtures de autorización: código fuera de alcance e inexistente indistinguibles;
   columnas de identidad. Sin cambiar roles de producción.
2. Plantilla `PRODUCTOS_V1` con el mismo pipeline; exige `product:manage` (MANAGER no lo obtiene por `import:manage`);
   inmutables, catálogos exactos (KG sin conversiones), `#BORRAR` solo en opcionales, desactivados intactos, sin versiones
   ni eventos al reimportar sin cambios. Migración `0031_import_products`.
3. UI: selector de plantilla según permisos efectivos; defecto del botón de mapeo corregido.
4. `npm run validate` APROBADA (`validation-results/2026-10-12T03-50-08-390Z`). Evidencia:
   `docs/qa/EVIDENCIA_P0-026_PRODUCTOS_2026-10-12.md`.
5. Rutas de C: actualizadas en la documentación vigente (`docs/20`, `docs/UX_UI.md`).

## Estado

P0-026 **ABIERTA**: faltan plantillas de parcelas, entregas y lotes. P0-023/P0-024 abiertas por el ensayo físico (APK
`9996a9b4…` conservada con su hash).

## Servicios levantados

Web 3000, API 4000 (migración `0031_import_products`), worker, escáner, S3 local y vista previa móvil 3001.

## Siguiente paso

1. Ensayo en teléfono físico (lo ejecuta el usuario).
2. P0-026: siguiente plantilla. Lotes o entregas exigen conservar estados de P0-012/P0-016 sin confirmar recepción, calidad,
   inventario ni debida diligencia; parcelas no deben inventar geometría.
3. Antes de una compilación nativa desde D:, regenerar las cachés Android que conservan rutas de C: (ver `docs/20`).
