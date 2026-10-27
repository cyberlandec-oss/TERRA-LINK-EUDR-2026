# Contraste de las comprobaciones de seguridad exigidas frente a la evidencia disponible (2026-10-15)

**Esto no es una auditoría independiente.** Son las pruebas automatizadas del propio repositorio, escritas por quien
escribió el código, ejecutadas en el equipo local. Una revisión de ciberseguridad externa sigue **pendiente** y es un
gate aparte (docs/16 §Definition of Done).

Validación de referencia: `validation-results/2026-10-15T01-45-25-586Z` — **APROBADA** sobre `a779ab3`
(59 suites, 504 pruebas, 58 E2E), que incluye la corrección descrita abajo y su prueba.

Exigencia contrastada: docs/16 §«Comprobaciones críticas de seguridad», QA-01/02/09/13/15, docs/07 (autorización),
docs/12 (archivos privados), docs/15 §«Seguridad de llamadas externas» y docs/17.

## Resumen por área

| Área | Exigencia | Evidencia disponible | Veredicto |
| --- | --- | --- | --- |
| **Autorización entre dominios** | «Prueba positiva A→A junto a negativa A→B»; cada vista agregada exige el permiso de **su** dominio | `rbac.int-spec` + pruebas de autorización en cada módulo; reportes exigen el permiso de cada dominio del que publican datos (`reports-entities`); riesgo y expediente exigen alcance de organización completo | **Cubierto** |
| **Aislamiento entre organizaciones** | IDs, listas, grafo, instantáneas, parcelas, exportaciones, objetos y trabajos de B no accesibles desde A; FK de B rechazada | Pruebas por módulo + **recorrido integral**: productor, parcela, entrega, recepción y lote de A son invisibles e inutilizables desde B | **Cubierto** |
| **Exportaciones** | Permiso separado revalidado al descargar; sin PII; con huella y registro | `audit:export`, `report:export` (revalidado), `dd:export_package`; CSV con `X-Content-Sha256`; GeoJSON exige `plot:read_geometry` | **Cubierto** |
| **Archivos privados** | Contenido autorizado por clasificación; nada de claves de almacenamiento; análisis antimalware; barrido que no borra lo referenciado | `documents`, `scanner-limits`, `storage-sweeper`; descarga por id + clasificación (`PERSONAL_DATA` exige `producer:read_identity`); el barrido usa **lista blanca** de claves gestionadas | **Cubierto, con un defecto corregido hoy** (abajo) |
| **Llamadas salientes** | Hosts/protocolos permitidos, redirecciones, SSRF/DNS, plazo, tamaño, redacción | QA-15 en niveles: decisión pura (13), transporte con servidores controlados (7), adaptador Whisp contra servidor controlado (18), desenlaces de extremo a extremo (25) | **Cubierto salvo el nivel de proveedor real** (D-09 parte B) |
| **Elevación de SUPER_ADMIN** | «superadmin con elevación explícita» (QA-02) | Hoy **no existe** elevación: el acceso a una organización donde no es miembro responde `ELEVATION_REQUIRED`/404 | **Brecha abierta por decisión: D-04** |
| **Concesiones entre organizaciones** | Buyer y auditor externos según grants | No implementadas (ADR-0002 propuesto, P1-001). Es el **segundo criterio abierto de P0-003**, junto con la elevación | **Brecha abierta, declarada** |
| **Revisión externa** | — | Ninguna | **PENDIENTE** |

## Defecto encontrado y corregido hoy

**Qué pasaba.** La API satelital devolvía la **clave de almacenamiento** del original del proveedor:
`raw_evidence: { object_key: "satellite/<organización>/<trabajo>.json", sha256 }`.

**Por qué importa.** Ningún otro módulo publica una clave de objeto: los documentos exponen su SHA-256 y su número de
versión, nunca la ruta en el almacén privado. Publicarla revela la estructura interna del almacenamiento (y en este
caso incluía el identificador de la organización). No era una vía de descarga —no existe ningún endpoint que acepte
una clave arbitraria, el barrido usa lista blanca y el contenido se sirve siempre por identificador con su
clasificación—, pero sí una fuga de estructura interna contraria a la propia regla de redacción del proyecto
(«nunca se presentan secretos, tokens, enlaces, claves…», docs/07 §auditoría).

**Qué se hizo.** La respuesta pasa a `raw_evidence: { stored: true, sha256 }`: el original se **acredita por su
huella**, que es lo que permite verificarlo, sin publicar dónde vive. Prueba añadida en `satellite.int-spec.ts`: el
resultado conserva el SHA-256 y la respuesta **no contiene** `object_key` ni ninguna ruta del almacén.

Alcance del hallazgo: **una respuesta de API**, dentro del código escrito en esta misma entrega. No hay indicio de que
el patrón exista en otros módulos (se comprobó: ningún otro devuelve `object_key`).

## Brechas priorizadas, sin maquillaje

| Prioridad | Brecha | Por qué sigue abierta | Qué la cierra |
| --- | --- | --- | --- |
| **1** | **Ninguna revisión de seguridad independiente** | Nadie ajeno al código ha mirado | Encargar la revisión; es un gate aparte de P0-031 |
| **2** | **P0-003 incompleta en sus dos frentes** (QA-02 parcial): **elevación de SUPER_ADMIN** y **concesiones entre organizaciones** (buyer/auditor externos) | La elevación espera **D-04**; las concesiones no tienen contrato definido (ADR-0002 propuesto, P1-001). Son dos criterios distintos de la misma historia, no uno | D-04 · contrato de concesiones |
| **3** | **Llamada saliente contra un proveedor real nunca ejecutada** | **D-09 parte B** sin aprobar | D-09 parte B (ver ensayo propuesto con geometría sintética) |
| **4** | **Auditoría: formato y retención de la exportación** sin política | **D-38** provisional (`TL_AUDIT_CSV 0.1`, 5000 registros). **No reabre P0-025**, que está DONE_LOCAL: es una política pendiente, no un criterio incumplido | D-38 |
| **5** | **RPO/RTO sin medir** (último resto de QA-16) | El respaldo y la restauración **sí están verificados** (13-oct sobre 37 migraciones y **15-oct sobre las 39 actuales**, en contenedor aislado): `docs/qa/EVIDENCIA_QA16_RESTAURACION_2026-10-15.md`. Lo que falta es el recorrido sobre la copia | Levantar una API contra la copia restaurada y repetir el recorrido integral; medir tiempos con datos de piloto |
| **6** | **Pruebas de mutación dirigidas** | docs/16 las admite como demostración puntual («mutación dirigida del tenant filter o del guard de stock»); no se han ejecutado | Ejercicio acotado sobre el filtro de tenant y el guard de stock |

## Lo que esta evidencia **no** dice

- No dice que el sistema sea seguro. Dice que **estas comprobaciones** pasan.
- No sustituye revisión de código independiente, análisis de dependencias ni prueba de penetración.
- No cubre producción: no hay despliegue, ni TLS propio, ni gestión de secretos operativa, ni endurecimiento de
  infraestructura. Todo eso está fuera de la etapa local vigente y así consta en docs/17 y docs/20.
