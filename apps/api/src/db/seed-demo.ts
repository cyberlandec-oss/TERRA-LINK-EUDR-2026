import { randomInt, randomUUID } from 'crypto';
import { closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { AddressInfo } from 'net';
import { createApp } from '../bootstrap';
import { loadConfig } from '../config';
import { hashPassword } from '../auth/passwords';
import { createDb } from './database';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service';

// Seed DEMO/QA para revisión visual local (npm run seed:demo -w apps/api).
// - Solo desarrollo local: se niega a ejecutar contra bases *_test / *_e2e o con NODE_ENV=production.
// - Datos sintéticos rotulados «DEMO». Conserva todo lo existente; es idempotente.
// - Usa los flujos reales de la API (organizaciones, invitaciones, aceptación, roles, productores): todo
//   queda auditado, cifrado y con eventos. Solo la cuenta de revisión de plataforma se inserta directa
//   (no existe endpoint para crear SUPER_ADMIN).
// - Contraseñas: solo en CREDENCIALES.csv (raíz, ignorado por git). Se reutilizan entre ejecuciones;
//   nunca se regeneran ni se resetean cuentas existentes. No se imprimen.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
// TL_CREDENTIALS_DIR: carpeta alternativa de los CSV de credenciales (solo para la comprobación del seed en una base
// desechable: e2e/seed/comprobar-seed-demo.mjs). Por defecto, la raíz del repositorio.
const CRED_DIR = process.env.TL_CREDENTIALS_DIR ? resolve(process.env.TL_CREDENTIALS_DIR) : ROOT;
const CSV_PATH = resolve(CRED_DIR, 'CREDENCIALES.csv');
const WEB_URL = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const DOMAIN = 'demo.terralink.local';

interface OrgSpec { key: string; name: string; type: string; typeLabel: string; profile: string }
const ORGS: OrgSpec[] = [
  { key: 'coop', name: 'DEMO · Cooperativa Río Verde', type: 'COOPERATIVE', typeLabel: 'Cooperativa', profile: 'productor (cooperativa de productores)' },
  { key: 'acopio', name: 'DEMO · Acopio San Isidro', type: 'COLLECTOR', typeLabel: 'Acopiador / centro de acopio', profile: 'acopiador' },
  { key: 'export', name: 'DEMO · Exportadora Pacífico', type: 'EXPORTER', typeLabel: 'Exportador', profile: 'exportador' },
  { key: 'import', name: 'DEMO · Chocolates Europa (importador UE)', type: 'IMPORTER', typeLabel: 'Importador', profile: 'comprador europeo' },
];

interface UserSpec { local: string; first: string; last: string; memberships: Array<{ org: string; role: string; note?: string }>; platform?: boolean; note?: string }
const USERS: UserSpec[] = [
  { local: 'superadmin.revision', first: 'Revisión', last: 'Plataforma (demo)', platform: true, memberships: [],
    note: 'Administra la plataforma: organizaciones, estado e incorporación del ORG_ADMIN. Sin acceso a miembros, auditoría ni operación de las empresas (D-04).' },
  { local: 'admin.cooperativa', first: 'Carmen', last: 'Zambrano (demo)', memberships: [{ org: 'coop', role: 'ORG_ADMIN' }] },
  { local: 'supervisor.cooperativa', first: 'Luis', last: 'Mera (demo)', memberships: [{ org: 'coop', role: 'MANAGER' }] },
  { local: 'tecnico1.cooperativa', first: 'Rosa', last: 'Cedeño (demo)', memberships: [{ org: 'coop', role: 'FIELD_TECHNICIAN' }] },
  { local: 'tecnico2.cooperativa', first: 'Jorge', last: 'Loor (demo)', memberships: [{ org: 'coop', role: 'FIELD_TECHNICIAN' }] },
  { local: 'productor.cooperativa', first: 'Ana', last: 'Vélez (demo)', memberships: [{ org: 'coop', role: 'PRODUCER',
    note: 'Cuenta sin vínculo con un registro de productor (UX-D08): «Mi finca» pendiente.' }] },
  { local: 'auditor.cooperativa', first: 'Silvia', last: 'Andrade (demo)', memberships: [{ org: 'coop', role: 'AUDITOR',
    note: 'Lee parcelas sin coordenadas exactas (clasificación de geometría, D-24).' }] },
  { local: 'eudr.cooperativa', first: 'Diana', last: 'Ponce (demo)', memberships: [{ org: 'coop', role: 'EUDR_MANAGER',
    note: 'Segunda persona del recorrido de mitigación (P0-021): verifica o rechaza lo que ejecuta la administración (separación de funciones). Rol existente; sin permisos adicionales.' }] },
  { local: 'admin.acopio', first: 'Patricia', last: 'Intriago (demo)', memberships: [{ org: 'acopio', role: 'ORG_ADMIN' }] },
  { local: 'recepcion.acopio', first: 'Kevin', last: 'Macías (demo)', memberships: [
    { org: 'acopio', role: 'RECEPTION_OPERATOR', note: 'El acopio aún no tiene productores DEMO: el recorrido de recepción está en la Cooperativa.' },
    { org: 'coop', role: 'RECEPTION_OPERATOR', note: 'Recorrido P0-012 (misma cuenta, segunda membresía): recibir, pesar y registrar muestra.' },
  ] },
  { local: 'calidad.acopio', first: 'Diana', last: 'Pinargote (demo)', memberships: [
    { org: 'acopio', role: 'QUALITY_OPERATOR', note: 'El acopio aún no tiene productores DEMO: el recorrido de calidad está en la Cooperativa.' },
    { org: 'coop', role: 'QUALITY_OPERATOR', note: 'Recorrido P0-012 (misma cuenta, segunda membresía): resultados y decisión de calidad.' },
  ] },
  { local: 'admin.exportadora', first: 'Fernando', last: 'Alcívar (demo)', memberships: [{ org: 'export', role: 'ORG_ADMIN' }] },
  { local: 'trazabilidad.exportadora', first: 'Gabriela', last: 'Moreira (demo)', memberships: [{ org: 'export', role: 'TRACEABILITY_MANAGER', note: 'Lotes y explorador de trazabilidad pendientes (P0-013 a P0-017).' }] },
  { local: 'eudr.exportadora', first: 'Andrés', last: 'Vera (demo)', memberships: [{ org: 'export', role: 'EUDR_MANAGER', note: 'Riesgo, evidencias y debida diligencia pendientes (P0-018 a P0-022).' }] },
  { local: 'exportacion.exportadora', first: 'Mónica', last: 'Bravo (demo)', memberships: [{ org: 'export', role: 'EXPORT_MANAGER', note: 'Embarques pendientes (P0-029).' }] },
  { local: 'auditor.exportadora', first: 'Ricardo', last: 'Solórzano (demo)', memberships: [{ org: 'export', role: 'AUDITOR', note: 'Auditor interno de su organización; sin acceso a otras empresas.' }] },
  { local: 'admin.importador', first: 'Claire', last: 'Dubois (demo)', memberships: [{ org: 'import', role: 'ORG_ADMIN' }] },
  { local: 'comprador.importador', first: 'Lukas', last: 'Weber (demo)', memberships: [{ org: 'import', role: 'BUYER',
    note: 'Solo membresía en su organización. Sin portal comprador (P1) ni concesiones entre organizaciones (UX-D09).' }] },
  { local: 'coordinador.multi', first: 'Esteban', last: 'Ponce (demo)', memberships: [
    { org: 'coop', role: 'MANAGER', note: 'Usuario con roles distintos en dos organizaciones: usar el selector de organización.' },
    { org: 'export', role: 'TRACEABILITY_MANAGER', note: 'Mismo usuario; rol distinto en otra organización.' },
  ] },
];

const PRODUCERS = [
  { code: 'DEMO-RV-001', first_name: 'María', last_name: 'Quijije (demo)', community: 'La Unión', parish: 'Calceta', doc: '0990000001', tech: 1 },
  { code: 'DEMO-RV-002', first_name: 'Pedro', last_name: 'Menéndez (demo)', community: 'La Unión', parish: 'Calceta', doc: '0990000002', tech: 1 },
  { code: 'DEMO-RV-003', first_name: 'Teresa', last_name: 'Chávez (demo)', community: 'El Carmen', parish: 'Quiroga', doc: '0990000003', tech: 1 },
  { code: 'DEMO-RV-004', legal_name: 'Finca Los Almendros (demo)', community: 'El Carmen', parish: 'Quiroga', tech: 1 },
  { code: 'DEMO-RV-005', first_name: 'Segundo', last_name: 'Cevallos (demo)', community: 'Río Chico', parish: 'Membrillo', doc: '0990000005', tech: 2 },
  { code: 'DEMO-RV-006', first_name: 'Lucía', last_name: 'Palma (demo)', community: 'Río Chico', parish: 'Membrillo', tech: 2, draft: true },
  { code: 'DEMO-RV-007', first_name: 'Ramón', last_name: 'García (demo)', community: 'Río Chico', parish: 'Membrillo', doc: '0990000007', tech: 2, archive: 'Dejó de producir cacao (dato de demostración)' },
  { code: 'DEMO-RV-008', first_name: 'Elena', last_name: 'Mendoza (demo)', community: 'La Unión', parish: 'Calceta' },
  // Mismo documento que DEMO-RV-003 con otro formato: abre un caso de posible duplicado (P0-005).
  { code: 'DEMO-RV-009', first_name: 'Teresa', last_name: 'Chávez Q. (demo)', community: 'El Carmen', parish: 'Quiroga', doc: '099-000-0003', tech: 1 },
];

// Parcelas DEMO (P0-006): situaciones geométricas variadas con coordenadas SINTÉTICAS (zona de Calceta).
const sq = (lon: number, lat: number, d: number) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
const PLOTS: Array<{ code: string; producer: string; name: string; versions: Array<Record<string, unknown>> }> = [
  { code: 'DEMO-PAR-001', producer: 'DEMO-RV-001', name: 'Lote del río (demo)', versions: [
    { survey_method: 'DECLARED', area_declared_ha: 2.5 },
    { survey_method: 'MANUAL_COORDINATES', geometry: sq(-80.1621, -0.8512, 0.0012), area_declared_ha: 2.5, notes: 'Geometría sintética de demostración' },
  ] },
  { code: 'DEMO-PAR-002', producer: 'DEMO-RV-002', name: 'Loma alta (demo)', versions: [
    { survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1588, -0.8475] }, area_declared_ha: 1.2, notes: 'Punto sintético de demostración' },
  ] },
  { code: 'DEMO-PAR-003', producer: 'DEMO-RV-003', name: 'Huerta vieja (demo)', versions: [] },
  { code: 'DEMO-PAR-004', producer: 'DEMO-RV-004', name: 'Los Almendros norte (demo)', versions: [{ survey_method: 'DECLARED', area_declared_ha: 5 }] },
  { code: 'DEMO-PAR-005', producer: 'DEMO-RV-005', name: 'Membrillo (demo)', versions: [
    { survey_method: 'MANUAL_COORDINATES', geometry: sq(-80.1702, -0.8601, 0.0008), notes: 'Geometría sintética de demostración' },
  ] },
  { code: 'DEMO-PAR-006', producer: 'DEMO-RV-001', name: 'Lote del cerro (demo)', versions: [] },
];

