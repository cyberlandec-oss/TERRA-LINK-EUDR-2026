# Evidencia A-02 — Administración web de concesiones (2026-10-21)

Ampliación autorizada (RF-49, `docs/03`; historia A-02, `docs/18`), **posterior** a la documentación original, a A-01 y a P1-001. No altera ningún criterio original y no entra en el conteo 42/60 ni 30/44.
Estado: **DONE_LOCAL** sobre `0211a30`. No acredita producción, Android real, conformidad EUDR ni aceptación externa.

## 1. Candidatos y validaciones (cada uno con su propio resultado)
| SHA | Resultado | Registros | Nota |
| --- | --- | --- | --- |
| `acac9b5` | **FALLIDA** (1.ª corrida) | `validation-results/2026-10-21T01-32-35-575Z` | Solo `a01-alcance-propio` (15 pruebas): el `beforeAll` superó el límite de 60 s del hook. Las otras 88 suites (960 pruebas) pasaron |
| `acac9b5` | **FALLIDA** (2.ª corrida, mismo SHA) | `validation-results/2026-10-21T02-09-52-894Z` | Mismo fallo y misma suite. La repetición se hizo una vez, tras diagnosticar |
| **`0211a30`** | **APROBADA** | `validation-results/2026-10-21T03-04-51-749Z` | typecheck, lint, build, OpenAPI validado (263 rutas), **89 suites · 975 pruebas**, E2E **94**. Candidato = `acac9b5` + un cambio **solo de prueba** (ver §2). **SHA desplegado** |

Las dos corridas fallidas se conservan y no se atribuyen a `0211a30`; la aprobación de `0211a30` no se hereda hacia atrás.

## 2. Diagnóstico de `a01-alcance-propio` (precisado)
**Lo demostrado**: la preparación (`beforeAll`) de esa suite excedió el límite de 60 s del hook. **Lo no demostrado**: la causa física. La latencia observada apunta a un problema de rendimiento, pero no identifica
si es almacenamiento, contención de PostgreSQL u otra carga del equipo; **no se declara resuelto ningún problema de disco**.
| Dato (de `api-test-timings/harness-timings.jsonl` y del log) | 1.ª fallida | 2.ª fallida | Aprobada `4913dd3` (23-04) | Aprobada `0211a30` |
| --- | --- | --- | --- | --- |
| Reinicio de esquema + migración dentro del hook | 3,4 + 20,7 s | 1,4 + 29,6 s | (media 14,2 s de migración en la corrida) | 0,5 + 10,9 s |
| Duración total de la suite | 62,1 s (hook cortado) | 62,1 s (hook cortado) | 77,5 s | 22,6 s |
| Commits > 1 s dentro de la suite | 17 (suma 25 s) | 8 (suma 15 s) | n/d | 0 |
| Commits > 1 s en toda la corrida | 118 (mediana 1,26 s) | 280 (mediana 1,30 s) | 177 (mediana 1,21 s) | — |
- **Error inicial**: `Exceeded timeout of 60000 ms for a hook` (60 apariciones = 15 pruebas × 4 informes).
- **Errores derivados del cierre**: al vencer el hook, Jest ejecuta `afterAll` (cierra la conexión) mientras el cuerpo del `beforeAll` sigue; la siguiente petición devuelve **500 `driver has already been destroyed`** (registrado como `SETUP-A01 members … 500`). No es un fallo de la API.
- **Margen**: la corrida aprobada de `4913dd3` ya tardó 77,5 s en la suite; el margen real del hook **no está medido** (el arnés no registra la duración del `beforeAll` por separado de la suite). Los 30 s y 157 s de pasadas aisladas posteriores muestran variabilidad, no margen.
- **Cambio en `0211a30`** (solo prueba): las 8 altas de usuarios (invitación → aceptación → inicio de sesión) se lanzan con `Promise.all`. **Qué hace**: reduce el *encadenamiento* de operaciones independientes; **no reduce la cantidad de trabajo** (siguen siendo 8 altas). **Independencia comprobada por lectura del código**: cada alta usa un correo distinto y su propia invitación/token; no leen ni escriben datos compartidos entre sí más allá de contadores de la organización (que serializa la base) y la caché de tokens del arnés (clave por correo); el mapa de membresías `m` se llena **después** de que todas terminan; no hay dependencia de orden. **Todas las aserciones se conservan** (15 pruebas).
- **Pendiente de diagnóstico**: identificar la causa física de los commits lentos (contención, esperas de almacenamiento u otras). Si la suite vuelve a fallar, se investigará con las métricas de PostgreSQL y del entorno antes de cualquier otra acción; no se relanza por repetición ni se sube ningún timeout.

