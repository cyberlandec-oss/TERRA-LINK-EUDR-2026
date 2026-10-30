# Cierre de E: pendientes finitos, clasificados y con su acción de cierre (2026-10-29, revisado tras los soportes móviles)

Base: contraste de `docs/24` con `docs/18` (backlog), `docs/07` (RBAC), `docs/UX_UI.md` y las evidencias vigentes. **No se recalculan porcentajes**: 42/60 requisitos (70 %) y 30/44 MVP (68,2 %) siguen igual, porque no hay un requisito nuevo con evidencia de **aceptación** (DONE_LOCAL y las ampliaciones A-01…A-04 no son aceptación externa).

**Código validado y desplegado: `70348c7`** (`npm run validate` APROBADA sobre ese SHA, `validation-results/2026-10-29T22-07-43-825Z`; API reconstruida una vez; la web no cambió). Prueba móvil omitida: `session.api.test.ts` (humo contra la API real, solo con `TL_API_SMOKE=1`); no afecta a esta entrega, que se cubre con `soportes.test.ts`, `sync-altas.int-spec.ts` y el recorrido en emulador.

## Intervenciones del propietario: lista única vigente
Esta es la única lista de lo que depende de una persona fuera del desarrollo; las demás secciones y documentos remiten aquí. El equipo no cambia datos ni aprueba perfiles para llegar a READY.

| # | Qué hace el propietario o la parte competente | Acción de cierre al recibirlo | Filas |
| --- | --- | --- | --- |
| P1 | **Whisp, dos decisiones separadas que no se deducen del ensayo** (hecho con geometría artificial, `docs/qa/EVIDENCIA_WHISP_ENSAYO_REAL_2026-10-29.md`): (a) **autorización para parcelas reales** (datos de productores, base del tratamiento) y (b) **activación permanente** (D-09 parte B, responsable permanente) | Registrar cada decisión; sin (a) no se envía ninguna parcela real; sin (b) los nuevos análisis siguen deshabilitados | 5a, 5b |
| P2 | **Dato real de CAD-1027213440:** superficie declarada o polígono | Versión geométrica nueva con un rol con `plot:update` y reevaluación | 4 |
| P3 | **Revisión competente** (D-05.B / D-07 / P1-005): adopción de una configuración geográfica revisada y aplicable; catálogo de riesgo, conclusión humana y `LEGAL_PROFILE` | Registrar la decisión de la persona con facultad; desbloquea expediente y despacho | 3, 6, 7 |
| P4 | **Canales externos:** GUIA, EUDR-IS y perfil Ecuador validado | Canal/acuerdo verificado y recibos auténticos | 8 |
| P5 | **Objetivos de recuperación y rendimiento:** RPO/RTO (responsable de operación) y presupuestos p95/SLO (TECH-001) | Fijarlos; luego aceptar los tiempos observados (9e) y medir con el dataset del piloto (9b) | 9a, 9b, 9d, 9e |
| P6 | **Organización piloto:** dataset y capacitación | Medición de 9b y capacitación | 9b, 9f |
| P7 | **Navegador del propietario en `localhost`:** dirección de la barra y error de la petición `login` (Network) y de Console | Diagnóstico con el dato | 10 |
| P8 | **Teléfono físico** (al final; el almacenamiento lleno se comprueba como recuperación, sin exigir que el fallo sea determinista): instalar `ARM64-soportes-70348c7.apk` y recorrer la guía de `apps/mobile/README.md` | Registrar el ensayo; cierra el gate Android real | 1a, 1b |

El soporte sobre productor desde la interfaz móvil **no** figura aquí: queda fuera del alcance exigido.

## Estados obsoletos corregidos en esta revisión
- `docs/24` (T15, traspaso entre organizaciones): resuelto por A-03/RF-50 (DONE_LOCAL, `d99f40a`); la salida real sigue bloqueada (D4).
- `docs/18` P0-024: ya no lista recepciones/calidad/lotes/inventario como pendiente móvil (ninguna fuente lo exige).
- `docs/07`: referencia de productores del pull y, ahora, catálogo de tipos documentales del pull solo para quien puede subir documentos.
- Panel geográfico del expediente: estado actual calculado con el mecanismo vigente (`4ff7cb2`).

## Lista finita de pendientes
Categorías: **I** implementación pendiente · **C** configuración o decisión · **D** datos faltantes · **E** evidencia por producir · **X** dependencia externa. Un pendiente con varias categorías se separa en filas.

