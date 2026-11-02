import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Utilidad de consulta segura (`e2e/review/consulta-api.mjs`). Se prueba con credenciales FICTICIAS, en un
// directorio temporal: ninguna cuenta real interviene. Lo que se fija aquí es lo que provocó la incidencia —
// que una contraseña acabe en la salida— y la regla de qué archivo manda cuando hay dos.
//
// No abre navegador ni toca la API: es lógica pura del lector de credenciales.
interface Util {
  archivoVigente(dir?: string): string;
  cuentaDemo(local: string, dir?: string): { email: string; contrasena: string; rol: string; organizacion: string };
  sanear<T>(valor: T): T;
  permitir(valor: unknown, campos: string[]): unknown;
}
let util: Util;
test.beforeAll(async () => { util = (await import('../review/consulta-api.mjs')) as unknown as Util; });

const CABECERA = 'nombre_usuario,email,contrasena,rol,organizacion,tipo_organizacion,perfil_cadena,es_admin_empresa,es_admin_plataforma,url_acceso,estado_acceso,observaciones';
const fila = (local: string, pwd: string, rol = 'ORG_ADMIN (Administración)') =>
  `Ficticio ${local},${local}@ficticio.invalid,${pwd},${rol},ORG FICTICIA,COOPERATIVE (Cooperativa),acopio,SI,NO,http://localhost:3000,LOGIN_VERIFICADO,`;

function escenario(principal: string[], pendiente?: string[], pendienteMasNuevo = true) {
  const dir = mkdtempSync(join(tmpdir(), 'tl-cred-'));
  writeFileSync(join(dir, 'CREDENCIALES.csv'), `﻿${[CABECERA, ...principal].join('\r\n')}\r\n`);
  if (pendiente) {
    const p = join(dir, 'CREDENCIALES.pendiente.csv');
    writeFileSync(p, `﻿${[CABECERA, ...pendiente].join('\r\n')}\r\n`);
    // Fechas explícitas: la prueba no debe depender de la resolución del reloj del sistema de archivos.
    const viejo = new Date(Date.now() - 60_000);
    const nuevo = new Date();
    utimesSync(join(dir, 'CREDENCIALES.csv'), pendienteMasNuevo ? viejo : nuevo, pendienteMasNuevo ? viejo : nuevo);
    utimesSync(p, pendienteMasNuevo ? nuevo : viejo, pendienteMasNuevo ? nuevo : viejo);
  }
  return dir;
}

test('la consulta publica cuenta, organización y rol, y nunca la contraseña', async () => {
  const dir = escenario([fila('ficticia.uno', 'NoDebeSalir-0000000000')]);
  const cuenta = util.cuentaDemo('ficticia.uno', dir);
  // La utilidad SÍ lee la contraseña —la necesita para autenticar—, pero lo que se publica no la lleva.
  expect(cuenta.contrasena).toBe('NoDebeSalir-0000000000');
  const publicado = {
    cuenta: cuenta.email.split('@')[0],
    organizacion: cuenta.organizacion,
    rol: cuenta.rol,
    resultado: util.sanear({ code: 'risk_critical', value: '1', contrasena: cuenta.contrasena, access_token: 'jwt-ficticio' }),
  };
  const texto = JSON.stringify(publicado);
  expect(texto).not.toContain('NoDebeSalir-0000000000');
  expect(texto).not.toContain('jwt-ficticio');
  expect(publicado).toMatchObject({ cuenta: 'ficticia.uno', organizacion: 'ORG FICTICIA', rol: 'ORG_ADMIN (Administración)' });
  expect(publicado.resultado).toEqual({ code: 'risk_critical', value: '1' });
});

test('el saneado quita claves sensibles a cualquier profundidad, incluso dentro de listas', async () => {
  const salida = util.sanear([{ lote: 'L-1', interno: { token: 'jwt-ficticio', password: 'x', estado: 'OK' } }]);
  expect(salida).toEqual([{ lote: 'L-1', interno: { estado: 'OK' } }]);
  expect(JSON.stringify(salida)).not.toMatch(/jwt-ficticio|password/);
});

test('manda el archivo más reciente: un CREDENCIALES.csv bloqueado y atrasado no impone una credencial muerta', async () => {
  const dir = escenario(
    [fila('ficticia.dos', 'Antigua-1111111111')],
    [fila('ficticia.dos', 'Vigente-2222222222')],
  );
  expect(util.archivoVigente(dir)).toContain('CREDENCIALES.pendiente.csv');
  expect(util.cuentaDemo('ficticia.dos', dir).contrasena).toBe('Vigente-2222222222');

  // Y al revés: si el principal es el más reciente, manda él.
  const dir2 = escenario(
    [fila('ficticia.dos', 'Vigente-3333333333')],
    [fila('ficticia.dos', 'Antigua-4444444444')],
    false,
  );
  expect(util.archivoVigente(dir2)).toContain('CREDENCIALES.csv');
  expect(util.cuentaDemo('ficticia.dos', dir2).contrasena).toBe('Vigente-3333333333');
});