## 3. Entrega
- **Pantalla** `/organizaciones/{id}/concesiones` (menú Administración; solo con `grant:manage`): lista con filtro por estado (activa/vencida/revocada) e historia (recurso con su código, destinatario, alcance, vigencia, quién concedió y revocó, motivos); alta guiada en cuatro pasos con revisión que **no concede**; revocación con motivo. Español e inglés, teclado, 390 px.
- **API**: `grantee_email` (correo exacto; misma respuesta para no existe/inactiva; intentos auditados sin el correo y limitados a 10/h), `GET …/access-grants/shareable`, lista enriquecida. Sin migración, sin permisos nuevos, sin ampliar la proyección.
- **Pruebas**: integración `access-grants` (30), E2E `concesiones` (6), unitaria web (i18n).

## 4. Despliegue y demostración local
`node scripts/desplegar.mjs` → `/version`: commit `0211a30`, esquema `0057`, coincide. Guion `e2e/review/a02-demostracion.mjs` sobre el DEMO (propietario `admin.cooperativa`, destinatario `comprador.importador`, no miembro): **7/7**.
Las ejecuciones previas del guion (6/7, 3/7, 1/7) fallaron por defectos del **guion** (concesiones de ensayo previas que ocupaban la lista del destinatario, `isVisible` que no espera, y una expresión de claves que confundía correos con claves); se corrigieron sin cambiar código del producto. Antes del recorrido, el guion revoca con motivo las concesiones ACTIVAS que dejó el recorrido de cadena para ese destinatario sintético.

| Caso | Resultado | Detalle |
| --- | --- | --- |
| 1 El propietario abre Concesiones; el técnico (sin grant:manage) no tiene menú ni acceso | OK | propietario: menú=1, filas previas=22 · técnico: pantalla denegada=true, menú=0, API=403 |
| 2 Alta guiada: un correo no identificable da un mensaje único; revisar NO concede; confirmar sí | OK | mensaje único=true · concesiones tras fallo/revisión=22/22 (antes 22) · tras confirmar: ACTIVA, solo lectura=true |
| 3 El destinatario (no miembro) ve solo lo concedido: proyección sin identidad ni geometrías; el espacio de la cooperativa le responde 404 | OK | sin identidad ni geometrías ni economía · acceso directo (lote/concesiones/parcelas)=404/404/404 |
| 4 Rechazos: recurso de otra organización, otra administración sin acceso y destinatario sin vencimiento válido | OK | recurso ajeno=422 REFERENCE_NOT_FOUND · otra administración: lista=404, revocar=404, ve la concesión=false · vencimiento pasado=422 GRANT_EXPIRY_INVALID |
| 5 El propietario revoca con motivo (la interfaz no confirma sin él) y el destinatario pierde el acceso al instante | OK | botón sin motivo deshabilitado=true · estado=REVOCADA, motivo y responsable registrados · destinatario: en su lista=false, lectura=404, botones Ver=0 |
| 6 Auditoría: conceder, rechazar destinatario y revocar quedan registrados sin el correo en claro | OK | filas: grant.create/4 · grant.recipient_unavailable/5 · grant.revoke/9 · correo en claro en auditoría=0 |
| 7 Inglés y 390 px con teclado: mismo recorrido traducido, sin desborde | OK | sin desborde=true · sin claves de traducción · revisar no concedió nada (concesiones 23 → 23) |

Capturas (no versionadas): `validation-results/a02-demostracion-2026-10-21/`.

## 5. Respaldo (criterio y resultado)
Se tomó `_respaldos/2026-10-21-a02-concesiones-0057` aunque A-02 **no tiene migración**: el criterio es el estado persistente real. Desde el respaldo anterior se crearon datos nuevos (23 concesiones, 91 registros `grant.*`, el recorrido de cadena `CAD-*`, 11 organizaciones `ENSAYO A-01*`).
Restauración aislada verificada: 137 tablas con conteos idénticos, restricciones idénticas, identidad descifrada (56 productores, 0 fallos), 1199 objetos con la misma huella. **Esta copia sí cubre la organización de prueba manual de A-01 y los registros `CAD-*`; el respaldo `…-a01-mapa-fotos-0057` no los cubría.**

## 6. Límites
- **`/compartido` (vista del destinatario) sigue solo en español.** Es el portal de P1-001 (DONE_LOCAL con esa aceptación) y **no** formaba parte del criterio bilingüe de A-02, que se registró para la pantalla de administración (`docs/03`, criterio 7). El recorrido propietario → destinatario es, por tanto, bilingüe en el tramo del propietario y en español en el del destinatario. Si el propietario quiere el portal del destinatario en inglés, es un tramo adicional acotado (traducir esa página y los textos de la proyección) que se registrará como tal.
- El destinatario no ve el código del lote en su lista hasta abrir la concesión (la lista solo rotula el tipo): con varias concesiones vigentes hay que abrirlas para distinguirlas. No se cambió.
- Las concesiones se otorgan a cuentas **existentes y activas**; no se invita ni se crea una cuenta desde aquí (por diseño).
- A-03 es **propuesta**: nada de traspaso está implementado (`docs/decisiones/A03-TRASPASO-ENTRE-ORGANIZACIONES.md`, D1–D9 abiertas).
