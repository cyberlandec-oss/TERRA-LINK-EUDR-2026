import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { EncryptionRequiredError } from '../core/ports';
import { LocalStore } from '../core/store';
import { cleanupCacheTemps, expoPlatform, expoUploader, runtimeEnvironment } from './expo';

// Autoprueba de seguridad EN EL DISPOSITIVO (build nativo, emulador o teléfono). Se ejecuta desde «Diagnóstico» o con
// `adb shell am start -a android.intent.action.VIEW -d "terralinkcampo://autoprueba"`. Escribe una línea
// `TL_SELFTEST {json}` en el registro (visible con `adb logcat`). Usa una base temporal propia; no toca datos de cuentas.
// Distinguir en la evidencia: resultado en emulador ≠ resultado en teléfono físico.

export interface SelfTestCase { id: string; ok: boolean; detail: string }

const hex = (n: number) => Array.from(Crypto.getRandomBytes(n)).map((b) => b.toString(16).padStart(2, '0')).join('');

export async function runSelfTest(): Promise<{ environment: string; ok: boolean; cases: SelfTestCase[] }> {
  const cases: SelfTestCase[] = [];
  const add = (id: string, ok: boolean, detail: string) => cases.push({ id, ok, detail });
  const name = `tl-selftest-${hex(4)}.db`;
  const key = hex(32);
  const step = async (id: string, fn: () => Promise<[boolean, string]>) => { try { const [ok, d] = await fn(); add(id, ok, d); } catch (e) { add(id, false, `excepción: ${(e as Error).message.slice(0, 160)}`); } };
  const dir = String(SQLite.defaultDatabaseDirectory);
  const dbFile = () => new File(dir.startsWith('file://') ? dir : `file://${dir}`, name);
  // 1) SQLCipher activo y datos escritos con clave
  await step('sqlcipher_activo', async () => {
    const db = await SQLite.openDatabaseAsync(name);
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
    const v = await db.getFirstAsync<{ cipher_version?: string }>('PRAGMA cipher_version').catch(() => null);
    await db.execAsync("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('dato-sintetico-autoprueba');");
    await db.closeAsync();
    return [!!v?.cipher_version, v?.cipher_version ? `cipher_version=${v.cipher_version}` : 'PRAGMA cipher_version vacío: la base NO está cifrada'];
  });
  // 2) Archivo en disco: sin cabecera SQLite en claro y sin el texto escrito
  await step('archivo_cifrado', async () => {
    const bytes = await dbFile().bytes();
    const plain = String.fromCharCode(...Array.from(bytes.subarray(0, 15))) === 'SQLite format 3';
    return [bytes.length > 0 && !plain, plain ? 'El archivo empieza con «SQLite format 3»: está en claro' : `Cabecera no legible en claro (${bytes.length} bytes)`];
  });
  await step('contenido_no_legible', async () => {
    const contains = Array.from(await dbFile().bytes(), (c) => String.fromCharCode(c)).join('').includes('dato-sintetico-autoprueba');
    return [!contains, contains ? 'El texto escrito aparece en claro en el archivo' : 'El texto escrito no aparece en el archivo'];
  });
  // 3) Clave incorrecta: fallo cerrado de SQLite (no devuelve datos)
  await step('clave_incorrecta_falla', async () => {
    const wrong = await SQLite.openDatabaseAsync(name);
    await wrong.execAsync(`PRAGMA key = "x'${hex(32)}'"`);
    const r = await wrong.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM t').then(() => 'leyó datos').catch((e: Error) => `error: ${e.message.slice(0, 80)}`);
    await wrong.closeAsync().catch(() => undefined);
    return [r.startsWith('error'), r];
  });
  // 4) Clave correcta vuelve a leer
  await step('clave_correcta_lee', async () => {
    const right = await SQLite.openDatabaseAsync(name);
    await right.execAsync(`PRAGMA key = "x'${key}'"`);
    const n = (await right.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM t'))?.n;
    await right.closeAsync();
    return [n === 1, `filas=${n}`];
  });
  await SQLite.deleteDatabaseAsync(name).catch(() => undefined);
  // 4b) Almacén real con transacciones sobre la base cifrada (migraciones + escritura transaccional)
  await step('almacen_cifrado_transaccional', async () => {
    const key = `selftest-tx-${hex(4)}`;
    const st = await LocalStore.open(expoPlatform, key);
    await st.replaceDataset([{ id: '00000000-0000-4000-8000-000000000001', plot_code: 'AUTO-1', name: null, row_version: 1, status: 'ACTIVE', producer_id: '00000000-0000-4000-8000-0000000000a1', producer_code: null, producer_display_name: null, geometry_status: null }]);
    const n = (await st.plots()).length;
    const enc = st.encrypted;
    await st.close();
    await SQLite.deleteDatabaseAsync(`tl-${key}.db`).catch(() => undefined);
    return [n === 1 && enc, `transacción confirmada; parcelas=${n}; cifrado=${enc}`];
  });
  // 5) Lógica de fallo cerrado de la app en este runtime: un almacén que reporta base sin cifrar no se abre
  const fakeNone = { ...expoPlatform, environment: 'NATIVE_BUILD' as const, openDb: async (dbName: string) => ({ ...(await expoPlatform.openDb(dbName)), cipher: async () => 'NONE' as const }) };
  const r = await LocalStore.open(fakeNone, `selftest-${hex(4)}`).then(async (s) => { await s.close(); return 'abrió'; }).catch((e) => (e instanceof EncryptionRequiredError ? 'rechazado' : `otro error: ${(e as Error).message}`));
  add('app_rechaza_sin_cifrado', r === 'rechazado', `almacén con base sin cifrar → ${r} (simulado sobre el runtime real)`);
  // 6) Copia temporal de subida: se borra tras un fallo de red
  const before = Paths.cache.list().filter((e) => e.name.startsWith('tl-upload-')).length;
  const up = await expoUploader('http://127.0.0.1:9/autoprueba', new Uint8Array([1, 2, 3]), 'image/jpeg', {}, {}).then(() => 'respondió').catch(() => 'falló');
  const after = Paths.cache.list().filter((e) => e.name.startsWith('tl-upload-')).length;
  add('temporal_subida_limpia_tras_fallo', up === 'falló' && after === before, `subida ${up}; temporales antes=${before} después=${after}`);
  // 7) Recuperación tras interrupción: un temporal huérfano se borra al iniciar
  const orphan = new File(Paths.cache, `tl-upload-autoprueba-${hex(4)}`);
  orphan.create({ overwrite: true }); orphan.write(new Uint8Array([9]));
  const removed = cleanupCacheTemps();
  add('temporal_huerfano_eliminado', !orphan.exists && removed >= 1, `eliminados=${removed}`);
  const result = { environment: runtimeEnvironment, ok: cases.every((c) => c.ok), cases };
  console.log(`TL_SELFTEST ${JSON.stringify(result)}`);
  return result;
}
