# ADR-0008 — Inicio de sesión federado (SSO)

- **Estado**: **adoptado para desarrollo y demostración local (2026-10-20)**: OIDC Authorization Code + PKCE (`openid-client`), **Keycloak autoalojado como proveedor local de ensayo** (perfil `sso`), vínculo por emisor+sujeto, acceso con contraseña conservado, deshabilitado por defecto (`SSO_ENABLED`). **No** hay proveedor de un cliente real conectado: conectarlo es configuración comercial de ese cliente (no un criterio original de P1-015) y quedó fuera de esta entrega. Hallazgo de la demostración real: RFC 9207 (`iss` en el retorno). Evidencia: `docs/qa/EVIDENCIA_P1015_COSTE_SSO_IDIOMAS_2026-10-20.md`. Estado anterior: propuesta (2026-10-18), bloqueada por una decisión de negocio
- **Historia**: P1-015 · **Requisito**: RF-46 (`docs/03:62`) «Extensión multilenguaje/**SSO**/consumo»
- **Antecedente**: **ADR-0005** ya dejó escrito que «no hay proveedor elegido (Keycloak, Cognito, Entra,
  Auth0…) ni acuerdo de coste o SSO», y remitió explícitamente a **P1-015**

## Contexto

La autenticación actual es **local**: contraseña con `argon2id`, testigo propio de duración corta y límite de
intentos por cuenta, por origen y por ambos. Funciona, está probada y **no depende de nadie**.

SSO significa delegar **quién es cada persona** en un proveedor de identidad externo. Eso cambia tres cosas:
la **confianza** (si el proveedor cae, nadie entra), el **coste** (casi todos cobran por usuario activo) y el
**modelo de datos** (hay que decidir qué pasa con las cuentas existentes y con la pertenencia a
organizaciones).

## Decisión que hay que tomar

| Opción | Qué implica | Coste y dependencia |
| --- | --- | --- |
| **(A)** Seguir **solo con el inicio de sesión local** | Lo actual. Nada que negociar | **Ninguno**. Pero cada cooperativa gestiona sus contraseñas |
| **(B)** **OIDC** contra un proveedor alojado (Entra, Auth0, Cognito…) | Estándar, rápido de integrar | **Coste por usuario activo**, y dependencia de un tercero para entrar |
| **(C)** **OIDC** contra un proveedor **autoalojado** (Keycloak) | Mismo estándar, sin cuota por usuario | **Coste de operación**: un servicio más que mantener, actualizar y respaldar |
| **(D)** **Híbrido**: local por defecto, OIDC opcional por organización | Cada organización elige | El más flexible y **el más caro de construir y probar** |

**Recomendada: (C)** si el SSO se vuelve requisito de un comprador grande —conserva el estándar sin cuota por
usuario—; **(A)** mientras no lo sea. **(D)** solo si varias organizaciones lo piden a la vez.

## Por qué no se implementa ahora

1. **No hay proveedor elegido ni acuerdo de coste**: elegirlo aquí sería inventar una decisión de negocio.
2. **La historia depende de un «piloto»** (`docs/18:216`), y **no hay piloto**. Sin usuarios reales de una
   organización real no se puede comprobar que el SSO funciona para ellos.
3. Integrar OIDC **sin proveedor** daría código no ejecutado: exactamente lo que el proyecto no considera
   demostrado.

## Consecuencias

- **RF-46 no puede cerrarse** mientras «SSO comprobado» siga sin proveedor ni piloto. Esa es su condición
  exacta, y sale de los criterios, no de una interpretación.
- El producto **dice** que la autenticación es local: `GET /organizations/:orgId/limits` publica `sso_note`,
  y no se insinúa un SSO que no existe.
- Lo que **sí** queda listo: la autorización es **por organización, acción y recurso** y no depende de cómo se
  pruebe la identidad. Cambiar a OIDC **no obligaría** a rehacer los permisos.
