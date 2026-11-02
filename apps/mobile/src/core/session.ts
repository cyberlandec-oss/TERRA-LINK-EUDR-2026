// Sesión del dispositivo (P0-023, revisada 2026-10-10):
// - El inicio de sesión es solo online. La autorización local para capturar termina cuando vence la sesión emitida por
//   el servidor (exp del JWT, ADR-0005: 1 h, sin refresh). No se renueva ni se prolonga sin red.
// - D-40 (ventana local más larga que la sesión) es una PROPUESTA NO APROBADA y NO se aplica: no existe en este código
//   ninguna autorización local distinta del token. Su contrato pendiente está en docs/11.
// - Sin red no se detectan revocaciones, bajas ni cambios de permisos: la UI lo dice.
// - Reloj: si la hora del dispositivo retrocede respecto de la última hora vista, se bloquea hasta volver online.
// - Bloqueada la captura, borradores, cola y fotos se conservan y siguen visibles; nada se borra.

export interface StoredSession {
  user_id: string;
  email: string;
  token_expires_at: string; // exp del JWT emitido por el servidor (no se modifica en el dispositivo)
  last_online_auth_at: string;
  last_seen_at: string; // hora máxima observada en el dispositivo (detección de reloj atrasado)
  organizations: Array<{ organization_id: string; name: string; status: string; roles: string[]; permissions: string[] }>;
}

export type CaptureGate =
  | { allowed: true; until: string; note: string }
  | { allowed: false; reason: 'NO_SESSION' | 'SESSION_EXPIRED' | 'CLOCK_BACKWARDS' | 'NO_PERMISSION' | 'ORG_NOT_ACTIVE'; note: string };

/** Permisos que habilitan la captura de campo de parcelas (asignadas o de toda la organización). */
export const CAPTURE_PERMISSIONS = ['plot:update', 'plot:update_assigned', 'plot:update_own'];

export function captureGate(s: StoredSession | null, orgId: string | null, now: Date): CaptureGate {
  if (!s || !orgId) return { allowed: false, reason: 'NO_SESSION', note: 'Inicia sesión con conexión para preparar el trabajo de campo.' };
  const org = s.organizations.find((o) => o.organization_id === orgId);
  if (!org || !org.permissions.some((p) => CAPTURE_PERMISSIONS.includes(p))) return { allowed: false, reason: 'NO_PERMISSION', note: 'Tu rol en esta organización no permite capturar en parcelas (según los permisos descargados al iniciar sesión).' };
  if (org.status !== 'ACTIVE') return { allowed: false, reason: 'ORG_NOT_ACTIVE', note: 'La organización no estaba activa al iniciar sesión.' };
  if (now.getTime() + 60_000 < Date.parse(s.last_seen_at)) return { allowed: false, reason: 'CLOCK_BACKWARDS', note: 'La hora del dispositivo retrocedió: conéctate e inicia sesión para revalidar. Tus capturas se conservan.' };
  if (now >= new Date(s.token_expires_at)) return { allowed: false, reason: 'SESSION_EXPIRED', note: 'La sesión emitida por el servidor venció: conéctate e inicia sesión para seguir capturando. Tus capturas se conservan y siguen visibles.' };
  return { allowed: true, until: s.token_expires_at, note: 'Captura permitida hasta que venza la sesión emitida por el servidor. Sin conexión no se detectan revocaciones.' };
}

/** Error de escritura bloqueada por la sesión: lo guardado no se toca. */
export class CaptureBlockedError extends Error {
  constructor(readonly gate: Extract<CaptureGate, { allowed: false }>) { super(gate.note); this.name = 'CaptureBlockedError'; }
}

/** Clave estable de aislamiento local por cuenta + organización (nombre de archivo de base y carpeta de adjuntos). */
export async function accountKey(sha256: (b: Uint8Array) => Promise<string>, userId: string, orgId: string): Promise<string> {
  const hex = await sha256(new TextEncoder().encode(`terra-link:${userId}:${orgId}`));
  return hex.slice(0, 32);
}

/** exp (segundos) del JWT, sin verificar firma: solo para limitar localmente; la autorización es del servidor. */
export function jwtExpiry(token: string): Date | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = JSON.parse(globalThis.atob ? globalThis.atob(b64) : Buffer.from(b64, 'base64').toString('utf8')) as { exp?: number };
    return typeof json.exp === 'number' ? new Date(json.exp * 1000) : null;
  } catch { return null; }
}

/** Minutos que le quedan a la sesión emitida por el servidor (0 si ya venció). Es un aviso de la interfaz: la autorización es del servidor. */
export const SESSION_WARN_MIN = 10;
export function sessionMinutesLeft(tokenExpiresAt: string, now: Date): number {
  return Math.max(0, Math.floor((Date.parse(tokenExpiresAt) - now.getTime()) / 60_000));
}
/** Aviso cuando queda poco: guardar y sincronizar antes de que venza; sin red no se renueva. null si no hay nada que avisar. */
export function sessionLimitNotice(tokenExpiresAt: string, now: Date): string | null {
  const left = sessionMinutesLeft(tokenExpiresAt, now);
  if (now >= new Date(tokenExpiresAt)) return null;
  if (left > SESSION_WARN_MIN) return null;
  return `Quedan ${left < 1 ? 'menos de 1 minuto' : `${left} min`} de sesión: lo capturado se conserva, pero al vencer no podrás capturar hasta iniciar sesión con conexión. Sincroniza antes si tienes red.`;
}
