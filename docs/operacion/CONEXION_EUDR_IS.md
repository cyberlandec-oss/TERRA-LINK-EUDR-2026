# Conexión con EUDR-IS (TRACES NT) — P1-007, tramo 1: credenciales y Echo

Estado (2026-10-30): **implementado en local el registro cifrado de credenciales por organización y entorno y la comprobación Echo en ACCEPTANCE**. **No hay presentación de DDS**: el expediente sigue devolviendo `NOT_SUBMITTED`. Conocer una URL o tener una clave no autoriza a presentar declaraciones.

## Qué acredita y qué no
| Hecho | Qué acredita | Qué NO acredita |
| --- | --- | --- |
| Credencial registrada | Que Terra Link la tiene cifrada para esa organización y ese entorno | Que sea válida ni que esté activa |
| Echo `OK` en ACCEPTANCE | Transporte y autenticación (usuario, Authentication Key y WebServiceClientId) | El operador representado, el contrato de la DDS ni una presentación |
| `EUDR_IS_LIVE_CALLS=enabled` | Que la plataforma puede salir a la red hacia EUDR-IS | Autorización para presentar en PRODUCTION |

## Variables (en el `.env` local, ignorado por Git; se dejan vacías hasta que las completes)
`EUDR_IS_LIVE_CALLS` · `EUDR_IS_ACCEPTANCE_USERNAME` · `EUDR_IS_ACCEPTANCE_AUTH_KEY` · `EUDR_IS_ACCEPTANCE_CLIENT_ID` · `EUDR_IS_PRODUCTION_USERNAME` · `EUDR_IS_PRODUCTION_AUTH_KEY` · `EUDR_IS_PRODUCTION_CLIENT_ID`.
Las de un entorno **no se reutilizan** para el otro. Dónde se obtienen: usuario y Authentication Key en el perfil EU Login (Edit Profile → Web Services Access → Active); la dirección donde se generan indica el entorno (`acceptance.eudr.webcloud.ec.europa.eu` = ACCEPTANCE; `eudr.webcloud.ec.europa.eu` = PRODUCTION). La organización de Terra Link debe corresponder al **operador o representación autorizada en TRACES**, no a una cuenta DEMO por defecto.

### Dónde está cada dato (indicación del propietario, 2026-10-31)
- **Username:** TRACES NT → usuario (arriba a la derecha) → Edit Profile → Personal Information. **Authentication Key** y **WebServiceClientId:** Web Services Access (ojo para ver la clave). La Authentication Key **no** es la contraseña de EU Login. Si «Web Services Access» no aparece, comprobar que el operador esté validado y el usuario vinculado a él.
- **Operador:** Directory → Operators. El rol `EXPORT_MANAGER` de Terra Link no establece por sí mismo la identidad del operador. Si la integración actúa para varios operadores existe un *Web Service Access Identifier / OperatorAccessIdentifier* (en los identificadores del operador), distinto de la clave y del WebServiceClientId; **Terra Link aún no lo almacena** (se decidirá en el tramo de `submitDds`).
- Los datos del cacao (parcelas, producto, HS, cantidades, trazabilidad, soportes, análisis, evaluación) proceden de la operación en Terra Link, no de las claves de TRACES.
- Registrarse en un entorno no da acceso al otro; empezar por ACCEPTANCE (sin valor legal). Soporte oficial: SANTE-TRACES@ec.europa.eu.
- Al propietario le basta comunicar: entorno, nombre del operador y si aparece «Web Services Access». Las claves se guardan solo en `.env`.

## Procedimiento local
1. Completa en `.env` las tres variables del entorno (nunca las pegues en el chat ni las versiones).
2. Carga cifrada, con organización y entorno **explícitos** (no hay valores por defecto; el comando solo informa «credencial registrada/rotada» o un error redactado):
```bash
npm run eudr-is:cargar -w apps/api -- --org <uuid-de-la-organizacion> --env ACCEPTANCE
```
3. Alternativa: pantalla **Conexión EUDR-IS** (menú de administración, permiso `integration:manage`); los campos se vacían al guardar y el valor no se vuelve a mostrar.
4. Para comprobar la conexión: pon `EUDR_IS_LIVE_CALLS=enabled` en `.env`, reinicia la API y pulsa «Comprobar conexión (Echo)». Resultado y fecha quedan en `eudr_is_echo_checks` (solo se añade).

## Contratos por entorno (WSDL públicos leídos el 2026-10-30)
| Servicio | PRODUCTION `eudr.webcloud.ec.europa.eu` | ACCEPTANCE `acceptance.eudr.webcloud.ec.europa.eu` |
| --- | --- | --- |
| DDS V3 (`submitDds`, `amendDds`, `withdrawDds`, `getDds`, `getDdsByIdentifiers`, `getDdsByInternalReference`) | Existe | Existe |
| DDS V4 (mismas seis operaciones) | **No existe** (404) | Existe |
| Echo (`EudrEchoService`) | El WSDL responde, pero la documentación oficial solo lo describe para ACCEPTANCE: no se usa | Documentado y operativo |
Antes de implementar `submitDds` hay que contrastar los XSD de V3 y V4 y registrar la versión usada por cada entorno; no se asume que sean idénticos.

## Seguridad
SOAP con WS-Security `UsernameToken` + `PasswordDigest` (`Base64(SHA-1(nonce + created + clave))`), `Timestamp` de 5 minutos y cabecera `WebServiceClientId` (`base/v4`). Credenciales cifradas con AES-256-GCM y contexto `eudr_is_credentials:{organización}:{entorno}:{campo}`; nunca se devuelven, se registran ni se auditan. Con el interruptor apagado no sale ninguna llamada.

## Pendiente (siguiente tramo de P1-007)
Presentación de ensayo en ACCEPTANCE (`submitDds`), consulta del resultado, recibos auténticos y conciliación ante respuestas perdidas o timeouts; PRODUCTION queda separada y requiere autorización explícita.
