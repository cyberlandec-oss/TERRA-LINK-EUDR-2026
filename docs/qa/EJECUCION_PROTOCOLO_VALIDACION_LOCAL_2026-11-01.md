# Ejecución del protocolo de validación local completa — primera pasada (2026-11-01)

Instalación identificada: API/web desplegadas en **`74d0f39`** (esquema `0077`, `/version` sin `+sucio`), localhost y 127.0.0.1 responden; HEAD `5e11262`, remoto sincronizado (0 0). Los commits posteriores a `74d0f39` solo tocan documentación. Cuentas existentes; sin seed, cuentas nuevas, claves ni respaldos. **Esta es una pasada parcial: no cierra el protocolo** (ver «No ejecutado»).

## Qué se ejecutó
| Caso | Recorrido | Resultado | Evidencia |
| --- | --- | --- | --- |
| E00 instalación y acceso | R1 | PASA | `/version`, salud web/API, login por alias local |
| Cuentas y contextos (sec. 4) | R1 | **PASA: 22 combinaciones de 19 cuentas** (menús = permisos efectivos, Mi trabajo, denegaciones, teclado, 390 px, zoom 200 %) | `e2e/review/web-por-rol.mjs` → `docs/qa/web-por-rol/matriz.json` |
| E02, E05–E08, E10–E11, E13–E14, E16, E19, E23 (parcial) | R1, marca `ENSAYO-LOCAL-DD-1101` | T1–T14 resueltos: **T1–T8, T10, T13, T14 PASA; T9, T11, T12 BLOQUEO ESPERADO** | `e2e/review/cadena-integral-web.mjs` → `validation-results/cadena-integral-web-2026-11-01/resultado.json` |
| R2/R3 (integración, aislamiento, cadena técnica) | R2/R3 | PASA, reutilizado | `npm run validate` APROBADA sobre `74d0f39` (`validation-results/2026-10-31T18-40-59-945Z`), que incluye `cadena-tecnica-completa.int-spec.ts` (R3, `READY` preparado) |

### Último paso real de R1
Cadena creada: parcela `ENSAYO-LOCAL-DD-1101` (geometría técnica VALID) → ENT-2026-00008 (500 kg declarados) → recepción 480 kg → calidad liberada por decisión humana → LOT-2026-00010 (480 kg) → fermentación LOT-2026-00011 (450 + 30 kg de merma; ledger conciliado) → evaluación de riesgo → mitigación → expediente con instantánea 1 → embarque con 450 kg reservados → auditor reconstruye hasta la parcela → comprador consulta solo lo concedido (sin identidad ni geometrías; recurso ajeno 404).
**Requisito concreto que detiene R1:** el paquete no alcanza `READY` (`RISK_CATALOG_APPROVED`, `REGULATORY_CONCLUSION`, `GEOLOCATION_PROFILE`, `LEGAL_PROFILE` dependen de revisión regulatoria/decisiones externas; `RISK_NO_BLOCKING_FINDINGS` depende de D-09.B y D-05.B) y por eso el despacho queda bloqueado (4 comprobaciones). No se simuló ninguna aprobación. Cantidades distintas a las del protocolo (500/480/450 en vez de 220+180/400/360/300): el script vigente usa su propio caso y mantiene el balance real; no se alteró para coincidir.

## Hallazgos
1. **Guion de revisión desactualizado (no defecto de producto):** `revision-por-rol.mjs` → `parcelas.mjs` esperaba el botón del polígono sin elegir la pestaña «Polígono por vértices» (la pantalla ofrece los métodos como pestañas). Corregido en `parcelas.mjs`. `geojson.mjs` tiene el mismo desfase (pestaña «Importar GeoJSON») y **queda pendiente**; ese script y los posteriores de `revision-por-rol.mjs` no se ejecutaron. La cobertura vigente de esas pantallas son los e2e de `npm run validate` y `web-por-rol.mjs`.
2. **T15 NO_DEFINIDO (traspaso entre organizaciones):** la Exportadora no recibe los lotes de la cooperativa; la documentación define lectura (P1-001) e intercambio con guía (P1-006), no un traspaso de lotes. Coincide con la compuerta A-03/D4 pendiente de decisión del propietario.
3. **F02** sigue siendo limitación abierta: el técnico con alcance asignado no ve los vínculos de sus entregas.