const ROLE_ES: Record<string, string> = {
  SUPER_ADMIN: 'Administración de plataforma', ORG_ADMIN: 'Administrador de organización', MANAGER: 'Supervisor',
  FIELD_TECHNICIAN: 'Técnico de campo', RECEPTION_OPERATOR: 'Operador de recepción', QUALITY_OPERATOR: 'Operador de calidad',
  TRACEABILITY_MANAGER: 'Responsable de trazabilidad', EUDR_MANAGER: 'Responsable EUDR', EXPORT_MANAGER: 'Responsable de exportación',
  BUYER: 'Comprador', AUDITOR: 'Auditor', PRODUCER: 'Productor',
};

const email = (u: UserSpec) => `${u.local}@${DOMAIN}`;

function newPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 18; i++) out += alphabet[randomInt(alphabet.length)];
  return `Demo-${out}`;
}

// ---- CSV (RFC 4180, UTF-8 con BOM para Excel) ----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const HEADER = ['nombre_usuario', 'email', 'contrasena', 'rol', 'organizacion', 'tipo_organizacion', 'perfil_cadena',
  'es_admin_empresa', 'es_admin_plataforma', 'url_acceso', 'estado_acceso', 'observaciones'];

/**
 * Archivos de credenciales que existen, **del más reciente al más antiguo**.
 *
 * El orden importa: `CREDENCIALES.pendiente.csv` se escribe cuando `CREDENCIALES.csv` está abierto en otro
 * programa, y entonces el principal se queda **obsoleto**. Leerlo primero devolvería una contraseña muerta. Es
 * la misma regla que ya usa `e2e/review/revision-por-rol.mjs`: manda el más reciente.
 */
