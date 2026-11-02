# Evidencia: QA integral por cuenta, contexto y cadena (2026-10-30)

Orden del propietario `ORDEN_QA_INTEGRAL_TERRA_LINK_2026-10-30.md` y precisiones posteriores. Datos **sintéticos** del DEMO; sin cuentas nuevas, sin cambios de claves, sin seed y sin respaldos rutinarios. **Esto es QA local: no acredita producción, presentación oficial, que el comprador tenga todo lo que necesita como operador europeo, ni conformidad EUDR, y no cambia los porcentajes aceptados (42/60 = 70 %; MVP 30/44 = 68,2 %).**

## SHA: validado, desplegado y publicado (distintos)
| Qué | SHA | Resultado |
| --- | --- | --- |
| Candidato de la migración corregida (0072 con trabajos terminados) | `c523edb` | `npm run validate` **APROBADA** (`validation-results/2026-10-30T15-28-05-403Z`) |
| Candidato con revalidación del worker y mejoras del Productor | `7a8a9d2` | **APROBADA** (`…16-08-23-506Z`) |
| Candidato con soportes de la instantánea (0073) | `6eb528d` | **APROBADA** (`…17-04-02-538Z`); desplegado y recorrido |
| **Candidato final** (aviso de descarga a 390 px + guiones de QA) | `fc8afbd` | **APROBADA** (`…17-45-37-197Z`); **desplegado** (`/version` = `fc8afbd`, esquema `0073`) |
| Despliegue **fallido** | `bde5934` | La migración 0072 falló sobre el DEMO (el relleno tocaba trabajos terminados y su disparador lo prohíbe). Se revirtió sola (esquema 0071, datos intactos). Corregido en `c523edb` con una prueba que falla sin la corrección. |

Recuperación del DEMO tras el fallo: las imágenes anteriores se habían sobrescrito (`:local`); se reconstruyeron desde un árbol aparte las del último código desplegado (`7d9921e`), se levantaron `api`, `worker` y `web` con `--no-deps` (sin repetir `migrate`) y se verificó `/version` y los datos antes de seguir. Imágenes conservadas: `*:rec-7d9921e` y `*:cand-bde5934`.

## Inventario real (denominador)
19 cuentas únicas (22 filas del archivo de credenciales); **22 contextos**: 21 cuenta + organización y 1 de plataforma. Los 12 roles canónicos tienen al menos una cuenta con la que probar el caso positivo (SUPER_ADMIN por la cuenta de plataforma). `coordinador.multi` es una cuenta con dos contextos (MANAGER en la Cooperativa, TRACEABILITY_MANAGER en la Exportadora), no otro rol; recepción y calidad también tienen dos membresías.

## Matriz por cuenta y contexto (`e2e/review/qa-cuentas-matriz.mjs`, sobre `fc8afbd`)
Por contexto: inicio de sesión; permisos efectivos del servidor = catálogo de roles; menú observado = esperado por permisos; una lectura permitida (200); sondeos **prohibidos con cuerpo válido** (conceder acceso, crear productor, abrir expediente, autorizar satélite, otra organización) → 403/404; recuentos de datos iguales antes y después. **22/22 PASS, 0 defectos.**

