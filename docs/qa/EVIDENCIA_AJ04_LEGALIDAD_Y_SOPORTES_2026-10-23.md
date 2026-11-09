# Evidencia — AJ-04: «Legalidad y soportes» como puerta de entrada documental — 2026-10-23

Corrige el recorrido jurídico/documental: la pantalla operativa responde **qué aspecto documentar, qué soportes se suelen aportar, dónde aportarlos y qué falta o qué observó una persona responsable**. El perfil jurídico técnico (versión, «parcial») queda como configuración de revisión en Administración y no condiciona aportar ni consultar soportes. No modifica versiones históricas, no publica perfiles, no marca requisitos como cumplidos. No cambia 42/60 ni 30/44.

## Qué cambió (sin migración)
- Nueva pantalla `/organizaciones/{id}/legalidad` («Legalidad y soportes»; permiso `document:read`) en Trazabilidad. «Perfil jurídico» pasa a Administración como «Perfil jurídico (configuración técnica)» y muestra un aviso que remite a la pantalla operativa.
- «Tres cosas distintas»: recomendaciones de las guías, información declarada (lo que se aporta) y requisitos formalmente adoptados (hoy ninguno: no hay perfil adoptado).
- Aspectos con ejemplos orientativos (no obligatorios), «conviene aclarar», fuente (B02–B09, páginas) y fecha de incorporación (2026-10-22); los aspectos que se resuelven **registrando información** (ubicación, trazabilidad, diligencia) remiten a su módulo.
- «¿Dónde lo aporto?»: por parcela y productor, conteo por aspecto y acceso directo a «Documentos y soportes»; «Sin soporte aportado aún» es orientativo, no incumplimiento.
- «¿Qué falta?»: documentos con observaciones (nombre, fecha y motivo de quien revisó), análisis fallido/rechazado, vencidos y pendientes; los disponibles se declaran en espera de revisión humana (subir no aprueba).
- EN completo (`i18n-en-legalidad.ts`).

## Pruebas
- `e2e/tests/legalidad-soportes.spec.ts` (6, datos sintéticos aislados, productor VINCULADO): sin «parcial/0.1.0» en el contenido principal; tres cosas distintas; aportar y volver (resumen refleja lo registrado, `review = null`); observaciones con nombre/fecha/motivo; perfil técnico solo para quien lo gestiona; EN, teclado y 390 px.
- `guia-documental.test.ts` (6) y `i18n.test.ts` (25).
- `75b0592`: `npm run validate` **APROBADA** (`validation-results/2026-10-23T14-29-27-735Z`; integración 2 658 s, e2e 496 s). Desplegado `75b0592`, esquema `0066` (sin migración nueva: no hay respaldo adicional).
- Demostración desplegada `node e2e/review/legalidad-demostracion.mjs`: **5/5**, lectura únicamente (97/103/40/45/56 antes y después).

## Límites
Orientación de guías de distintos años, no armonizadas; no certifica ni acredita autenticidad. La revisión humana real y lo externo siguen pendientes.
