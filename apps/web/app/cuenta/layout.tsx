'use client';

import type { ReactNode } from 'react';
import { WorkspaceProvider } from '../../lib/workspace';

// Mi cuenta comparte el shell y la sesión del resto de pantallas autenticadas.
export default function CuentaLayout({ children }: { children: ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
