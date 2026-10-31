import type { ReactNode } from 'react';
import './globals.css';
import { I18nProvider } from '../lib/i18n';

export const metadata = { title: 'Terra Link', description: 'Trazabilidad y debida diligencia de cacao' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body><I18nProvider>{children}</I18nProvider></body>
    </html>
  );
}
