# Revisión de los requisitos pendientes de DD-2026-00001, 00002 y 00003 (2026-10-30)

Revisión **de solo lectura** sobre las instantáneas vigentes (n.º 2, 3 y 2). No se crearon instantáneas, soportes, declaraciones, evaluaciones ni verificaciones: lo que sigue son aportes reales de personas o decisiones de terceros y **no se inventan** para obtener `READY`. Cuentas DEMO vigentes; sin cuentas nuevas, claves, seed ni respaldos.

## SHA
| Qué | SHA | Resultado |
| --- | --- | --- |
| Candidato con la guía de resolución del expediente | `161b7f5` | `npm run validate` **APROBADA** (`validation-results/2026-10-31T00-12-51-533Z`); **desplegado** (`/version` = `161b7f5`) |

## Carencia funcional comprobada y corregida
El expediente decía **qué** estaba pendiente pero no **quién** podía resolverlo, **desde qué pantalla** ni **de qué naturaleza** era la intervención. Ahora cada requisito no cumplido muestra «Cómo se resuelve»: naturaleza (`DATA` falta información o soporte · `ACTION` falta ejecutar una acción · `DECISION` requiere decisión humana · `EXTERNAL` depende de un tercero o de una decisión pendiente), los roles que **hoy** tienen el permiso (calculados del catálogo, sin lista paralela), si la cuenta actual puede hacerlo y el enlace a la pantalla. Vive en `GET …/dd-cases/{id}` (`latest.resolution`), fuera del contenido y del hash de la instantánea. Comprobado en el despliegue: 14 de 14, 11 de 11 y 10 de 10 requisitos no cumplidos con guía. Pruebas: `produccion-instantanea.int-spec` (todo requisito no cumplido tiene guía; ninguno cumplido la trae) y e2e `productos.spec` 24/24.

## Requisitos comunes a los tres expedientes
| Requisito | Qué falta | Quién (roles existentes) | Pantalla | ¿Funcionalidad o información/configuración? |
| --- | --- | --- | --- | --- |
| `RISK_EVALUATION_CURRENT` (INVALID) | La evaluación 1 está desactualizada | `ORG_ADMIN`, `EUDR_MANAGER` (`risk:evaluate`) | Riesgo del lote → «Reevaluar» | Acción; **la funcionalidad existe** |
| `RISK_REVIEW_RESOLVED` (PENDING) | Revisión humana sin iniciar (sobre una evaluación vigente) | `ORG_ADMIN`, `EUDR_MANAGER` (`risk:review`) | Riesgo del lote → «Iniciar revisión» | Decisión humana; existe |
| `MITIGATIONS_VERIFIED` (PENDING) | Una acción abierta (00001 `DATA_MISSING_ORIGIN`; 00002 y 00003 `DOCUMENT_EXPIRED`): soporte y verificación por **otra** persona | Aporta: `ORG_ADMIN`, `TRACEABILITY_MANAGER`, `EUDR_MANAGER`; verifica: `ORG_ADMIN`, `EUDR_MANAGER` | Mitigaciones | Acción + soporte real; existe |
| `DELIVERY_SUPPORTS` (PENDING) | Un soporte de la entrega (ENT-2026-00002 / 00004 / 00005) | `ORG_ADMIN`, `MANAGER`, `RECEPTION_OPERATOR` (y técnico en su alcance) | Entregas → «Vincular soporte» | Información (el documento real lo aporta el productor o el acopio); existe |
| `REGULATORY_CONCLUSION` (NOT_EVALUABLE) | Conclusión humana vigente | `EUDR_MANAGER` (`risk:conclude`) | Riesgo del lote | Decisión; existe, pero **depende de perfil y revisión autorizados** |
| `RISK_CATALOG_APPROVED` (NOT_EVALUABLE) | Perfil jurídico aprobado (D-07.5) | Propietario del producto + revisión jurídica | Perfil jurídico | **Externa / decisión pendiente** |
| `LEGAL_PROFILE` (NOT_EVALUABLE) | Perfil jurídico adoptado con revisión | Adopta `ORG_ADMIN`; la revisión es jurídica externa (plataforma registra) | Perfil jurídico | **Externa**; Terra Link no sustituye la revisión |
| `GEOLOCATION_PROFILE` (NOT_EVALUABLE) | Configuración de geolocalización adoptada y revisada | Adopta `ORG_ADMIN`; revisa la plataforma | Geolocalización | Configuración + revisión de la plataforma |
| `DEFORESTATION_ANALYSIS` (NOT_EVALUABLE) | Análisis satelital con proveedor seleccionado | `ORG_ADMIN`, `EUDR_MANAGER`, `EXPORT_MANAGER` | Parcela → Análisis satelital | **Uso autorizado pendiente**: el adaptador y el ensayo real con geometría artificial ya están demostrados; falta la autorización de uso sobre estas parcelas (D-09 parte B) y las condiciones para que el resultado satisfaga el requisito |

