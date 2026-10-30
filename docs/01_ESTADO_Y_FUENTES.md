# Estado, fuentes y nivel de certeza

> **Nota (2026-10-20):** este documento describe la **línea base de la primera entrega** y se conserva como referencia histórica. El estado actual del repositorio, las historias y la cobertura están en `23_ESTADO_DESARROLLO.md` (bloque «Estado vigente») y `sesiones/REANUDAR_2026-10-20.md`. Las intervenciones externas se mantienen en `decisiones/CIERRE_E_PENDIENTES_2026-10-29.md`. El resto de este documento sigue siendo la línea base histórica, no una declaración actual de capacidades ausentes.

## Lo que se ha revisado

Se leyeron los cuatro archivos entregados: documentación técnica maestra v0.1, negocio real, mapa competitivo y workflows. Se consultó la guía de DataCamp por su URL canónica porque el enlace corto no abrió; se contrastó el mecanismo de instrucciones con la documentación oficial de Claude Code. Se consultaron páginas oficiales de la Comisión Europea para separar preparación interna de presentación regulatoria.

Esta entrega no incluye acceso ni auditoría del repositorio actual. No se ejecutaron aplicación, migraciones, API, pruebas de campo o integraciones. Todos los elementos del backlog comienzan `PENDIENTE_DE_VERIFICAR`; no son defectos confirmados ni funciones necesariamente ausentes.

## Clasificación

| Etiqueta | Significado |
| --- | --- |
| FUENTE | La capacidad o intención aparece en los adjuntos |
| PROPUESTA | Detalle de ingeniería desarrollado en este paquete |
| POR_VERIFICAR | Depende de repositorio, proveedor, operador o evidencia no recibida |
| IMPLEMENTADO | Código inspeccionado con ruta/commit |
| INTEGRADO | Participa en el flujo real |
| VERIFICADO | Prueba ejecutada con resultado y entorno |
| CONFORME | Criterios regulatorios vigentes evaluados y documentados por responsables |
| PRODUCTIVO | Operación real con controles y evidencia operacional |

Las cinco últimas etiquetas se acreditan por separado; ninguna se infiere de la anterior.

## Diferencias que no deben ocultarse

| Tema | Evidencia | Tratamiento |
| --- | --- | --- |
| Stack | S1 propone NestJS/Next.js, React Native/Expo y BullMQ | No constituye instrucción para migrar un proyecto existente |
| Evolución de Terra Link | Contexto previo menciona FastAPI/React y núcleo en desarrollo | Antecedente sin nueva verificación; inspeccionar código antes de adoptar |
| Roles | S1 §9 y S4 enumeran 12 identificadores | Usar los 12 documentados; cualquier rol adicional requiere catálogo real/ADR |
| GIS | S1 deja sin definir el caso exacto de 4 ha | Guardar umbral y operador en regla; validar jurídicamente el perfil antes de activar |
| Riesgo | S1 mezcla severidad con estados del proceso | Separarlos en la propuesta; no migrar sin revisar los enums existentes |
| DD y DDS | Fuentes usan expresiones cercanas para conceptos distintos | Expediente, paquete, readiness y envío oficial tienen estados distintos |
| Saldo negativo | S1 contempla excepción administrativa | Propuesta: bloquear consumo negativo y usar ajuste documentado; ADR-0003 |
| Inventario UX | S4 contiene cifras ilustrativas de balance ambiguas | Sustituir por escenarios conservativos claros y probados |
| Proveedores | Benchmark aporta declaraciones y precios históricos | No reproducirlos como comparativa vigente ni garantía de API |
| Guías nacionales | S1/S3 citan títulos y marcadores incompletos | No se recibieron sus textos originales; validar requisitos legales contra fuentes primarias |

## Orden para conocer la realidad

1. Comprobar manifiestos, lockfiles, rama y commit.
2. Identificar módulos, rutas, esquema, migraciones y permisos reales.
3. Ejecutar verificaciones autorizadas y reproducibles en desarrollo.
4. Contrastar cada historia con su criterio y documentar gaps.
5. Repriorizar para continuar el proyecto en vez de reconstruirlo.

Las fuentes originales permanecen intactas en `sources/`. Los cambios de este paquete deben mantener una relación con ellas o identificarse como decisiones nuevas.
