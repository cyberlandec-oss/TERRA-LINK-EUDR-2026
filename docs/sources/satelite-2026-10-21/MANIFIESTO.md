# Copia fechada de documentación pública oficial para D-09.B (proveedor satelital), leída el 2026-10-21

Solo **lecturas GET de páginas de documentación y términos** (sin enviar geometrías, datos personales ni credenciales; sin llamar a ningún endpoint de análisis; sin registrar cuenta ni obtener clave — la página de registro de Whisp
redirige a un formulario de identidad de FAO que **no se abrió más allá de su carga** y cuya captura se descartó por contener parámetros de sesión). Las páginas que se renderizan con JavaScript se leyeron con un navegador y se guardó su texto visible
(`.txt`, con la URL y la hora de lectura en la cabecera). Los archivos de interfaz sin contenido legible (envoltorios JavaScript) **no se guardan**. Nada de esto es revisión jurídica.

| Archivo | Fuente (URL) | sha256 |
| --- | --- | --- |
| `whisp-openapi.json` | `https://whisp.openforis.org/api/openapi.json` — **OpenAPI 3.1.0, versión de la especificación 2.3.0** (sin cambio respecto del contrato fechado 2026-10-15) | `adb336a9…2cb0` |
| `whisp-terms-of-service.txt` | `https://whisp.openforis.org/legal/terms-of-service` (**Terms of Service for Whisp API**, FAO), texto visible | `1cdb2305…ebcad7` (cuerpo completo del archivo) |
| `whisp-privacy-openforis.html` | `https://www.openforis.org/whisp-terms/` (los mismos términos publicados por Open Foris) | `c85b677a…817e27` |
| `whisp-license.txt` | `https://raw.githubusercontent.com/forestdatapartnership/whisp/main/LICENSE` (MIT) | `466c206a…f876d` |
| `whisp-license-page.txt` | `https://whisp.openforis.org/legal/license` | `921fbd8c…428b76` |
| `whisp-faqs.html` | `https://www.openforis.org/whisp-faqs/` | `c4831ca8…551a45` |
| `whisp-readme.md` · `whisp-layers.md` · `whisp-app-readme.md` | `forestdatapartnership/whisp` (README y `layers_description.md`) y `forestdatapartnership/whisp-app` (README), rama `main` | `d6125fff…961d` · `41eca3ab…2928` · `9ad3871b…3e82` |
| `whisp-home.html` | `https://whisp.openforis.org/` (la aplicación muestra «v2.3.0» y la biblioteca «v3.0.0a17») | `69e56e89…f431` |
| `fao-data-protection.html` | `https://www.fao.org/contact-us/data-protection-and-privacy/en/` | `012643c8…25ac` |
| `gfw-terms.html` | `https://www.globalforestwatch.org/terms/` → redirige a `globalnaturewatch.org/terms/` (WRI) | `6b9bf9db…d04f` |
| `jrc-gfc2020.html` | `https://forobs.jrc.ec.europa.eu/GFC` (JRC, *Global forest cover 2020 — Data Access*) | `d08231d8…f43a` |

**No se pudo leer:** la documentación de la API de GFW (`data-api.globalforestwatch.org`, ReDoc que exige JavaScript y no se renderizó) ni el portal de datos del JRC (aplicación JavaScript): por eso **no se afirma nada** sobre cuotas, precios ni
condiciones de GFW más allá de sus términos, ni sobre el acceso a datos del JRC más allá de su página «About the data».

> Actualización 2026-10-23: la especificación publicada pasó a **2.3.1**; su copia está en `docs/sources/satelite-2026-10-23/whisp-openapi-2.3.1.json` (sha256 `29ce6009…e8f3`). Ver `docs/decisiones/P0-028-WHISP-CONTRATO-2.3.1.md`.
