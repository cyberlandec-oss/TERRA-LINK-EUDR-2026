'use client';

import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, ErrorPanel, PageHeader } from '../../../../lib/ui';
import { ApiError } from '../../../../lib/api';
import { MembersSection } from '../_componentes/miembros';

// UI-03 Equipo, invitaciones y roles (docs/UX_UI.md §10.3). La API aplica anti-escalamiento y D-04.
export default function MembersPage() {
  const ws = useWorkspace();
  const org = ws.activeOrg;
  const onboardingOnly = ws.isPlatformAdmin && !ws.activePerms;
  if (!org || (!ws.can('membership:read') && !onboardingOnly)) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite ver los miembros de esta organización.', request_id: null })} />;
  }
  return (
    <>
      <Breadcrumb items={[{ label: org.name, href: `/organizaciones/${org.id}` }, { label: onboardingOnly ? 'Incorporar administrador' : 'Miembros e invitaciones' }]} />
      <PageHeader title={onboardingOnly ? 'Incorporar administrador' : 'Miembros e invitaciones'} meta={org.name} />
      <MembersSection org={{ ...org, permissions: ws.activePerms?.permissions ?? [] }} canManage={onboardingOnly || ws.can('membership:assign')} />
    </>
  );
}
