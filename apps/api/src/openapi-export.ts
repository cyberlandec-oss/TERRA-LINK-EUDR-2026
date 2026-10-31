import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { buildOpenApi, createApp } from './bootstrap';
import { loadConfig } from './config';
import { createDb } from './db/database';

// Genera apps/api/openapi.json desde los controladores reales y lo VALIDA contra la especificación
// OpenAPI (estructura, referencias y esquemas). Falla con código 1 si el documento no es válido.
// Solo herramienta de desarrollo: no se carga en tiempo de ejecución de la API.
async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const app = await createApp(config, db);
  await app.init();
  const out = resolve(__dirname, '..', 'openapi.json');
  const doc = buildOpenApi(app);
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  await app.close();
  await db.destroy();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SwaggerParser = require('@apidevtools/swagger-parser');
  await SwaggerParser.validate(JSON.parse(JSON.stringify(doc)));
  console.log(`OpenAPI escrito y validado en ${out} (${Object.keys(doc.paths).length} rutas)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
