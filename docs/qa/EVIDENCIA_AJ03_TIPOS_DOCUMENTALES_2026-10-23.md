# Evidencia — AJ-03: tipos documentales ambiental, laboral y de derechos de terceros (migración 0066) — 2026-10-23

Fuente: plan de ajuste del propietario (`contexto/PLAN_AJUSTE_MINIMO_DOCUMENTACION_Y_PRODUCTO_2026-10-23.md`) y contexto funcional de Ecuador. Gestión de soportes dentro del ajuste ya autorizado; **no** requirió otra decisión.
Un tipo solo **clasifica** un archivo: no lo vuelve obligatorio, no es evidencia aprobada, no acredita autenticidad y no modifica `LEGAL_PROFILE`, riesgo, READY ni despacho. No cambia 42/60 ni 30/44.

## 1. Comprobación previa: ¿bastaban los tipos existentes?
No. Catálogo previo: `LAND_TENURE` (tenencia), `DELIVERY_SUPPORT` (soporte de entrega), `FIELD_EVIDENCE` (foto, croquis o acta del **recorrido de campo**, solo PDF) y `FIELD_PHOTO`. Un permiso ambiental, un soporte laboral o un acuerdo con terceros subidos como «evidencia del recorrido» o «tenencia» quedarían **mal etiquetados** y con una clasificación falsa. Titular y vínculos (`documents.owner`, `document_links`) ya existían: **no se añadió ninguna relación**.

## 2. Cambio mínimo (migración `0066_tipos_documentales_ambiente_trabajo_terceros`)
| Tipo | Titulares | Privacidad | Qué ve el Productor |
| --- | --- | --- | --- |
| `ENVIRONMENTAL_SUPPORT` «Soporte ambiental» | parcela, productor | OPERATIONAL | estado y contenido (si está disponible) |
| `LABOR_SUPPORT` «Soporte laboral» | parcela, productor | PERSONAL_DATA | estado y metadatos; el contenido solo con acceso a la identidad |
| `THIRD_PARTY_RIGHTS_SUPPORT` «Soporte de derechos de terceros o comunidades» | parcela, productor | PERSONAL_DATA | ídem |
`LABOR_SUPPORT` admite parcela para que el Productor (que no actualiza su ficha de productor) pueda aportarlo a su parcela. El catálogo sigue de solo lectura frente a UPDATE/DELETE; `down` no retira tipos con documentos. La guía documental remite ahora a estos tipos (ningún aspecto queda «sin tipo»); el aviso de privacidad se muestra donde corresponde.

## 3. Pruebas
- `apps/api/test/document-types-soportes.int-spec.ts` (5, PostgreSQL/S3/ClamAV reales): catálogo y clasificación (los anteriores no cambian); el Productor vinculado aporta cada tipo a **su** parcela con `review = null`; **riesgo, expedientes, evidencia, revisiones y perfil jurídico no cambian** (conteos idénticos); privacidad (laboral `RESTRICTED` y `CONTENT_RESTRICTED` al Productor; ambiental descargable; la administración sí ve el laboral); versionado sin heredar revisión; alcance (parcela ajena, titular no admitido).
- `e2e/tests/mi-finca.spec.ts` (10): **recorrido positivo con un productor VINCULADO en un entorno de ensayo aislado y datos sintéticos**: guía con los tipos, carga de los tres tipos desde Mi finca, filas con su tipo y «Pendiente de revisión», API sin revisiones, y el soporte laboral con contenido restringido. 25 pruebas web (guía, traducción, estados).
- Entornos distintos: el acceso a documentos propios con cuenta vinculada se acredita **solo** en el entorno de ensayo; en el entorno desplegado la cuenta DEMO de productor sigue **sin vínculo** y solo acredita ese estado de configuración.

## 4. Validación, despliegue, demostración y respaldo
- `b83026d`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T13-16-46-803Z`; integración 2 688 s, e2e 515 s).
- Desplegado `b83026d`, esquema `0066`; 27 volúmenes. `node e2e/review/mi-finca-demostracion.mjs`: **9/9** (lectura/UI; sin cambios en datos: 97/103/40/45/56): los 7 tipos con su clasificación en el entorno desplegado, guía sin «sin tipo» y sin lenguaje de certificación.
- **Respaldo** `_respaldos/2026-10-23-tipos-documentales-0066/` (volcado `-Fc`, objetos, `claves.env` restringido, `SHA256SUMS` verificado). **Restauración aislada** (`tl-restore`, sin seed ni migraciones): 66 migraciones, conteos idénticos a `estado-actual.txt`, los 7 tipos, `LABOR_SUPPORT` = PERSONAL_DATA y el catálogo restaurado **sigue de solo lectura** (UPDATE rechazado por `document_types_read_only`). Contenedor y volumen retirados.

## 5. Contraste de las entregas propias (sin ampliar el detalle)
El criterio original es consultar «qué consta sobre mis entregas» (`UX_UI` §7.13/UI-22; `docs/07`: recursos propios). El **listado** actual (estado, cantidades, recepción) lo satisface. El detalle expone nombres del personal, compuertas internas y notas: no es necesario para esa consulta y **se conserva restringido**. No se encontró una carencia comprobada que justifique ampliarlo. Observación (no es carencia del criterio): el soporte de una entrega lo vincula quien opera la entrega (`delivery_supports`), no el Productor.

## 6. Pendiente
Revisión jurídica real y todo lo externo (GUIA/EUDR-IS, piloto, Android físico). Ninguna decisión pendiente de producto sobre tipos documentales.
