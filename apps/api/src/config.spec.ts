import { validateProductionTransport } from './config';

describe('transporte de producción', () => {
  it('exige HTTPS para web y almacenamiento, y proxy confiable', () => {
    expect(() => validateProductionTransport({ NODE_ENV: 'production' }, 'http://web.example', 'https://objects.example', 1)).toThrow('WEB_ORIGIN');
    expect(() => validateProductionTransport({ NODE_ENV: 'production' }, 'https://web.example', 'http://objects.example', 1)).toThrow('S3_ENDPOINT');
    expect(() => validateProductionTransport({ NODE_ENV: 'production' }, 'https://web.example', 'https://objects.example', 6)).toThrow('TRUST_PROXY_HOPS');
  });

  it('mantiene HTTP permitido fuera de producción y acepta transporte seguro en producción', () => {
    expect(() => validateProductionTransport({ NODE_ENV: 'test' }, 'http://localhost:3000', 'http://localhost:9000', 0)).not.toThrow();
    expect(() => validateProductionTransport({ NODE_ENV: 'production' }, 'https://web.example', 'https://objects.example', 0)).not.toThrow();
  });

  it('mantiene compatibilidad explícita de TRUST_PROXY antiguo', () => {
    expect(() => validateProductionTransport({ NODE_ENV: 'production' }, 'https://web.example', 'https://objects.example', 1)).not.toThrow();
  });
});
