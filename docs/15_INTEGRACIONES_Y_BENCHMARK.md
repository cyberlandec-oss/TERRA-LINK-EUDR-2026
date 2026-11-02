# Integraciones y traducción del benchmark

S2 y S3 son fuentes funcionales aportadas, no una verificación nueva de las plataformas. Los nombres sirven como referencia del tipo de experiencia/capacidad deseada; no copiar marcas, código, datasets o propiedad intelectual.

## Benchmark → decisión de producto

| Referente en adjuntos | Capacidad buscada | Adaptación Terra Link | Historia |
| --- | --- | --- | --- |
| Farmforce/KOLTIVA/INATrace | First mile, registro y app de campo | Español, pequeños productores y offline persistente | P0-004/006/023/024 |
| Cacao EUDR/Sourcemap | Onboarding y validación de geodatos | Excel con preview/errores y GIS revisable | P0-009/010/026; P1-004 |
| BanQu/Afarinick | Custodia y transformación | Grafo + ledger sin blockchain inicial | P0-015/016/017 |
| Meridia | Riesgo explicable/evidencia/mitigación | Causa → tarea → soporte → verificación | P0-019/020/021 |
| ICE CoT/Space Intelligence | Evidencia y procedencia verificable | Snapshot de dataset/método/geometría | P0-028/022 |
| Satelligence | Monitoreo/coste colaborativo | Adapter y métricas de coste por análisis | P0-028; P1-010/011 |
| osapiens/Source Intelligence | Red de proveedores e integración ERP | Grants explícitos y conexión por contrato | P1-001/008 |
| GUIA/Agrocalidad | Identidad e intercambio nacional | Canal autorizado, mapeo y conciliación | P1-006 |
| Gaps del benchmark | Madurez, simulación, pasaporte, impacto económico | Medidas independientes de conclusión legal | P1-002/004/009/010/012/014 |

Precios, cifras de cobertura y rankings de adjuntos permanecen históricos. Actualizarlos con fuentes oficiales/cotización antes de una decisión de compra; no implementarlos como tarifa predeterminada.

## Contrato de adapter satelital

Entrada: tenant, versión/hash de geometría, periodo de análisis, operación y credencial referenciada. Salida: job/result con proveedor, dataset/version, fecha/resolución/método, cobertura, observaciones, limitaciones, resultado y referencia de bytes originales. No todas las APIs entregan la misma confianza; no inventarla.

Fallback: evidencia manual versionada y evaluación pendiente; simuladores solo en tests/desarrollo claramente marcados. Cambio de proveedor exige fixture contractual y comparabilidad documentada; no reclasificar jurídicamente por ausencia de alerta.

## Estado de integraciones

| Integración | Estado aquí | Condición de activación |
| --- | --- | --- |
| WHISP | **ADAPTADOR DE DESARROLLO** (D-09 parte A, 2026-10-15): implementado contra el contrato oficial fechado (`docs/decisiones/P0-028-WHISP-CONTRATO.md`, OpenAPI 2.3.0) y probado **solo contra servidores controlados**. Llamadas reales **deshabilitadas** por configuración | Parte B: términos aceptados, autorización de datos (D-14), custodia de la clave e interruptor `SATELLITE_LIVE_CALLS` |
| GFW / EU Forest Observatory / otro satélite | POR_VERIFICAR; documentados como candidatos, sin adaptador | API, términos, cobertura, coste, seguridad y credenciales comprobadas |
| GUIA/Agrocalidad | **INTERCAMBIO POR ARCHIVO, CERRADO TRAS ACUERDO VERIFICADO** (P1-006, 2026-10-18): implementado el *fallback* —exportar el padrón propio y conciliar el de la contraparte— con **mapeo declarado, conciliación que no escribe datos, registro de actos y acuerdo de intercambio**. **Ninguna llamada de red**: no se asume API. El canal lo **verifica la plataforma** (`exchange:verify`), no la organización | Para un canal **real**: acuerdo/canal oficial o **formato autorizado** por GUIA/Agrocalidad. El formato propio es **D-50, NO OFICIAL**; al existir uno autorizado se publica otra versión y los actos antiguos conservan la suya |
| EUDR-IS/TRACES | PROPUESTA | Documentación vigente, rol/representación, credenciales y prueba ACCEPTANCE |
| ERP | **ENVÍO FIRMADO IMPLEMENTADO** (P1-008, 2026-10-19): destino configurado por la organización, **firma con instante**, **tenant por el dato**, **referencia de paquete/submission exacta** y **resultado por intento** consultable. Garantía declarada: **al menos una vez**; el «exactamente una vez» lo consigue el receptor con `X-Terra-Delivery-Id`. Demostrado **solo contra un receptor local**: **ningún ERP real conectado** | Para una integración **real**: un ERP concreto con su **correspondencia de campos** acordada —aquí solo hay contrato declarado y catálogo de 24 tipos— y la **conciliación** que pide esta columna, que **no** es criterio de P1-008 sino condición para declarar real la integración: hoy se consulta cada intento con su resultado **paginado** y se reencola la cola muerta (P0-015), y lo que falta es acordarla con la contraparte |
| Correo/SMS/WhatsApp | Fuera de habilitación automática | Proveedor/consentimiento/contexto real; no enviar por instalar Markdown |

## Seguridad de llamadas externas

Hosts/protocolos permitidos, validación de destinos y redirecciones, protección SSRF/DNS según infraestructura real, timeout, tamaño máximo y redacción de credenciales. **Implementado en P0-028** (`apps/api/src/satellite/egress.ts`): solo `https`; lista blanca **exacta** donde el **puerto forma parte de la entrada** (`host` implica 443, `host:puerto` para el resto); sin credenciales en la URL ni literales IP; cada dirección resuelta se comprueba **al conectar** (cierra la ventana de *DNS rebinding*); **ninguna redirección se sigue** (un 3xx es bloqueo, no reintento: seguirla entregaría la credencial a un destino no autorizado); plazo y tamaño máximo; redacción del secreto en todo texto conservado. Se admite **anclar una CA**; no existe forma de desactivar la verificación TLS. No adjuntar clave a host no autorizado; no aceptar URL arbitraria como «documento» para descarga de servidor.

Clave satelital cifrada y referenciada por tenant; no en payload público, log o frontend. Rate limit/cupo/coste medidos; circuit breaker y retry con backoff. Webhook con firma/timestamp/deduplicación; referencia externa no sustituye autorización interna.

## Interoperabilidad gradual

Primero import/export explícitos; luego integración batch/API donde exista canal. Mapear identidad local/oficial con estado `MATCHED/UNMATCHED/CONFLICT`; coincidencia no habilita compartir datos. Guardar fuente, versión y último intercambio. Mostrar diferencias al steward para resolver; evitar sincronización que sobreescriba evidencia validada sin revisión.

## Compartir con comprador

Entregar vista de lote/embarque y paquete específico según grant. Debe mostrar fecha, versiones, límites y bloqueos. Pasaporte comercial no sustituye DDS ni convierte coordenadas/documentos personales en información pública.
