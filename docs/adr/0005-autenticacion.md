# ADR-0005 — Autenticación inicial

Estado: PROPUESTO · 2026-10-09.

## Contexto

S1 pide identidad compatible con OIDC/OAuth2. No hay proveedor elegido (Keycloak, Cognito, Entra, Auth0…) ni acuerdo de coste o SSO. P0-001 necesita un usuario autenticado para probar membresía y aislamiento.

## Decisión propuesta

- Fase actual: email + contraseña con argon2id (`users.password_hash`), JWT HS256 de corta vida (`JWT_TTL_SECONDS`, por defecto 3600) y secreto ≥32 caracteres en `JWT_SECRET`.
- El estado del usuario se consulta en cada solicitud: una baja corta el acceso aunque el token no haya caducado (probado).
- El login usa un mensaje uniforme y audita los fallos de usuarios existentes.
- **Límite de intentos (implementado 2026-10-09):** solo cuenta fallos, en tres contadores Redis de ventana fija: cuenta+origen (5), cuenta (20) y origen (50) por 900 s, configurables con `LOGIN_RL_*`. Al superar un umbral responde 429 `TOO_MANY_ATTEMPTS` con `Retry-After`. El bloqueo dura como máximo la ventana: nunca es permanente. La cuenta se identifica por el hash del email exista o no, así que no revela su existencia. Un éxito reinicia cuenta+origen. Si Redis falla, el login falla (fail-closed). El origen es `req.ip`; `TRUST_PROXY=true` solo detrás de un proxy de confianza. Riesgo residual: un tercero puede bloquear temporalmente una cuenta (≤ ventana) superando el umbral por cuenta desde muchas IP.
- **Sesiones:** el JWT lleva `tv` (`users.token_version`); desactivar o reactivar una cuenta lo incrementa e invalida todas las sesiones emitidas.
- **Invitaciones (P0-002), MECANISMO PROVISIONAL de desarrollo:** enlace de un solo uso sin correo. Token de 256 bits (`randomBytes(32)`), solo se guarda su SHA-256, se muestra una vez a quien invita y viaja en el fragmento `#token=`. Tiene caducidad (`INVITATION_TTL_HOURS`, 72 h), revocación y consumo atómico con bloqueo de fila. Aceptar no marca `email_verified_at`. Debe reemplazarse por envío verificado (correo/OIDC) antes de operación real.
- La web guarda el token en `sessionStorage` (limitación: está expuesto si hay XSS). Al adoptar OIDC, pasar a cookie httpOnly + SameSite con protección CSRF.
- `users.external_subject` se añadirá al integrar OIDC. El dominio usa `users.id` y no depende del proveedor.

## Tres asuntos que se deciden por separado (D-19)

| Asunto | Estado de desarrollo | Qué NO implica | Decisión pendiente |
| --- | --- | --- | --- |
| **Autenticación** (cómo se prueba quién inicia sesión) | Contraseña local argon2id + JWT corto + límite de intentos | No es OIDC/SSO | Local frente a proveedor OIDC (P1-015) |
| **Verificación del correo** (que la persona controla el buzón) | No implementada: `email_verified_at` siempre nulo | Aceptar un enlace o iniciar sesión **no** verifica el correo | Mecanismo (enlace de verificación por correo o claim `email_verified` de un IdP) |
| **Entrega de invitaciones** (cómo llega el enlace al invitado) | Manual: quien invita copia el enlace secreto y lo comparte por un canal privado | Tener el enlace no prueba identidad ni posesión del correo | Correo transaccional (u otro canal), con su proveedor y plantilla |

El correo transaccional resuelve la entrega y puede apoyar la verificación; OIDC resuelve la autenticación. No se sustituyen entre sí.

## Límite de intentos: riesgo, recuperación y fallo de Redis (D-20, provisional)

- **Riesgo:** con 20 fallos por cuenta en 15 minutos desde cualquier origen, un tercero puede bloquear temporalmente una cuenta.
- **Recuperación:** el bloqueo dura como máximo la ventana (900 s) y desaparece solo. No hay desbloqueo manual ni bloqueo permanente. El titular puede entrar desde otro origen mientras el contador cuenta+origen de ese origen no esté al límite y el de cuenta tampoco.
- **Si Redis falla:** el login responde **503 `LOGIN_TEMPORARILY_UNAVAILABLE`** con `Retry-After: 30` y mensaje recuperable, sin detalles internos y sin evaluar la contraseña ni emitir sesión (fail-closed). `/health/ready` devuelve 503 con `checks.redis = "unavailable"`. Al recuperarse Redis, la misma instancia vuelve a funcionar sin reinicio. Prueba automatizada: `apps/api/test/redis-outage.int-spec.ts` (proxy TCP controlable). Códigos distintos: 401 credenciales, 429 exceso de intentos, 503 indisponibilidad.
- **Estado:** valores provisionales, sin validar para producción.

## Pendiente para aceptar

Elegir proveedor OIDC (P1-015), refresh tokens, verificación de correo y envío de invitaciones por un canal verificado. Política de contraseñas actual: mínimo 12 caracteres, sin más reglas (decisión pendiente).