| Cuenta | Contexto | Roles | Permisos = catálogo | Menú = esperado | Lectura permitida | Rechazo con cuerpo válido | Sin efecto | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| superadmin.revision | PLATAFORMA | SUPER_ADMIN | sí (plataforma) | n/a (menú de plataforma) | organizaciones=200 | datos operativos de una organización=404 | n/a | PASS |
| admin.cooperativa | DEMO · Cooperativa Río Verde | ORG_ADMIN | sí (107) | 38 entradas, sí | /lots=200 | — | sí | PASS |
| supervisor.cooperativa | DEMO · Cooperativa Río Verde | MANAGER | sí (42) | 27 entradas, sí | /lots=200 | conceder acceso externo=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| tecnico1.cooperativa | DEMO · Cooperativa Río Verde | FIELD_TECHNICIAN | sí (20) | 15 entradas, sí | /deliveries=200 | conceder acceso externo=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| tecnico2.cooperativa | DEMO · Cooperativa Río Verde | FIELD_TECHNICIAN | sí (20) | 15 entradas, sí | /deliveries=200 | conceder acceso externo=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| productor.cooperativa | DEMO · Cooperativa Río Verde | PRODUCER | sí (11) | 7 entradas, sí | /deliveries=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| auditor.cooperativa | DEMO · Cooperativa Río Verde | AUDITOR | sí (23) | 27 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| eudr.cooperativa | DEMO · Cooperativa Río Verde | EUDR_MANAGER | sí (36) | 25 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| admin.acopio | DEMO · Acopio San Isidro | ORG_ADMIN | sí (107) | 38 entradas, sí | /lots=200 | — | sí | PASS |
| recepcion.acopio | DEMO · Acopio San Isidro | RECEPTION_OPERATOR | sí (14) | 12 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| recepcion.acopio | DEMO · Cooperativa Río Verde | RECEPTION_OPERATOR | sí (14) | 12 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| calidad.acopio | DEMO · Acopio San Isidro | QUALITY_OPERATOR | sí (9) | 11 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| calidad.acopio | DEMO · Cooperativa Río Verde | QUALITY_OPERATOR | sí (9) | 11 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| admin.exportadora | DEMO · Exportadora Pacífico | ORG_ADMIN | sí (107) | 38 entradas, sí | /lots=200 | — | sí | PASS |
| trazabilidad.exportadora | DEMO · Exportadora Pacífico | TRACEABILITY_MANAGER | sí (30) | 23 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| eudr.exportadora | DEMO · Exportadora Pacífico | EUDR_MANAGER | sí (36) | 25 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| exportacion.exportadora | DEMO · Exportadora Pacífico | EXPORT_MANAGER | sí (17) | 14 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| auditor.exportadora | DEMO · Exportadora Pacífico | AUDITOR | sí (23) | 27 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| admin.importador | DEMO · Chocolates Europa (importador UE) | ORG_ADMIN | sí (107) | 38 entradas, sí | /lots=200 | — | sí | PASS |
| comprador.importador | DEMO · Chocolates Europa (importador UE) | BUYER | sí (0) | 1 entradas, sí | sin lectura operativa (BUYER: solo lo concedido) | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| coordinador.multi | DEMO · Cooperativa Río Verde | MANAGER | sí (42) | 27 entradas, sí | /lots=200 | conceder acceso externo=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |
| coordinador.multi | DEMO · Exportadora Pacífico | TRACEABILITY_MANAGER | sí (30) | 23 entradas, sí | /lots=200 | conceder acceso externo=403 · crear productor=403 · abrir expediente=403 · autorizar análisis satelital a otra organización=403 | sí | PASS |

Alcance de esta matriz: comprueba **acceso, menú, lectura y rechazo** por contexto. La **acción con escritura y su persistencia** de cada rol se demuestra en la cadena siguiente y en las pruebas de integración/e2e vigentes; donde el DEMO no tiene datos para un rol (p. ej. TRACEABILITY_MANAGER y EUDR_MANAGER de la Exportadora, que no tiene lotes) el caso positivo es el de las pruebas aisladas (`dd.int-spec`, procesos) y se declara **NO APLICA en el DEMO**, no «probado por semejanza».

## Cadena con cambio de actor (`e2e/review/qa-cadena-distribuida.mjs`, sobre `fc8afbd`): 11/11
Registros «QA-1030» en la Cooperativa Río Verde; idempotente.
1. **ORG_ADMIN** registra productor y parcela asignados al técnico 1; el **técnico 1** captura el polígono (1 versión, `MANUAL_COORDINATES`); técnico 2, lo no asignado y escribir sin asignación → 404.
2. **RECEPCIÓN**: entrega con origen y recepción con peso y muestra; el reintento no duplica la recepción; no crea productores (403).
3. **CALIDAD**: decisión humana `RELEASED` con límites declarados («No es liberación jurídica»); la recepción no decide (403).
4. Soporte de la entrega (PDF) con huella vinculado por la administración; el **MANAGER** crea el lote; el auditor no (403).
5. **EUDR**: expediente e instantánea; `READY` no se fuerza (preparación `BLOCKED`; `DELIVERY_SUPPORTS` MET, `DEFORESTATION_ANALYSIS` y `LEGAL_PROFILE` NOT_EVALUABLE, `RISK_REVIEW_RESOLVED` PENDING); el soporte figura en la instantánea con su huella; el técnico no abre expedientes (403).
6. **Paquete interno**: JSON con referencias por versión y huella (`attachments.included=false`), `NOT_SUBMITTED`, sin los bytes del PDF.
7. **Concesión con soportes** al comprador: lista exacta (1 soporte, 0 excluidos), descarga con huella igual; versión ajena, otra cuenta del importador y backoffice → 404.
8. **Pantallas** (1280 y 390 px, sin desborde): el concedente ve «Incluye los soportes»; el comprador ve la advertencia de vista limitada y descarga la versión exacta.
9. **Propietaria → exportadora**: la parcela se autoriza a la Exportadora; ve la parcela sin coordenadas ni productor; encargar hoy **BLOQUEADO** (`SATELLITE_REQUESTS_NOT_AUTHORIZED`, D-09 B: Whisp es adaptador de desarrollo); por la ruta de la propietaria 404; el auditor no encarga (403); revocar → 403 `SATELLITE_AUTHORIZATION_REVOKED` y desaparece de su lista. **El caso positivo** (encargo con la credencial del solicitante, revalidación del worker, versión y huella, descarga) está en `satellite-autorizacion.int-spec.ts` (16) y el servicio real con geometría artificial en `EVIDENCIA_WHISP_ENSAYO_REAL_2026-10-29.md`.
10. **AUDITOR** reconstruye quién hizo qué (acciones por actor: administración, recepción, calidad, supervisor y EUDR distintos) y no puede escribir (403).

