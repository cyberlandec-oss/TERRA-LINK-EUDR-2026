import { AuditService } from '../audit/audit.service';
import { PiiCipher, parsePiiConfig } from '../crypto/pii';
import { createDb } from '../db/database';
import { EudrIsService } from './eudr-is';
import type { Environment } from './echo';

// Cargador LOCAL de credenciales de EUDR-IS desde el archivo privado `.env` (se invoca con `npm run eudr-is:cargar -w apps/api -- --org <uuid> --env ACCEPTANCE`).
//   · Exige organización Y entorno EXPLÍCITOS: no hay organización por defecto ni se asocia nada al DEMO.
//   · Variables (vacías hasta que las completes localmente; nunca se versionan ni se escriben en el chat):
//       EUDR_IS_ACCEPTANCE_USERNAME · EUDR_IS_ACCEPTANCE_AUTH_KEY · EUDR_IS_ACCEPTANCE_CLIENT_ID
//       EUDR_IS_PRODUCTION_USERNAME · EUDR_IS_PRODUCTION_AUTH_KEY · EUDR_IS_PRODUCTION_CLIENT_ID
//     Las de un entorno NO se reutilizan para el otro.
//   · Cifra con el mismo mecanismo de datos personales (PII_KEYS) y guarda cifrado. Solo informa «credencial registrada/rotada» o un error redactado: nunca imprime un valor.
//   · No contacta con ningún servicio externo. Registrar no activa llamadas (EUDR_IS_LIVE_CALLS).
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const fail = (m: string): never => { console.error(`ERROR: ${m}`); process.exit(1); };

async function main(): Promise<void> {
  const org = arg('--org');
  const env = arg('--env');
  if (!org || !/^[0-9a-f-]{36}$/i.test(org)) fail('Indica la organización con --org <uuid>. No hay organización por defecto.');
  if (env !== 'ACCEPTANCE' && env !== 'PRODUCTION') fail('Indica el entorno con --env ACCEPTANCE o --env PRODUCTION. No se reutilizan entre entornos.');
  const environment = env as Environment;
  const prefix = `EUDR_IS_${environment}_`;
  const username = process.env[`${prefix}USERNAME`]?.trim();
  const authenticationKey = process.env[`${prefix}AUTH_KEY`]?.trim();
  const clientId = process.env[`${prefix}CLIENT_ID`]?.trim();
  const faltan = ['USERNAME', 'AUTH_KEY', 'CLIENT_ID'].filter((k) => !process.env[`${prefix}${k}`]?.trim());
  if (faltan.length) fail(`Faltan valores en el archivo .env: ${faltan.map((k) => `${prefix}${k}`).join(', ')}. Complétalos localmente y vuelve a ejecutar.`);
  const url = process.env.DATABASE_URL;
  if (!url) fail('Falta DATABASE_URL.');
  let cfg;
  try { cfg = parsePiiConfig(process.env); } catch { cfg = null; }
  if (!cfg) fail('Faltan las claves de cifrado (PII_KEYS, PII_ACTIVE_KEY_ID, PII_INDEX_KEY): no se guarda nada sin cifrar.');

  const db = createDb(url as string);
  try {
    const o = await db.selectFrom('organizations').select(['id', 'name']).where('id', '=', org as string).executeTakeFirst();
    if (!o) fail('La organización indicada no existe. No se crea ni se deduce ninguna.');
    const service = new EudrIsService(db, null as never, new AuditService(), new PiiCipher(cfg!));
    const prior = await db.selectFrom('eudr_is_credentials').select('environment').where('organization_id', '=', org as string).where('environment', '=', environment).executeTakeFirst();
    await service.store(org as string, environment, { username: username as string, authenticationKey: authenticationKey as string, clientId: clientId as string }, 'CLI', null);
    console.log(`Credencial ${prior ? 'rotada' : 'registrada'}: organización «${o!.name}», entorno ${environment}. No se mostró ningún valor y no se contactó ningún servicio.`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    fail(`No se pudo registrar la credencial${code ? ` (${code})` : ''}.`);
  } finally {
    await db.destroy();
  }
}

void main();
