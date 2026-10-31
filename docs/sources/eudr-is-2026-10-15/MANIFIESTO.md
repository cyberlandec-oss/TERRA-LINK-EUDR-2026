# Copia fechada de la documentación del EUDR Information System (descargada el 2026-10-15)

Copia **literal** de cuatro páginas de la documentación pública del sistema de destino, guardada para que la
propuesta D-05 pueda citarla contra una versión concreta. **No es normativa**: es la documentación técnica de un
sistema, que su propia página advierte que puede cambiar.

Origen: `https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/`
Descarga: **2026-10-15**, con `curl` desde el entorno de desarrollo local, sin autenticación.

| Archivo | URL | Bytes | sha256 |
| --- | --- | ---: | --- |
| `index.html` | `.../operator/index.html` | 37 995 | `77be729622500f147c94d0c955add75c53738ddc9570474613c33d9ecbc6fb96` |
| `change-log.html` | `.../operator/change-log.html` | 31 479 | `8e5821f28d50881383dd9bfdd8181cb4f251c0a81b548a533fdd1985eace70ec` |
| `validation-rules.html` | `.../operator/validation-rules.html` | 29 300 | `08d91eed9a67cf0c5e95ab8b72f89f91f3adb9b53d0a3a9b007f237c1146c086` |
| `geojson-description.html` | `.../operator/geojson-description.html` | 61 450 | `165fee68742baf3cc1695c11305498b20d68571eaee5dae57f2d0dc62412bb35` |

## Identificación de versiones (tal como la declara la propia documentación)

| Qué | Valor | Dónde lo dice |
| --- | --- | --- |
| Título del conjunto | *EUDR Information System — Operator API Reference* | `index.html` |
| **Versión del servicio** | **V3**, la actual. Endpoints `…/ws/EUDRDueDiligenceStatementServiceV3` y `…/ws/EUDRSimplifiedDeclarationServiceV3` | `index.html` §*API version history* |
| Versiones anteriores | V1 y V2, que **se retiran** con la salida de V3 | `index.html` §*Previous API versions* |
| Motivo del rediseño | Reglamento (UE) **2025/2650**: nuevos tipos de actor (micro o pequeño operador primario, operador downstream), Declaración Simplificada y declaraciones agrupadas | `index.html`, `change-log.html` |
| **Fecha de la página GeoJSON** | **«Updated 17 August 2026»** | `geojson-description.html` |
| Fecha de las demás páginas | **No declaran fecha** | `index.html`, `change-log.html`, `validation-rules.html` |
| Advertencia de la propia fuente | «this version of documentation may not be final and will be adapted as needed», por la modificación en curso del Reglamento de Ejecución (UE) **2024/3084**; y «Readers are invited to regularly verify whether new specifications are published, as services and their behaviour may evolve» | `index.html` |

## Corrección: «v1.2» es la versión del DOCUMENTO, no de la API

Una revisión anterior de `docs/decisiones/D-05-PROPUESTA.md` citaba estas páginas como «referencia de API
**v1.2**». **El número existe, pero no es lo que esa etiqueta decía.** Comprobado sobre el HTML guardado, aparece
en dos sitios y los dos se refieren al **documento**, no al servicio:

| Dónde | Cadena literal |
| --- | --- |
| Enlace de descarga, en las cuatro páginas | `./pdf/EUDR Operator API Reference v1.2.pdf` |
| Configuración del sitio, en las cuatro páginas | `"version": "1.2"` |

El PDF se descargó para comprobarlo: `https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/pdf/EUDR%20Operator%20API%20Reference%20v1.2.pdf`
· 6 686 345 bytes · sha256 `317829e50b42c25ed0a61702af6c68e17d7117195952074c028dd2034774348a`.
**No se guarda en el repositorio** por tamaño: su contenido es el mismo de las cuatro páginas HTML que sí están
aquí, y el hash permite recomprobarlo descargándolo de nuevo.

Hay por tanto **cuatro** identificadores distintos que no deben mezclarse:

1. **Versión del servicio de destino**: **V3** (`…ServiceV3`). Es lo que importa para integrar.
2. **Versión del documento** *Operator API Reference*: **1.2**. Es lo que importa para citar.
3. **Fecha de una página concreta**: **17-08-2026**, solo la de GeoJSON; las otras tres no publican fecha.
4. **Revisión del perfil interno de Terra Link**: `EUDR_GEO_V1`, que es nuestra.

El error de la revisión 2 no fue inventarse un número: fue **llamar «versión de la API» a la versión del
documento**. La revisión 3 los cita por separado.

## Qué acredita esta copia, y qué no

- **Acredita** qué decía la documentación el 2026-10-15, de forma verificable por hash.
- **No acredita** el comportamiento real del servicio: nadie ha importado un archivo en TRACES desde Terra Link.
  Leer la documentación no es probar una importación aceptada.
- **No acredita** nada sobre la norma. La documentación de un sistema no interpreta el Reglamento.