También: el Productor (Ana Vélez, demo) consulta el satélite de **su** parcela (200; «Tu rol no encarga análisis satelitales»), no el de una ajena (404), y no encarga ni autoriza (403). Incidencia del Productor y su recorrido (6/6): `qa/EVIDENCIA_PRODUCTOR_INCIDENCIA_2026-10-30.md`.

Revisión web por rol ya existente (`web-por-rol.mjs`): **APROBADO**, 22 combinaciones de 19 cuentas (menú frente a permisos, «Mi trabajo», Lot Hub, filtros, teclado, 390 px y zoom 200 %). Capturas refrescadas en `docs/qa/capturas/web-por-rol/`.

## Defectos hallados y corregidos
| Defecto | Dónde | Corrección | Prueba |
| --- | --- | --- | --- |
| Migración 0072 fallaba con trabajos satelitales terminados | despliegue | suspende solo durante el relleno el disparador de transiciones | `satellite-autorizacion.int-spec` (bajar a 0071 y subir con un trabajo COMPLETED) |
| El worker no revalidaba la autorización antes de enviar | satélite entre organizaciones | revalida revocación, vencimiento y organizaciones activas | 0 envíos en 3 casos; 1 en el control |
| El auditor de la exportadora podía descargar el original | satélite | exige `satellite:request` además de la descarga concedida | integración |
| El listado de instantáneas para compartir respondía 500 | concesiones | columna correcta (`captured_at`) | `access-grants-soportes.int-spec` |
| El comprador no recibía su indicador `include_documents` en `GET /granted` | concesiones | se expone | integración y e2e |
| El aviso de descarga ensanchaba la página a 390 px | pantalla del comprador | parte la línea | e2e `concesiones.spec` |
| Productor sin vínculo no podía trabajar; faltaba el botón de la primera parcela; subtítulo del técnico; encabezado poco orientador | Productor | vínculo por el mecanismo existente; botón; subtítulo propio; encabezado | e2e `mi-finca.spec` |

## Relación finita de pendientes (responsable y acción)
- **Registros QA duplicados** (ENT-2026-00007, LOT-2026-00009 y su expediente): los dejó una pasada anterior del guion no idempotente; se conservan y se declaran. El guion ya es idempotente.
- **Encargo real de Whisp desde el recorrido distribuido**: requiere D-09 parte B y `SATELLITE_LIVE_CALLS` (decisión del propietario); no se activó.
- **Cancelación y descarga alternativa de Whisp**: solo pruebas controladas; no observadas en el servicio real.
- **País y periodo de producción en la instantánea**, perfil de destino y presentación oficial: ver `13`; dependen de decisiones y de terceros.
- **Un comprador no recibe geometrías ni documentos personales por esta vía**: una vista limitada puede no bastar para su debida diligencia; hace falta definir con el propietario qué más debe entregarse y bajo qué autorización.
- **Roles sin datos propios en el DEMO** (Exportadora sin lotes): caso positivo solo en pruebas aisladas.
- Teléfono físico: al final. D-40 sigue en la opción A.