function credentialFiles(): string[] {
  return [CSV_PATH, resolve(CRED_DIR, 'CREDENCIALES.pendiente.csv')]
    .filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/** Lee una columna del CSV por email, en orden de archivo. Nunca devuelve nada a la consola. */
function readColumn(path: string, column: string): Array<[string, string]> {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const head = rows.shift() ?? [];
  const iEmail = head.indexOf('email');
  const iCol = head.indexOf(column);
  const out: Array<[string, string]> = [];
  for (const r of rows) if (r[iEmail] && r[iCol]) out.push([r[iEmail], r[iCol]]);
  return out;
}

function loadKnownPasswords(): Map<string, string> {
  const known = new Map<string, string>();
  for (const path of credentialFiles()) {
    for (const [mail, pass] of readColumn(path, 'contrasena')) if (!known.has(mail)) known.set(mail, pass);
  }
  return known;
}

/**
 * TODAS las contraseñas que algún archivo atribuye a esa cuenta, sin repetir.
 *
 * Al rotar hay que comprobar que la anterior **deja de servir**, y si los dos archivos discrepan —porque uno
 * quedó bloqueado y se quedó atrás— la única comprobación honesta es que **ninguna** de las dos abra sesión.
 */
function knownPasswordsFor(mail: string): string[] {
  const out: string[] = [];
  for (const path of credentialFiles()) {
    for (const [m, pass] of readColumn(path, 'contrasena')) if (m === mail && !out.includes(pass)) out.push(pass);
  }
  return out;
}

/** ¿Se puede escribir CREDENCIALES.csv o CREDENCIALES.pendiente.csv? (abre sin escribir; no altera su contenido). */
function canPersistCredentials(): boolean {
  for (const path of [CSV_PATH, resolve(CRED_DIR, 'CREDENCIALES.pendiente.csv')]) {
    try { if (existsSync(path)) closeSync(openSync(path, 'r+')); return true; } catch { /* abierto en otro programa */ }
  }
  return false;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:demo no se ejecuta en producción');
  const config = loadConfig();
  const dbName = new URL(config.databaseUrl).pathname.slice(1);
  if (/_test$|_e2e$/.test(dbName)) throw new Error('seed:demo es para la base de desarrollo, no para bases de prueba');
  const db = createDb(config.databaseUrl);
  const app = await createApp({ ...config, port: 0 }, db);
  app.useLogger(['error']);
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  async function call<T>(method: string, path: string, token?: string, body?: unknown, okStatuses = [200, 201]): Promise<{ status: number; data: T }> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as T;
    if (!okStatuses.includes(res.status)) {
      const code = (data as { error?: { code?: string } } | null)?.error?.code ?? 'SIN_CODIGO';
      throw new Error(`${method} ${path} → ${res.status} ${code}`);
    }
    return { status: res.status, data };
  }
  const login = async (mail: string, password: string) =>
    (await call<{ access_token: string }>('POST', '/api/v1/auth/login', undefined, { email: mail, password })).data.access_token;

  const known = loadKnownPasswords();
  const passwords = new Map<string, string>(); // email → contraseña conocida
  const withoutCredential = new Set<string>();
  const userExists = async (mail: string) => !!(await db.selectFrom('users').select('id').where('email', '=', mail).executeTakeFirst());

  try {
    // Rotación de la contraseña de UNA cuenta DEMO (`-- --rotar=<cuenta>`), p. ej. tras exponerse en una captura.
    // Orden seguro: 1) se guarda primero la nueva credencial en los CSV locales (si no se pueden escribir, no se rota);
    // 2) se activa en la base y se invalidan las sesiones (token_version + 1); 3) se verifica el login nuevo y el rechazo
    // del anterior. Si falla el paso 2, se restauran los CSV. No se imprime ninguna contraseña. Las demás cuentas no cambian.
    const rotateArg = process.argv.find((a) => a.startsWith('--rotar='));
    if (rotateArg) {
      const local = rotateArg.slice('--rotar='.length);
      // Incluye la cuenta de plataforma: si su credencial se expone, es la que más urge rotar.
      const spec = USERS.find((x) => x.local === local);
      if (!spec) throw new Error('Cuenta DEMO desconocida para rotar.');
      const mail = email(spec);
      const user = await db.selectFrom('users').select(['id']).where('email', '=', mail).executeTakeFirst();
      const previousPasswords = knownPasswordsFor(mail);
      if (!user || !previousPasswords.length) throw new Error('La cuenta no existe o no tiene credencial conocida: no se rota.');
      // Se escribe en los archivos que SE PUEDAN escribir. Antes se escribía en todos los que existieran, de modo
      // que un `CREDENCIALES.csv` abierto en Excel abortaba la rotación entera: justo cuando más urge rotar. Si no
      // se puede escribir ninguno, no se rota nada. Un archivo bloqueado se declara después, porque se queda con
      // una credencial que ya no sirve.
      const writable = (f: string) => { try { closeSync(openSync(f, 'r+')); return true; } catch { return false; } };
      const existing = [CSV_PATH, resolve(CRED_DIR, 'CREDENCIALES.pendiente.csv')].filter((f) => existsSync(f));
      const locked = existing.filter((f) => !writable(f));
      const files = existing.filter(writable).map((f) => ({ f, text: readFileSync(f, 'utf8') }));
      if (!files.length) throw new Error('Ningún archivo de credenciales se puede escribir: no se rota nada.');
      const rewrite = (text: string, pwd: string, estado: string) => {
        const rows = parseCsv(text); const head = rows.shift() ?? [];
        const iE = head.indexOf('email'); const iP = head.indexOf('contrasena'); const iS = head.indexOf('estado_acceso');
        for (const r of rows) if (r[iE] === mail) { r[iP] = pwd; r[iS] = estado; }
        return '\uFEFF' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
      };
      const fresh = newPassword();
      for (const c of files) writeFileSync(c.f, rewrite(c.text, fresh, 'ROTACION_EN_CURSO')); // lanza si está bloqueado: nada se activa
      try {
        await db.updateTable('users').set({ password_hash: await hashPassword(fresh), token_version: sql`token_version + 1` } as never).where('id', '=', user.id).execute();
      } catch (err) {
        for (const c of files) writeFileSync(c.f, c.text);
        throw err;
      }
      const status = async (pwd: string) => (await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mail, password: pwd }) })).status;
      const okNew = (await status(fresh)) === 200;
      // Se comprueban TODAS las anteriores conocidas, no solo la que ganó la precedencia: si los dos archivos
      // discrepaban, dar por buena una sola dejaría la otra sin verificar.
      const previas = previousPasswords.filter((x) => x !== fresh);
      const oldRejected = (await Promise.all(previas.map(status))).every((c) => c === 401);
      for (const c of files) writeFileSync(c.f, rewrite(c.text, fresh, okNew ? 'LOGIN_VERIFICADO (rotada)' : 'FALLO_LOGIN'));
      const superId = (await db.selectFrom('users').select('id').where('platform_role', '=', 'SUPER_ADMIN').executeTakeFirst())?.id ?? null;
      await app.get(AuditService).record(db, { organizationId: null, actorUserId: superId, action: 'user.password_rotated', entityType: 'user', entityId: user.id, result: 'SUCCESS',
        after: { reason: 'Rotación de cuenta DEMO por exposición de la credencial (consola, captura o transcripción); sesiones anteriores invalidadas' } });
      const vigente = files.map((c) => c.f.split(/[\\/]/).pop()).join(', ');
      const obsoleto = locked.map((f) => f.split(/[\\/]/).pop()).join(', ');
      console.log(`Rotación de ${local}: credencial nueva guardada en ${vigente} (vigente); login nuevo=${okNew}; anteriores rechazadas=${oldRejected} (${previas.length} comprobada(s)); sesiones previas invalidadas.`);
      if (locked.length) console.error(`AVISO: ${obsoleto} está bloqueado y conserva una credencial que YA NO SIRVE. El archivo vigente es ${vigente}.`);
      if (!okNew || !oldRejected) process.exitCode = 1;
      return;
    }

    // 1) Cuenta de revisión de plataforma (SUPER_ADMIN).
    const superUser = USERS.find((u) => u.platform)!;
    const superMail = email(superUser);
    if (await userExists(superMail)) {
      if (known.has(superMail)) passwords.set(superMail, known.get(superMail)!);
      else withoutCredential.add(superMail);
    } else {
      const pwd = known.get(superMail) ?? newPassword();
      await db.insertInto('users').values({
        email: superMail, first_name: superUser.first, last_name: superUser.last,
        password_hash: await hashPassword(pwd), status: 'ACTIVE', platform_role: 'SUPER_ADMIN',
      }).execute();
      passwords.set(superMail, pwd);
    }
    if (!passwords.has(superMail)) throw new Error('La cuenta de revisión de plataforma existe pero su contraseña no está en CREDENCIALES.csv; no se resetea.');
    const superToken = await login(superMail, passwords.get(superMail)!);

    // 2) Organizaciones DEMO (alta solo si no existen).
    const allOrgs = (await call<Array<{ id: string; name: string }>>('GET', '/api/v1/organizations?scope=all', superToken)).data;
    const orgIds = new Map<string, string>();
    for (const o of ORGS) {
      const existing = allOrgs.find((x) => x.name === o.name);
      const id = existing?.id ?? (await call<{ id: string }>('POST', '/api/v1/organizations', superToken, { name: o.name, organization_type: o.type, country: o.type === 'IMPORTER' ? 'DE' : 'EC' })).data.id;
      orgIds.set(o.key, id);
    }

    // 3) Membresías mediante invitación + aceptación (flujo real). Primero los ORG_ADMIN.
    const tokens = new Map<string, string>();
    const tokenOf = async (mail: string) => {
      if (!tokens.has(mail)) tokens.set(mail, await login(mail, passwords.get(mail)!));
      return tokens.get(mail)!;
    };
    const isMember = async (orgKey: string, mail: string, role: string) => {
      const row = await db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id')
        .leftJoin('role_assignments as ra', (j) => j.onRef('ra.membership_id', '=', 'm.id'))
        .select(['m.status', 'ra.role_code']).where('u.email', '=', mail).where('m.organization_id', '=', orgIds.get(orgKey)!).execute();
      return { member: row.length > 0 && row[0].status === 'ACTIVE', hasRole: row.some((r) => r.role_code === role) };
    };
    async function ensureMembership(u: UserSpec, orgKey: string, role: string, inviterToken: string) {
      const mail = email(u);
      const state = await isMember(orgKey, mail, role);
      if (state.member) {
        if (await userExists(mail) && known.has(mail)) passwords.set(mail, known.get(mail)!);
        else if (!passwords.has(mail)) withoutCredential.add(mail);
        return;
      }
      const exists = await userExists(mail);
      if (exists && !known.has(mail) && !passwords.has(mail)) { withoutCredential.add(mail); return; }
      const inv = (await call<{ token: string }>('POST', `/api/v1/organizations/${orgIds.get(orgKey)}/invitations`, inviterToken, { email: mail, role_code: role })).data;
      if (exists) {
        if (!passwords.has(mail)) passwords.set(mail, known.get(mail)!);
        await call('POST', '/api/v1/invitations/accept', await tokenOf(mail), { token: inv.token });
      } else {
        // Una cuenta nueva solo se crea si su contraseña podrá guardarse (CSV principal o pendiente escribible).
        if (!known.has(mail) && !canPersistCredentials()) { withoutCredential.add(mail); return; }
        const pwd = known.get(mail) ?? newPassword();
        await call('POST', '/api/v1/invitations/accept', undefined, { token: inv.token, first_name: u.first, last_name: u.last, password: pwd });
        passwords.set(mail, pwd);
      }
    }
    for (const u of USERS.filter((x) => x.memberships.some((m) => m.role === 'ORG_ADMIN'))) {
      for (const m of u.memberships) await ensureMembership(u, m.org, m.role, superToken);
    }
    const adminOf = (orgKey: string) => email(USERS.find((u) => u.memberships.some((m) => m.org === orgKey && m.role === 'ORG_ADMIN'))!);
    for (const u of USERS.filter((x) => !x.platform && !x.memberships.some((m) => m.role === 'ORG_ADMIN'))) {
      for (const m of u.memberships) {
        const admin = adminOf(m.org);
        if (!passwords.has(admin)) { withoutCredential.add(email(u)); continue; }
        await ensureMembership(u, m.org, m.role, await tokenOf(admin));
      }
    }

    // 4) Productores sintéticos de la cooperativa (por su ORG_ADMIN; cifrado, historial y eventos reales).
    const coopAdmin = adminOf('coop');
    if (passwords.has(coopAdmin)) {
      const t = await tokenOf(coopAdmin);
      const coopId = orgIds.get('coop')!;
      const members = (await call<Array<{ email: string; membership_id: string }>>('GET', `/api/v1/organizations/${coopId}/members`, t)).data;
      const techMembership = (n: number) => members.find((m) => m.email === `tecnico${n}.cooperativa@${DOMAIN}`)?.membership_id;
      for (const p of PRODUCERS) {
        const found = (await call<{ items: Array<{ id: string; producer_code: string }> }>('GET', `/api/v1/organizations/${coopId}/producers?status=ALL&q=${encodeURIComponent(p.code)}`, t)).data.items;
        if (found.some((x) => x.producer_code === p.code)) continue;
        const body: Record<string, unknown> = {
          producer_code: p.code, community: p.community, parish: p.parish, canton: 'Bolívar', province: 'Manabí',
          status: p.draft ? 'DRAFT' : 'ACTIVE',
          ...(p.legal_name ? { legal_name: p.legal_name } : { first_name: p.first_name, last_name: p.last_name }),
          ...(p.doc ? { document_type: 'CEDULA', document_number: p.doc, phone: '+593 99 000 0000' } : {}),
          ...(p.tech && techMembership(p.tech) ? { assigned_membership_id: techMembership(p.tech) } : {}),
        };
        const created = (await call<{ id: string; row_version: number }>('POST', `/api/v1/organizations/${coopId}/producers`, t, body)).data;
        if (p.archive) {
          await call('POST', `/api/v1/organizations/${coopId}/producers/${created.id}/archive`, t, { expected_version: created.row_version, reason: p.archive });
        }
      }
    }

    // 4b) Parcelas DEMO de la cooperativa (P0-006): alta y versiones por la API (historial, eventos, auditoría).
    if (passwords.has(coopAdmin)) {
      const t = await tokenOf(coopAdmin);
      const coopId = orgIds.get('coop')!;
      for (const pl of PLOTS) {
        const existing = (await call<{ items: Array<{ plot_code: string }> }>('GET', `/api/v1/organizations/${coopId}/plots?status=ALL&q=${encodeURIComponent(pl.code)}`, t)).data.items;
        if (existing.some((x) => x.plot_code === pl.code)) continue;
        const producer = (await call<{ items: Array<{ id: string; producer_code: string }> }>('GET', `/api/v1/organizations/${coopId}/producers?status=ALL&q=${encodeURIComponent(pl.producer)}`, t)).data.items
          .find((x) => x.producer_code === pl.producer);
        if (!producer) continue;
        let plot = (await call<{ id: string; row_version: number }>('POST', `/api/v1/organizations/${coopId}/plots`, t,
          { producer_id: producer.id, plot_code: pl.code, crop: 'Cacao', variety: 'Nacional', name: pl.name, canton: 'Bolívar', province: 'Manabí' })).data;
        for (const v of pl.versions) {
          const res = (await call<{ plot: { id: string; row_version: number } }>('POST', `/api/v1/organizations/${coopId}/plots/${plot.id}/geometry-versions`, t, { expected_version: plot.row_version, ...v })).data;
          plot = res.plot;
        }
      }
    }

    // 4c) Productos DEMO (P0-011): uno por estado/presentación definido en las fuentes (S1 §17), unidad KG,
    // en cada organización con administrador conocido. Por la API (historial, eventos, auditoría); idempotente.
    // Sin variedades ni clasificaciones de calidad inventadas.
    const DEMO_PRODUCTS = [
      { code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA' },
      { code: 'CACAO_FERMENTADO', name: 'Cacao fermentado', product_state: 'CACAO_FERMENTADO' },
      { code: 'CACAO_SECO', name: 'Cacao seco', product_state: 'CACAO_SECO' },
      { code: 'CACAO_CLASIFICADO', name: 'Cacao clasificado', product_state: 'CACAO_CLASIFICADO' },
    ];
    for (const o of ORGS) {
      const admin = USERS.find((u) => u.memberships.some((m) => m.org === o.key && m.role === 'ORG_ADMIN'));
      if (!admin || !passwords.has(email(admin))) continue;
      const t = await tokenOf(email(admin));
      const orgId = orgIds.get(o.key)!;
      const existing = (await call<{ items: Array<{ code: string }> }>('GET', `/api/v1/organizations/${orgId}/products?status=ALL&limit=100`, t)).data.items.map((x) => x.code);
      for (const pr of DEMO_PRODUCTS) {
        if (existing.includes(pr.code)) continue;
        await call('POST', `/api/v1/organizations/${orgId}/products`, t, { ...pr, unit: 'KG', scientific_name: 'Theobroma cacao' });
      }
    }

    // 4d) Documento DEMO (P0-018): soporte de entrega SINTÉTICO para DEMO-RV-001, subido por la API (pasa por el
    // análisis antimalware real). Idempotente por título. No es un documento real ni evidencia aprobada.
    if (passwords.has(coopAdmin)) {
      const t = await tokenOf(coopAdmin);
      const coopId = orgIds.get('coop')!;
      const title = 'Guía de entrega DEMO-RV-001 (sintética)';
      const docs = (await call<Array<{ title: string }>>('GET', `/api/v1/organizations/${coopId}/documents?document_type=DELIVERY_SUPPORT`, t)).data;
      const producer = (await call<{ items: Array<{ id: string; producer_code: string }> }>('GET', `/api/v1/organizations/${coopId}/producers?status=ALL&q=DEMO-RV-001`, t)).data.items.find((x) => x.producer_code === 'DEMO-RV-001');
      if (producer && !docs.some((d) => d.title === title)) {
        const form = new FormData();
        form.append('operation_id', randomUUID());
        form.append('document_type', 'DELIVERY_SUPPORT');
        form.append('owner_type', 'producer');
        form.append('owner_id', producer.id);
        form.append('title', title);
        form.append('issuer', 'Centro de acopio (ficticio)');
        form.append('file', new Blob([Buffer.from(['%PDF-1.4', '% Documento SINTETICO de demostracion Terra Link', '%%EOF', ''].join('\n'))], { type: 'application/pdf' }), 'guia-demo.pdf');
        const res = await fetch(`${base}/api/v1/organizations/${coopId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: form });
        if (res.status !== 201 && res.status !== 200) throw new Error(`POST documento DEMO → ${res.status}`);
      }
    }

    // 4e) Recorrido DEMO de evidencias (P0-019): documento de tenencia SINTÉTICO de DEMO-RV-002 y una
    // afirmación «Existe documentación de tenencia» con ese soporte, ENVIADA a revisión (sin verificar).
    // Idempotente: si ya existe una afirmación para ese productor, no se crea otra.
    if (passwords.has(coopAdmin)) {
      const t = await tokenOf(coopAdmin);
      const coopId = orgIds.get('coop')!;
      const producer = (await call<{ items: Array<{ id: string; producer_code: string }> }>('GET', `/api/v1/organizations/${coopId}/producers?status=ALL&q=DEMO-RV-002`, t)).data.items.find((x) => x.producer_code === 'DEMO-RV-002');
      if (producer) {
        const claims = (await call<Array<{ id: string }>>('GET', `/api/v1/organizations/${coopId}/evidence?entity_type=producer&entity_id=${producer.id}`, t)).data;
        if (claims.length === 0) {
          const title = 'Constancia de tenencia DEMO-RV-002 (sintética)';
          const docs = (await call<Array<{ id: string; title: string; versions: Array<{ id: string }> }>>('GET', `/api/v1/organizations/${coopId}/documents?document_type=LAND_TENURE`, t)).data;
          let version = docs.find((d) => d.title === title)?.versions[0]?.id;
          if (!version) {
            const form = new FormData();
            form.append('operation_id', randomUUID());
            form.append('document_type', 'LAND_TENURE');
            form.append('owner_type', 'producer');
            form.append('owner_id', producer.id);
            form.append('title', title);
            form.append('issuer', 'Junta parroquial (ficticia)');
            form.append('file', new Blob([Buffer.from(['%PDF-1.4', '% Documento SINTETICO de demostracion: tenencia', '%%EOF', ''].join(String.fromCharCode(10)))], { type: 'application/pdf' }), 'tenencia-demo.pdf');
            const res = await fetch(`${base}/api/v1/organizations/${coopId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: form });
            if (res.status !== 201 && res.status !== 200) throw new Error(`POST documento de tenencia DEMO → ${res.status}`);
            version = ((await res.json()) as { document: { versions: Array<{ id: string }> } }).document.versions[0].id;
          }
          let ev = (await call<{ evidence: { id: string; row_version: number } }>('POST', `/api/v1/organizations/${coopId}/evidence`, t, { operation_id: randomUUID(), claim_type: 'LAND_TENURE_DOCUMENTED', entity_type: 'producer', entity_id: producer.id })).data.evidence;
          ev = (await call<{ evidence: { id: string; row_version: number } }>('POST', `/api/v1/organizations/${coopId}/evidence/${ev.id}/sources`, t, { operation_id: randomUUID(), expected_version: ev.row_version, document_version_id: version, relationship: 'SUPPORTS' })).data.evidence;
          await call('POST', `/api/v1/organizations/${coopId}/evidence/${ev.id}/submit`, t, { expected_version: ev.row_version, reason: 'Recorrido DEMO: enviada a revisión' });
        }
      }
    }

    // 4f) Recorrido DEMO de entregas (P0-012) dentro de la Cooperativa: centro, una entrega con soporte y una
    // recepción parcial con muestra (calidad pendiente), una entrega sin documento ni origen con periodo
    // desconocido recibida completa, y un borrador del técnico. Datos SINTÉTICOS; sin decisiones de calidad.
    // Idempotente por la marca «DEMO-ENT» en las observaciones.
    const recEmail = `recepcion.acopio@${DOMAIN}`;
    if (passwords.has(coopAdmin) && passwords.has(recEmail)) {
      const t = await tokenOf(coopAdmin);
      const tr = await tokenOf(recEmail);
      const coopId = orgIds.get('coop')!;
      const o = `/api/v1/organizations/${coopId}`;
      const existing = (await call<Array<{ id: string; delivery_code: string }>>('GET', `${o}/deliveries?q=ENT-`, t)).data;
      const marked = existing.length ? (await Promise.all(existing.map((d) => call<{ notes: string | null }>('GET', `${o}/deliveries/${d.id}`, t)))).some((r) => r.data.notes?.includes('DEMO-ENT')) : false;
      if (!marked) {
        let centers = (await call<Array<{ id: string; code: string }>>('GET', `${o}/locations`, t)).data;
        if (!centers.some((c) => c.code === 'DEMO-CA-01')) await call('POST', `${o}/locations`, t, { code: 'DEMO-CA-01', name: 'Centro de acopio Calceta (demo)', location_type: 'COLLECTION_CENTER' });
        centers = (await call<Array<{ id: string; code: string }>>('GET', `${o}/locations`, t)).data;
        const center = centers.find((c) => c.code === 'DEMO-CA-01')!.id;
        const prods = (await call<{ items: Array<{ id: string; code: string }> }>('GET', `${o}/products?limit=100`, t)).data.items;
        const baba = prods.find((p) => p.code === 'CACAO_BABA')!.id;
        const producer = async (code: string) => (await call<{ items: Array<{ id: string; producer_code: string }> }>('GET', `${o}/producers?status=ALL&q=${code}`, t)).data.items.find((x) => x.producer_code === code)!.id;
        const p1 = await producer('DEMO-RV-001');
        const plots = (await call<{ items: Array<{ id: string; plot_code: string }> }>('GET', `${o}/plots?limit=100`, t)).data.items;
        const today = new Date().toISOString().slice(0, 10);
        // A) con origen, periodo por mes y soporte; recepción parcial con muestra durante la recepción
        const a = (await call<{ delivery: { id: string } }>('POST', `${o}/deliveries`, t, { operation_id: randomUUID(), producer_id: p1, product_id: baba, location_id: center, delivery_date: today,
          quantity_declared: '350', unit: 'KG', harvest_period: { precision: 'MONTH', start: '2026-09', end: '2026-09' }, origins: [{ plot_id: plots.find((x) => x.plot_code === 'DEMO-PAR-001')!.id }],
          notes: 'DEMO-ENT · entrega sintética con soporte', register: true })).data.delivery;
        const cands = (await call<Array<{ version_id: string; title: string; availability: string }>>('GET', `${o}/deliveries/${a.id}/support-candidates`, t)).data;
        const guide = cands.find((c) => c.title === 'Guía de entrega DEMO-RV-001 (sintética)');
        if (guide) await call('POST', `${o}/deliveries/${a.id}/supports`, t, { operation_id: randomUUID(), document_version_id: guide.version_id, support_kind: 'DELIVERY_NOTE' });
        await call('POST', `${o}/deliveries/${a.id}/receptions`, tr, { operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(),
          weighing: { method: 'Báscula de plataforma (demo)', quantity: '200', unit: 'KG', weighed_on: today },
          quality_sample: { sample_reference: 'DEMO-M-001', result: { method: 'Prueba de corte (demo)', measurements: [{ parameter: 'MOISTURE', value: '7.5', unit: '%' }] } } });
        // B) sin origen ni documento, periodo desconocido; recepción completa
        const p5 = await producer('DEMO-RV-005');
        const b = (await call<{ delivery: { id: string } }>('POST', `${o}/deliveries`, t, { operation_id: randomUUID(), producer_id: p5, product_id: baba, location_id: center, delivery_date: today,
          quantity_declared: '120', unit: 'KG', harvest_period: { precision: 'UNKNOWN' }, notes: 'DEMO-ENT · sin documento ni origen; periodo desconocido', register: true })).data.delivery;
        await call('POST', `${o}/deliveries/${b.id}/receptions`, tr, { operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(),
          weighing: { method: 'Báscula de plataforma (demo)', quantity: '120', unit: 'KG', weighed_on: today } });
        // C) borrador del técnico (sin cantidad)
        const tech = `tecnico1.cooperativa@${DOMAIN}`;
        if (passwords.has(tech)) await call('POST', `${o}/deliveries`, await tokenOf(tech), { operation_id: randomUUID(), producer_id: await producer('DEMO-RV-002'), notes: 'DEMO-ENT · borrador del técnico' });
      }
    }

    // 4g) Recorrido DEMO de lotes y procesos (P0-016) en la Cooperativa: lote con origen declarado (150 kg de la
    // recepción de ENT-2026-00001), lote «Origen incompleto» (120 kg de ENT-2026-00002), una fermentación cerrada
    // 150 → 140 + 10 kg (cifras sintéticas) y un secado iniciado cuyo cierre queda bloqueado (D-32).
    // Idempotente: solo si la Cooperativa no tiene lotes. Datos SINTÉTICOS.
    if (passwords.has(coopAdmin)) {
      const t = await tokenOf(coopAdmin);
      const coopId = orgIds.get('coop')!;
      const o = `/api/v1/organizations/${coopId}`;
      const lots = (await call<Array<{ id: string }>>('GET', `${o}/lots`, t)).data;
      if (!lots.length) {
        const opts = (await call<{ receptions: Array<{ id: string; delivery_code: string; available: string }>; products: Array<{ id: string; code: string }> }>('GET', `${o}/lot-options`, t)).data;
        const prod = (code: string) => opts.products.find((p) => p.code === code)?.id;
        const r1 = opts.receptions.find((r) => r.delivery_code === 'ENT-2026-00001');
        const r2 = opts.receptions.find((r) => r.delivery_code === 'ENT-2026-00002');
        if (r1 && r2 && prod('CACAO_FERMENTADO') && prod('CACAO_SECO')) {
          const known = (await call<{ lot: { id: string } }>('POST', `${o}/lots`, t, { operation_id: randomUUID(), inputs: [{ reception_id: r1.id, quantity: '150' }] })).data.lot;
          await call('POST', `${o}/lots`, t, { operation_id: randomUUID(), inputs: [{ reception_id: r2.id, quantity: '120' }] });
          const ferm = (await call<{ run: { id: string } }>('POST', `${o}/process-runs`, t, { operation_id: randomUUID(), process_type: 'FERMENTATION', output_product_id: prod('CACAO_FERMENTADO'), notes: 'DEMO-LOT · fermentación sintética' })).data.run;
          const startAt = new Date(Date.now() - 6 * 86_400_000).toISOString();
          await call('POST', `${o}/process-runs/${ferm.id}/start`, t, { operation_id: randomUUID(), started_at: startAt, inputs: [{ lot_id: known.id, quantity: '150' }] });
          const closed = (await call<{ run: { outputs: Array<{ lot_id: string }> } }>('POST', `${o}/process-runs/${ferm.id}/close`, t, { operation_id: randomUUID(), closed_at: new Date().toISOString(), outputs: [{ quantity: '140' }], loss_quantity: '10' })).data.run;
          const dry = (await call<{ run: { id: string } }>('POST', `${o}/process-runs`, t, { operation_id: randomUUID(), process_type: 'DRYING', output_product_id: prod('CACAO_SECO'), notes: 'DEMO-LOT · secado sintético (cierre bloqueado por D-32)' })).data.run;
          await call('POST', `${o}/process-runs/${dry.id}/start`, t, { operation_id: randomUUID(), started_at: new Date().toISOString(), inputs: [{ lot_id: closed.outputs[0].lot_id, quantity: '140' }] });
        }
      }
    }

    // 4h) Riesgo DEMO (P0-020 + D-07). Dos pasos deliberados, en este orden:
    //
    //   1. **Adoptar el catálogo `1.0.0` SOLO en la Cooperativa DEMO**, rotulado como ensayo local. Es lo que
    //      permite que la revisión por rol vea una severidad de verdad —incluido un lote CRÍTICO— en vez de un
    //      «sin clasificar» permanente. La adopción es **de esta organización**: no toca a ninguna otra, ni
    //      siquiera a las demás del propio seed, y el administrador de cada una decide la suya (D-07.1).
    //   2. Evaluar los lotes de recepciones. Sin revisión humana y sin conclusión: sigue `UNDETERMINED`.
    //
    // Lo que esto NO significa: el catálogo no está aprobado bajo ningún perfil jurídico (D-07.5), así que el
    // expediente sigue BLOCKED y nada de esto acerca a `READY` ni a un despacho.
    if (passwords.has(coopAdmin)) {
      const t = await tokenOf(coopAdmin);
      const o = `/api/v1/organizations/${orgIds.get('coop')!}`;
      const adopciones = (await call<{ adopted: boolean }>('GET', `${o}/risk/rule-sets/adoptions`, t)).data;
      if (!adopciones.adopted) {
        await call('POST', `${o}/risk/rule-sets/adoptions`, t, { operation_id: randomUUID(), rule_set_version: '1.0.0', decision: 'ADOPT',
          reason: 'Ensayo local del MVP en la Cooperativa DEMO: clasificar hallazgos para revisión por rol. No es aprobación regulatoria.' });
      }
      // Idempotente: evalúa los lotes sin evaluación y **reevalúa** los que quedaron `STALE` al adoptar el
      // catálogo. Adoptar NO recalcula nada por sí solo (D-07.4): hay que pedir la evaluación nueva, y esa crea un
      // registro aparte sin tocar el anterior. Sin este paso, un DEMO ya sembrado nunca mostraría una severidad.
      const risk = (await call<Array<{ lot_id: string; lot_code: string; evaluation_id: string | null; freshness: string | null }>>('GET', `${o}/risk/lots`, t)).data;
      for (const r of risk.filter((x) => (!x.evaluation_id || x.freshness === 'STALE') && ['LOT-2026-00001', 'LOT-2026-00002'].includes(x.lot_code))) {
        await call('POST', `${o}/risk/lots/${r.lot_id}/evaluations`, t, { operation_id: randomUUID() });
      }
    }

    // 4i) Mitigación DEMO (P0-021): para la causa «origen faltante» de LOT-2026-00002, creada por la administración y asignada a
    // la administración (responsable que aportará el soporte). Queda ABIERTA: sin entregas ni decisiones (no se simula
    // la resolución de la causa). Idempotente: solo si el lote no tiene mitigaciones.
    if (passwords.has(coopAdmin)) {
      const t = await tokenOf(coopAdmin);
      const o = `/api/v1/organizations/${orgIds.get('coop')!}`;
      const lot2 = (await call<Array<{ lot_id: string; lot_code: string; evaluation_id: string | null }>>('GET', `${o}/risk/lots`, t)).data.find((x) => x.lot_code === 'LOT-2026-00002');
      if (lot2?.evaluation_id) {
        const existing = (await call<unknown[]>('GET', `${o}/mitigations?lot_id=${lot2.lot_id}`, t)).data;
        if (!existing.length) {
          const opts = (await call<{ assignees: Array<{ membership_id: string; name: string }> }>('GET', `${o}/mitigation-options?evaluation_id=${lot2.evaluation_id}`, t)).data;
          const assignee = opts.assignees.find((a) => a.name.includes('demo'));
          if (assignee) await call('POST', `${o}/mitigations`, t, { operation_id: randomUUID(), evaluation_id: lot2.evaluation_id, factor_code: 'DATA_MISSING_ORIGIN', title: 'Completar el origen de ENT-2026-00002 (DEMO)',
            acceptance_criteria: 'Parcela de origen identificada con un soporte vigente y disponible (DEMO)', assignee_membership_id: assignee.membership_id, due_date: '2026-12-31' });
        }
      }
    }

    // 4j) Expediente DEMO (P0-022) de LOT-2026-00002 con una instantánea: queda BLOCKED (catálogo de riesgo sin
    // aprobación bajo perfil jurídico aunque esté adoptado, conclusión UNDETERMINED, perfil jurídico/D-05/satélite/embarques no evaluables). No se revisa, aprueba ni exporta en el
    // seed; no se inventan datos para alcanzar READY. Idempotente: solo si el lote no tiene expediente.
    if (passwords.has(coopAdmin)) {
      const t = await tokenOf(coopAdmin);
      const o = `/api/v1/organizations/${orgIds.get('coop')!}`;
      const list = (await call<{ cases: Array<{ lot_code: string }>; lots_without_case: Array<{ id: string; lot_code: string }> }>('GET', `${o}/dd-cases`, t)).data;
      const lot2 = list.lots_without_case.find((l) => l.lot_code === 'LOT-2026-00002');
      if (lot2 && !list.cases.some((c) => c.lot_code === 'LOT-2026-00002')) {
        const c = (await call<{ case: { id: string } }>('POST', `${o}/dd-cases`, t, { operation_id: randomUUID(), lot_id: lot2.id, scope_note: 'Expediente DEMO de LOT-2026-00002 (datos sintéticos): preparación interna, no DDS.' })).data.case;
        await call('POST', `${o}/dd-cases/${c.id}/snapshots`, t, { operation_id: randomUUID() });
      }
    }

    // 5) Verificación: login real de cada cuenta con contraseña conocida.
    const verified = new Map<string, boolean>();
    for (const [mail, pwd] of passwords) {
      const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mail, password: pwd }) });
      verified.set(mail, res.status === 200);
    }

    // 6) CREDENCIALES.csv: una fila por usuario + organización + rol.
    const lines: string[][] = [];
    for (const u of USERS) {
      const mail = email(u);
      const pwd = passwords.get(mail) ?? '';
      const estado = withoutCredential.has(mail) && !pwd ? 'SIN_CREDENCIAL_CONOCIDA (cuenta previa; no se resetea)'
        : verified.get(mail) ? 'LOGIN_VERIFICADO' : 'FALLO_LOGIN';
      const name = `${u.first} ${u.last}`;
      if (u.platform) {
        lines.push([name, mail, pwd, 'SUPER_ADMIN', '(plataforma)', '—', 'administración de plataforma', 'NO', 'SI', WEB_URL, estado, u.note ?? '']);
        continue;
      }
      for (const m of u.memberships) {
        const o = ORGS.find((x) => x.key === m.org)!;
        lines.push([name, mail, pwd, `${m.role} (${ROLE_ES[m.role]})`, o.name, `${o.type} (${o.typeLabel})`, o.profile,
          m.role === 'ORG_ADMIN' ? 'SI' : 'NO', 'NO', WEB_URL, estado, m.note ?? u.note ?? '']);
      }
    }
    const csv = '﻿' + [HEADER, ...lines].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
    const current = existsSync(CSV_PATH) ? readFileSync(CSV_PATH, 'utf8') : null;
    if (current !== csv) {
      try {
        writeFileSync(CSV_PATH, csv, { encoding: 'utf8' });
      } catch (err) {
        // Archivo abierto en otro programa (p. ej. Excel): no se pierden credenciales nuevas.
        const pending = resolve(CRED_DIR, 'CREDENCIALES.pendiente.csv');
        // Si el pendiente ya tiene exactamente este contenido, no se reescribe (puede estar abierto en Excel).
        const pendingCurrent = existsSync(pending) ? readFileSync(pending, 'utf8') : null;
        try {
          if (pendingCurrent !== csv) writeFileSync(pending, csv, { encoding: 'utf8' });
        } catch {
          console.error('CREDENCIALES.pendiente.csv también está abierto: las contraseñas no cambiaron; solo cambian las filas de membresías.');
        }
        console.error(`No se pudo escribir CREDENCIALES.csv (${(err as NodeJS.ErrnoException).code ?? 'error'}): ciérralo y renombra CREDENCIALES.pendiente.csv.`);
        process.exitCode = 1;
      }
    }

    const ok = [...verified.values()].filter(Boolean).length;
    console.log(`Seed DEMO listo: ${ORGS.length} organizaciones, ${PLOTS.length} parcelas DEMO definidas, ${USERS.length} cuentas, ${lines.length} filas en CREDENCIALES.csv; login verificado ${ok}/${verified.size}; sin credencial conocida: ${withoutCredential.size}.`);
    if (ok !== verified.size) process.exitCode = 1;
  } finally {
    await app.close();
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('Fallo del seed DEMO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
