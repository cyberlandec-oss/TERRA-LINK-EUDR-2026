# Evidencia: concesión de geometrías de una instantánea (2026-10-30)

Decisión del propietario: **concesión aparte** con los polígonos de la instantánea; los documentos con datos personales siguen excluidos. Cuentas DEMO vigentes; sin cuentas nuevas, claves, seed ni respaldos.

## SHA
| Qué | SHA | Resultado |
| --- | --- | --- |
| Candidato (migración `0074`, API, pantallas, pruebas) | `ab7752b` | `npm run validate` **APROBADA** (`validation-results/2026-10-30T22-22-41-700Z`); **desplegado** (`/version` = `ab7752b`, esquema `0074`) |
| Prueba añadida después (tipos de geometría) y guion de demostración | posterior | Solo prueba y guion; sin cambio de código de producto |

## Demostración sobre el despliegue (`e2e/review/geometrias-demostracion.mjs`, 7/7)
Instantánea del expediente QA-1030 (Cooperativa Río Verde). Concesión de geometrías a `admin.importador`; la concesión de soportes de `comprador.importador` queda intacta.
1. La concesión **antigua** (soportes, sin geometrías) conserva su alcance: `include_geometries=false`, vista «no compartida», ruta de geometrías **403** `GRANT_GEOMETRIES_NOT_INCLUDED`.
2. Conceder exige la administración (la cuenta compradora no puede: 404); la concesión sale con `include_geometries=true` e `include_documents=false`.
3. El destinatario recibe la geometría **exacta de la instantánea**: mismo tipo (`Polygon`), mismas coordenadas, versión 1 y huella SHA-256 iguales a las del contenido guardado.
4. Sin nombre del productor ni identificadores internos de la parcela o de la organización.
5. Destinatario incorrecto (otra cuenta de la misma organización) e identificador inexistente: **404** indistinguibles; control autorizado 200.
6. Los términos no se editan (el disparador lo rechaza) y cada lectura queda auditada (`grant.geometries_read`).
7. Revocar: 200 antes, 404 después. **Revocar impide nuevas consultas; no retira archivos ya descargados.**

## Pruebas dirigidas
- `access-grants-geometrias.int-spec.ts` (8): catálogo, apagado por omisión, validación (solo instantánea, con lectura, solo administración), recorrido sin identidad del productor, independencia de los soportes, **conserva punto, polígono y multipolígono**, corrección posterior de la parcela **sin efecto** sobre lo compartido, otra cuenta/revocada/vencida/términos inmutables.
- `access-grants-soportes.int-spec.ts` y concesiones previas: 50 pruebas de concesiones en verde; e2e `concesiones.spec.ts` 7/7 (casilla propia, revisión previa, tabla de polígonos del comprador).

## Límites
- Se comparten las geometrías **fijadas en la instantánea**, no la vigente de hoy; una corrección posterior no las cambia (y desactualiza la instantánea por el mecanismo existente).
- Compartir polígonos no es presentar una DDS, no certifica su exactitud y la validez técnica no es una conclusión de cumplimiento ni de legalidad.
- Los documentos con datos personales siguen sin compartirse por esta vía.
