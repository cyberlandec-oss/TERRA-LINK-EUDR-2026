# Rotación de credenciales DEMO — segunda exposición (2026-10-16)

Entorno local de desarrollo, cuentas **DEMO sintéticas**. No existe entorno de producción. Este documento no
contiene ninguna contraseña, ni anterior ni nueva. Continúa `docs/qa/ROTACION_CREDENCIALES_DEMO_2026-10-14.md`.

## 1. Qué pasó, y por qué volvió a pasar

Preparando una consulta de verificación a la API se inspeccionó `CREDENCIALES.csv` con
`cut -d, -f1-3`. La tercera columna es `contrasena`. Se imprimieron **la cabecera y cinco filas**.

Es **la misma causa que el 2026-10-14**: para armar un `curl` hacía falta una contraseña, y se miró el archivo con
una herramienta de texto que seleccionaba la columna del secreto. La corrección de aquel día fue una **regla
escrita** («no se imprime nunca la columna `contrasena`»). Una regla no impide repetir el gesto cuando la tarea
—consultar la API con una cuenta— no tiene una herramienta que la haga sin secretos. Por eso esta vez la
corrección es una **herramienta**, no otra advertencia.

**Segunda exposición, en la misma sesión**: al comprobar la configuración del despliegue se ejecutó un `grep` sobre
`.env` que imprimió `PII_KEYS`, `PII_INDEX_KEY` y `SEED_ADMIN_PASSWORD`. Son secretos **de distinta naturaleza** y
**no están cubiertos por la autorización de rotación** de esta tarea; se tratan en §6.

## 2. Alcance exacto de la exposición de cuentas

Delimitado con certeza: el comando y su salida constan en la transcripción de la sesión.

| | |
| --- | --- |
| Cuentas expuestas | `superadmin.revision`, `admin.cooperativa`, `supervisor.cooperativa`, `tecnico1.cooperativa`, `tecnico2.cooperativa` (**5**, dominio `@demo.terralink.local`) |
| Incluye plataforma | **Sí**: `superadmin.revision` es la cuenta `SUPER_ADMIN` de revisión, y es la que más urgía |
| No expuestas | Las otras 14 cuentas DEMO: el listado se cortó en la quinta fila |

Un segundo comando leyó la contraseña de `admin.cooperativa` **a una variable de shell**, sin imprimirla; esa
cuenta ya estaba en las cinco anteriores.

## 3. Rotación

Se usó **solo** el modo de rotación, `npm run seed:demo -w apps/api -- --rotar=<cuenta>`, una cuenta por
invocación. Comprobado en el código antes de ejecutarlo: esa rama **retorna antes** de cualquier alta de
organizaciones, usuarios, parcelas o datos operativos — **no repuebla nada**.

Orden seguro, sin cambios: 1) guardar la credencial nueva en los archivos locales; 2) activarla en la base e
invalidar sesiones (`token_version + 1`); 3) verificar login nuevo y rechazo del anterior; si 2 falla, se
restauran los archivos.

### Dos defectos del mecanismo, corregidos antes de rotar

1. **`--rotar` se bloqueaba con el archivo abierto.** Escribía en *todos* los archivos de credenciales que
   existieran, así que un `CREDENCIALES.csv` abierto en Excel hacía fallar la rotación entera. Ahora escribe en los
   que **se puedan escribir**, aborta solo si no puede escribir ninguno, y **avisa** de que el bloqueado conserva
   una credencial muerta.
2. **La precedencia entre archivos era por orden fijo**, de modo que un principal bloqueado y atrasado imponía una
   contraseña que ya no servía. Ahora manda el **más reciente** — la regla que ya usaba `revision-por-rol.mjs` —, y
   al verificar se comprueba que **todas** las contraseñas anteriores conocidas quedan rechazadas, no solo una.

### Resultado

| | |
| --- | --- |
| Cuentas rotadas | Las **5** de §2, una por invocación |
| Verificación por cuenta | login nuevo correcto · credencial anterior **rechazada** · sesiones previas invalidadas — las 5 |
| Comprobación independiente | `token_version = 2` **exactamente** en esas 5; las otras 14 cuentas DEMO siguen en 1 o en 0 |
| Bitácora | 5 registros `user.password_rotated` |
| Datos conservados | 4 organizaciones, 20 usuarios, 21 membresías, 6 parcelas, 9 productores, 3 lotes, 3 entregas, 4 evaluaciones — **sin cambios** |

### Archivo vigente: `CREDENCIALES.pendiente.csv`

