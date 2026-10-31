'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type Member } from './api';
import { useI18n } from './i18n';
import { Alert, ErrorPanel, StatusBadge } from './ui';

// A-01 — Vínculo explícito entre un productor y la PERSONA que lo es (alcance propio).
//   · Es un acto de gestión con motivo, versionado y auditado: ni el correo ni el nombre vinculan nada.
//   · La persona debe ser miembro activo con el rol Productor. Vincular no la convierte en responsable (técnico asignado)
//     ni le da facultad de revisar evidencias o concluir riesgo: solo le abre SU productor y SUS parcelas.
interface Props { orgId: string; producerId: string; rowVersion: number; selfMembershipId: string | null; onSaved: () => void }

export function ProducerSelfLink({ orgId, producerId, rowVersion, selfMembershipId, onSaved }: Props) {
  const { t } = useI18n();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      const all = await api<Member[]>(`/api/v1/organizations/${orgId}/members`);
      setMembers(all.filter((m) => m.status === 'ACTIVE' && m.roles.includes('PRODUCER')));
    } catch (err) { setError(err as ApiError); }
  }, [orgId]);
  useEffect(() => { void loadMembers(); }, [loadMembers]);

  const linked = members?.find((m) => m.membership_id === selfMembershipId) ?? null;

  async function submit(e: FormEvent, membershipId: string | null) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/producers/${producerId}/self-membership`, {
        method: 'PUT', body: { expected_version: rowVersion, membership_id: membershipId, reason: reason.trim() },
      });
      setReason(''); setPick('');
      onSaved();
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  return (
    <section className="card form" aria-labelledby="self-link-title">
      <h2 id="self-link-title">{t('Acceso propio del productor')}</h2>
      <p className="muted">{t('Vincula a la persona que ES este productor para que gestione solo sus parcelas y evidencias. No es lo mismo que asignar un técnico, y no le da facultad de revisar evidencias ni de concluir riesgo.')}</p>
      {selfMembershipId ? (
        <Alert tone="valid" title={t('Persona vinculada')}>
          <p>{linked ? `${linked.first_name} ${linked.last_name} · ${linked.email}` : t('Una persona de la organización (su membresía ya no tiene el rol Productor activo).')}</p>
        </Alert>
      ) : (
        <p><StatusBadge tone="neutral">{t('Sin persona vinculada')}</StatusBadge> <span className="muted">{t('Nadie con el rol Productor puede ver este productor todavía.')}</span></p>
      )}
      {error && <ErrorPanel error={error} onRetry={loadMembers} />}
      <form onSubmit={(e) => submit(e, selfMembershipId ? null : pick)} aria-label={selfMembershipId ? t('Desvincular') : t('Vincular persona')}>
        {!selfMembershipId && (
          <>
            <label htmlFor="sl-member">{t('Persona con el rol Productor')}</label>
            <select id="sl-member" required value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t('Elige una persona…')}</option>
              {(members ?? []).map((m) => <option key={m.membership_id} value={m.membership_id}>{m.first_name} {m.last_name} · {m.email}</option>)}
            </select>
            {members && members.length === 0 && <p className="field-help">{t('No hay miembros activos con el rol Productor: invita a la persona con ese rol primero.')}</p>}
          </>
        )}
        <label htmlFor="sl-reason">{t('Motivo (queda en el historial y la auditoría)')}</label>
        <input id="sl-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="submit" className={selfMembershipId ? 'danger' : ''} disabled={busy || (!selfMembershipId && !pick)} aria-busy={busy}>
          {selfMembershipId ? t('Desvincular') : t('Vincular persona')}
        </button>
      </form>
    </section>
  );
}
