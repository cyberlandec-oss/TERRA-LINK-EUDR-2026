import type { ReactNode } from 'react';
import './globals.css';
import { I18nProvider } from '../lib/i18n';
import { PwaRegister } from '../lib/pwa-register';

export const metadata = { title: 'Terra Link', description: 'Trazabilidad y debida diligencia de cacao', manifest: '/manifest.webmanifest' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body><I18nProvider><PwaRegister />{children}</I18nProvider></body>
    </html>
  );
}