## No ejecutado en esta pasada (permanece pendiente, no aprobado)
E01 (vínculo productor en R1), E03 (versiones geométricas y exportación GeoJSON por rol), E04 (versiones de documentos, privacidad, archivos dañados), E09/E10 con las cantidades del protocolo, E12 (análisis distribuido y fallos del proveedor: cubierto solo por la validación vigente, sin repetición dirigida), E15 (conclusión humana: no se hizo en el DEMO), E17–E18 (revisión, aprobación y paquete reales: dependen de `READY`; solo R3), E20 (despacho: bloqueado), E21 (vigencia en casos separados), E22 (móvil/offline: sin cambios de código desde la evidencia vigente; no repetido), matriz de información del expediente (sec. 8) y comparaciones antes/después de la sec. 7 por caso. La revisión visual de pantallas y la matriz R1 completa por rol/escritura requieren otra pasada.

## Cuatro conclusiones (sec. 9)
- **Construcción:** la cadena parcela → entrega → recepción → calidad → lote → proceso → inventario → riesgo → expediente → embarque → consulta del comprador existe y opera; sin implementar: traspaso de lotes entre organizaciones, presentación DDS (P1-007 tramos siguientes).
- **Demostración local:** 22/22 contextos y R1 hasta la compuerta de `READY`, con cuentas existentes y datos `ENSAYO-LOCAL-DD-1101`.
- **Ramas controladas:** R3 (`cadena-tecnica-completa`) prueba aprobación, paquete y concesiones sobre un `READY` preparado; **no** demuestra que R1 lo produzca.
- **Aceptación/servicios oficiales:** nada de esto acredita conformidad EUDR, presentación DDS ni producción. Porcentajes 42/60 (70 %) y 30/44 (68,2 %) sin cambio.

## Segunda pasada: `revision-por-rol.mjs` (guion antiguo) — sin valor probatorio hasta actualizarlo
Tras corregir `parcelas.mjs` y `geojson.mjs` (pestañas por método), el guion completo se ejecutó: **41 entradas, 18 con incidencias** (parcelas, CTE, documentos, entregas, lotes, mitigaciones, diligencia, satélite, conteos de productores 11 vs 8 esperados, «capacidades pendientes rotuladas» 0). **No se trianguló cada una y no se declaran defectos ni aprobaciones a partir de ellas**: el guion afirma textos, conteos y estados fijos del DEMO de octubre (p. ej. «Pendiente de evaluación», balance 150 = 140 + 10, 8 productores), y el DEMO cambió con las ejecuciones posteriores (incluida la cadena `ENSAYO-LOCAL-DD-1101`, que libera calidad y forma lotes). Sospechosos que sí merecen triaje real antes de descartarlos: acceso del productor a la pantalla de documentos (enlace=1, denegado=0) y el estado satelital del técnico (tarjeta ausente pero sin «sin datos»). Siguiente paso recomendado: sustituir este guion por pruebas con datos propios (e2e o integración) en vez de afirmaciones sobre el DEMO vivo; la cobertura vigente de esas pantallas sigue siendo `npm run validate` (APROBADA sobre `74d0f39`) y `web-por-rol.mjs` (22/22). Se descartó el JSON bruto de esa corrida (no versionado por no ser una prueba concluyente).

### Triaje de los dos sospechosos (2026-11-01, API real, cuentas existentes, solo lectura)
- **Productor → Documentos: NO es defecto.** El catálogo (`catalog.ts`, PRODUCER) concede `document:read` y `document:upload` a propósito («puerta de entrada» para aportar soportes, E04). Con la cuenta del productor la API devuelve 4 documentos; la administración ve 10 (alcance propio, no filtración). La expectativa del guion antiguo («acceso denegado») estaba desfasada. Pendiente no cubierto: comprobar el contenido de tipos personales (política de metadatos sin contenido) en una prueba dirigida con datos propios.
- **Técnico → tarjeta satelital: NO es defecto.** El técnico no tiene `satellite:read`: la API responde 403 `PERMISSION_DENIED` y la ficha no muestra la tarjeta. El «sin datos» que esperaba el guion no aplica a un rol sin permiso (coherente con «no reemplazar acceso restringido por sin datos»).
Resultado: de los dos sospechosos ninguno es defecto de producto; las otras 16 incidencias del guion antiguo siguen sin triar y sin valor probatorio.

