---
paths:
  - "frontend/**/*"
  - "web/**/*"
  - "apps/web/**/*"
  - "**/*.tsx"
  - "**/*.jsx"
---
# Web y UX

Consulta docs/UX_UI.md (marca, tokens, componentes, estados, roles) y docs/14 (workflows) antes de cambiar una pantalla.
Tokens únicos en apps/web/app/globals.css; no crear otra fuente de estilos. Sin logo oficial: identificación textual (UX-D01).
Solo superficies conectadas a operaciones reales; módulos futuros fuera del menú.
Home/menu/links/acciones derivan de permisos efectivos; backend sigue siendo autoridad.
Separar loading, vacío, 403, error, datos incompletos y offline.
No reemplazar acceso restringido por «sin datos» ni llenar KPIs con cifras ficticias.
Lote/Parcela/Productor navegan por contexto; preservar formularios/borradores al fallar.
My Work resuelve el dominio real, no un checkbox desconectado.
Español primero, texto además de color, labels/foco/teclado y unidades claras.
