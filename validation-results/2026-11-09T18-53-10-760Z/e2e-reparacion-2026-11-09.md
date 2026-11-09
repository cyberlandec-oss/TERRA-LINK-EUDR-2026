# Continuación E2E local — candidato `0996464`

Esta evidencia es una continuación manual de la validación original. El resumen original (`resumen.json` y `resumen.md`) se conserva sin sobrescribir: registró API, web y OpenAPI aprobados, y E2E fallida por falta del ejecutable Chromium del entorno.

## Resultado original conservado

- E2E: `23 failed`, `29 passed`, `126 did not run`.
- Causa: Playwright no encontraba `chrome-headless-shell.exe` en `C:\Users\mario\AppData\Local\ms-playwright`.
- No se interpreta como fallo funcional ni como aprobación: las pruebas posteriores al error de lanzamiento no se ejecutaron.
- Evidencia: [`e2e-navegador.log`](./e2e-navegador.log), [`resumen.json`](./resumen.json).

## Recuperación y ejecución independiente

- Candidato verificado antes de ejecutar: `0996464a368d58800dccc0d201c86534b0613881`.
- Se instaló el navegador Chromium requerido por Playwright en el perfil local, sin modificar el código del candidato.
- PostgreSQL fue esperado hasta estado saludable después del reinicio; no se eliminaron volúmenes ni se recreó la base operativa.
- Se ejecutó el comando existente `npm run test:e2e` con un único proceso Playwright, API y web E2E propios (`4100`/`3100`) y la configuración vigente de `e2e/playwright.config.ts`.
- Resultado terminal del arnés: código `0`.
- Resultado Playwright: `status: passed`, `failedTests: []`, conservado en [`e2e/test-results/.last-run.json`](../../e2e/test-results/.last-run.json).

## Alcance y límites

Esta ejecución acredita E2E local de navegador sobre el mismo SHA; no reescribe el resumen histórico ni convierte la validación automática original en íntegramente aprobada. La aceptación de producción, piloto, validación de campo, Android físico y operación real permanece fuera de esta evidencia.
