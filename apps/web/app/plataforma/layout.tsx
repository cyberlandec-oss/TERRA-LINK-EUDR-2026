'use client';

import type { ReactNode } from 'react';
import { WorkspaceProvider } from '../../lib/workspace';

// Pantallas de PLATAFORMA (SUPER_ADMIN) comparten el shell y el contexto de sesión; la autorización la decide la API.
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
