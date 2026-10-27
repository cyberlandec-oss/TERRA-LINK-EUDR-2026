# Recorrido integral de la cadena desde la web, por rol (2026-10-20/21)

Complementa `docs/qa/MATRIZ_RECORRIDO_INTEGRAL.md` (recorrido de integración por API, 10 casos) con el **mismo encadenamiento hecho en el navegador**, un rol por transición,
sobre la organización **DEMO · Cooperativa Río Verde** (datos **sintéticos**; no se creó ninguna organización). Es preparación de **P0-031**: **no es el piloto** (sin operadores reales, sin
Android real, sin dataset de piloto). A-01, el catálogo original de 60 requisitos y la aceptación externa pendiente siguen **separados**; este recorrido no cambia ningún porcentaje.

- Guion: `e2e/review/cadena-integral-web.mjs` · resultado: `validation-results/cadena-integral-web-2026-10-21/resultado.json` (+ capturas, no versionadas).
- Ejecución final (marca `CAD-1021010428`): **15 transiciones; 0 defectos del producto; 0 respuestas HTTP ≥ 400 inesperadas.** No se ejecutó `validate` (no cambia código funcional).
- Datos: cada ejecución agrega **un** conjunto marcado `CAD-<mes día hora min seg>` (parcela, entrega, lote de entrada, proceso, lote de salida, comprador, embarque, mitigación, expediente). Las ejecuciones de puesta a punto del guion
  dejaron además conjuntos `CAD-…` incompletos en la misma organización (10 parcelas `CAD-*`, 13 lotes con insumos en total, 5 compradores `CAD-*`, 9 mitigaciones `CAD-*`): son **datos sintéticos de ensayo**, identificables por su marca, y no se borraron.
- Cuentas: las DEMO de `CREDENCIALES.csv` (leídas con la utilidad segura; ninguna contraseña impresa ni versionada).
- **No se simuló ninguna aprobación ni se desbloqueó ninguna compuerta.**

## Clasificación
- **OK** — recorrido implementado y demostrado · **BLOQUEO ESPERADO** — la compuerta vigente se comporta como debe (no es defecto) · **DEFECTO** — fallo funcional reproducible · **PENDIENTE ORIGINAL** — implementación definida y autorizada que falta · **NO DEFINIDO** — la documentación no lo define (no se implementa por interpretación).

| # | Transición | Actor (rol, cuenta DEMO) | Qué recibe el siguiente rol / qué hace desde la interfaz | Resultado |
| --- | --- | --- | --- | --- |
| T1 | Productor → parcela y geometría | Técnico de campo asignado (`tecnico1.cooperativa`) | Crea la parcela, escribe el polígono, el servidor lo revisa **sin guardar** y se confirma la versión 1 `MANUAL_COORDINATES` (sin precisión). Recibe la administración: parcela con geometría registrada, pendiente de evaluación | **OK** |
| T2 | Geometría → evaluación GIS | Administración (`admin.cooperativa`) | Evalúa en la ficha: estado **técnico** (VALID en la ejecución final) con la salvedad «no es conformidad EUDR»; la procedencia es visible. (En una ejecución anterior dio REVIEW_REQUIRED por **geometría idéntica** a otra parcela de una ejecución previa: la regla funcionó; el guion ahora desplaza el trazado) | **OK** |
| T3 | Parcela → entrega | Administración | Registra la entrega con la parcela de origen y el aviso «no es un expediente completo, producto liberado ni cumplimiento EUDR» | **OK** |
| T4 | Entrega → recepción | Operador de recepción (`recepcion.acopio`) | Revisión previa → confirma 480 kg de 500 declarados; la entrega sigue abierta; calidad «Pendiente de evaluación» para el siguiente rol | **OK** |
| T5 | Recepción → calidad | Operador de calidad (`calidad.acopio`) | Registra muestra y resultado (humedad en %BH) y decide: «Calidad liberada por decisión humana (límites declarados, no verificados)» | **OK** |
| T6 | Recepción → lote | Supervisión (`supervisor.cooperativa`) | Forma el lote de 480 kg con el origen heredado y la calidad liberada | **OK** |
| T7 | Lote → proceso → salida | Administración | Prepara, inicia y cierra la fermentación (480 = 450 + 30; rendimiento 93,75 %, «no es base seca»); el lote de salida enlaza al de entrada. **Nota de roles**: en el DEMO de Río Verde solo ORG_ADMIN tiene `process:manage` (el rol Responsable de trazabilidad existe solo en la Exportadora); el MANAGER ve los procesos pero no los opera | **OK** |
| T8 | Salida → inventario | Administración | La existencia por lote y centro refleja 450 kg; «Comprobar conciliación» → Conciliado. El MANAGER solo consulta | **OK** |
| T9 | Lote → riesgo | Responsable EUDR (`eudr.cooperativa`) | Evaluación técnica 1, **incompleta**, «no es conclusión regulatoria»; no evaluables por decisiones externas (`GEOLOCATION_PROFILE`, D-05) | **BLOQUEO ESPERADO** (D-05.B, D-07.5/7.6) |
| T10 | Riesgo → mitigación | Responsable EUDR | Crea la mitigación desde la causa `DOCUMENT_EXPIRED` y la asigna; el responsable (administración) la recibe en «Mi trabajo → Mitigaciones asignadas a ti». Solo administración y EUDR pueden ser responsables | **OK** |
| T11 | Lote → expediente DD | Responsable EUDR | Crea el expediente y captura la instantánea 1; «Generar paquete» **bloqueado**; sin evaluar: `RISK_CATALOG_APPROVED`, `REGULATORY_CONCLUSION`, `GEOLOCATION_PROFILE`, `LEGAL_PROFILE`; READY inalcanzable | **BLOQUEO ESPERADO** |
| T12 | Lote → preparación de exportación | Administración | Registra comprador, crea el embarque, agrega el lote y **reserva 450 kg** en el ledger. «Despachar» queda deshabilitado con 3 comprobaciones que bloquean: `DD_PACKAGE` (ninguna instantánea aprobada), `EVIDENCE` (se acredita con el paquete aprobado) y `GATE SHIPMENT_DISPATCH` (dato requerido ausente) | **BLOQUEO ESPERADO** (D-34, D-05.B) |
| T13 | Auditoría hacia atrás | Auditor (`auditor.cooperativa`) | Desde el lote de salida ve el lote de entrada, la entrega y la parcela de origen, sin identidad del productor y sin acciones operativas (solo lectura) | **OK** |
| T14 | Compartir con el destinatario | Comprador externo (`comprador.importador`) | Con una concesión de LECTURA vigente (otorgada por la administración **por API**; las concesiones de ensayo previas estaban revocadas/vencidas y por eso no veía nada) ve la proyección autorizada: sin identidad ni geometrías; el recurso en el espacio de la cooperativa le responde 404 | **OK** |
| T15 | Cooperativa → Exportadora (traspaso de lotes entre organizaciones) | Responsable de trazabilidad de la Exportadora | La Exportadora tiene 0 lotes y no ve los de Río Verde. La documentación define concesiones de lectura (P1-001) y el intercambio con GUIA (P1-006), **no** un traspaso de lotes entre organizaciones | **NO DEFINIDO** |

