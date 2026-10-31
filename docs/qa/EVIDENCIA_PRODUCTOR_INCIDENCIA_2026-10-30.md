# Evidencia: incidencia del Productor y su recorrido (2026-10-30)

Cuenta DEMO vigente `productor.cooperativa` (Ana Vélez, demo). Sin crear cuentas ni cambiar claves. Diagnóstico de solo lectura mientras corría una validación; reparación y recorrido después.

## Diagnóstico (versión desplegada `7d9921e`, esquema 0071)
| Capa | Resultado |
| --- | --- |
| Organización | Cooperativa Río Verde, `ACTIVE` |
| Permisos efectivos | `PRODUCER`: `plot:*_own`, `producer:read_own`, `delivery:read_own`, `document:read/upload`, `plot:read_geometry`, `sync:use`; sin `document:review`, `risk:*`, `satellite:request` |
| Productores y parcelas (respuestas reales) | 200 con **0** productores y **0** parcelas |
| Vínculo cuenta–productor | **Ninguno** (`self_membership_id` vacío en los 11 productores) |

**Causa: configuración** (cuenta sin vínculo), no autorización, datos ni interfaz. La pantalla ya decía «configuración pendiente» y `qa/EVIDENCIA_A05_MI_FINCA_DOCUMENTOS_2026-10-23.md` lo había registrado como pendiente. Ningún productor del DEMO le correspondía por documento, semilla ni historial; por eso no se vinculó por semejanza de nombres.

## Reparación (autorizada por el propietario: «Crear su registro»)
Con `admin.cooperativa` y la API existente se creó el productor `DEMO-RV-010` «Ana Vélez (demo)» y se vinculó con `PUT …/producers/{id}/self-membership` a la membresía del **usuario** de la cuenta (localizada por su identificador, no por el nombre). Historial del productor: `ProducerSelfLinked`.

## Recorrido (`e2e/review/productor-recorrido-demostracion.mjs`, 6/6)
1. Estado real (versión, organización activa, permisos, vínculo, respuestas reales).
2. Mi finca → su parcela propia (`ANA-P1`, creada por la propia Productora desde Captura de campo → «Registrar una parcela nueva»).
3. Mi ubicación + mapa + polígono de 3 vértices; **revisar no guardó nada** (0 versiones); guardar creó la versión 1 (`MANUAL_COORDINATES`); sin solicitudes externas.
4. Volver a consultar: API y ficha conservan la versión vigente; Mi finca ofrece «Ver o corregir la ubicación».
5. Adjuntar una fotografía y un croquis: quedan recibidos, sin aprobación (4 documentos propios porque una pasada anterior que falló ya había subido 2).
6. Rechazo de lo ajeno (con control autorizado): parcela y productor ajenos → 404; escribir o subir en una parcela ajena → 404; satélite de una parcela ajena → 403/404; **aprobar un documento → 403**; la pantalla de una parcela ajena no muestra datos.

## Defectos corregidos (candidato `7a8a9d2`, validado)
- «Mi finca» sin parcelas no ofrecía acción; ahora «Registrar una parcela nueva» (lleva a la ficha donde está el formulario).
- «Productores» le decía al Productor «asignados a ti» (texto del técnico); ahora «Ves solo tu productor.».
- El encabezado de «Captura de campo» ahora orienta: «Ubica tu parcela, registra su polígono y adjunta fotos o documentos. Revisa los datos antes de guardarlos.»; la explicación de responsabilidades quedó como ayuda secundaria plegable. Cambiar el texto no sustituyó la corrección funcional (vínculo y botón).
- e2e `mi-finca.spec.ts`: cuenta vinculada y sin parcelas → botón → registrar → persistencia → encabezados → sin facultades de decidir.

Registrar y corregir geometría no concede aprobar documentos ni concluir riesgo (comprobado). Capturas locales en `validation-results/productor-recorrido-2026-10-30/` (ignorado por Git).