## Clasificación de las observaciones restantes de `revision-por-rol.mjs` (tercera pasada)
Reejecutado el guion: 15 `FALLA` con detalle (más las notas «Tarea», datos del DEMO). Cada una se contrastó con la condición exacta del guion, el texto/código vigente de la web y, donde la interfaz decidía, una sonda en pantalla. **Ninguna es defecto reproducible del producto.** Las cifras fijas del guion (5 parcelas, 11 hitos con 5 pendientes, 150 = 140 + 10) eran del DEMO de octubre.

| # | Observación | Clasificación | Evidencia |
| --- | --- | --- | --- |
| 1 | parcelas · admin | **No concluyente (evidencia insuficiente)** | Las 6 parcelas DEMO-PAR están en la lista y no hay paginación; el guion no imprime qué condición falla (¿foco o enlaces «volver»?). Se cubre con e2e de parcelas de `validate` |
| 2 | parcelas · técnico asignado (esperaba 5, ve 14) | Expectativa desfasada / dato | Las parcelas creadas después (incluida la de `ENSAYO-LOCAL-DD-1101`) se asignan al técnico; la restricción a asignados se prueba en integración |
| 3 | polígono por rol (admin 0) | Expectativa desfasada | La acción vive bajo la pestaña «Polígono por vértices». Sonda: admin sin pestaña 0, con pestaña 1; auditor: sin pestaña, sin captura y sin «Capturar ubicación» (la restricción de seguridad se cumple) |
| 4 | coordinador · exportadora (esperaba 0, ve 1) | Dato | La exportadora tiene una parcela por concesión/prueba satelital posterior; autorizada, no filtración |
| 5 | CTE admin (3 pendientes/8 integradas vs 5/6) | Expectativa desfasada | Más hitos integrados desde la cifra del guion; sin acciones operativas (0) y sin desborde |
| 6 | documentos · técnico, foco | Expectativa desfasada | Los identificadores de React cambiaron (`_r_0_-title`); sin botón de revisión y sin desborde |
| 7 | documentos · productor «sin permiso» | Expectativa desfasada | Catálogo: PRODUCER tiene `document:read/upload` (ya triado) |
| 8 | mitigaciones · segunda persona | Dato | «sin cambios (ya revisada)»: el guion no es idempotente; la decisión original se conserva (`true`) |
| 9 | mitigaciones · riesgo tras reevaluar | Expectativa desfasada / dato | Evaluación vigente 1, DATA_MISSING_ORIGIN y MITIGATION_UNVERIFIED visibles, conclusión Indeterminada; solo no coincide la frase de «sin revisión humana» (no existe en la web) |
| 10 | diligencia · responsable EUDR | Expectativa desfasada | Sonda en DD-2026-00003: GEOLOCATION_PROFILE, LEGAL_PROFILE y D-05 visibles, «no evaluable» presente, paquete deshabilitado, presentación oficial «no presentada» |
| 11–13 | lotes (3) | Expectativa desfasada | D-32: la humedad del secado es %BH con método declarado; ya no existe la frase «bloqueado hasta definir la unidad de humedad»; el proceso cerrado usa datos distintos a 150/140/10 |
| 14 | entregas · admin («aviso de no conformidad») | Expectativa desfasada | Esa frase ya no existe en la pantalla de entregas |
| 15 | entregas · calidad (sigue «Pendiente») | Dato | Esa entrega ya tiene decisión de calidad de ejecuciones anteriores |

Nada se cambió en el producto. Los asserts de seguridad (auditor sin captura, técnico no asignado sin acceso, permisos por organización) pasan y no se tocaron. **No se reescribió el guion antiguo**: se sustituye por pruebas con datos propios (siguiente punto); su cobertura sigue siendo `npm run validate` + `web-por-rol.mjs`.

---
# Cierre de la ejecución (2026-11-01)

## Conciliación del inventario de observaciones
La cifra «16» era 18 incidencias de la primera corrida (10 notas «Tarea» + 8 módulos) menos los 2 sospechosos ya triados. La tabla de 15 clasifica las líneas `FALLA` de la **segunda** corrida: una de ellas (productor→Documentos) ya estaba triada y el técnico→tarjeta satelital **no se repitió**. Resultado: 14 nuevas clasificadas + 2 triadas antes; **las 10 notas «Tarea» no estaban en la tabla** y se clasifican aquí:

