import { validateServerUrl, SERVER_URL_HELP } from '../server-url';

describe('validación de la URL del servidor', () => {
  it('acepta la API local por HTTP y servidores HTTPS', () => {
    expect(validateServerUrl('http://localhost:4000')).toEqual({ ok: true, url: 'http://localhost:4000' });
    expect(validateServerUrl(' http://127.0.0.1:4000/ ')).toEqual({ ok: true, url: 'http://127.0.0.1:4000' });
    expect(validateServerUrl('https://api.ejemplo.ec')).toMatchObject({ ok: true });
  });
  it('rechaza texto que no es URL (p. ej. una contraseña tecleada por error) sin reproducirlo', () => {
    const secret = 'Demo-NoEsUnaUrlSintetica';
    const r = validateServerUrl(secret);
    expect(r).toEqual({ ok: false, reason: 'FORMAT' });
    expect(JSON.stringify(r) + SERVER_URL_HELP).not.toContain(secret);
  });
  it('rechaza HTTP hacia otros hosts, credenciales embebidas, espacios y puertos inválidos', () => {
    expect(validateServerUrl('http://192.168.1.20:4000')).toEqual({ ok: false, reason: 'INSECURE' });
    expect(validateServerUrl('http://usuario:clave@localhost:4000')).toEqual({ ok: false, reason: 'CREDENTIALS' });
    expect(validateServerUrl('http://local host:4000')).toEqual({ ok: false, reason: 'FORMAT' });
    expect(validateServerUrl('http://localhost:70000')).toEqual({ ok: false, reason: 'PORT' });
    expect(validateServerUrl('ftp://localhost')).toEqual({ ok: false, reason: 'FORMAT' });
  });
});
