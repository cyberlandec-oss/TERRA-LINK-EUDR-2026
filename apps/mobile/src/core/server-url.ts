// Validación de la URL del servidor ANTES de usarla o guardarla. El mensaje de error nunca reproduce lo escrito (si
// por error se tecleó una contraseña en este campo, no debe aparecer en la interfaz, registros ni almacenamiento).
// Regla alineada con la política de red del build: HTTP solo hacia localhost/127.0.0.1 (API local vía `adb reverse`);
// cualquier otro servidor exige HTTPS. Sin usuario/contraseña embebidos, sin espacios, puerto 1–65535.
export type ServerUrlResult = { ok: true; url: string } | { ok: false; reason: 'FORMAT' | 'INSECURE' | 'CREDENTIALS' | 'PORT' };

export const SERVER_URL_HELP = 'La dirección del servidor no es válida. Usa http://localhost:4000 (API local) o una dirección https://.';

export function validateServerUrl(input: string): ServerUrlResult {
  const v = input.trim();
  if (!v || /\s/.test(v) || v.length > 200) return { ok: false, reason: 'FORMAT' };
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(v)) return { ok: false, reason: 'CREDENTIALS' };
  const m = /^(https?):\/\/([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::(\d{1,5}))?(\/[A-Za-z0-9._~\-/]*)?$/i.exec(v);
  if (!m) return { ok: false, reason: 'FORMAT' };
  const [, scheme, host, port] = m;
  if (port && (Number(port) < 1 || Number(port) > 65535)) return { ok: false, reason: 'PORT' };
  const local = /^(localhost|127\.0\.0\.1)$/i.test(host);
  if (scheme.toLowerCase() === 'http' && !local) return { ok: false, reason: 'INSECURE' };
  return { ok: true, url: v.replace(/\/+$/, '') };
}
