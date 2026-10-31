import { corsOrigins } from './cors-origins';

describe('orígenes CORS admitidos', () => {
  it('con una web local admite los tres alias de loopback del mismo puerto y protocolo, y nada más', () => {
    expect(corsOrigins('http://localhost:3000')).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']);
    expect(corsOrigins('http://127.0.0.1:3000/')).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']);
    expect(corsOrigins('http://[::1]:3100')).toEqual(['http://localhost:3100', 'http://127.0.0.1:3100', 'http://[::1]:3100']);
  });
  it('con un dominio real admite únicamente ese origen (sin ampliar ni comodín)', () => {
    expect(corsOrigins('https://app.terralink.example')).toEqual(['https://app.terralink.example']);
    expect(corsOrigins('https://app.terralink.example:8443/')).toEqual(['https://app.terralink.example:8443']);
    expect(corsOrigins('https://192.168.1.20:3000')).toEqual(['https://192.168.1.20:3000']); // una IP de red NO se amplía
    expect(corsOrigins('no es url')).toEqual(['no es url']);
    for (const o of [...corsOrigins('http://localhost:3000'), ...corsOrigins('https://x.example')]) expect(o).not.toContain('*');
  });
});
