# QA-16 · Respaldo y restauración: evidencia histórica y verificación sobre el estado actual (2026-10-15)

QA-16 pide «restaurar DB+objetos en entorno aislado y ejecutar recorrido → snapshot consistente, archivos disponibles
y tiempos/RPO/RTO medidos».

## Corrección de un dato que yo di mal

En `docs/qa/CONTRASTE_SEGURIDAD_2026-10-15.md` y en la primera versión de la matriz del recorrido escribí que la
restauración de respaldo estaba «no ejecutada» y que «no existen comandos de respaldo verificados». **Es falso.**
El 13 de octubre se hizo un respaldo completo y **se verificó restaurándolo**, con cotejo de tablas y migraciones,
descifrado con las claves del respaldo y comprobación de objetos por hash. Está documentado en
`docs/qa/TRASLADO_DISCO_DOCKER_PASOS.md` §«Respaldo verificado (hecho, no pendiente)» y el respaldo sigue en
`D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\_respaldos\2026-10-13-pretraslado\`.

Lo que sí faltaba —y es lo que se hizo hoy— era **repetirlo sobre el estado actual**, que ya no es el de entonces:
37 migraciones entonces, **39** ahora, con tablas nuevas (satélite) que aquel respaldo no podía contener.

## Lo verificado el 2026-10-13 (histórico, intacto)

| | |
| --- | --- |
| Respaldo | `_respaldos/2026-10-13-pretraslado/`: `terra_link.dump`, `object-data.tar.gz`, `claves.env` (ACL restringida), `SHA256SUMS.txt`, `estado-previo.txt`, `docker_data.vhdx` |
| Estado capturado | **37 migraciones**, 13 tablas con conteos |
| Restauración | Base aislada `terra_link_verif` (creada y eliminada; `terra_link` no se tocó) |
| Resultado | Conteos idénticos en las 13 tablas y en las 37 migraciones · **12 campos descifrados** en `producers` y **14** en `producer_versions`, 0 fallos · objetos 2/2 por clave, tamaño y sha256, 0 rotas, 0 huérfanas |

**Ese respaldo no se ha tocado ni sobrescrito.** Sigue siendo el punto de retorno del traslado de disco.

## Lo verificado hoy, 2026-10-15, sobre el estado actual

### Respaldo nuevo

`_respaldos/2026-10-15-qa16/` — **no sustituye** al del 13 de octubre.

| Archivo | Qué es |
| --- | --- |
| `terra_link.dump` | Base completa (`pg_dump -Fc`) con las escrituras de la aplicación **pausadas** |
| `object-data.tar.gz` | Volumen `terra-link_object-data` (los tres buckets: privado, test y e2e) |
| `claves.env` | Las 9 variables necesarias para descifrar y acceder (`PII_*`, `S3_*`, `JWT_SECRET`, `POSTGRES_*`). ACL restringida al usuario; **nunca versionado ni impreso** |
| `estado-actual.txt` | 25 tablas con conteos, migraciones e inventario de objetos referenciados |
| `SHA256SUMS.txt` | Huellas de los cuatro; `sha256sum -c` → los cuatro `OK` |

**Coordinación de escrituras**: antes del volcado se detuvieron `api`, `web` y `worker` (`docker compose stop api web
worker`), dejando solo `postgres`, `redis`, `object-storage` y `scanner`. Así la base y los objetos corresponden al
**mismo instante**: el worker es el único que escribe objetos fuera de una petición.

### Restauración en un entorno **totalmente aislado**

No una base aparte en el mismo servidor, como en octubre: un **contenedor PostgreSQL nuevo con su propio volumen**,
creado para esto y destruido después. **Sin seed y sin migraciones** sobre la copia: solo `pg_restore`.

```
docker run -d --name tl-restore-qa16 -e POSTGRES_USER=... -v tl-restore-qa16-data:/var/lib/postgresql/data postgis/postgis:16-3.4
docker exec tl-restore-qa16 psql -U restore -d postgres -c "CREATE DATABASE terra_link_restaurada OWNER restore;"
docker exec tl-restore-qa16 pg_restore -U restore -d terra_link_restaurada --no-owner --no-privileges /tmp/terra_link.dump
```

### Resultados

| Comprobación | Resultado |
| --- | --- |
| **Migraciones** | **39/39**, de `0001_identity_organizations` a `0039_satellite_whisp_development`; **0 sin marca de tiempo** |
| **Tablas y conteos** | **Idénticos** a `estado-actual.txt`: `diff` sin diferencias en las 28 líneas (25 tablas + migraciones + 2 objetos) |
| **Satélite** | `satellite_providers` 4 filas con su estado (`WHISP = SELECTED_FOR_DEVELOPMENT`, 1 operación declarada); `satellite_jobs`, `satellite_results` y `satellite_credentials` en 0, como en origen |
| **Reportes** | Sus fuentes restauradas: `risk_rule_sets` (0.1.0 y 0.2.0, ambas `NOT_APPROVED`), `risk_rules` 16, `risk_evaluations` 2, `dd_cases`/`dd_snapshots` 1, `audit_logs` 276, `domain_events` 63 |
| **Relaciones** | **265 FK, 311 CHECK y 125 UNIQUE** reconstruidas en la copia |
| **Descifrado** | **18 campos** en `producers` (6 de 9 productores con identidad) y **21** en `producer_versions`; **0 fallos**. Clave `k1` presente y activa. **Ningún valor se imprimió** |
| **Objetos** | 2/2 referenciados: **clave, tamaño y sha256 exactos**; 0 faltantes, 0 diferentes, **0 huérfanos** en el bucket privado |

### Tiempos medidos

| Fase | Duración |
| --- | --- |
| Volcado de base + volumen de objetos | **3 s** |
| Arranque del entorno aislado | 6 s |
| Restauración (`pg_restore`) | **14 s** |
| Verificación completa (cotejo, descifrado, objetos) | < 2 min |

Con estos volúmenes (dump de 538 KB, 2 objetos) los tiempos **no son extrapolables** a un piloto real. Sirven como
línea base del procedimiento, no como RPO/RTO.

### Qué se comparó contra qué

Contra **`estado-actual.txt`, capturado por el propio respaldo** con las escrituras pausadas; no contra la base de
desarrollo, que volvió a admitir escrituras al reanudar los servicios. Comparar contra una base viva habría producido
diferencias que no dirían nada sobre el respaldo.

## Segunda mitad de QA-16: la aplicación operando sobre la copia

Lo anterior demuestra que **los datos se recuperan**. QA-16 pide además **ejecutar un recorrido**, es decir, que la
aplicación pueda **operar** con lo restaurado. Eso es lo que sigue.

### La instancia de ensayo

`infra/qa16/docker-compose.ensayo.yml`, proyecto Compose **`tl-ensayo-qa16`**: red y volúmenes propios
(`ensayo-postgres-data`, `ensayo-object-data`), puertos propios (**5450 / 6390 / 9010 / 4010 / 3010**) y
**sin `migrate` ni `worker`**: la copia se restaura y se usa, no se migra ni se procesa.

Los secretos llegan por `--env-file` desde un archivo temporal generado a partir del **`claves.env` del respaldo**
—ninguna variable sale de el `.env` de desarrollo— y ese archivo nunca se escribe en el repositorio. Ninguna variable
del compose tiene valor por defecto: si faltara una, el arranque falla en vez de caer silenciosamente en la
configuración de desarrollo.

### Configuración efectiva comprobada ANTES de arrancar

| Variable | Valor efectivo |
| --- | --- |
| `DATABASE_URL` | `postgres://terra_link:[REDACTADO]@postgres:5432/`**`terra_link_restaurada`** (servicio del proyecto de ensayo) |
| `S3_ENDPOINT` / `S3_BUCKET` | `http://object-storage:9000` (del ensayo) / **`terra-link-private`** restaurado del `tar` |
| `PII_ACTIVE_KEY_ID` | `k1` — la del respaldo. Las claves están presentes y **no se imprimen** |
| `SATELLITE_LIVE_CALLS` | **`disabled`** |
| `SATELLITE_FIXTURE_ENABLED` | **`false`** |
| `TL_INSTANCIA` | **`ENSAYO_DE_RESTAURACION_QA16`** |
| Referencias a desarrollo | **0** coincidencias de `localhost:5440`, `/terra_link`, `terra-link_postgres-data` o `terra-link_object-data` en la configuración resuelta |

