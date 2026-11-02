# Copia fechada del texto normativo EUDR (descargada el 2026-10-15)

En la sesión anterior se registró que **la norma no se había podido leer literalmente**: EUR-Lex devolvía páginas
vacías. La causa real, comprobada el 2026-10-15, es que `eur-lex.europa.eu` responde **HTTP 202 con un desafío
JavaScript de AWS WAF** (2 035 bytes, sin contenido del documento) a cualquier petición automatizada. No es un
fallo transitorio ni de red.

**La vía que sí funciona** es el servicio de contenido de la Oficina de Publicaciones:
`https://publications.europa.eu/resource/celex/<CELEX>` con cabecera `Accept: application/xhtml+xml` y
`Accept-Language: eng`. Devuelve el documento completo. Por ahí se obtuvieron los textos de esta carpeta.

| Archivo | CELEX / fuente | Bytes | sha256 |
| --- | --- | ---: | --- |
| **`02023R1115-20260918.xhtml`** (**vigente**) | `02023R1115-20260918` | 315 135 | `1cd2711f41ceabc1fd716ba8447c47f5d4aa51d19fe86846c1c275f6622cb1c6` |
| `02023R1115-20251226.xhtml` (histórico) | `02023R1115-20251226` | 267 071 | `a00f759dfaf6daeff3b831e14571bd89828360e29cd9c7e6e1b6d3d1af0ddbe6` |
| `32025R2650.xhtml` | `32025R2650` | 182 765 | `f9a2440227c4231d359e2816d9fc17bf59643dd1f3c7fa6ff31320180037ae27` |
| `country-classification-list.html` | Comisión Europea, *Country Classification List* (`green-forum.ec.europa.eu/countries-and-partnerships/country-classification-list_en`) | 178 393 | `b536d933e9286558f3cd781a2ef9c4a97899063241d97f04faf97f9c6b583356` |

Los CELEX se descargan de `https://publications.europa.eu/resource/celex/<CELEX>`.

## Consolidación vigente y comparación con la anterior

El 2026-10-15 se comprobó que existe una consolidación **posterior** a la que se había citado:

| | Anterior | **Vigente** |
| --- | --- | --- |
| Identificación | `02023R1115 — EN — 26.12.2025 — 002.001` | **`02023R1115 — EN — 18.09.2026 — 003.001`** |
| Modificaciones | M1 (2024/3234), M2 (2025/2650) | M1, M2 y **M3** |

**M3** es el **Reglamento Delegado (UE) 2026/2102 de la Comisión, de 13 de julio de 2026** (OJ L 2102, 17.9.2026).

### Qué cambió, comprobado por comparación de los dos textos

La comparación completa de ambos documentos devuelve **diez bloques distintos**, y **todos están en el Anexo I**
(la lista de materias primas y productos). **Ningún artículo cambió.** Verificado uno a uno sobre el texto:

| Artículo | Resultado |
| --- | --- |
| Art. 2(28) geolocalización | **Idéntico** |
| Art. 2(27) parcela | **Idéntico** |
| Art. 2(15a) micro o pequeño operador primario | **Idéntico** |
| Art. 4a(5) dirección postal | **Idéntico** |
| Art. 9(1)(d) información | **Idéntico** |
| Art. 38 fechas de aplicación | **Idéntico** |

**No se asume que todo cambió por haber una consolidación nueva.** Lo que M3 hace es precisar el alcance de
productos: excluir residuos (Directiva 2008/98/CE), productos usados y de segunda mano, y cierto material de
embalaje; añadir partidas (por ejemplo `2101 11 00`, extractos de café, aplicable desde el 30-12-2027) y afinar
códigos.

**Para cacao, que es el alcance de este proyecto**: `1801` (granos de cacao, enteros o partidos, crudos o
tostados) **no cambia**. El único retoque del bloque es en `1802` (cáscara y residuos), que ahora excluye los
residuos tal como los define la Directiva 2008/98/CE.

