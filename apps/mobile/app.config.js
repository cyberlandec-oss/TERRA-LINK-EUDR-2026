// Configuración dinámica sobre app.json.
// TL_VARIANT=negativa → APK de PRUEBA NEGATIVA aislado: otro identificador de aplicación (otro almacenamiento), SQLCipher
// DESACTIVADO en la configuración nativa y rótulo visible. Sirve solo para comprobar el fallo cerrado; nunca para el
// ensayo físico ni para datos reales. La lógica de protección de la app es la misma.
module.exports = ({ config }) => {
  const negative = process.env.TL_VARIANT === 'negativa';
  const plugins = (config.plugins ?? []).map((p) => (Array.isArray(p) && p[0] === 'expo-sqlite' ? ['expo-sqlite', { ...p[1], useSQLCipher: !negative }] : p));
  plugins.push('./plugins/with-local-cleartext');
  return {
    ...config,
    name: negative ? 'TL PRUEBA NEGATIVA (sin SQLCipher)' : config.name,
    scheme: negative ? 'terralinkneg' : config.scheme,
    android: { ...config.android, package: negative ? 'ec.agtech.terralink.campo.pruebanegativa' : config.android.package },
    plugins,
    extra: { ...(config.extra ?? {}), variant: negative ? 'PRUEBA_NEGATIVA_SIN_SQLCIPHER' : 'ACEPTACION' },
  };
};
