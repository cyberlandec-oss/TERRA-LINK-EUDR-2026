// Ejecuta un único encargo satelital QA. Nunca usa el DATABASE_URL operativo ni procesa un lote.
// Requiere un plot_code QA y un trabajo ya creado por la API con autorización vigente.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';

const plotCode = process.argv[2];
if (!plotCode) throw new Error('Uso: node scripts/run-satellite-qa-once.mjs <plot_code>');

function envFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/u, '$2');
  }
  return out;
}

const base = envFile(resolve('.env'));
const secretPath = resolve(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.terra-link', 'secrets', 'whisp.env');
const secret = envFile(secretPath);
if (!base.DATABASE_URL) throw new Error('Falta DATABASE_URL en .env');
if (!secret.WHISP_API_KEY?.trim()) throw new Error('Falta WHISP_API_KEY en el archivo externo protegido');
const qaUrl = new URL(base.DATABASE_URL);
qaUrl.pathname = '/terra_link_e2e';
const db = new Client({ connectionString: qaUrl.toString() });
await db.connect();
try {
  const plot = await db.query('select id from plots where plot_code = $1', [plotCode]);
  if (plot.rows.length !== 1) throw new Error(`PLOT_NOT_FOUND_OR_AMBIGUOUS:${plot.rows.length}`);
  const jobs = await db.query(`
    select id, status, provider_code from satellite_jobs
    where plot_id = $1 and status in ('REQUESTED', 'RUNNING')
    order by requested_at desc`, [plot.rows[0].id]);
  if (jobs.rows.length !== 1) throw new Error(`SATELLITE_JOB_NOT_UNIQUE:${jobs.rows.length}`);
  if (jobs.rows[0].provider_code !== 'WHISP') throw new Error(`UNEXPECTED_PROVIDER:${jobs.rows[0].provider_code}`);
  console.log(`QA_JOB_SELECTED plot=${plotCode} job=${jobs.rows[0].id} provider=WHISP`);
  const child = spawn(process.execPath, [resolve('apps/api/dist/worker-main.js')], {
    env: {
      ...process.env, ...base, ...secret,
      DATABASE_URL: qaUrl.toString(),
      S3_BUCKET: base.S3_BUCKET?.includes('private') ? 'terra-link-e2e' : base.S3_BUCKET,
      SATELLITE_LIVE_CALLS: 'enabled',
      SATELLITE_ONCE: 'true',
      SATELLITE_JOB_ID: jobs.rows[0].id,
      ALLOW_LEGACY_CREDENTIAL_FALLBACK: 'false',
    },
    stdio: 'inherit',
  });
  const code = await new Promise((resolveCode) => child.on('close', resolveCode));
  process.exitCode = code ?? 1;
} finally {
  await db.end();
}
