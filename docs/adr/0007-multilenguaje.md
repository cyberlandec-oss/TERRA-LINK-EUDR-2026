# ADR-0007 — Extensión multilenguaje, con el español primero

- **Estado**: **adoptado para desarrollo y demostración local (2026-10-20)**: opción **B** (español como fuente) con **inglés** como segunda lengua. Implementado en la interfaz (acceso, navegación, estados, errores, límites, coste, «Mi cuenta») con reserva al español; los textos de los límites los traduce la API (`?lang=`). No son traducciones jurídicas certificadas. Evidencia: `docs/qa/EVIDENCIA_P1015_COSTE_SSO_IDIOMAS_2026-10-20.md`. Texto original: propuesta (2026-10-18)
- **Historia**: P1-015 · **Requisito**: RF-46 (`docs/03:62`), columna **Restricción**: «**Español primero** y
  decisiones de coste»
- **Aceptación mínima** (`docs/18:216`): «**ADR por componente**, **español conservado** y límites/coste/SSO
  comprobados»

## Contexto

Terra Link está **enteramente en español**: interfaz, mensajes de error, textos de advertencia y los propios
nombres de los estados que el producto publica. No hay ninguna capa de internacionalización instalada, y el
español **no depende** de ninguna: está escrito en el código.

Eso hoy es una ventaja —el idioma no puede degradarse por una traducción ausente— y mañana es el problema:
añadir una segunda lengua sin cuidado convierte el español en «una traducción más», con el riesgo clásico de
que una clave sin traducir se muestre como `errors.delivery.not_found` a un técnico en campo.

**Lo que RF-46 restringe no es que haya varias lenguas: es que el español vaya primero.**

## Decisión que hay que tomar

| Opción | Qué implica | Efecto sobre «español primero» |
| --- | --- | --- |
| **(A)** Mantener el español **en el código**, sin capa de i18n | Lo actual. Una segunda lengua exigiría refactorizar | **Máxima garantía**: el español no puede faltar |
| **(B)** Capa de i18n con **el español como fuente**, no como traducción | Las claves **son** el texto español; una lengua sin traducir **cae al español**, nunca a la clave | **Alta**: el peor caso es ver español |
| **(C)** Capa de i18n con claves abstractas y catálogos por lengua | Lo habitual en productos multilingües | **Baja**: una clave sin traducir se ve como clave |

**Recomendada: (B)**, cuando se decida añadir una segunda lengua. **Hasta entonces se queda (A)**, que es lo
que hay, y no se instala nada «por si acaso».

## Consecuencias

- **No se añade i18n en esta entrega.** Instalar una capa sin una segunda lengua real sería trabajo muerto y
  un riesgo nuevo sin contrapartida.
- Si se adopta (B), la regla es: **el catálogo español es la fuente**, y el mecanismo de reserva cae **al
  español**, nunca a la clave. Eso es lo que hace comprobable «español primero».
- **Qué NO decide este ADR**: qué segunda lengua, ni cuándo. Eso depende de a qué mercado se vende, que es una
  decisión de negocio, no de arquitectura.

## Cómo se comprueba hoy

`GET /organizations/:orgId/limits` publica `language: { primary: 'es', available: ['es'] }` y la revisión
`limites.mjs` comprueba sobre el despliegue que la interfaz **no muestra claves de traducción** y que el
idioma declarado es el español. Es una comprobación de que **el español está conservado**, no una prueba de
soporte multilingüe —que no existe y no se afirma—.