Al arrancar, `GET /health/ready` devolvió `database: ok`, **`schema: ok`** —la copia está en la versión de esquema
que el código espera—, `redis: ok` y `scanner: unavailable` con `document_analysis: UNAVAILABLE`: el escáner
antimalware **no forma parte del ensayo**, así que las **subidas** de documentos no se ejercitaron (las descargas sí).

### Comprobaciones por la API real de esa instancia

| Comprobación | Resultado |
| --- | --- |
| Acceso y organización | Cuatro sesiones abiertas contra la copia; «DEMO · Cooperativa Río Verde» legible |
| Permisos de dos roles | ORG_ADMIN **77** permisos frente a AUDITOR **20**; solo del admin: `producer:create`, `producer:read_identity`, `lot:create`; compartidos: `producer:read`, `plot:read`, `report:read` |
| Denegación entre organizaciones | La administración de «DEMO · Acopio San Isidro» pide productores de la cooperativa → **404 sin datos** |
| Lectura del dato restaurado | 8 productores activos (de 9: uno está de baja y la lista por omisión no lo incluye), 6 parcelas, 3 entregas, 3 lotes; **conciliación de inventario con 0 diferencias** |
| **Descifrado con permiso** | El administrador lee la identidad restaurada —descifrada con las claves del respaldo— y **el auditor no la recibe** |
| **Documentos restaurados** | **2/2** descargados del almacén restaurado con **sha256 y tamaño exactos** |
| Historial, riesgo, expediente y reportes | Lote con su historial y su grafo legibles; 1 expediente restaurado; **11 indicadores** (7 `OK`, 3 `UNKNOWN`, 1 `CRITERION_UNDEFINED`) |

