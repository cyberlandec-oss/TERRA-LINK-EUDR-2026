# Evidencia: correcciones F01–F11 de la orden consolidada (2026-10-30)

Cuentas DEMO vigentes; sin cuentas nuevas, claves, seed ni respaldos. Esta tabla es el seguimiento de la entrega (no hay otra cola).

## SHA
| Qué | SHA | Resultado |
| --- | --- | --- |
| Prueba de la cadena técnica completa | `8129662` | `npm run validate` **APROBADA** (`validation-results/2026-10-31T02-53-25-461Z`); solo prueba, sin despliegue |
| Correcciones F02–F08 (migración `0076`) | `3b12839` | `npm run validate` **APROBADA** (`validation-results/2026-10-31T03-50-21-811Z`); **desplegado** (`/version` = `3b12839+sucio`, esquema `0076`; el «sucio» es solo este documento sin versionar al construir) |

## Seguimiento
| Fila | Causa / fuente | Cierre | Evidencia | Estado |
| --- | --- | --- | --- | --- |
| F01 Productor y captura | Textos y alta de la primera parcela | Ya entró en `7a8a9d2` (contenido en lo desplegado) | `e2e/tests/mi-finca.spec.ts:206` | **Ya resuelto** |
| F02 Documento ↔ entrega | La ficha leía `document_links`; los soportes viven en `delivery_supports` | La ficha muestra entregas, versión exacta y vínculo vigente/retirado con `delivery:read`; con menos alcance dice que no puede saberlo (`null`) | `deliveries.int-spec` (vigente, retirado, sin uso, otra organización 404); demostración 5/5 | **Corregido y probado** — **limitación declarada:** el técnico con `delivery:read_assigned` recibe `null` (no ve sus entregas asignadas); ampliarlo es un candidato aparte, sin cambiar permisos generales |
| F03 Cobertura histórica | Constante global `INCOMPLETE` | Declaración por organización (`report_coverage_declarations`, solo añadir); sin declaración = **no determinada**; el aviso depende del estado | `reports.int-spec`, `reports-entities.int-spec`, `productos.spec`; demostración (UNKNOWN en la cooperativa) | **Corregido y probado** |
| F04 Reportes | Ayuda con referencias internas; hora solo UTC | Ayuda breve de alcance; hora legible en la zona del navegador **identificada**, UTC visible; fechas civiles sin convertir; el cálculo no cambió | `productos.spec` (24/24) | **Corregido y probado** |
| F05 Productos y procesos | Encabezado y enlace | Encabezado y ayuda pedidos con enlace a Procesos; sin conversiones | `productos.spec` | **Corregido y probado** |
| F06 Perfil jurídico | Siempre negaba; elegía el último publicado | Perfil adoptado primero, materias en español, estado exacto, sin negativa permanente; configuración separada del recorrido de soportes | `legalidad-soportes.spec` | **Corregido y probado** |
| F07 Geometrías | Nombre y explicación | «Descargar geometrías de parcelas» con alcance explicado | Contenido del archivo (versiones, huellas, incluidas/omitidas) y permisos: `reports-entities.int-spec` («GeoJSON: exige plot:read_geometry…», catálogo por rol); sin exportador nuevo | **Corregido y probado** (reutilizando evidencia) |
| F08 Whisp | Mensaje de estado | «Nuevos análisis con Whisp deshabilitados» con motivo y qué decide el propietario; resultados guardados siguen visibles | Compilación y revisión; el endurecimiento previo no se tocó | **Corregido** — **decisión pendiente:** autorizar el uso sobre parcelas reales (organización, parcelas, individual o automático, duración) |
| F09 Traspasos | `BlockingTransferDispatchGate` bloquea siempre | Propuesta mínima: `docs/decisiones/A03-PROPUESTA-D4-SALIDA-Y-ORIGEN-RECEPTORA.md` | Sin cambios de código | **Decisión pendiente** (D4, D3 c, D2); el traspaso **no es operativo de punta a punta** mientras la salida siga bloqueada |
| F10 Expediente | Cadena no probada de punta a punta | `cadena-tecnica-completa.int-spec.ts` (4/4): todo se cumple salvo `RISK_NO_BLOCKING_FINDINGS` (dos reglas dependen de D-09.B y D-05.B); la copia sintética rotulada ejerce aprobación, paquete, hash, concesiones, acceso y desactualización | `8129662` validado | **Parcial:** el bloqueo real del producto está comprobado (`RISK_NO_BLOCKING_FINDINGS` depende de D-09.B y D-05.B; `READY` no se alcanza por el recorrido normal) y el tramo posterior (aprobación, paquete, hash, concesiones, desactualización) se probó sobre una copia sintética con `READY` y ese requisito forzados en la base de pruebas. **No** equivale a una cadena operativa desbloqueada, no cambia el estado de los expedientes DEMO ni es aceptación regulatoria. D-39 se mantiene |
| F11 Cuentas y roles | Inventario y funcionamiento son comprobaciones distintas | Inventario: 19 usuarios, 21 membresías activas + plataforma = 22 contextos (sin cambio). Funcionamiento tras el despliegue: `web-por-rol.mjs` APROBADO en 22 combinaciones (menús = permisos efectivos, Mi trabajo, denegaciones, teclado, 390 px, zoom 200 %); lecturas F02/F03 por cuenta | `docs/qa/web-por-rol/matriz.json`; `e2e/review/correcciones-f02-f08-demostracion.mjs` 8/8 | **PASS** en lo afectado; las escrituras no se repitieron por cuenta |

## Límites
- La cobertura histórica del DEMO no se declaró (nadie la declaró): se muestra como no determinada.
- Esto es validación local; no acredita producción, conformidad EUDR ni presentación de DDS. Los porcentajes aceptados (42/60 y 30/44) no cambian.