## Por expediente
### DD-2026-00001 · LOT-2026-00002 · ENT-2026-00002 · productor DEMO-RV-005
Lote de **origen incompleto** (la entrega no tiene parcela).
| Requisito | Qué falta | Quién · pantalla | ¿Qué tipo de falta? |
| --- | --- | --- | --- |
| `ORIGIN_DECLARED` (PENDING) | Parcela de origen | `ORG_ADMIN`, `MANAGER`, `RECEPTION_OPERATOR` · Entregas | **No hay función para añadir parcelas a una entrega ya registrada**: es decisión de diseño (D-39, el origen incompleto no se completa ni se mezcla). Si el origen real se conoce, se registra una entrega nueva con su parcela. **Decisión del propietario (2026-10-30): se mantiene D-39**; no se construye corrección de origen. Registrar otra entrega no corrige este lote ni este expediente, y no debe volver a registrarse la misma mercancía (duplicaría cantidades). |
| `GEOMETRY_TECHNICAL` (NOT_EVALUABLE) | Sin parcelas de origen no hay geometría | Consecuencia del anterior | — |
| `QUALITY_DECIDED` (PENDING) | Muestra y decisión de calidad (recepción «sin resultado») | `ORG_ADMIN`, `QUALITY_OPERATOR` (decide); registran muestra `RECEPTION_OPERATOR` · Entregas → recepción | Información/decisión humana; existe |
| `RISK_NO_BLOCKING_FINDINGS` (INVALID) | Hallazgo bloqueante por origen incompleto | — | Reevaluar no lo quita: lo sostiene el origen incompleto |
| `SHIPMENT_LINK` (PENDING) | Ítem de embarque con reserva | `ORG_ADMIN`, `EXPORT_MANAGER` · Embarques | Acción; existe, pero un origen incompleto **no se despacha como conocido** |

### DD-2026-00002 · LOT-2026-00005 ← LOT-2026-00004 · ENT-2026-00004 · parcela CAD-1027213440
Origen completo y calidad `RELEASED`; embarque vinculado.
| Requisito | Qué falta | Quién · pantalla | ¿Qué tipo de falta? |
| --- | --- | --- | --- |
| `GEOMETRY_TECHNICAL` (PENDING) | La parcela tiene un **punto** sin superficie declarada ni polígono: la evaluación técnica no es posible (ya registrado en `23`) | Aporta el dato: técnico asignado, `MANAGER`, `ORG_ADMIN` (`plot:update`); evalúan `EUDR_MANAGER`, `MANAGER`, `TRACEABILITY_MANAGER`, `ORG_ADMIN` · Parcela → ubicación/superficie | **Información de campo**; la funcionalidad existe |
| `RISK_NO_BLOCKING_FINDINGS` (NOT_EVALUABLE) | Reglas no evaluables hasta tener perfil/geometría evaluables | — | Se resuelve con lo común y la geometría |

### DD-2026-00003 · LOT-2026-00007 ← LOT-2026-00006 · ENT-2026-00005 · parcela CAD-1028225001
Origen completo, calidad `RELEASED`, geometría técnica y embarque cumplidos. Solo quedan los requisitos comunes (soporte de la entrega, mitigación por documento vencido, reevaluar y revisar, y los externos) más `RISK_NO_BLOCKING_FINDINGS` no evaluable.

## Intervenciones humanas reales identificadas
1. **Productor / acopio:** el soporte de cada una de las 3 entregas y un documento vigente que sustituya al vencido (00002 y 00003).
2. **Equipo de campo:** superficie declarada o polígono de CAD-1027213440 (00002).
3. **Calidad:** decisión de calidad de la recepción de ENT-2026-00002 (00001).
4. **Responsable EUDR / administración:** reevaluar el riesgo, iniciar la revisión y que una persona **distinta** verifique cada mitigación.
5. **Propietario / terceros:** uso autorizado del análisis satelital sobre estas parcelas (D-09 B; el adaptador ya está demostrado), revisión de la configuración de geolocalización, perfil jurídico y su revisión jurídica (D-07.5/D-37).
6. **Cerrado:** el origen incompleto de 00001 no se corrige (D-39 mantenida). DD-2026-00001 se conserva como caso bloqueado y prueba negativa: no todo expediente DEMO debe terminar en `READY`.

Actualizar una instantánea resolvió su desactualización; **completar estos requisitos es el siguiente avance** y no hay atajo: un `READY` sin ellos sería falso. Nada de esto es una presentación de DDS ni acredita conformidad.

## Operativo frente a externo
- **Operativo, con las cuentas actuales, cuando exista el soporte y una decisión fundada:** vincular soportes existentes, reevaluar el riesgo, iniciar la revisión y verificar mitigaciones (persona distinta).
- **No se inventa:** el dato de campo, la decisión de calidad ni la revisión competente.
- Terra Link conserva y presenta documentos y estados; no certifica su autenticidad.
