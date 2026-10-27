import { defineConfig, devices } from '@playwright/test';
import { API_PORT, API_URL, E2E_DATABASE_URL, WEB_PORT, WEB_URL } from './env';

// E2E en navegador real (Chromium) contra API y web compiladas, con base y puertos propios.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure', locale: 'es-EC' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --env-file-if-exists=../../.env dist/main.js',
      cwd: '../apps/api',
      url: `${API_URL}/health/live`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        API_PORT: String(API_PORT),
        WEB_ORIGIN: WEB_URL,
        REDIS_KEY_PREFIX: `tl-e2e:${Date.now()}:`,
        S3_BUCKET: 'terra-link-e2e',
        // Hermético: el acceso federado es de cada despliegue y no debe filtrarse desde el .env al E2E (los casos de
        // idiomas y acceso suponen que está deshabilitado; el recorrido con Keycloak real vive en e2e/review).
        SSO_ENABLED: 'false',
      },
    },
    {
      // NEXT_PUBLIC_API_URL se incrusta al compilar: se compila con la URL de la API E2E.
      command: `npm run build && npx next start -p ${WEB_PORT}`,
      cwd: '../apps/web',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { NEXT_PUBLIC_API_URL: API_URL },
    },
  ],
});
