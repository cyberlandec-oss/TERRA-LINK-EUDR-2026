# Documentos y Evidence Center

FUENTE: S1 §§30–32, 55–59; S4 §§12–13. PROPUESTA: afirmaciones explícitas, revisión y trazabilidad de snapshots.

## Conceptos

Documento: archivo o registro con tipo, titular, emisor, fecha, vencimiento y versiones. Evidencia: información utilizada para respaldar o contradecir una afirmación. Un PDF subido no es automáticamente evidencia validada. Un checksum detecta cambios de bytes; no certifica autenticidad ni contenido jurídico.

| Afirmación | Soportes posibles | Limitación |
| --- | --- | --- |
| La parcela fue capturada en campo | GPS/muestras, técnico, fecha, fotos | Precisión y procedencia verificables |
| El lote tiene origen identificado | Entregas, recepción, grafo, versiones de parcelas | No completa un origen desconocido |
| Se realizó análisis ambiental | Resultado proveedor/dataset/fecha/geometría | No concluye legalidad por sí solo |
| Existe documentación de tenencia | Documento/emisor/periodo/revisión | Su aplicabilidad la define perfil validado |
| Una mitigación fue verificada | Acción, soporte, revisión y responsable | Aportar evidencia no es verificarla |

## Carga y revisión

1. Autorizar usuario/recurso y crear sesión de subida con límites de tamaño/tipo.
2. Recibir bytes en cuarentena privada; verificar tipo real y checksum, sin confiar solo en extensión.
3. Escanear y registrar resultado; fallo/indisponibilidad permanece pendiente, no «limpio».
4. Crear versión de documento y metadata; no reemplazar bytes anteriores.
5. Vincular a entidad autorizada y afirmación con relación `SUPPORTS/CONTRADICTS/BASED_ON`.
6. Aportar para revisión. Verificador autorizado acepta/rechaza con motivo y fecha.
7. Caducidad, nueva versión o revocación cambia vigencia y recalcula los expedientes afectados.

## Estados separados

| Dimensión | Estados propuestos |
| --- | --- |
| Subida | INITIATED, UPLOADING, COMPLETE, FAILED |
| Escaneo | PENDING, CLEAN, INFECTED, FAILED |
| Evidencia | DRAFT, SUBMITTED, VERIFIED, REJECTED, EXPIRED, REVOKED |

Solo una combinación autorizada habilita descarga o uso en un paquete. Una versión nueva no hereda aprobación de la anterior automáticamente.

## Evidence Center

Vista orientada a afirmación/requisito, con entidad vinculada, tipo, procedencia, vigencia, revisor, versión y pendientes. Filtros por productor, parcela, lote, categoría de riesgo, responsable y estado. Acción «ver causa» conduce a riesgo; «aportar soporte» a carga; «verificar» exige permiso separado.

Detalle muestra: qué pretende probar, qué archivos/datos utiliza, qué contradicciones hay, quién revisó y qué expedientes dependen de ella. No ocultar evidencia contraria para mejorar un score.

## Reutilización e impacto

Enlaces apuntan a versiones concretas. Una evidencia válida puede respaldar varias afirmaciones, pero la aplicabilidad temporal/espacial se verifica por enlace. Un documento de un productor no prueba automáticamente todos los lotes del tenant. Modificaciones invalidan readiness dependiente; paquetes históricos permanecen inmutables con aviso de revisión posterior.

## Acceso y retención

Objetos privados; URLs temporales, autorización antes de emitirlas y auditoría de descarga. Vistas del comprador/auditor aplican campo y recurso del grant. No servir documentos de identidad por pasaporte público. Retención y eliminación legalmente aplicable requieren política; evidencia de un expediente bajo retención no se borra por eliminar su vista actual.

## Implementación P0-018 (2026-10-10)

- Flujo: recibir (bytes en memoria = cuarentena) → **análisis antimalware real** (ClamAV local, servicio `scanner`, protocolo INSTREAM) → infectado: rechazo sin almacenar y auditado → tipo real por firma de bytes (PDF/JPEG/PNG; MIME declarado distinto → rechazo) → objeto privado en S3 + versión + resultado del análisis en la misma transacción. Escáner caído: la versión queda FAILED (no disponible) y se puede reintentar; un reintento que detecte malware la deja RECHAZADA.
- Estados mostrados: recibido (versión registrada), disponible (último análisis CLEAN), pendiente/fallido/rechazado, revisado por una persona (por versión), vigente/vencido. «Vencido» no es «inaccesible». Evidencia (SUBMITTED/VERIFIED/…) y relaciones probatorias: P0-019.
- Límites (provisionales, D-36): 10 MiB por archivo y 1 GiB por organización (configurables), cuota serializada por organización.
- Staging y compensación reutilizados de P0-009; el barrido elimina solo objetos sin versión registrada; las versiones registradas no se borran (sin eliminación por antigüedad).
- Eventos `DocumentUploaded` y `DocumentScanCompleted` sin nombres de archivo ni contenido; auditoría de carga, rechazo, análisis, revisión, vínculo y descarga.
- Contrato preparado para P0-012: titular/vínculo `delivery` reservado (hoy 422 `ENTITY_TYPE_NOT_AVAILABLE`); el validador KDE ya verifica `DELIVERY_SUPPORT` (existe, tenant, alcance, disponible) sin aprobar el contenido.

### Escáner comprobado (2026-10-10)

