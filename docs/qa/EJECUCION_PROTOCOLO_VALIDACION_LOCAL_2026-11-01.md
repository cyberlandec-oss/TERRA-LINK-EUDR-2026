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
