# Cierre de E: pendientes finitos, clasificados y con su acción de cierre (2026-10-29)

Base: contraste de `docs/24` con `docs/18` (backlog), `docs/07` (RBAC), `docs/UX_UI.md` y las evidencias vigentes. **No se recalculan porcentajes**: 42/60 requisitos (70 %) y 30/44 MVP (68,2 %) siguen igual, porque no hay un requisito nuevo con evidencia de **aceptación** (DONE_LOCAL y las ampliaciones A-01…A-04 no son aceptación externa). Código desplegado y publicado: `0619055` (API y web idénticas a `4ff7cb2`; validación completa APROBADA sobre `0619055`, `validation-results/2026-10-29T16-45-37-875Z`).

## Estados obsoletos corregidos en esta revisión
- `docs/24` (recorrido integral): el punto «T15, traspaso de lotes entre organizaciones: NO DEFINIDO» quedó **resuelto por A-03/RF-50** (traspaso de custodia, DONE_LOCAL, `d99f40a`; la salida real sigue bloqueada, D4). El recorrido T15 del script solo comprueba que, **sin un traspaso ejecutado**, la exportadora no ve lotes ajenos.
- `docs/18` P0-024: ya no lista recepciones/calidad/lotes/inventario como pendiente móvil (ninguna fuente lo exige).
- `docs/07`: la referencia de productores del pull (id, código, nombre visible) queda registrada con su alcance.
- Panel geográfico del expediente: el aviso fijo «sigue pendiente de D-05.B» se sustituyó por el estado actual calculado con el mecanismo vigente (`4ff7cb2`).

## Lista finita de pendientes
Categorías: **C** código o interfaz por completar · **K** configuración · **D** datos faltantes · **E** evidencia por completar · **X** dependencia externa.

| # | Pendiente | Cat. | Acción de cierre | ¿Ejecutable ahora? |
| --- | --- | --- | --- | --- |
| 1 | Teléfono físico (P0-023/024; gate de `.claude/rules/40-mobile-offline.md`) | X + E | Instalar el APK vigente (`CANDIDATO-mapa-altas-0f68196`, SHA-256 `bb9cea2f…8095`; es x86_64, para teléfono hay que compilar `arm64-v8a`) y recorrer la guía única de `apps/mobile/README.md` | No: equipo del propietario |
| 2 | Documentos de soporte capturables desde el móvil (RF-23 dice «evidencias» sin acotar el tipo; S1 §46 nombra `documents_metadata`) | K (decisión de alcance) | El propietario decide si entra; si entra, nueva operación móvil con integridad y estado separado, probada con PostgreSQL real | No: decisión |
| 3 | Mapa móvil: deslizar sobre el mapa lo mueve y no desplaza la página | C (menor) | Modo «mover mapa» explícito o ancho de borde libre; verificar en emulador | Sí (cambio móvil + APK nuevo) |
| 4 | Almacenamiento lleno: el fallo real de escritura es **no determinista** (1 de 2 ejecuciones a 0 KB libres) | E (límite registrado) | Cuota por app (herramienta del sistema) o dispositivo con partición mínima; hoy: demostrado una vez con contenido comparado (`docs/qa/EVIDENCIA_MOVIL_ALTAS_MAPA_2026-10-28.md`) | Parcial |
| 5 | Aserción de «Mi ubicación» sin guardar del arnés (`capturar-ubicacion`) atada al diseño anterior | E (arnés) | Reescribir la aserción por contenido | Sí |
| 6 | `GEOLOCATION_PROFILE` NOT_EVALUABLE en DD-2026-00002: no hay configuración adoptada | K | Una persona con facultad adopta una configuración **revisada y aplicable** (mecanismo existente, `docs/qa/EVIDENCIA_GEOLOCATION_PROFILE_CONFIG_2026-10-22.md`); no se adopta por conveniencia | No: D-05.B (decisión/revisión real) |
| 7 | Parcela CAD-1027213440 NO EVALUABLE: punto sin superficie declarada | D | Registrar la superficie (o un polígono) en una versión geométrica nueva con un rol que pueda (`plot:update`) y volver a evaluar. **No** bloquea el resto del proyecto | Sí, con el dato real |
| 8 | Ensayo real con Whisp (P0-028) | X | Propietario: `WHISP_API_KEY=` en `C:\Users\mario\PROYECTOS DEV\TERRA LINK 2025\.env` (clave en una sola línea, sin comillas ni espacios). Luego K: `WHISP` → `SELECTED` con responsable, `SATELLITE_LIVE_CALLS=enabled` temporal, credencial por organización; autorización de la geometría artificial (`WHISP_ENSAYO_AUTORIZADO`) | No: clave del propietario |
| 9 | Catálogo de riesgo aprobado, conclusión humana y `LEGAL_PROFILE` reales (D-07, P1-005) | X | Revisión jurídica/regulatoria real; el mecanismo ya está demostrado | No |
| 10 | Despacho de embarque (P0-029) | K + D | Condición de `dd_package_id`/`dispatch_at` (D-34), instantánea DD READY y calidad decidida | No: depende de 6, 9 |
| 11 | GUIA (P1-006), EUDR-IS (P1-007), perfil Ecuador validado (P1-005) | X | Canal/acuerdo verificado y recibos auténticos | No |
| 12 | Piloto (P0-031): Android real, restauración DB+objetos, capacitación; RNF-05/RNF-06 | X + E | Dataset del piloto, budgets p95/SLO en TECH-001, restauración medida (RPO/RTO) | No |
| 13 | Incidencia del navegador del propietario desde `localhost` | E | Obtener solo la dirección de la barra y el error de la petición `login` (Network) y de Console | No: dato del propietario |

## Qué sí quedó cerrado (con su evidencia)
- **Altas, mapa móvil y APK** (D): `docs/qa/EVIDENCIA_MOVIL_ALTAS_MAPA_2026-10-28.md` — cadena de Altas, mapa con y sin red, adjunto interrumpido, conflicto con historial, separación de cuentas, SQLCipher, persistencia tras cierre forzado, respuesta perdida, foto con análisis, sesión vencida, **ubicación denegada** (contenido comparado) y **almacenamiento lleno** (una ejecución real con contenido comparado; límite documentado).
- **Acceso web**: causa demostrada para orígenes `127.0.0.1`/`[::1]` y corregida (`233b548`); el caso `localhost` del propietario queda como el pendiente 13.
- **Panel geográfico y DD-2026-00002**: panel con estado actual del requisito (`4ff7cb2`), evaluación técnica de CAD-1027213440, instantánea 2 BLOQUEADA, instantánea 1 conservada.
- **Recorridos por rol** (web, 22 combinaciones, 19 cuentas) y **cadena** parcela→entrega→lote→satélite→riesgo→expediente con bloqueos esperados: `docs/qa/web-por-rol/`, `e2e/review/cadena-integral-web.mjs`.

## Separación obligada
Implementación (código y pruebas) ≠ demostración local (emulador/despliegue local) ≠ aceptación externa (propietario, jurídico, proveedor) ≠ preparación para producción. Ninguno de los pendientes anteriores se cierra con el siguiente nivel sin la evidencia de su propio nivel.
