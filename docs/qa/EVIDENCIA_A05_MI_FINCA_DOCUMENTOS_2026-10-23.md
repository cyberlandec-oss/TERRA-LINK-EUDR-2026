# Evidencia — «Mi finca» y documentos en contexto (AJ-02 + AJ-03; rotulado A-05 en el código) — entrega 1 (2026-10-23)

**Alcance:** recorrido propio del productor y aportación documental desde la entidad, **reutilizando** el servicio, los permisos y la carga de documentos existentes. Sin migración, sin permisos nuevos y sin cambios de contrato API.
Preparación y gestión de evidencia: **Terra Link no certifica** autenticidad ni conformidad; subir un archivo no lo aprueba. No cambia 42/60 ni 30/44.

## Fuente y brecha que resuelve
| Brecha (docs/24, tabla CTX) | Fuente | Qué se hizo |
| --- | --- | --- |
| CTX-01 · función ausente: «Mi finca» solo era una tarjeta «pendiente» | `docs/UX_UI.md` §7.13, UI-22, UX-D08; `docs/14` PRODUCER; plan de ajuste §6 | Pantalla `/organizaciones/{id}/mi-finca` y entrada de menú para cuentas con alcance propio |
| Cuenta sin vínculo vs sin datos vs sin permiso | UX-D08; plan §4 (configuración pendiente) | Tres estados con su causa y cómo resolverlos; no se da acceso implícito |
| CTX-05 · integración incompleta: carga solo en `/documentos` | `docs/03` RF-18/19; P0-018/P0-019; plan §6 «Documentos desde contexto» | Sección «Documentos y soportes» en productor, parcela y Mi finca con el **mismo** `UploadDocument` (extraído, no duplicado) |
| CTX-06 · función ausente: orientación por aspecto | contexto B02/B07/B08/B09 (síntesis, no requisitos); `docs/13` Legalidad | Guía orientativa con fuente por aspecto; no bloquea la carga ni depende de ninguna revisión global |

## Qué se conservó
Servicio `POST/GET /documents`, antivirus, límites, versiones, alcance por titular, auditoría; el tratamiento de `FIELD_PHOTO` (limpieza de metadatos) sigue solo en «Evidencias del recorrido de campo»; los tipos `FIELD_EVIDENCE`/`FIELD_PHOTO` quedan fuera de la carga contextual genérica para no subir imágenes con metadatos por ese camino. Revisiones humanas e historial intactos. La fila de «Evidencias del recorrido» ahora lista solo sus tipos (los demás documentos van en «Documentos y soportes»).

## Distinción de lo que muestra la pantalla
Orientación (guía con fuente y fecha) ≠ soporte aportado (archivo + versión + titular) ≠ comprobación técnica (estado del análisis) ≠ revisión humana («Pendiente de revisión», «Revisado: aceptado», «Con observaciones»; derivadas del contrato existente, sin catálogo nuevo). Los pendientes de Mi finca se derivan de lo registrado (ubicación, análisis, vigencia, observaciones) y se rotulan «no son una evaluación de cumplimiento».

## Límites declarados
- **Entregas propias:** el rol PRODUCER no tiene permiso de lectura de entregas; la pantalla lo explica como **sin permiso** (distinto de «sin datos»). La documentación raíz las prevé (`docs/07`: «Recursos propios: perfil, parcelas, entregas, documentos, pendientes»): es la **entrega 2** (permiso acotado de lectura propia).
- **Aspectos sin tipo de documento** (ambiente, trabajo, derechos de terceros): el catálogo de sistema tiene 4 tipos; la guía lo dice. Alta de tipos por migración: decisión pendiente, no se asumió.
- **Documentos con titular entrega:** siguen sin estar disponibles (texto «llegará con P0-012» desactualizado): entrega 2.
- La cuenta DEMO `productor.cooperativa` sigue **sin vínculo cuenta–productor** (configuración de cuenta pendiente); no se modificó.

## Validación, despliegue y demostración
- `42f7433`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T05-44-49-396Z`; integración 2 443 s, e2e 469 s). Antes: 25 pruebas web (guía, traducción, estados), 9 E2E nuevos (`e2e/tests/mi-finca.spec.ts`) y 63 E2E relacionados.
- Desplegado `42f7433` (esquema 0065; 27 volúmenes). `node e2e/review/mi-finca-demostracion.mjs`: **7/7** con cuentas DEMO reales y **sin cambios** en datos (97/103/40/45/56 antes y después): cuenta sin vínculo, sin permiso de entregas, guía con fuente en la parcela, sin lenguaje de certificación, auditor sin Mi finca, inglés y 390 px.
- El recorrido con cuenta **vinculada** (parcelas propias, pendientes, carga «pendiente de revisión», aislamiento, sin vínculo) corre sobre datos sintéticos aislados (`mi-finca.spec.ts`). No se hizo respaldo: no hay migración ni estado persistente nuevo.
- A-04 se conserva intacta (web `5f77b72`; móvil `056d298`, APK `3df0ca8d`, con evidencia diferenciada).
