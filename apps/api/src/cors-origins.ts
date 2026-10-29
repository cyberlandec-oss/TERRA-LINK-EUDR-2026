// Orígenes que el navegador puede usar para llamar a la API. La web declara UNA dirección (WEB_ORIGIN). En un entorno local esa
// dirección es un alias de «loopback» y la persona puede abrir la web por cualquiera de los tres (localhost, 127.0.0.1, [::1]): el
// navegador los trata como orígenes distintos y, sin esto, bloquea las llamadas («Sin conexión con el servidor» en la web).
// La lista es EXPLÍCITA y solo se amplía cuando WEB_ORIGIN ya es de loopback; con un dominio real se admite únicamente ese. Nunca `*`.
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function corsOrigins(webOrigin: string): string[] {
  const clean = webOrigin.trim().replace(/\/$/, '');
  let u: URL;
  try { u = new URL(clean); } catch { return [clean]; }
  if (!LOOPBACK_HOSTS.includes(u.hostname === '::1' ? '[::1]' : u.hostname)) return [clean];
  const port = u.port ? `:${u.port}` : '';
  return LOOPBACK_HOSTS.map((h) => `${u.protocol}//${h}${port}`);
}
