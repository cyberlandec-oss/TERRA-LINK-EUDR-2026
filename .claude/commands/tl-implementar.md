---
description: Implementar una historia concreta de Terra Link conservando código y verificando aceptación.
argument-hint: ID de historia y alcance
---

Historia solicitada: $ARGUMENTS
Lee CLAUDE.md y la historia exacta en docs/18_BACKLOG.md. Si no se especificó ID, elige
el siguiente gap READY_FOR_DEV según docs/23_ESTADO_DESARROLLO.md, o solicita el dato faltante
si no hay evidencia suficiente para elegir; sigue mientras con inspección útil.
Verifica dependencias y código actual. Consulta solo specs de dominio/API/UX implicadas.
Declara el gap, el alcance y los cambios previstos; reutiliza stack y patrones existentes.
Implementa sección completa con autorización, auditoría, validación y errores recuperables.
Ejecuta comandos comprobados del repo y QA pertinente; cierra con `npm run validate` (criterio local, docs/20).
No aplicar acciones productivas implícitas. GitHub Actions no es requisito en esta etapa.
Actualiza historia/estado/ADR si corresponde, evidencia y cierre de sesión.
Entrega resultado, pruebas ejecutadas, limitaciones y próximo paso. No marques gates ausentes como cerrados.
