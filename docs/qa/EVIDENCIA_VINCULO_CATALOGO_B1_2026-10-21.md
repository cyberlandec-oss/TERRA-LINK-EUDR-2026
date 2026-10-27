# Evidencia: D-07.5(b), opción b-1 — acto de vinculación del catálogo de riesgo con un perfil revisado (2026-10-21)

Esta evidencia acredita un **mecanismo**. **No se publicó ningún catálogo ni perfil real vinculado, no se aprobó ningún perfil, no se adoptó nada en ninguna organización y no se concedió ni ejerció facultad de concluir.** El caso positivo existe solo con datos sintéticos en bases aisladas; en el entorno operativo se demuestran los **rechazos**.

## 1. Candidatos y validaciones (cada uno sobre su propio SHA)

| Candidato | Qué contiene | `npm run validate` | Despliegue |
| --- | --- | --- | --- |
| `d539dc8` | Migración `0061`, API de plataforma, pantalla, pruebas de integración y E2E | **APROBADA** (1030 pruebas, 114 E2E; 15:14:25–15:49:43 local) | Desplegado; demostración 12/12 |
| `390b5ce` | Corrección de un defecto de la pantalla hallado en la captura a 390 px: la columna de elegibilidad (con lo que falta de cada perfil) quedaba fuera de la vista. Versión, estado y motivos pasan a la primera columna; la E2E exige que el motivo caiga dentro del ancho | **APROBADA** (1030 pruebas, 114 E2E; árbol intacto; `validation-results/2026-10-21T20-55-20-499Z/`) | **Desplegado final**: `/version` = `390b5ce`, esquema `0061_d075b_vinculacion_catalogo_perfil` |

**Atribución de la corrida de `d539dc8`:** corrió sobre el árbol de trabajo (no sobre una copia aislada) y terminó a las 15:49:43. Las modificaciones responsive se hicieron **después**: `page.tsx` e `i18n-en-vinculo.ts` a las 15:52:07, el script de demostración a las 15:51:46 y la E2E a las 15:54:05; `390b5ce` se confirmó a las 15:55:18. El informe previo no ordenaba esa secuencia; queda registrada. La validación de `390b5ce` es independiente y se hizo con el árbol sin tocar (único archivo sin confirmar: `AGENTS.md`).

## 2. Demostración sobre el despliegue final (`390b5ce`) — 12/12

`e2e/review/vinculo-catalogo-demostracion.mjs`. Cada comprobación es aislada y ninguna acredita preparación del expediente.
- Permiso: administración de la organización → 403; plataforma → 200 (control autorizado).
- Ningún perfil es elegible; motivos por código: `0.1.0` = parcial + sin revisión; `0.2.0` = borrador + parcial + sin revisión.
- Rechazos sin efectos: `0.1.0` y `0.2.0` → 422 `PROFILE_NOT_ELIGIBLE`; referencia inexistente → 422; etiqueta → 400; `1.0.0` como versión nueva → 409.
- Estado de datos idéntico antes y después (3 conjuntos de reglas, 0 actos, 1 adopción de riesgo, 13 de perfil, 0 revisiones, 24 reglas); `1.0.0` intacto (sin perfil, 8 reglas, su adopción histórica).
- La base rechaza una etiqueta, `0.1.0` y `0.2.0` (transacciones revertidas).
- Pantalla en español: explica que ningún perfil es elegible y lista lo que falta; **sin botón de confirmar**. Pantalla en inglés a **390 px**: textos traducidos, sin códigos internos, sin desborde y con los motivos **visibles dentro del ancho** (captura revisada: `validation-results/vinculo-catalogo-2026-10-21/pantalla-en-390.png`).
- La administración de la organización ve acceso denegado en la interfaz.

## 3. Pruebas aisladas (datos sintéticos, bases `*_test` / `*_e2e`)

- `test/risk-catalog-link.int-spec.ts` (11): positivo con perfil sintético completo y revisado (versión `1.1.0` copia exacta, `NOT_APPROVED`, **sin adopción automática**, acto con autor, fecha, motivo, perfil y revisión); idempotencia; revisión obsoleta → 409 `REVIEW_CHANGED`; la base repite las comprobaciones (referencia sin acto, revisión no vigente, versión que no es copia, acto inmutable); **expediente** que cumplía `RISK_CATALOG_APPROVED` y tras una revisión **objetada**: la referencia histórica permanece, el historial la marca «ya no vigente», la instantánea histórica conserva `MET` pero queda **desactualizada** (`STALE`, mecanismo existente) y una instantánea nueva muestra `PENDING`; con la revisión objetada el perfil deja de ser elegible.
- `e2e/tests/vinculo-catalogo.spec.ts` (5): sin perfil elegible, positivo sintético con **teclado**, perfil objetado, inglés y 390 px.
- Revisión objetada o retirada: registrarla **no se bloquea** (el trigger vigila `risk_rule_sets`, no las revisiones); lo que cambia es la vigencia.

## 4. Respaldo de `0061` y restauración aislada

`_respaldos/2026-10-21-vinculo-catalogo-0061/` (base, objetos, `claves.env` restringido, `estado-actual.txt`, `SHA256SUMS.txt`), tomado con el despliegue final. Restauración en contenedor y volumen propios, sin seed ni migraciones: 61 migraciones; conteos idénticos (22 organizaciones, 23 lotes, 2 versiones legales, 11 reglas, 3 conjuntos de riesgo sin perfil, 0 actos); 4 triggers de la guarda presentes; `0.2.0` = `DRAFT`; la copia rechaza escribir `0.1.0` como referencia. Entorno de restauración eliminado; 27 volúmenes intactos.

## 5. Cuatro acciones distintas (ninguna ejecuta a las otras)

| Acción | Quién | Qué ocurre aquí |
| --- | --- | --- |
| **Crear la versión vinculada** | Plataforma (`risk_catalog:link_profile`, solo `SUPER_ADMIN`) | Es lo único que hace este acto |
| **Aprobación técnica** del catálogo | Decisión de producto (como `1.0.0`) | **No** se hereda: la versión derivada nace `NOT_APPROVED` |
| **Adopción por organización** | Cada organización (`risk:approve_rules`) | **No** se adopta automáticamente |
| **Conclusión regulatoria** | Revisor autorizado bajo perfil (D-07.6, pendiente) | Sigue `UNDETERMINED` por `CHECK`; no existe permiso ni endpoint para concluir |

## 6. Qué NO se hizo

No hay versión vinculada real (no existe perfil completo y revisado: `0.1.0` parcial y sin revisión, `0.2.0` borrador); no se implementó la etiqueta opcional de b-2; no se ejecutó el ensayo externo; no cambian porcentajes ni compuertas; Android pospuesto.
