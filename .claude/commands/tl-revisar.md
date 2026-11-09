---
description: Revisar una historia o diff de Terra Link contra invariantes y criterios de aceptación.
argument-hint: ID de historia o commit/diff
---

Objeto de revisión: $ARGUMENTS
Lee CLAUDE.md, historia/RF asociados y docs/16_PLAN_QA.md.
Inspecciona diff/código actual y compara con contratos de dominio/API/datos.
Prioriza tenant y referencias, stock/concurrencia, historia/versiones, evidencia/readiness y offline donde apliquen.
Ejecuta comprobaciones pertinentes autorizadas con comandos reales (`npm run validate` y suites de la historia).
Reporta hallazgos con archivo, causa, impacto, reproducción y severidad; no inventes fallos sin evidencia.
Distingue pruebas ejecutadas, bloqueadas y propuestas. Actualiza estado/evidencia si es parte de la revisión.
No modifiques el alcance ni apruebes producción/conformidad por pasar build.