| Archivo | Última escritura | Estado |
| --- | --- | --- |
| **`CREDENCIALES.pendiente.csv`** | 2026-10-16 | **VIGENTE.** Lleva las credenciales en uso, incluidas las cinco rotadas |
| `CREDENCIALES.csv` | 2026-10-14 | **OBSOLETO y bloqueado** por otro programa. Conserva las credenciales **muertas** de esas cinco cuentas |

**No se sobrescribe el principal bloqueado**, ni se fuerza la escritura, ni se imprime ninguno de los dos. Las
herramientas ya resuelven la ambigüedad solas: el seed, `revision-por-rol.mjs` y `consulta-api.mjs` toman el **más
reciente** de los dos, que es el pendiente.

### Cómo reconciliarlos cuando se cierre Excel

El pendiente es **el archivo completo**, no un parche: lleva todas las filas, no solo las rotadas. Por eso la
reconciliación es una sustitución, no una fusión.

```
# 1. Comprobar que ya nadie lo tiene abierto (debe imprimir «escribible»)
node -e "const{openSync,closeSync}=require('fs');try{closeSync(openSync('CREDENCIALES.csv','r+'));console.log('escribible')}catch{console.log('AUN BLOQUEADO')}"

# 2. Comprobar que el pendiente es el más reciente y tiene al menos tantas filas (sin imprimir contenido)
node -e "const{statSync,readFileSync}=require('fs');const n=f=>readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean).length;console.log('principal',statSync('CREDENCIALES.csv').mtime.toISOString(),n('CREDENCIALES.csv'),'filas');console.log('pendiente',statSync('CREDENCIALES.pendiente.csv').mtime.toISOString(),n('CREDENCIALES.pendiente.csv'),'filas')"

# 3. Conservar el obsoleto por si acaso, y sustituir
mv CREDENCIALES.csv CREDENCIALES.obsoleto-2026-10-14.csv
mv CREDENCIALES.pendiente.csv CREDENCIALES.csv

# 4. Comprobar que las cuentas rotadas siguen entrando, sin imprimir secretos
node e2e/review/consulta-api.mjs admin.cooperativa organizaciones
node e2e/review/consulta-api.mjs superadmin.revision organizaciones

# 5. Solo entonces, borrar el obsoleto
rm CREDENCIALES.obsoleto-2026-10-14.csv
```

**Si el paso 4 falla**, el obsoleto sigue ahí: `mv CREDENCIALES.csv CREDENCIALES.pendiente.csv` y
`mv CREDENCIALES.obsoleto-2026-10-14.csv CREDENCIALES.csv` deja todo como estaba. Los tres archivos están
ignorados por git, así que ninguno de estos pasos versiona nada.

**No hacer**: abrir el CSV para «comparar a ojo» —ahí está la columna que provocó las dos exposiciones— ni copiar
filas sueltas entre archivos: una fila a medias deja una cuenta con una contraseña que no es la de la base.

## 4. La corrección de fondo: una utilidad en vez de una regla

`e2e/review/consulta-api.mjs` hace lo que llevaba a mirar el CSV:

```
node e2e/review/consulta-api.mjs --listar-consultas
node e2e/review/consulta-api.mjs admin.cooperativa indicadores
node e2e/review/consulta-api.mjs eudr.cooperativa satelite
```

- **Lee la credencial del archivo vigente y la usa**; ni la contraseña ni el token salen por consola.
- **El filtro principal es una lista de PERMITIDOS por consulta** (`campos`): se publica lo que está en la lista y
  nada más. Un campo nuevo que la API empiece a devolver mañana **se descarta por omisión**, que es justo lo que
  una lista negra no puede hacer: esa solo detiene lo que alguien se acordó de prohibir.
- Un campo permitido que **deje de ser escalar** —porque la API cambió de forma— se sustituye por
  `[omitido: no escalar]`, de modo que un `status` que pase de texto a objeto no cuele su detalle interno.
- La **lista negra se conserva como segunda barrera**, por si alguien amplía una lista de permitidos sin pensar.
- **Los errores no vuelcan nada**: llevan ruta y código, nunca el cuerpo de la respuesta, las cabeceras ni la
  configuración; y la CLI imprime el mensaje, no la traza, que podría llevar la credencial leída.
- Probada con **secretos ficticios** (`e2e/tests/consulta-api.spec.ts`): un campo nuevo de nombre inocente, un
  campo permitido que cambia de forma, secretos dentro de listas y de objetos anidados, una lista de permitidos
  ampliada por error, campos ausentes que no se inventan, el archivo vigente por fecha, una cuenta sin credencial
  y el mensaje de una consulta fallida.

