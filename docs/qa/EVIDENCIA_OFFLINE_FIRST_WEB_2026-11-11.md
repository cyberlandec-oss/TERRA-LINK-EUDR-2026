# Evidencia Offline-First web — 2026-11-11

- Ejecutor: `mcr.microsoft.com/playwright:v1.64.0-noble` (Linux, Chromium incluido).
- Dependencias: `npm ci` con el lockfile, en volumen Docker exclusivo.
- Comando: `npm run test -w e2e -- tests/captura-campo.spec.ts`.
- Resultado terminal: `7 passed (2.2m)`, código `0`.

El caso Offline-First abrió desde «Mi finca», adquirió el punto con red, desconectó, recargó y recuperó el borrador, confirmó sin conexión, reconectó y permitió que el shell recargara la captura real; el sincronizador existente produjo exactamente una nueva versión en el servidor.

La ejecución filtrada inicial falló con `404` porque omitía la preparación serial; se conserva como diagnóstico del arnés, no como aprobación. La corrida completa posterior es la evidencia válida.

Límites: conflictos, cambio de cuenta, sesión expirada, cierre completo del navegador y polígonos/fotografías offline permanecen pendientes.
