import { readFileSync } from 'fs';
import { join } from 'path';

// QA de seguridad (docs/16 «exposición de servicios»): los servicios de DATOS del entorno local (PostgreSQL, Redis sin contraseña y el almacenamiento S3 con clave raíz) solo se
// publican en el bucle local. Que un puerto quede en todas las interfaces los expone a la red del equipo. La API y la web siguen accesibles por el navegador y por `adb reverse`.
const compose = readFileSync(join(__dirname, '..', '..', '..', 'docker-compose.yml'), 'utf8');
const puertosPublicados = (servicio: string, texto = compose): string[] => {
  const bloque = texto.split(/\n  (?=[a-z0-9-]+:\n)/).find((b) => b.startsWith(`${servicio}:`)) ?? '';
  return [...bloque.matchAll(/ports:\s*\[([^\]]*)\]/g)].flatMap((m) => m[1].split(',').map((p) => p.trim().replace(/^"|"$/g, '')));
};

describe('exposición de servicios de datos en docker-compose.yml', () => {
  for (const servicio of ['postgres', 'redis', 'object-storage', 'scanner']) {
    it(`${servicio} solo publica puertos en 127.0.0.1`, () => {
      const puertos = puertosPublicados(servicio);
      expect(puertos.length).toBeGreaterThan(0); // control: el servicio existe y publica algo
      for (const p of puertos) expect(p.startsWith('127.0.0.1:')).toBe(true);
    });
  }

  it('el análisis detecta un puerto abierto a todas las interfaces (sensibilidad, con un compose sintético)', () => {
    const sintetico = ['services:', '  redis:', '    ports: ["6379:6379"]', '  otro:', '    ports: ["127.0.0.1:1:1"]', ''].join('\n');
    expect(puertosPublicados('redis', sintetico).every((p) => p.startsWith('127.0.0.1:'))).toBe(false);
    expect(puertosPublicados('otro', sintetico).every((p) => p.startsWith('127.0.0.1:'))).toBe(true);
  });
});