| # | Pendiente | Cat. | Acción de cierre | ¿Ahora? |
| --- | --- | --- | --- | --- |
| 1a | Ensayo en teléfono físico (P0-023/024; gate de `.claude/rules/40-mobile-offline.md`) | E | Instalar `ARM64-soportes-70348c7.apk` y recorrer la guía de `apps/mobile/README.md`. El APK arm64 está **preparado, no probado**: no es evidencia de teléfono | No: equipo del propietario (al final) |
| 1b | Ubicación real, permiso denegado y recuperación ante almacenamiento lleno en teléfono | E | Misma guía; en emulador hay evidencia (denegada con contenido comparado; llena 1 de 2 ejecuciones, no determinista) | No: teléfono |
| 2 | Soporte sobre **productor** desde la interfaz móvil | Fuera del alcance exigido (no bloquea) | Mejora opcional: el servidor ya lo admite; solo faltaría la pantalla. `DELIVERY_SUPPORT` se vincula desde la entrega, `FIELD_PHOTO` conserva su flujo | No aplica |
| 3 | `GEOLOCATION_PROFILE` NOT_EVALUABLE en DD-2026-00002 | C | Una persona con facultad adopta una configuración **revisada y aplicable** (mecanismo existente); no se adopta por conveniencia | No: decisión real (D-05.B) |
| 4 | Parcela CAD-1027213440 NO EVALUABLE: punto sin superficie declarada | D | Registrar la superficie (o un polígono) en una versión nueva con un rol con `plot:update` y reevaluar. No bloquea el resto | Sí, con el dato real |
| 5a | Whisp: clave y autorización del ensayo | **Hecho** (2026-10-29) | Clave en `.env`; términos y envío de la geometría artificial confirmados por el propietario | Hecho |
| 5b | Whisp: ensayo real con geometría artificial (P0-028) | **Evidenciado**: «servicio real con geometría artificial» | `docs/qa/EVIDENCIA_WHISP_ENSAYO_REAL_2026-10-29.md`. Configuración temporal restaurada. Parcelas reales: fuera de esta autorización | Hecho |
| 6 | Catálogo de riesgo aprobado, conclusión humana y `LEGAL_PROFILE` reales (D-07, P1-005) | X | Revisión jurídica/regulatoria real; el mecanismo ya está demostrado | No |
| 7 | Despacho de embarque (P0-029) | C + D | Condición de `dd_package_id`/`dispatch_at` (D-34), instantánea DD READY y calidad decidida | No: depende de 3 y 6 |
| 8 | GUIA (P1-006), EUDR-IS (P1-007), perfil Ecuador validado (P1-005) | X | Canal/acuerdo verificado y recibos auténticos | No |
| 9a | RNF-05: presupuestos p95/SLO | C (decisión de TECH-001) | Acordar los objetivos; sin ellos no hay umbral que aprobar. No se inventan | No: decisión |
| 9b | RNF-05: medición con el dataset del piloto y carga | E | Medir con el dataset del piloto contra los presupuestos de 9a | No: depende de 9a y del dataset |
| 9c | RNF-06: restauración coherente de base y objetos | **Evidenciada** (ver abajo) | — | Hecho |
| 9d | RNF-06: **objetivos** RPO/RTO | C | El responsable fija RPO y RTO (`docs/17`); este repositorio no los inventa | No: decisión |
| 9e | RNF-06: **aceptación** de los tiempos observados frente a 9d | C | El responsable compara los tiempos observados (abajo) con 9d. Solo si el volumen declarado difiere de los ya medidos se mide de nuevo, una vez | No: depende de 9d |
| 9f | Capacitación (P0-031) | X | Con la organización piloto | No |
| 10 | Incidencia del navegador del propietario desde `localhost` | D | Dirección de la barra y error de la petición `login` (Network) y de Console | No: dato del propietario |
| 11 | Almacenamiento lleno: **no es un requisito adicional**. Se comprueba la recuperación prevista (aviso, sin pérdida, reintento) y se declara el límite del ensayo: el fallo de escritura real se produjo 1 de 2 veces a 0 KB libres. Provocarlo de forma repetida es asunto del arnés, no una función del producto | E (límite declarado) | Repetirlo en el teléfono físico solo como parte de la guía; sin construir nada nuevo | Con el teléfono (P8)