test('una cuenta sin credencial conocida se rechaza en vez de consultarse a ciegas', async () => {
  const dir = escenario([fila('ficticia.tres', '')]);
  expect(() => util.cuentaDemo('ficticia.tres', dir)).toThrow(/no tiene credencial conocida/);
  expect(() => util.cuentaDemo('no.existe', dir)).toThrow(/no está en el archivo/);
});

// ---------------------------------------------------------------- lista de permitidos
// Lo que de verdad protege la salida. Una lista negra solo detiene lo que alguien se acordó de prohibir; estas
// pruebas usan secretos FICTICIOS en campos que nadie habría pensado en prohibir.

test('un campo nuevo e inesperado no se publica, aunque su nombre sea inocente', async () => {
  const respuesta = [{
    code: 'risk_critical', status: 'OK', value: '1',
    // Campos que la API podría empezar a devolver mañana. Ninguno está en la lista de permitidos.
    nota_interna: 'SECRETO-FICTICIO-aaa111',
    debug: 'SECRETO-FICTICIO-bbb222',
    conexion: 'postgres://usuario:SECRETO-FICTICIO-ccc333@host/base',
    x_request_context: 'SECRETO-FICTICIO-ddd444',
  }];
  const salida = util.permitir(respuesta, ['code', 'status', 'value']);
  expect(salida).toEqual([{ code: 'risk_critical', status: 'OK', value: '1' }]);
  expect(JSON.stringify(salida)).not.toMatch(/SECRETO-FICTICIO/);
});

test('un campo permitido que deja de ser escalar no cuela su contenido', async () => {
  // `status` era texto; una versión nueva lo devuelve como objeto con detalle interno.
  const respuesta = { code: 'x', status: { valor: 'OK', traza: 'SECRETO-FICTICIO-eee555', token: 'jwt-ficticio' } };
  const salida = util.permitir(respuesta, ['code', 'status']) as Record<string, unknown>;
  expect(salida.code).toBe('x');
  expect(salida.status).toBe('[omitido: no escalar]');
  expect(JSON.stringify(salida)).not.toMatch(/SECRETO-FICTICIO|jwt-ficticio/);
});

test('secretos anidados en listas dentro de objetos tampoco salen', async () => {
  const respuesta = {
    name: 'ORG FICTICIA', organization_type: 'COOPERATIVE',
    miembros: [{ email: 'alguien@ficticio.invalid', contrasena: 'SECRETO-FICTICIO-fff666' }],
    config: { interno: { api_key: 'SECRETO-FICTICIO-ggg777' } },
  };
  const salida = util.permitir(respuesta, ['name', 'organization_type']);
  expect(salida).toEqual({ name: 'ORG FICTICIA', organization_type: 'COOPERATIVE' });
  expect(JSON.stringify(salida)).not.toMatch(/SECRETO-FICTICIO|ficticio\.invalid/);
});

test('la segunda barrera actúa aunque alguien amplíe la lista de permitidos por error', async () => {
  // Alguien añade `password_hash` y `document_number` a la lista «para depurar». No se publican igualmente.
  const respuesta = { lot_code: 'L-1', password_hash: 'SECRETO-FICTICIO-hhh888', document_number: '0000000000', phone_enc: 'v1.k1.xxx' };
  const salida = util.permitir(respuesta, ['lot_code', 'password_hash', 'document_number', 'phone_enc']);
  expect(salida).toEqual({ lot_code: 'L-1' });
  expect(JSON.stringify(salida)).not.toMatch(/SECRETO-FICTICIO|0000000000|v1\.k1/);
});

test('los campos ausentes no se inventan y el orden lo fija la lista, no la respuesta', async () => {
  const salida = util.permitir({ value: '1', code: 'x' }, ['code', 'status', 'value']) as Record<string, unknown>;
  expect(Object.keys(salida)).toEqual(['code', 'value']); // `status` falta: no aparece como null
  expect(salida).toEqual({ code: 'x', value: '1' });
});

test('un error de consulta dice ruta y código, y nada más', async () => {
  const mod = (await import('../review/consulta-api.mjs')) as unknown as Util & { consultar(o: unknown): Promise<unknown> };
  const dir = escenario([fila('ficticia.cuatro', 'NoDebeSalir-9999999999')]);
  // Puerto cerrado: el fallo ocurre antes de cualquier respuesta. El mensaje no debe llevar la credencial.
  await expect(mod.consultar({ cuenta: 'ficticia.cuatro', consulta: 'organizaciones', base: 'http://127.0.0.1:1', dir }))
    .rejects.toThrow(/.*/);
  await mod.consultar({ cuenta: 'ficticia.cuatro', consulta: 'organizaciones', base: 'http://127.0.0.1:1', dir })
    .catch((e: Error) => {
      expect(e.message).not.toMatch(/NoDebeSalir-9999999999/);
      expect(e.message).not.toMatch(/ficticia\.cuatro@/);
    });
});