### Recorrido operativo sobre la copia

Creado **por la API de la instancia de ensayo**, usando los catálogos **restaurados** (producto y centro de acopio):
productor → parcela → entrega de **120 kg declarados** → recepción de **115 recibidos** → lote con **115 kg en el
ledger**. Todo rotulado **`ENSAYO-QA16`**, incluido el nombre del productor («productor sintético posterior a la
restauración»), de modo que ningún registro del ensayo pueda confundirse con contenido del respaldo.

Que se pueda **formar un lote nuevo a partir de un producto y un centro restaurados** es la prueba de que la copia no
solo se lee: se opera.

### Los bloqueos siguen vigentes en la copia (no se forzó ninguno)

| Bloqueo | Resultado en la copia |
| --- | --- |
| Riesgo | Evaluación `INCOMPLETE`, severidad `NOT_ASSESSED`, conclusión `UNDETERMINED`, catálogo `NOT_APPROVED` |
| Satélite | Encargar un análisis → **409 `SATELLITE_REQUESTS_NOT_AUTHORIZED`**; no se llamó a ningún proveedor |
| Expediente | `readiness BLOCKED` con **7 requisitos no evaluables**: `GEOLOCATION_PROFILE`, `DEFORESTATION_ANALYSIS`, `LEGAL_PROFILE`, `RISK_NO_BLOCKING_FINDINGS`, `RISK_CATALOG_APPROVED`, `REGULATORY_CONCLUSION`, `SHIPMENT_LINK` |

(El séptimo, `RISK_NO_BLOCKING_FINDINGS`, aparece porque el lote del ensayo aún no tiene evaluación vinculada: es
coherente, no un bloqueo nuevo.)

### La interfaz web, sobre la copia

Instancia web del ensayo en `http://localhost:3010`, construida apuntando a la API del ensayo (4010). Con sesión de
administrador: la lista de parcelas muestra las **6 restauradas más la del ensayo**, correctamente rotulada; la ficha
abre con «Ubicación y superficie», «Evaluación GIS (técnica)» y «Análisis satelital» con su aviso de **adaptador en
desarrollo**; **0 errores de página**. Capturas: `qa16-ensayo--parcelas-restauradas.png` y
`qa16-ensayo--ficha-parcela.png`.

### Resultado

**9 comprobaciones correctas, 3 bloqueos esperados, 0 fallas.** Detalle en `docs/qa/ensayo-qa16-resultados.json`.

Tiempos de esta mitad: infraestructura aislada 8 s · restauración de objetos 3 s · restauración de base 13 s ·
API operativa 7 s · interfaz web (con construcción de imagen) 31 s.

## Límites de esta verificación

- **El escáner antimalware no formó parte del ensayo**: las **subidas** de documentos no se ejercitaron. Las
  descargas de los documentos restaurados sí, con su hash.
- **Las tablas satelitales estaban vacías en el respaldo** (`satellite_jobs`, `satellite_results` y
  `satellite_credentials` en 0). Restaurar su **estructura** y el registro de proveedores **no demuestra** que se
  recuperen trabajos, resultados ni credenciales **poblados**: eso no se ha probado y no se puede afirmar.
- **RPO/RTO no están medidos**: los tiempos son de un conjunto mínimo (dump de 538 KB, 2 objetos). No se extrapolan.
- **No se probó la restauración del VHDX completo** (el respaldo de octubre lo incluye). Aquí solo base + objetos.
- **El cotejo de objetos es contra `document_versions`**: los buckets de test y e2e se respaldan pero no se cotejan,
  por desechables.
- **No se ejercitó el worker** (outbox ni corredor satelital) sobre la copia: no forma parte de la instancia.
- La base y los volúmenes de desarrollo **no se tocaron** en ningún momento; el entorno de ensayo se destruyó al
  terminar.

## Comandos reproducibles

Registrados en `docs/20_COMANDOS_Y_ENTORNO.md` §«Respaldo y restauración verificada (QA-16)».