### RNF-06: qué acreditan los registros existentes
- **QA-16 (2026-10-15)**, `docs/qa/EVIDENCIA_QA16_RESTAURACION_2026-10-15.md`: respaldo y restauración en entorno aislado de base **y** objetos; conteos idénticos en las 25 tablas y 39/39 migraciones, 12+14 campos cifrados descifrados con 0 fallos, objetos 2/2 con clave, tamaño y SHA-256 exactos, 0 huérfanos; la aplicación operó sobre la copia (9 comprobaciones correctas, 3 bloqueos esperados). **Volumen: dump de 538 KB y 2 objetos.** Tiempos: volcado 3 s, arranque 6 s, `pg_restore` 14 s (13 s en la segunda mitad), verificación < 2 min; API operativa 7 s.
- **Restauración aislada de `_respaldos/2026-10-20-a01-mapa-fotos-0057`**: 137 tablas con conteos y restricciones idénticos, 53 productores descifrados sin fallos, **1191 objetos con la misma huella**. Ese registro no consigna tiempos.
- **Tres cosas distintas** (definiciones en `docs/17`): **objetivos** (RPO/RTO: ninguno fijado), **tiempos observados** (los de arriba, de esos dos volúmenes; no se extrapolan) y **aceptación** (no existe: requiere un objetivo). El criterio «restauración coherente de base y objetos» sí está cubierto. No se probó la restauración del VHDX completo. No se añade como condición un «volumen real de un cliente»: falta fijar objetivos y aceptarlos.

## Qué sí quedó cerrado (con su evidencia)
- **D-40, offline prolongado** (2026-10-30): decidida la opción A (mantener 1 h). Conservar lo capturado 7 días y sincronizar tras reconectar están probados (`store.test.ts` «7 días simulados» + integración); capturar de nuevo dura lo que la sesión. Sin cambio de código ni de criterios de RNF-04/QA-08; el ensayo Android real sigue en P8.
- **Whisp, servicio real con geometría artificial** (2026-10-29): recorrido plataforma → API → worker → Whisp → resultado guardado → consulta y descarga (SHA-256 coincide), un solo intento, cobertura `UNKNOWN`, `conclusion: NOT_EVALUATED`; configuración restaurada y control negativo 409. No es análisis de una parcela real ni conclusión regulatoria. La web distingue «resultado disponible» (consulta y descarga, SHA-256 coincide) de «nuevos análisis deshabilitados» (`ac1fdec`, validada y desplegada).
- **Soportes documentales móviles (PDF o imagen)** (`70348c7`): operación `DOCUMENT_ATTACH` sobre parcela o productor (existentes o con referencia local), tipos de Documentos con titular parcela/productor (sin tipos nuevos), subida aparte con SHA-256, firma de bytes y escaneo; aportar **no** revisa ni aprueba. Emulador: PDF por el selector del sistema sobre una parcela creada sin conexión, subida interrumpida y recuperada con **un solo documento**, tipo `LAND_TENURE`, titular = parcela definitiva, SHA-256 idéntico, 1 versión, 0 revisiones humanas, estado «archivo disponible (sin revisar)». Pruebas: `soportes.test.ts` (3), `sync-altas.int-spec.ts` (9).
- **Mapa y formulario**: el dedo dentro del mapa mueve el mapa; fuera de él se desplaza la página; se llega a «Guardar en cola» y se vuelve arriba; los vértices se conservan. Solo hizo falta una indicación en la tarjeta del mapa.
- **«Mi ubicación» no guarda hasta la acción explícita**: aserción del arnés reescrita por contenido (misma coordenada de la lectura, guardada solo tras «Usar esta ubicación»).
- **Altas, mapa móvil y APK** (`docs/qa/EVIDENCIA_MOVIL_ALTAS_MAPA_2026-10-28.md`): cadena de Altas, mapa con y sin red, adjunto interrumpido, conflicto con historial, separación de cuentas, SQLCipher, persistencia tras cierre forzado, respuesta perdida, foto con análisis, sesión vencida, ubicación denegada, almacenamiento lleno.
- **Acceso web**: causa demostrada para `127.0.0.1`/`[::1]` y corregida (`233b548`); el caso `localhost` del propietario es el pendiente 10.
- **Panel geográfico y DD-2026-00002**: estado actual del requisito (`4ff7cb2`), evaluación técnica de CAD-1027213440, instantánea 2 BLOQUEADA, instantánea 1 conservada.
- **Recorridos por rol** (web, 22 combinaciones, 19 cuentas) y **cadena** parcela→entrega→lote→satélite→riesgo→expediente.

## Separación obligada
Implementación (código y pruebas) ≠ demostración local (emulador/despliegue local) ≠ aceptación externa (propietario, jurídico, proveedor) ≠ preparación para producción. El 70 % y el 68,2 % miden requisitos **aceptados**, no lo construido: no existe todavía un cálculo acreditado del porcentaje técnico total y no se improvisa uno. Ninguno de los pendientes anteriores se cierra con el siguiente nivel sin la evidencia de su propio nivel.