**A partir de ahora, para consultar la API con una cuenta DEMO se usa esta utilidad.** Queda prohibido el
procedimiento manual de leer el CSV y pasar la contraseña a `curl`. Para *mirar* el archivo siguen valiendo solo
las columnas de identificación, nunca `contrasena` (regla del 2026-10-14, que sigue vigente).

## 5. Qué NO resuelve esto

La exposición ocurrió en la transcripción de una sesión. La rotación **invalida** lo expuesto —esas contraseñas ya
no abren ninguna sesión—, pero **no borra lo escrito**: la transcripción sigue siendo material sensible.

## 6. Pendiente de decisión: los secretos de `.env`

El `grep` sobre `.env` expuso tres valores que **no** son cuentas DEMO y **no** están cubiertos por la
autorización de esta tarea. Se dejan **sin tocar** a propósito, porque dos de ellos no se rotan sin un
procedimiento:

| Secreto | Qué protege | Qué haría falta |
| --- | --- | --- |
| `SEED_ADMIN_PASSWORD` | La cuenta `admin@terralink.local` del seed de **desarrollo** (SUPER_ADMIN) | **ROTADA el 2026-10-16** con `seed:dev -- --rotar-admin`: ver §7 |
| `PII_KEYS` + `PII_ACTIVE_KEY_ID` | Cifrado AES-256-GCM de datos personales en reposo | El llavero **sí admite rotación**: añadir `k2`, activarla y seguir descifrando con `k1`. Pero `k1` quedó expuesta, así que lo ya cifrado sigue siendo legible para quien la tenga: remediarlo de verdad exige **re-cifrar** los campos existentes |
| `PII_INDEX_KEY` | Índice ciego (HMAC) para búsqueda exacta sin descifrar | Cambiarla **invalida todos los índices existentes**: la búsqueda exacta deja de encontrar nada hasta reindexar. No se toca sin un procedimiento de reindexado |

Los datos protegidos son **sintéticos y locales**. Aun así, la decisión es del responsable del proyecto, no de
quien ejecuta la tarea, porque dos de las tres opciones pueden dejar datos ilegibles o búsquedas rotas. El
procedimiento concreto, con su inventario, sus comprobaciones y su reversión, está en
`docs/decisiones/D-43-ROTACION-CLAVES-PII.md` (**propuesta, no ejecutada**).

**Precisión**: `PII_ACTIVE_KEY_ID` **no es un secreto**. Es el identificador de la clave activa y viaja en claro
dentro de cada token cifrado (`v1.<kid>.…`), por diseño, para saber con qué clave descifrar. Que apareciera en la
salida no añade exposición y no hay nada que rotar en él.

## 7. Rotación del SUPER_ADMIN de desarrollo (2026-10-16)

Autorizada aparte y ejecutada. **Es una cuenta distinta** de la de plataforma DEMO ya rotada, y se comprobó antes
de tocar nada:

| Cuenta | De dónde sale | Antes | Después |
| --- | --- | --- | --- |
| `admin@terralink.local` | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` de `.env` | `token_version = 0` | **`1`** |
| `superadmin.revision@demo.terralink.local` | Seed DEMO, rotada en §3 | `token_version = 2` | **`2`, sin tocar** |

Se usó `npm run seed:dev -w apps/api -- --rotar-admin`, que **no es el seed general**: rota esa única cuenta, no
crea ninguna —si no existe, falla— y no toca las cuentas DEMO. Mismo orden seguro que la rotación DEMO: escribir
el archivo primero, activar después, restaurar el archivo si la activación falla.

| Comprobación | Resultado |
| --- | --- |
| Login con la credencial nueva | **Correcto** |
| Login con la anterior | **Rechazado** |
| Sesiones previas | **Invalidadas** (`token_version` 0 → 1) |
| Cambios en `.env` | **Una sola línea**, `SEED_ADMIN_PASSWORD`; mismo número de líneas y el resto byte a byte |
| Otras cuentas | **Ninguna tocada** |
| Bitácora | Una entrada `user.password_rotated` |

El valor nuevo **no se ha publicado** y vive solo en `.env`, que no se versiona.

**Mientras tanto**, la misma regla de §4 se extiende a `.env`: no se imprime, ni entero ni filtrado. Para saber si
una variable está puesta se mira el **efecto** —por ejemplo `live_calls_enabled` en la respuesta de la API— o el
nombre de la variable en el contenedor, nunca su valor.