## Resumen por categoría
- **Implementado y demostrado**: T1–T8, T10, T13, T14 (transiciones con su rol, la información que pasa al siguiente y la acción que completa desde la interfaz).
- **Defecto funcional reproducible**: **ninguno** del producto. Durante la puesta a punto del guion aparecieron fallos **del guion** (forma de `product_state`, selectores, marca repetida en el mismo minuto), corregidos; no hubo cambios de código del producto.
- **Implementación original pendiente (definida y autorizada)**: **ninguna nueva** en este recorrido. Siguen las ya registradas: criterios con teléfono de P0-023/P0-024, P0-017/P0-022/P0-028/P0-029 en lo que dependen de D-05.B, D-07.5/7.6, D-09.B y D-34.
- **Bloqueos esperados** (no son defectos): T9, T11, T12 — revisión regulatoria (D-05.B, D-07.5/7.6), catálogo/perfil jurídico y compuerta de despacho (D-34). READY y el despacho **no** se alcanzan y no se forzaron.
- **No definido en la documentación** (se registra para decisión del producto; no se implementó):
  1. **Traspaso de lotes entre organizaciones** (T15): hoy la cadena opera dentro de la organización que posee los lotes; los demás actores externos solo reciben lectura por concesión.
  2. **Pantalla de la organización propietaria para otorgar/revocar concesiones** (T14): existe la API (`grant:manage`) y el portal del destinatario (P1-001 DONE_LOCAL), pero no una pantalla de gestión; la aceptación registrada de P1-001 no la incluye.
  3. **Reparto de roles del DEMO**: Río Verde no tiene Responsable de trazabilidad ni de exportación; procesos y embarques los opera ORG_ADMIN. Es una decisión de datos de ensayo, no de producto (el recorrido de integración cubre EXPORT_MANAGER dentro de su organización).

## Alcance de lo no recorrido aquí
Importación de productores y flujo móvil/offline (workflows 1 y 2 de `docs/14`) y exportación de hallazgos de auditoría (workflow 7, parte de exportar) se acreditan en sus propios E2E/integración y en la evidencia móvil existente; el ensayo físico Android sigue pospuesto.

## Corte temporal de la organización de prueba manual
La organización «ENSAYO A-01 · prueba manual 2541» (guía `docs/qa/GUIA_PRUEBA_A01_WEB.md`, cuentas en `CREDENCIALES_A01.csv` local e ignorado por git) se creó **después** del respaldo `_respaldos/2026-10-20-a01-mapa-fotos-0057`; ese respaldo **no** la contiene ni se le atribuye recuperación. Tampoco contiene los registros `CAD-*` de este recorrido. Se tomará un respaldo nuevo cuando corresponda a un cambio persistente que lo justifique.
