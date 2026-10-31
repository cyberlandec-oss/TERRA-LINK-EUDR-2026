# Sesión 2026-10-11 — Recorrido en emulador, prueba negativa y orientación

- Recorrido integrado en emulador iniciado: login por la interfaz OK; **defecto real** al abrir el almacén cifrado
  (transacción en conexión sin clave de SQLCipher). Corregido en código; APK sin recompilar (guardia de disco).
- Incidente: una captura mostró una credencial DEMO (tecleada en el campo equivocado); se eliminó y se añadió una red
  de seguridad que impide guardar capturas con contraseñas visibles.
- Prueba negativa sin SQLCipher: variante aislada preparada; no compilada (2,73 GB libres).
- Orientación: revisión visual con píxeles reales en Chromium y aceptación/rechazo del servidor — OK.
- Sonda de cifrado antes del login; cleartext solo a localhost; refresco del estado de análisis de fotos.
- Móvil: `validation-results/2026-10-11T17-08-34-732Z-movil`. API: prueba nueva 7/7.
- Pendiente: reiniciar Windows y medir espacio; recompilar aceptación y negativa; repetir recorrido completo en
  emulador; ensayo físico. P0-023 y P0-024 ABIERTAS.