| Nota «Tarea» | Clasificación | Motivo |
| --- | --- | --- |
| supervisor / coordinador: «11 productores visibles (esperado 8)» y «1 posible duplicado» | Dato | los productores del DEMO crecieron con ejecuciones posteriores; la cifra fija era de octubre |
| técnico1: «7 productores visibles (esperado 5)» | Dato | las asignaciones crecieron (incluida `ENSAYO-LOCAL-DD-1101`) |
| productor, recepción×2, calidad×2, exportación, comprador: «0 capacidades pendientes rotuladas» | Expectativa desfasada | la regla de la web (`50-frontend.md`) deja los módulos futuros fuera del menú; ya no hay capacidades rotuladas como pendientes |

**Sigue pendiente de comprobación, sin declarar resuelta:** parcelas del administrador (#1: las 6 parcelas DEMO-PAR están en la lista, pero el guion no identifica qué condición falla). Las demás: sin defecto de producto.

## Defecto corregido y verificado (documentos del Productor)
- **Defecto:** el Productor vinculado recibía 403 al subir un documento a su **propio registro de productor** (la web se lo ofrece). El servidor exigía `producer:update_own`, que no tiene, aunque `docs/07` le da documentos propios.
- **Corrección** (`documents.ts`, `entityScope`): solo para *subir* a un productor, si el alcance de edición falla y la cuenta tiene `producer:read_own` **y** `self_membership_id` igual a su membresía, se admite. No cambia permisos generales ni el alcance de lectura.
- **Integración** (`documents-productor.int-spec.ts`, 5 pruebas): propio operativo (campos, hash, descarga idéntica); propio personal (metadatos sí, contenido 403 `CONTENT_RESTRICTED`); subida al productor propio 201 con contenido restringido; productor ajeno 404 en ambos sentidos; sin edición del registro; sin revisión propia (**403 en la ruta real `/reviews`, con control de la administración 201**). Se detectó y corrigió un falso positivo propio: la primera versión probaba `/review` (ruta inexistente, 404).
- **Candidato `61c931d`:** `npm run validate` **APROBADA** (`validation-results/2026-11-01T02-04-32-681Z`, árbol limpio durante la corrida); desplegado una vez (`/version` = `61c931d`, esquema `0077`).
- **Demostración sobre el despliegue** con la cuenta existente `productor.cooperativa` (`e2e/review/productor-documento-demostracion.mjs`, **8/8**): subida web de dos soportes ficticios (`ENSAYO-LOCAL-DD-1101`, operativo y de tenencia) al productor vinculado (única opción de titular visible: el propio); consulta posterior; ambos **sin revisión**; operativo descargable con huella coincidente; personal con contenido restringido y sin nombre de archivo; revisión propia 403 (control de ruta 400 con cuerpo inválido, sin aprobar nada); documento ajeno 404 (la administración ve 12, el productor 6); pantalla sin botones de descarga ni revisión. Capturas: `docs/qa/capturas/productor-documentos-subida.png` y `productor-documento-personal.png`. Dos registros ficticios rotulados quedan en el DEMO; un reintento los reutiliza.

## Matriz E01–E23
Columnas: **I** integración ejecutada (base desechable; 46 suites y 523 pruebas dirigidas el 2026-11-01, más `validate` sobre `61c931d`), **V** recorrido visual o R1 en la instalación, **R** evidencia anterior reutilizada, **P** comprobación pendiente.

| Etapa | I | V | R | P |
| --- | --- | --- | --- | --- |
| E00 instalación | — | `/version`, salud, login localhost y 127.0.0.1 | — | `[::1]` no probado |
| E01 organización y vínculo | members, producers, a01 | `web-por-rol` 22/22 | — | acción de vínculo en R1 no repetida |
| E02 parcela Productor/técnico | plots, polygon-drafts, location-capture, a01 | R1 T1 (técnico) | emulador previo | captura del Productor en pantalla no repetida |
| E03 geometría y versiones | gis-evaluation, geometry-imports, history | R1 T2 | — | GeoJSON por rol en pantalla (`geojson.mjs` desfasado) |
| E04 documentos y versiones | documents, document-types, evidence, **documents-productor** | **Productor en la web, 8/8** | — | versión nueva desde la web; archivos dañados solo en integración |
| E05 declaración y origen | deliveries, delivery-own, produccion-instantanea | R1 T3 | declaración móvil offline | — |
| E06 recepción | deliveries | R1 T4 | — | — |
| E07 calidad | deliveries | R1 T5 | — | rama rechazada solo en integración |
| E08 lote y origen | lots | R1 T6, T13 | — | — |
| E09 fermentación | lots | R1 T7 (450 + 30) | — | — |
| E10 secado e inventario | lots, inventory | R1 T8 (conciliación) | — | secado en R1 no ejecutado (D-32) |
| E11 embarque y reserva | shipments | R1 T12 (450 kg reservados) | — | — |
| E12 análisis | satellite, satellite-autorizacion, satelite-riesgo-expediente | — | ensayo Whisp real con geometría artificial | sin llamadas nuevas |
| E13 configuración y riesgo | risk, geo-profile | R1 T9 | — | sin adopciones competentes |
| E14 hallazgos y mitigaciones | mitigations | R1 T10 | — | verificación por segunda persona (requiere documento vigente real) |
| E15 conclusión humana | risk-conclusion | — | — | no se registra en el DEMO (sin catálogo ni perfil aprobados) |
| E16 expediente e instantánea | dd, dd-geo-panel | R1 T11 | — | — |
| E17 revisión y aprobación | **R3** cadena-tecnica-completa | bloqueado en R1 | — | R1 no llega a `READY` |
| E18 paquete | **R3** cadena-tecnica-completa, exchange | bloqueado en R1 | paquete DD con instantánea vigente (A-08/A-09 7/7) | paquete en R1 no generable |
| E19 comprador y concesiones | access-grants (3 suites) | R1 T14 | — | — |
| E20 despacho y traspasos | shipments, d34a-despacho, custody-transfers | R1 T12 (compuerta), T15 | — | traspaso de lotes sin implementar |
| E21 vigencia e historia | history, produccion-instantanea, event-corrections, gis-evaluation | — | — | casos de desactualización en R1 sin ejecutar |
| E22 móvil y offline | sync, sync-altas, sync-productor, location-capture (servidor) | — | emulador (`docs/qa/movil-emulador`); sigue aplicable: el cambio de servidor solo toca la subida a un productor propietario y la sincronización de campo usa parcela; no se reconstruyó el APK | teléfono físico y GPS real (fuera de etapa) |
| E23 auditoría e informes | reports, audit | R1 T13, `web-por-rol` | — | — |

## Hasta dónde llega el recorrido normal y por qué se detiene
R1 con datos propios (`ENSAYO-LOCAL-DD-1101`) llega a parcela, entrega, recepción, calidad, lote, fermentación, inventario, evaluación, mitigación abierta, expediente con instantánea y embarque reservado; el comprador consulta lo concedido. **No alcanza `READY`.**

| Requisito | Motivo | Qué falta |
| --- | --- | --- |
| `GEOLOCATION_PROFILE` | no hay configuración geográfica adoptada con revisión vigente | configuración y decisión competente (el mecanismo existe) |
| `LEGAL_PROFILE` | el perfil jurídico no tiene revisión competente (D-07.5/D-37) | decisión competente (el mecanismo existe) |
| `RISK_CATALOG_APPROVED` | catálogo sin aprobación | decisión competente |
| `REGULATORY_CONCLUSION` | requiere una conclusión humana posterior a lo anterior | decisión humana (mecanismo implementado) |
| `RISK_NO_BLOCKING_FINDINGS` | depende de D-09.B (uso del análisis satelital sobre parcelas autorizadas) y D-05.B | decisión del propietario |
| Soportes de la entrega y mitigación `DOCUMENT_EXPIRED` | falta un documento real y la verificación por otra persona | datos reales |

El despacho queda bloqueado por la misma compuerta (4 comprobaciones). **Ramas posteriores** (aprobación, paquete, concesiones, desactualización): solo **R3** (`cadena-tecnica-completa`, `READY` forzado en base desechable); no se presentan como éxito de R1. Implementación pendiente real: traspaso de lotes entre organizaciones (T15) y presentación DDS (P1-007, siguientes tramos).

## Limitaciones
Teléfono físico y GPS real; aceptación jurídica; presentación DDS; la observación #1 (parcelas del administrador); `revision-por-rol.mjs` sin reescribir; F02 (técnico asignado sin vínculos de entregas). Los porcentajes de aceptación **no cambian**: esta corrección no está asociada a un criterio de aceptación registrado y no se propone ninguna fila.
