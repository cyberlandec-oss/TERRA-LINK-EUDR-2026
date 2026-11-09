# D-34, D-35 y D-33 (parte de recepción) — Propuesta para P0-012 Entregas (NO APROBADA)

Estado: **PROPUESTA** para decisión de Producto/Trazabilidad. Nada se activa hasta aprobarla. Adelantar P0-018 (Documentos) resuelve la capacidad técnica de referenciar y verificar un soporte, pero **no ratifica D-35**.

Fuentes leídas: S1 §§19–20 (entregas), §43 (paquete de diligencia: «production_period»; Guía para intermediarios: «periodo de producción»), S2 (Recepción → Pesaje → Calidad), S4 §7.5–7.6 (calidad conectada al lote), docs/05 (entrega con periodo explícito; varios orígenes con cantidades), docs/06 (deliveries, receptions, quality), docs/08 (KDE mínimos, `ReceptionCorrected`), docs/14 (flujo de acopio: buscar → pesar → clasificar → confirmar → generar lote), UX_UI §7.6 (recepción: «pesar y confirmar»; comprobante según contrato).

## Estados propuestos para P0-012

| Estado | Qué significa | Compuerta KDE |
| --- | --- | --- |
| Entrega **borrador** | Captura en curso (campo o acopio); puede tener faltantes | Ninguna (los faltantes se muestran como faltantes) |
| Entrega **confirmada** | El declarante afirma la entrega: proveedor, origen, producto, fecha, peso declarado, periodo y soporte | DELIVERY@1 completo (`gate.transition_allowed`) |
| Recepción **confirmada** | El centro recibió y pesó una cantidad de una entrega confirmada (parcial o total) | RECEPTION@1 + WEIGHING@1 |
| Clasificación registrada | Decisión de calidad sobre la muestra del lote recibido | CLASSIFICATION@1 (ver D-33) |

## D-34 — `production_period`

| Aspecto | Propuesta | Fundamento |
| --- | --- | --- |
| Significado | Periodo (inicio–fin) en que se produjo/cosechó el cacao de **esa** entrega | S1 §43 y la Guía para intermediarios lo listan como información requerida del paquete; docs/05 exige periodo explícito en la entrega |
| Quién lo registra | Quien declara la entrega (productor o técnico de campo); procede de la declaración del productor, no se deriva de la fecha de entrega | docs/08 (actor de DELIVERY) |
| Condición | **Requerido para confirmar la entrega** (opcional en borrador). Se elimina la condición indefinida: pasa de CONDITIONAL a REQUIRED en una nueva versión del catálogo KDE | Todo el cacao que entra al paquete necesita periodo; dejarlo condicional sin regla bloquea todo |
| Formato | Rango de fechas `inicio ≤ fin`; regla propuesta: `fin ≤ fecha de entrega` | Coherencia temporal (regla nueva, a ratificar) |
| Desconocidos | Si se desconoce, queda **faltante** y la entrega no se confirma; no se infiere de la fecha de entrega | «Datos faltantes siguen siendo desconocidos» (CLAUDE.md) |
| Transición bloqueada | Borrador → entrega confirmada | — |
| **Regla faltante** | Granularidad: si el productor solo conoce el mes, ¿se admite un rango mensual explícito (p. ej. «2026-09») o solo días? Hoy el tipo es por días; registrar un mes como «1–30» inventaría precisión | Requiere decisión |

Alternativas descartadas: (B) condicional «si la entrega va a un paquete de diligencia» — no se sabe al registrar y bloquearía después; (C) derivarlo de la fecha de entrega — inventa un dato.

## D-35 — Soporte documental de la entrega (`DELIVERY_SUPPORT`)

| Aspecto | Propuesta | Fundamento |
| --- | --- | --- |
| Documento | Documento de tipo `DELIVERY_SUPPORT` cuyo titular es el productor (y, desde P0-012, vinculado a la entrega) | docs/08 KDE DELIVERY «soporte» |
| Momento | **Requerido para confirmar la entrega**; opcional en borrador | Es un KDE mínimo del hito DELIVERY |
| Comprobación | Referencia verificada (existe, misma organización, alcance del usuario) y **disponible técnicamente** (último análisis antimalware limpio). Ya implementado en el validador KDE (P0-018) | — |
| Revisión humana | **No** se exige para confirmar la entrega. La revisión de contenido (`document:review`) pertenece a la evidencia del expediente (P0-019/P0-022) | docs/12: aportar no es verificar; UX_UI §17 |
| Diferencia clave | Verificar la referencia ≠ aprobar el contenido: el sistema solo afirma que el archivo existe, es accesible y pasó el análisis; no su autenticidad ni validez jurídica | docs/12 |
| Comprobante de recepción | Lo genera la recepción como registro propio; no es un archivo subido ni sustituye al soporte de la entrega | UX_UI §7.6 |
| **Regla faltante** | Qué documento físico cuenta como soporte (guía de remisión, liquidación de compra, nota de entrega u otro). El sistema no puede decidirlo | Requiere decisión de Producto/regulatorio |

Alternativas: (B) exigirlo solo al confirmar la recepción — mezcla el soporte del declarante con el comprobante del centro; (C) exigirlo solo al armar el paquete — dejaría entregas confirmadas sin soporte y contradice el KDE mínimo.

## D-33 (parte que afecta a la recepción) — Pesaje y clasificación

| Aspecto | Propuesta | Fundamento |
| --- | --- | --- |
| Pesaje | **Obligatorio para confirmar una recepción**: el peso real recibido sale de uno o más registros de pesaje (WEIGHING@1: entidad, método, valor KG, fecha, responsable) | UX_UI §7.6 («pesar y confirmar»), S2, docs/14 |
| Clasificación | **No bloquea** la confirmación de la recepción; bloquea la **siguiente** transición del lote (liberación o paso a procesamiento, P0-016). CLASSIFICATION@1 (muestra, método, decisión; versión de límites si libera), responsable QUALITY_OPERATOR | S4 §7.5 «la calidad debe quedar conectada al lote»; docs/07 separa recepción y calidad |
| Conflicto en las fuentes | docs/14 ordena «pesar → clasificar → confirmar». Esta propuesta lo cambia a «pesar → confirmar → clasificar el lote». Debe decidirlo Producto | — |
| Recepción parcial | Una entrega confirmada admite varias recepciones; estado «parcialmente recibida» hasta cerrarla. La diferencia frente al peso declarado se evalúa **al cerrar** la entrega (suma de recepciones): cualquier diferencia exige causa (sin tolerancia inventada) | P0-012 «recepción parcial/completa, diferencias con causa» |
| Corrección | `ReceptionCorrected` / corrección de pesaje con `correction_of` (P0-015): referencia al original, motivo, nuevo valor; el original se conserva. Si ya hay descendientes (lote procesado, movimientos), se bloquea hasta resolver el impacto | docs/08 §Correcciones |
| **Reglas faltantes** | (1) ¿Se puede cerrar una entrega con recepciones por debajo del declarado sin una recepción final explícita? (2) Tolerancia de diferencia: ninguna hasta decidirla (cualquier diferencia exige causa) | Requiere decisión |

## Decisiones que se piden

1. D-34: aprobar «REQUIRED al confirmar» y decidir la granularidad del periodo.
2. D-35: aprobar «REQUIRED al confirmar, verificación técnica sin revisión humana» y definir qué documento físico es el soporte.
3. D-33 (recepción): aprobar «pesaje antes de confirmar; clasificación después, ligada al lote» (o mantener el orden de docs/14) y la regla de cierre de entregas parciales.

Hasta entonces, P0-012 no confirma sus compuertas.