- Motor ClamAV 1.4.6, firmas daily 28149, main 63, bytecode 339 (actualizadas por freshclam al arrancar). Configuración versionada en `infra/clamav/clamd.conf`, montada en el servicio `scanner`; puerto publicado solo en `127.0.0.1` (antes en todas las interfaces).
- Límites efectivos: `StreamMaxLength 16M` (por encima: `INSTREAM size limit` → FAILED), `MaxFileSize 100M`, `MaxScanSize 400M`, `MaxRecursion 17`, `MaxFiles 10000`, `MaxScanTime 25000` ms (menor que la espera del cliente, 30 s), `AlertExceedsMax yes`, `HeuristicAlerts yes`. Antes de esta comprobación `AlertExceedsMax` estaba desactivado y `MaxScanTime` sin límite.
- Interpretación (`interpretReply`): `OK` → CLEAN; firma `FOUND` → INFECTED; `Heuristics.Limits.Exceeded.*` → FAILED `SCAN_INCOMPLETE_LIMITS` (nunca limpio); límite de flujo, tiempo de espera, conexión rechazada o respuesta desconocida → FAILED.
- Fixtures comprobados (sintéticos, en memoria): EICAR → `Eicar-Test-Signature`; flujo de 17 MiB → FAILED por tamaño; ZIP anidado 20 niveles → `Heuristics.Limits.Exceeded.MaxRecursion`; PDF pequeño → CLEAN.
- **Limitación residual observada**: un objeto interno mayor que `MaxFileSize` (ZIP con un archivo de 20 MiB cuando el límite era 16 MiB) se omite y clamd responde `OK` aunque `AlertExceedsMax` esté activo. Por eso `MaxFileSize`/`MaxScanSize` se mantienen muy por encima del máximo de documentos (10 MiB) y el resultado CLEAN se interpreta como «sin firmas detectadas dentro de esos límites», no como garantía.
- **Contenido incrustado en formatos admitidos (P0-025, 2026-10-10)**. Solo se aceptan PDF, JPEG y PNG por firma de bytes; un ZIP directo se rechaza (`FILE_TYPE_NOT_ALLOWED`). Reproducciones sintéticas contra clamd real:
  - PDF con flujo `FlateDecode` de ~110 KiB que se infla a 110 MiB (> `MaxFileSize`) → `Heuristics.Limits.Exceeded.MaxFileSize` → FAILED `SCAN_INCOMPLETE_LIMITS` → no disponible. Con 90 MiB inflados → CLEAN (dentro del límite, analizado). Prueba: `scanner-limits.int-spec.ts`.
  - **Políglota PDF+ZIP** (cabecera `%PDF-` seguida de un ZIP con un objeto de 20 o 110 MiB) → clamd responde `OK`: el objeto interno se omite sin aviso. Antes de esta historia el archivo habría quedado «disponible». **Política aplicada**: antes del escaneo se rechaza cualquier archivo admitido que contenga un contenedor comprimido incrustado (ZIP: cabecera local + fin de directorio central; RAR; 7z) con `422 EMBEDDED_ARCHIVE_NOT_ALLOWED`, sin almacenar nada. Prueba: `documents.int-spec.ts` («formatos, tipo engañoso y tamaño»). Riesgo de falso positivo: un PDF/imagen legítimo cuyos bytes contengan ambas secuencias; es muy improbable y el usuario recibe instrucción de recuperación (reexportar sin adjuntos).
  - PNG con IDAT que se descomprime a ~144 MiB → CLEAN: clamd no analiza los píxeles como contenido; no es un objeto omitido sino un alcance de detección.
  - Limitación de detección (no de límites): la cadena EICAR dentro de un flujo PDF, comprimido o no, no se detecta (la firma EICAR exige el archivo completo). CLEAN significa «sin firmas detectadas en lo analizado», nunca ausencia garantizada de malware.
  - Pendiente: PDF con adjuntos `/EmbeddedFile` cuyo contenido sea a su vez un archivo comprimido (cubierto por la regla de firmas solo si el contenedor no va comprimido dentro del flujo); evaluar en endurecimiento de producción (sandbox/CDR).
- La API acota la recepción al límite configurado (multer corta el flujo al superar `documents.maxBytes`) y la cuota se serializa por organización (probado con cargas concurrentes).

## Evidencias (P0-019, implementado)

- Afirmación (catálogo de sistema de docs/12, solo entidades existentes) ≠ soporte (versión exacta de documento con relación tipada) ≠ decisión (motivo y responsable). Adjuntar un documento disponible no cambia el estado de la afirmación.
- Verificar exige: al menos un soporte SUPPORTS vigente; todos los SUPPORTS disponibles (análisis limpio), no vencidos, no rechazados en revisión documental y en su versión más reciente; reconocer expresamente cualquier CONTRADICTS activo; acceso a todos los soportes.
- Una nueva versión del documento **no** sustituye el enlace ni hereda la verificación: la afirmación queda «requiere revisión» (`NEWER_DOCUMENT_VERSION`); se revoca, se reabre, se vincula la versión nueva (el soporte anterior se retira con motivo, conservado) y se vuelve a verificar. Otros motivos: soporte vencido, rechazado o no disponible; contradicción activa; vigencia de la afirmación terminada.
- Eventos `EvidenceCreated/SourceLinked/SourceWithdrawn/Submitted/Verified/Rejected/Revoked/Reopened` y auditoría en la misma transacción, sin títulos, nombres de archivo ni datos personales.
- Pendiente: afirmaciones de lote, análisis ambiental y mitigación (sus entidades no existen); uso de evidencias en riesgo y expedientes (P0-020/P0-022).

## Aceptación

Archivo válido y malicioso; escaneo caído; tipo MIME engañoso; subida truncada; checksum distinto; versión nueva; documento vencido; enlace a entidad ajena; intento de aprobar soporte propio si política lo impide; revocación de acceso; paquete histórico intacto tras modificación. Ver QA-09–12.
