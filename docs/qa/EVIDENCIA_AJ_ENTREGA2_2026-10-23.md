# Evidencia — Ajuste mínimo, entrega 2 (AJ-02 entregas propias, AJ-03 textos, AJ-04 atribución) — 2026-10-23

Fuente: plan de ajuste (`contexto/PLAN_AJUSTE_MINIMO_DOCUMENTACION_Y_PRODUCTO_2026-10-23.md`) y contexto funcional de Ecuador (`contexto/CONTEXTO_FUNCIONAL_EUDR_ECUADOR_2026-10-22.md`). Son recomendaciones del propietario que completan historias **originales**; no cambian 42/60 ni 30/44.
Terra Link prepara y gestiona evidencia: **no certifica** autenticidad ni conformidad.

## Brechas comprobadas y qué se hizo
| Clase (plan §4) | Hallazgo comprobado | Fuente | Cambio |
| --- | --- | --- | --- |
| Brecha funcional original | El Productor no podía ver sus entregas (`docs/07`: PRODUCER «recursos propios: perfil, parcelas, **entregas**, documentos»; UX §7.13) | docs/07 fila PRODUCER | Permiso `delivery:read_own` (PRODUCER y ORG_ADMIN, que debe poder asignar ese rol): **solo el listado** de las entregas del productor vinculado a la cuenta. El **detalle** (personal, compuertas internas, historial) y toda escritura siguen siendo de quien opera |
| Navegación incompleta | «Mis entregas» no existía en Mi finca | UI-22 | Tabla propia (estado, cantidades, recepción) sin enlace al detalle; sin vínculo: «sin entregas por falta de vínculo» (≠ sin permiso) |
| Texto desactualizado | «llegará con P0-012» (API, pantalla de documentos, ficha del documento) aunque P0-012 es DONE_LOCAL | docs/12; modelo `delivery_supports` | Comprobado que el **modelo vigente** vincula el soporte a la entrega (el documento pertenece al productor o a la parcela de origen): **no** hay titularidad por entrega y no se creó migración. Textos corregidos y camino explicado |
| Atribución ambigua | La revisión de un documento mostraba «Aceptada: motivo» sin quién ni cuándo | plan §5D | La API devuelve el responsable; la ficha dice «Revisión humana: aceptada por {persona} el {fecha}. Motivo… No es una certificación de Terra Link» |
| Defecto de producto (no era del plan) | En Productores, el listado inicial terminó 1 ms **después** de la búsqueda y la pisó (3 filas en vez de 1) | traza de la corrida `2026-10-23T06-53-02-801Z` | Guarda de secuencia en Productores, Parcelas y Productos; prueba determinista que falla sin ella |

## Qué se conservó
Servicio de documentos y su carga (antivirus, límites, versiones, alcance por titular), `FIELD_PHOTO`, revisiones humanas e historial, compuertas, READY/despacho, el mecanismo `delivery_supports`, roles y permisos específicos ya autorizados, y A-04 (web `5f77b72`; móvil `056d298`, APK `3df0ca8d`, evidencia diferenciada). Sin migración, sin endpoints nuevos (OpenAPI sin cambios).

## Validaciones (todas conservadas)
| SHA | Resultado | Corrida |
| --- | --- | --- |
| `1cc6eff` | **FALLIDA** en E2E (2 fallos de 154; 17 no ejecutados): (1) `productores.spec:93` — carrera de respuestas descrita arriba; (2) `productos.spec:205` — el test esperaba el texto antiguo de la revisión | `2026-10-23T06-53-02-801Z` |
| **`53f6e81`** | **APROBADA** (integración 2 619 s, e2e 463 s) | `2026-10-23T07-56-18-883Z` |

Diagnóstico de (1): reproducido con una prueba que retrasa a propósito la respuesta sin filtro (`e2e/tests/listados-respuesta-tardia.spec.ts`): sin la guarda recibe 3 filas, con ella 1; el spec pasó 3/3 en solitario antes del cambio, por lo que la causa era temporal y no de datos. (2) era un test desactualizado: se actualizó a la verdad nueva (responsable y fecha visibles) sin reducir aserciones.

## Pruebas añadidas
`apps/api/test/delivery-own.int-spec.ts` (6: solo lo propio, sin nombres de personas, detalle y escrituras rechazados con cuerpos válidos, cuenta sin vínculo = lista vacía, vincular/desvincular, otra organización, permisos del auditor, mensaje de documentos), 2 pruebas del catálogo, `documents.int-spec` (atribución de la revisión), `e2e/tests/mi-finca.spec.ts` ampliado (Mis entregas, sin vínculo), `listados-respuesta-tardia.spec.ts`.

## Despliegue y demostración
`53f6e81` desplegado (esquema 0065; 27 volúmenes). `node e2e/review/mi-finca-demostracion.mjs`: **8/8** con cuentas DEMO reales y sin cambios en datos (97/103/40/45/56): cuenta sin vínculo, «Mis entregas» sin vínculo, API (listado 200 vacío, detalle 403), guía con fuente, sin lenguaje de certificación, auditor, inglés y 390 px. Sin migración: no hay respaldo nuevo.

## Límites y pendientes
- El detalle de la entrega sigue sin mostrarse al Productor (decisión de privacidad: expone nombres del personal, compuertas y notas internas); un detalle propio más rico sería otra decisión.
- Aspectos sin tipo de documento propio (ambiente, trabajo, derechos de terceros): **resuelto después** con la migración 0066 (ver EVIDENCIA_AJ03_TIPOS_DOCUMENTALES_2026-10-23.md).
- La cuenta DEMO de productor sigue sin vínculo (configuración de cuenta pendiente; no se tocó).
- Cuatro avisos «Cumple/Bloquea» de compuertas (embarques, simulación, traspasos) describen comprobaciones técnicas; no se reescribieron (fuera de los recorridos intervenidos).
