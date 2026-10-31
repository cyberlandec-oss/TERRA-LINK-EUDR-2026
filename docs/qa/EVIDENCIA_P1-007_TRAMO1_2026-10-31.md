# Evidencia: P1-007 tramo 1 — credenciales de EUDR-IS y comprobación de conexión (2026-10-31)

Alcance: **credenciales cifradas por organización y entorno + Echo en ACCEPTANCE**. **No hay presentación de DDS**: el expediente sigue `NOT_SUBMITTED`; los recibos y la conciliación son el siguiente tramo. Las llamadas reales a EUDR-IS siguen **apagadas** (`EUDR_IS_LIVE_CALLS` vacío). Cuentas DEMO vigentes; sin cuentas nuevas, claves, seed ni respaldos; no se registró ninguna credencial en el DEMO.

## SHA y validaciones (todas conservadas)
| Qué | SHA | Resultado |
| --- | --- | --- |
| Candidato inicial | `169db7c` | Corrida **interrumpida** (reinicio de Docker y reposo de la máquina; 50 suites `PASS`, ninguna `FAIL`; `validation-results/2026-10-31T04-31-31-595Z`) |
| Candidato con `openapi.json` confirmado | `b3c2f0b` | **FALLIDA**: 1 de 1228 (`satellite.int-spec.ts:237`, plazo/cupo y reintento) — `validation-results/2026-10-31T18-11-08-679Z` |
| **Candidato validado y desplegado** | **`74d0f39`** | `npm run validate` **APROBADA** (`validation-results/2026-10-31T18-40-59-945Z`); desplegado desde árbol limpio: `/version` = `74d0f39` (sin `+sucio`), esquema `0077` |

**Fallo de `b3c2f0b`:** no dependía de EUDR-IS. El reintento se agendaba con el reloj de la aplicación (`Date.now()`) y se reclamaba comparando con el de la base (`now()`); con un retardo de 1 ms un desfase de milisegundos lo hacía no reclamable. No se pudo demostrar el desfase en el momento del fallo (los relojes coincidían al medirlos después). Corrección en `74d0f39`: el reintento y la renovación del arrendamiento usan el reloj de la base. La aserción y los tiempos no se tocaron. Esto reduce la causa identificada; tres pasadas aisladas no demuestran que la fragilidad haya desaparecido.

## Qué se implementó
Migración `0077` (`eudr_is_credentials`, `eudr_is_echo_checks`, esta última de solo añadir); cifrado AES-256-GCM con contexto `eudr_is_credentials:{organización}:{entorno}:{campo}`; cliente SOAP con WS-Security (`UsernameToken` + `PasswordDigest`, nonce, `Timestamp` de 5 min, `WebServiceClientId`); `GET/PUT/DELETE /organizations/{orgId}/eudr-is/credentials[/{environment}]` y `POST …/echo/{environment}`; pantalla «Conexión EUDR-IS»; cargador local `npm run eudr-is:cargar -- --org <uuid> --env <ACCEPTANCE|PRODUCTION>`; variables vacías en `.env.example` y en el `.env` local (solo nombres, ninguna existente se tocó; `.env` sigue ignorado por Git). Guía: `docs/operacion/CONEXION_EUDR_IS.md`.

## Pruebas
- Unitarias `eudr-is.spec.ts` (5): digest calculado de forma independiente, cabecera sin la clave, escape XML, interpretación de OK / autenticación / fallo / respuesta inesperada, Echo solo en el endpoint documentado de ACCEPTANCE, PRODUCTION rechazado.
- Integración `eudr-is.int-spec.ts` (6, PostgreSQL real, **transporte simulado: ninguna llamada sale de la máquina**): permisos (403 sin `integration:manage`, 404 entre organizaciones, 422 entorno inválido, control del administrador), secreto ni devuelto ni auditado ni en claro, descifrado solo con su organización, entorno y campo, ACCEPTANCE y PRODUCTION independientes, rotación con una sola fila, Echo con interruptor apagado (409, sin llamadas), sin credencial (409), `OK` y `AUTH_FAILED` registrados como evidencia de solo añadir.
- e2e `eudr-is.spec.ts` (4): registrar, no volver a mostrar, Echo deshabilitado con su motivo, solo lectura para MANAGER, 390 px.
- Demostración sobre el despliegue `e2e/review/eudr-is-demostracion.mjs` **11/11**, solo lectura y rechazos: estado sin credenciales y con llamadas apagadas; Echo documentado solo en ACCEPTANCE; EXPORT_MANAGER y AUDITOR 403; otra organización 404 (control: la propia 200); entorno inválido 422 sin efectos; Echo 409 `EUDR_IS_LIVE_CALLS_DISABLED` y PRODUCTION 422 `ECHO_NOT_DOCUMENTED_FOR_ENVIRONMENT`; el cargador rechaza sin `--org`, sin `--env` y con las variables vacías (nombra cuáles faltan, no escribe, no muestra valores).

## Qué NO se demostró (y por qué)
- Credenciales reales, Echo contra el servicio real y la organización y el entorno de las credenciales: **pendientes de que el propietario las identifique y complete `.env`**.
- Almacenamiento aislado con datos reales: se prueba en la base desechable; en el DEMO no se registró nada.
- Contraste de los XSD de DDS V3 y V4, `submitDds`, consulta del resultado, recibos auténticos y conciliación ante respuestas perdidas: siguiente tramo de P1-007. Producción solo ofrece DDS V3; ACCEPTANCE ofrece V3 y V4.
- Echo `OK` acreditaría transporte y credenciales, no el operador representado ni una presentación de DDS.

## Precisiones heredadas
- **F02:** el técnico con alcance asignado todavía no ve los vínculos de sus entregas en la ficha del documento (limitación funcional abierta, no cobertura completa).
- **F10:** se distinguen dos resultados. *Bloqueo comprobado por el producto:* una instantánea no alcanza `READY` porque `RISK_NO_BLOCKING_FINDINGS` depende de D-09.B y D-05.B. *Tramo posterior probado con estado preparado:* aprobación, paquete y concesiones se probaron sobre una copia sintética con `READY` y ese requisito forzados en la base de pruebas. No equivale a una cadena operativa desbloqueada.
- **`+sucio`:** el despliegue anterior quedó registrado como `3b12839+sucio` (documentación sin confirmar al construir); no se reconstruyó solo para cambiar la etiqueta. Este despliegue es limpio.