**Efecto sobre D-05: ninguno.** El umbral, la definición de geolocalización y la vía de dirección postal son los
mismos. La consolidación citada se actualiza por exactitud, no porque cambie una regla.

## Clasificación de riesgo de Ecuador

Dato que la revisión anterior dejó sin verificar, y que ya se puede verificar.

> **Ecuador — `standard risk category`.** Comisión Europea, *Country Classification List*, consultada el
> 2026-10-15 (copia con hash arriba).

La lista clasifica a cada país en `low risk`, `standard risk` o `high risk` a efectos del Art. 29.

**Consecuencias, que no deben confundirse entre sí:**

1. **Sobre la vía de la dirección postal (Art. 4a(5))**: la figura de «micro o pequeño operador primario»
   (Art. 2(15a)) exige estar **establecido en un país clasificado como de riesgo bajo**. Ecuador es **estándar**,
   no bajo. **Mientras esa clasificación siga así, esa vía no está disponible** para un operador establecido en
   Ecuador — y seguiría sin estarlo aunque se cumplieran las demás condiciones.
2. **Esto NO es el riesgo de una parcela ni de un lote.** La clasificación de país es una categoría del
   Reglamento sobre un **territorio**; la evaluación de riesgo de Terra Link es sobre **sujetos concretos** y
   depende de D-07 y de un catálogo de reglas que sigue **NO APROBADO**. Usar una para rellenar la otra sería
   exactamente el error que las compuertas del proyecto impiden.
3. **La lista cambia.** El Art. 29 prevé revisiones. El dato lleva fecha a propósito.

## Identificación exacta de los actos

| Acto | Identificación | Diario Oficial |
| --- | --- | --- |
| Base (**B**) | Reglamento (UE) **2023/1115**, de 31 de mayo de 2023 | OJ L 150, 9.6.2023, p. 206 |
| Modificación **M1** | Reglamento (UE) **2024/3234**, de 19 de diciembre de 2024 | OJ L 3234, 23.12.2024, p. 1 |
| Modificación **M2** | Reglamento (UE) **2025/2650**, de 19 de diciembre de 2025 | OJ L 2650, 23.12.2025, p. 1 |
| Modificación **M3** | Reglamento Delegado (UE) **2026/2102** de la Comisión, de 13 de julio de 2026 | OJ L 2102, 17.9.2026, p. 1 |

En el texto consolidado, los pasajes marcados **▼M2** son los introducidos por 2025/2650 y los **▼M3** por 2026/2102.

## Advertencia que hace el propio documento

> «This text is meant purely as a documentation tool and has no legal effect. The Union's institutions do not assume
> any liability for its contents. The authentic versions of the relevant acts, including their preambles, are those
> published in the Official Journal of the European Union and available in EUR-Lex.»

Es decir: **el consolidado sirve para trabajar, no para fundar una conclusión jurídica**. Para eso hace falta el
texto del Diario Oficial. Esta copia **no sustituye** la revisión de un responsable regulatorio; permite citar con
exactitud en vez de parafrasear de memoria.

## Pasajes citados en `docs/decisiones/D-05-PROPUESTA.md`

Todos verificados contra **ambos** consolidados (`-20251226` y `-20260918`), con resultado idéntico:

- **Art. 2(27)** «plot of land» — define la parcela como terreno dentro de **una sola propiedad inmobiliaria**
  reconocida por la ley del país de producción, con condiciones suficientemente homogéneas.
- **Art. 2(28)** «geolocation» — coordenadas con **al menos seis dígitos decimales**; polígono para parcelas de
  **más de cuatro hectáreas** destinadas a productos distintos del ganado.
- **Art. 2(15)** «operator» (▼M2) y **Art. 2(15a)** «micro or small primary operator» (▼M2), con **todas** sus
  condiciones acumulativas.
- **Art. 4a** (▼M2) régimen simplificado, y **Art. 4a(5)** sustitución de la geolocalización por dirección postal.
- **Art. 9(1)(d)** requisito de información de geolocalización.
- **Art. 38(2) y (3)** fechas de aplicación: **30-12-2026** y **30-06-2027**.
