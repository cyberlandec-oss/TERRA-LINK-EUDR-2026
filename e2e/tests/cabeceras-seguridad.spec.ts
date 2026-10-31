import { expect, test } from '@playwright/test';
import { API_URL } from '../env';

// QA de seguridad: cabeceras básicas de la web y de la API. No toca datos: solo lee respuestas.
test('la web envía las cabeceras de seguridad básicas y no revela el framework', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200); // control: la página responde
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('geolocation=(self)');
  expect(h['x-powered-by']).toBeUndefined();
});

test('la API envía nosniff y no revela el framework', async ({ request }) => {
  const res = await request.get(`${API_URL}/health/live`);
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-powered-by']).toBeUndefined();
});
