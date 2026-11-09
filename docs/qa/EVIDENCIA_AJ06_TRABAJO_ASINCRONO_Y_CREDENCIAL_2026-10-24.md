# Evidencia — AJ-06: trabajo satelital asíncrono completo y credencial por organización — 2026-10-24

Completa el recorrido web → API → worker → Whisp → resultado guardado → consulta posterior sobre el código existente, con cambios puntuales. **No** se llamó a Whisp real, **no** se activaron llamadas externas (`SATELLITE_LIVE_CALLS` sigue deshabilitado), **no** se registró ninguna clave real, **no** se enviaron parcelas. Cobertura 42/60 y 30/44 sin cambio.

## Pendientes técnicos del informe → resultado
| Pendiente | Resultado |
| --- | --- |
| Clave de la plataforma (credencial cifrada por organización) | **Faltaba la ruta**: solo existía la tabla. Añadidas `GET/PUT/DELETE /api/v1/organizations/{org}/satellite/credentials/{proveedor}` (permiso `integration:read`/`integration:manage`; cifrado con contexto `satellite_credentials:{org}:{proveedor}`; sin valor en respuestas, registros ni auditoría; solo proveedores externos) y `e2e/review/whisp-registrar-credencial.mjs`. Procedimiento en `decisiones/P0-028-WHISP-CONTRATO-2.3.1.md` |
| Progreso | El adaptador pide trabajo **asíncrono**, guarda el último avance **declarado** (porcentaje solo si el proveedor lo informó) y la tarjeta de la parcela lo muestra; renueva el arrendamiento mientras avanza |
| Reintentos | `provider_job_ref` (no expuesto por la API) permite retomar la consulta **sin reenviar** la geometría; si el proveedor ya no lo reconoce, se envía de nuevo |
| Cancelación | Pendiente: cancela en Terra Link. **En curso**: registra la petición (quién/cuándo/motivo); el corredor llama `POST /api/status/{token}/cancel` (200/404 ⇒ cancelado sin resultado; 409 ⇒ ya terminó y se recoge el resultado). La pantalla dice «Cancelación solicitada… se confirmará cuando el proveedor la atienda» |
| Ensayo directo | `whisp-ensayo-real.mjs` ahora ejecuta la descarga alternativa (`/api/generate-geojson/{token}`), usa `async:true` como el adaptador y se verificó contra un servidor local falso; **no** se ejecutó contra Whisp real |

## Cambios
Migración `0067_satellite_progreso_reanudacion_cancelacion` (columnas del trabajo; sujeto/proveedor/petición siguen inmutables; un trabajo terminado no vuelve a cambiar). `provider.ts` (ganchos `AnalysisHooks`, `resumeJobRef`, desenlace `CANCELLED`), `whisp.ts`, `runner.ts`, `satellite.ts`, `satellite.tsx`, EN, `openapi.json` (290 rutas).

## Pruebas
- `whisp.spec.ts` (55 en `src/satellite`): avance declarado, reanudación sin reenvío, reenvío tras «trabajo no reconocido», cancelación en el proveedor, 409 ⇒ se recoge el resultado.
- `satellite.int-spec.ts` (35, base real + servidor TLS controlado): avance persistido y visible sin exponer el identificador; reanudación sin `submit`; cancelación en curso con responsable y atención por el corredor; credencial cifrada, rotada, no devuelta, sin cruce de organizaciones, auditada sin valor, 403/404/422/400 según rol, proveedor y formato.
- `satelite-resultado-proveedor.spec.ts` (5): avance con %, cancelación solicitada, en curso/fallido sin valores, inglés.
- `6239de1`: `npm run validate` **APROBADA** (`validation-results/2026-10-24T01-55-57-068Z`; integración 2 400 s, e2e 555 s). Desplegado `6239de1`, esquema `0067`.
- Demostración desplegada `node e2e/review/satelite-estado-demostracion.mjs`: **6/6**, solo lectura (10/8/0 antes y después): llamadas reales deshabilitadas, Whisp solo adaptador de desarrollo, ruta de credencial (consulta del administrador, sin valores, 403 al auditor), columnas 0067 sin datos inventados.
- **Respaldo** `_respaldos/2026-10-24-satelite-0067/` (volcado `-Fc`, objetos, `claves.env` restringido a la cuenta, `SHA256SUMS` verificado). **Restauración aislada**: 67 migraciones, conteos idénticos a `estado-actual.txt`, 7 columnas y la restricción de cancelación presentes; contenedor y volumen retirados; 27 volúmenes intactos.

## Límite de lo demostrado
El recorrido completo está acreditado con **un servidor controlado**, no con Whisp real. La prueba real exige: clave de API del propietario (`WHISP_API_KEY` en `.env`), su autorización expresa, y —para hacerla desde la plataforma— `SATELLITE_LIVE_CALLS=enabled` temporal, `WHISP` `SELECTED` con responsable (D-09 B) y la credencial registrada con el script.
