'use client';

import type { ReactNode } from 'react';
import { WorkspaceProvider } from '../../lib/workspace';

// Todas las pantallas autenticadas comparten el shell y el contexto de organización activa.
export default function OrganizationsLayout({ children }: { children: ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
