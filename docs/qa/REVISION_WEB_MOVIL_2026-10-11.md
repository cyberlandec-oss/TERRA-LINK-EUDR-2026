# Revisión — vista previa web de la app móvil (2026-10-11)

**Ámbito**: diseño y navegación de `apps/mobile` en el navegador. **No** acredita cifrado, cámara, ubicación, Android,
el recorrido en emulador ni el ensayo físico; no cierra criterios nativos de P0-023/P0-024.

## Cómo levantarla

```
npm run web:preview --prefix apps/mobile      # http://localhost:3001
```

La web principal sigue en `http://localhost:3000` y la API en `http://localhost:4000` (no se tocaron). Revisión
automatizada: `node e2e/review/movil-web-preview.mjs` → `docs/qa/movil-web/revision.json` y
`docs/qa/capturas/movil-web/`.

## Implementación

- Mismas pantallas y componentes (`src/ui/screens.tsx`, `src/ui/kit.tsx`); no hay una segunda interfaz.
- Adaptadores solo web, elegidos por Metro por extensión: `src/adapters/expo.web.ts`, `preview.web.ts`, `selftest.web.ts`.
  El build Android usa `expo.ts` sin cambios (SQLCipher, sonda de cifrado y bloqueo antes del login intactos);
  `preview.ts` (nativo) no exporta escenarios y deja la API real.
- Entorno `WEB_PREVIEW_SYNTHETIC`: base SQLite en memoria del navegador (sql.js, sin cifrar), fixtures de foto y
  ubicación, y **servidor SIMULADO** en el navegador. **Ninguna petición llega a la API** de Terra Link; no se modificó
  CORS. Cuentas sintéticas `@vista-previa.invalid` (dominio reservado); la contraseña no se guarda ni se envía.
- Identificación permanente en la cabecera: «Vista previa web de la aplicación móvil · servidor SIMULADO · datos
  sintéticos · sin cifrado». Las etiquetas «confirmado por el servidor» pasan a «servidor SIMULADO» y el resumen de
  sincronización dice «SIMULADA: nada se envió a Terra Link».
- Escenarios en «Diagnóstico» (solo web): normal, sin conexión, próxima muestra en conflicto, dispositivo revocado,
  almacenamiento lleno simulado, sesión vencida simulada y borrado de los datos de la vista previa.
- La autoprueba de seguridad informa «no aplica» en web (no simula resultados de cifrado).

## Resultado (390 × 844 y 1280 × 800)

32/32 pasos correctos, 0 errores de consola, sin desbordamiento horizontal. Pantallas y estados: acceso (botón
deshabilitado sin contraseña; foco de teclado con Tab), error de acceso, organización, inicio sin parcelas, parcelas
descargadas, elegir parcela, captura con ubicación, foto y nota larga, pendientes en cola, sincronización sin
conexión, sincronización simulada, conflicto y su resolución, almacenamiento lleno, dispositivo revocado,
diagnóstico, autoprueba «no aplica» y sesión vencida. Ninguna captura contiene contraseñas (el script rechaza capturar
con un campo de contraseña lleno).

## Defectos corregidos (afectan también al APK)

| Defecto | Corrección |
| --- | --- |
| Fechas «… p. m..» (sufijo de 12 h seguido del punto de la frase) y formato distinto según el motor JS | Formato fijo de 24 h (`dd/mm/aaaa, hh:mm:ss`) |
| En escritorio el texto ocupaba todo el ancho (líneas ilegibles) | Columna de contenido de máx. 720 px, centrada |
| Botones con etiqueta en dos líneas sin aire vertical | `paddingVertical` y texto centrado |

Hallazgo del emulador corregido en el mismo cambio: con almacenamiento lleno, crear un borrador mostraba el error técnico
de SQLite en inglés; ahora se muestra un mensaje en español con recuperación (`storageFullMessage`, con prueba unitaria).

## Limitaciones

- Sin SQLCipher, almacenamiento seguro, cámara, ubicación, permisos, teclado en pantalla ni área segura de Android.
- La base y los secretos de la vista previa viven en `localStorage` del navegador (solo datos sintéticos).
- Las capturas de página completa no muestran el contenido desplazado dentro del área de scroll.
- El servidor simulado no reproduce reglas reales de autorización, análisis antivirus ni Documentos.
