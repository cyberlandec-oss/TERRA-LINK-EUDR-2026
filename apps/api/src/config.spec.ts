import { validateProductionTransport } from './config';

describe('transporte de producción', () => {
  it('exige HTTPS para web y almacenamiento, y proxy confiable', () => {
    expect(() => validateProductionTransport({ NODE_ENV: 'production' }, 'http://web.example', 'https://objects.example', true)).toThrow('WEB_ORIGIN');
    expect(() => validateProductionTransport({ NODE_ENV: 'production' }, 'https://web.example', 'http://objects.example', true)).toThrow('S3_ENDPOINT');
    expect(() => validateProductionTransport({ NODE_ENV: 'production' }, 'https://web.example', 'https://objects.example', false)).toThrow('TRUST_PROXY');
  });

  it('mantiene HTTP permitido fuera de producción y acepta transporte seguro en producción', () => {
    expect(() => validateProductionTransport({ NODE_ENV: 'test' }, 'http://localhost:3000', 'http://localhost:9000', false)).not.toThrow();
    expect(() => validateProductionTransport({ NODE_ENV: 'production' }, 'https://web.example', 'https://objects.example', true)).not.toThrow();
  });
});
