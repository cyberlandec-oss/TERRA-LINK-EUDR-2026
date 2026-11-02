'use client';

import { useI18n } from '../../../../lib/i18n';
import { AnalisisAutorizadosPanel } from '../../../../lib/satellite-autorizacion';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, PageHeader } from '../../../../lib/ui';

// Recorrido Productor → exportadora: análisis satelital de las parcelas que otra organización autorizó a la propia. El servidor decide cada acción.
export default function AnalisisAutorizadosPage() {
  const ws = useWorkspace();
  const { t } = useI18n();
  if (!ws.activeOrg) return null;
  const orgId = ws.activeOrg.id;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Análisis autorizados') }]} />
      <PageHeader title={t('Análisis autorizados')} meta={<span>{t('Análisis satelital de parcelas que otra organización te autorizó, con su procedencia y límites')}</span>} />
      <AnalisisAutorizadosPanel orgId={orgId} />
    </>
  );
}
