# Rotación de credenciales DEMO tras una exposición en consola (2026-10-14)

Entorno local de desarrollo, cuentas **DEMO sintéticas**. Ninguna credencial de producción está implicada: no existe
entorno de producción. Este documento no contiene ninguna contraseña, ni anterior ni nueva.

## Qué pasó

Durante la verificación del despliegue de P0-028 se inspeccionó `CREDENCIALES.csv` con un comando que imprimió las
tres primeras columnas del archivo. La tercera es `contrasena`. El resultado se escribió en la consola de la sesión,
que es exactamente lo que `docs/20_COMANDOS_Y_ENTORNO.md` prohíbe: «nunca se imprime en consola, informes ni
capturas».

Fueron **12 líneas impresas**, que corresponden a **11 cuentas distintas**: `recepcion.acopio` aparece dos veces
porque tiene dos membresías y el archivo lleva una fila por usuario + organización + rol.

La causa fue del operador, no del producto: el archivo estaba donde debía, ignorado por git, y el seed nunca imprime
contraseñas. Lo que falló fue inspeccionarlo con un `awk` que seleccionaba la columna del secreto cuando solo hacían
falta las de identificación.

## Qué se hizo

Se rotaron **exactamente esas 11 cuentas**, con el mecanismo que ya existía en el repositorio
(`seed:demo -- --rotar=<cuenta>`), que rota **una sola cuenta** y no repuebla nada:

1. se genera la credencial nueva y **se guarda primero** en los archivos locales (`CREDENCIALES.csv` y
   `CREDENCIALES.pendiente.csv`); si no se pueden escribir, **no se activa nada**;
2. se activa en la base y se invalidan las sesiones anteriores (`token_version + 1`);
3. se verifica el **login nuevo** y el **rechazo del anterior**; si el paso 2 falla, se restauran los archivos;
4. queda un registro `user.password_rotated` en la bitácora.

Única modificación necesaria del mecanismo: `--rotar` excluía la cuenta de plataforma (`!x.platform`). Se eliminó esa
exclusión, porque si la credencial expuesta es la de plataforma es precisamente la que más urge rotar.

## Resultado

| | |
| --- | --- |
| Cuentas rotadas | `superadmin.revision`, `admin.cooperativa`, `supervisor.cooperativa`, `tecnico1.cooperativa`, `tecnico2.cooperativa`, `productor.cooperativa`, `auditor.cooperativa`, `eudr.cooperativa`, `admin.acopio`, `recepcion.acopio`, `calidad.acopio` (**11**, dominio `@demo.terralink.local`) |
| Verificación por cuenta | login nuevo correcto · credencial anterior **rechazada** (401) · sesiones previas invalidadas — las 11 |
| Comprobación independiente | `token_version = 1` exactamente en esas 11; las otras 8 cuentas DEMO siguen en `0` |
| Datos conservados | 20 usuarios, 21 membresías, 4 organizaciones, 6 parcelas, 9 productores (sin cambios) |
| Bitácora | 11 registros `user.password_rotated` |
| Archivo de credenciales | 13 filas marcadas `LOGIN_VERIFICADO (rotada)` — 11 cuentas, dos de ellas con dos membresías |

No se ejecutó ningún repoblamiento ni reconstrucción de DEMO. No se tocaron volúmenes, respaldos ni APK.

## Qué cambia a partir de ahora

- Para mirar `CREDENCIALES.csv` se seleccionan **solo** las columnas de identificación (`nombre_usuario`, `email`,
  `rol`, `organizacion`, `estado_acceso`). La columna `contrasena` no se imprime **nunca**, ni filtrada, ni para
  «comprobar que existe»: para eso está `estado_acceso`.
- Las herramientas que necesitan una contraseña (revisión por rol, seed, scripts de verificación) la **leen del
  archivo y la usan**, sin pasarla por la salida estándar. Así estaba hecho y así se mantiene.
- Si vuelve a ocurrir: rotar solo lo expuesto con `--rotar`, verificar las tres condiciones (login nuevo, rechazo del
  anterior, sesiones invalidadas) y registrarlo aquí.

## Límite de este documento

La exposición ocurrió en la transcripción de una sesión de trabajo. La rotación **invalida** las credenciales
expuestas, de modo que lo impreso ya no abre ninguna sesión. No puede, en cambio, borrar lo ya escrito: esa parte se
resuelve tratando la transcripción como material sensible.
