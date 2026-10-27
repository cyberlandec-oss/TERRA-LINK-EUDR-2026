'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, session, type Member } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { ProducerFields, STATUS_LABEL, toPayload, type Producer } from '../page';
import { ProducerPlots } from './parcelas-productor';
import { ProducerSelfLink } from '../../../../../lib/producer-self-link';
import { EventHistory } from '../../../../../lib/event-history';

type ProducerDetail = Producer & { can_update: boolean; can_assign: boolean; can_archive: boolean; can_link_self?: boolean; self_membership_id?: string | null; is_own?: boolean };

interface Version {
  version: number;
  change_type: string;
  changed_fields: string[];
  reason: string | null;
  changed_at: string;
  actor: string;
}

const CHANGE_LABEL: Record<string, string> = {
  CREATE: 'Registro', UPDATE: 'Edición', ASSIGN: 'Cambio de responsable', LINK_SELF: 'Vínculo de acceso propio', ARCHIVE: 'Baja', ACTIVATE: 'Activación', CORRECTION: 'Corrección',
};
const FIELD_LABEL: Record<string, string> = {
  first_name: 'nombre', last_name: 'apellido', legal_name: 'razón social', document_type: 'tipo de documento',
  document_number: 'número de documento', phone: 'teléfono', address: 'dirección', community: 'comunidad',
  province: 'provincia', canton: 'cantón', parish: 'parroquia', status: 'estado', assigned_membership_id: 'responsable', self_membership_id: 'acceso propio',
};
const EDITABLE = ['first_name', 'last_name', 'legal_name', 'document_type', 'document_number', 'phone', 'address', 'community', 'province', 'canton', 'parish'] as const;

export default function ProducerDetailPage() {
  const { id: orgId, pid } = useParams<{ id: string; pid: string }>();
  const router = useRouter();
  const ws = useWorkspace();
  const possibleDuplicate = useSearchParams().get('coincidencia') === '1';
  const [p, setP] = useState<ProducerDetail | null>(null);
  const [history, setHistory] = useState<Version[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, h] = await Promise.all([
        api<ProducerDetail>(`/api/v1/organizations/${orgId}/producers/${pid}`),
        api<Version[]>(`/api/v1/organizations/${orgId}/producers/${pid}/history`),
      ]);
      setP(d);
      setHistory(h);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        session.clear();
        router.replace('/');
        return;
      }
      setError(err as ApiError);
    }
  }, [orgId, pid, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg?.name ?? 'Organización', href: `/organizaciones/${orgId}` }, { label: 'Productores', href: `/organizaciones/${orgId}/productores` }, { label: p ? p.producer_code : 'Productor' }]} />
      {error && (
        <ErrorPanel error={error} onRetry={load} />
      )}
      {!p && !error && <Loading label="Cargando productor…" />}
      {p && (
        <>
          <PageHeader
            title={`${p.producer_code} · ${p.display_name}`}
            meta={<>
              <StatusBadge tone={p.status === 'ACTIVE' ? 'valid' : p.status === 'DRAFT' ? 'review' : 'blocked'}>{STATUS_LABEL[p.status]}</StatusBadge>
              <span>versión {p.row_version}</span>
            </>}
          />
          {possibleDuplicate && (
            <Alert tone="review" title="Posible coincidencia de identidad">
              <p>Se detectó una posible coincidencia de identidad con otro productor. Un responsable la revisará; no se fusionó ni modificó ningún registro.</p>
            </Alert>
          )}
          {p.status === 'INACTIVE' && <Alert tone="review" title={`Productor de baja: ${p.deletion_reason ?? ''}.`}><p>Su historial se conserva.</p></Alert>}
          {!p.identity_visible && <p className="muted">Los datos de identidad y contacto no están disponibles para tu rol.</p>}
          {p.can_update ? <EditProducer orgId={orgId} producer={p} onSaved={load} /> : <ReadOnly producer={p} />}
          {p.can_assign && p.status !== 'INACTIVE' && <AssignProducer orgId={orgId} producer={p} onSaved={load} />}
          {p.can_link_self && p.status !== 'INACTIVE' && <ProducerSelfLink orgId={orgId} producerId={p.id} rowVersion={p.row_version} selfMembershipId={p.self_membership_id ?? null} onSaved={load} />}
          {p.can_archive && <StatusProducer orgId={orgId} producer={p} onSaved={load} />}
          <ProducerPlots orgId={orgId} producerId={p.id} producerActive={p.status !== 'INACTIVE'} />
          <EventHistory orgId={orgId} kind="producers" id={p.id}
            correction={p.can_update && p.status !== 'INACTIVE' ? { current: p as unknown as Record<string, string | null>, rowVersion: p.row_version, onCorrected: load } : null} />
          <section className="card">
            <h2>Historial</h2>
            <ul className="plain" aria-label="Historial">
              {history.map((v) => (
                <li key={v.version}>
                  <strong>v{v.version} · {CHANGE_LABEL[v.change_type] ?? v.change_type}</strong>{' '}
                  <span className="muted">
                    · {v.actor === 'PLATFORM' ? 'Administración de plataforma' : v.actor} · {new Date(v.changed_at).toLocaleString('es-EC')}
                    {v.changed_fields.length > 0 && ` · ${v.changed_fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}`}
                    {v.reason && ` · motivo: ${v.reason}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

function ReadOnly({ producer: p }: { producer: Producer }) {
  const row = (label: string, v?: string | null) => (<><dt className="muted">{label}</dt><dd>{v || '—'}</dd></>);
  return (
    <section className="card">
      <dl>
        {row('Nombre', [p.first_name, p.last_name].filter(Boolean).join(' '))}
        {row('Razón social', p.legal_name)}
        {p.identity_visible && (<>{row('Documento', p.document_type ? `${p.document_type} ${p.document_number}` : null)}{row('Teléfono', p.phone)}{row('Dirección', p.address)}</>)}
        {row('Comunidad', p.community)}
        {row('Provincia / cantón / parroquia', [p.province, p.canton, p.parish].map((x) => x || '—').join(' / '))}
      </dl>
    </section>
  );
}

function EditProducer({ orgId, producer, onSaved }: { orgId: string; producer: ProducerDetail; onSaved: () => void }) {
  const initial = Object.fromEntries(EDITABLE.map((k) => [k, (producer[k] as string | null | undefined) ?? '']));
  const [fields, setFields] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    // Solo se envían los campos cambiados (y nunca los de identidad si el rol no los ve).
    const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== initial[k]));
    try {
      await api(`/api/v1/organizations/${orgId}/producers/${producer.id}`, {
        method: 'PATCH', body: { expected_version: producer.row_version, ...toPayload(changed, true) },
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card form">
      <h2>Datos del productor</h2>
      <form onSubmit={submit}>
        <ProducerFields value={fields} onChange={setFields} showIdentity={producer.identity_visible} />
        {saved && <p className="muted" role="status">Cambios guardados.</p>}
        {error && (
          <ErrorPanel error={error} onReload={onSaved} />
        )}
        <button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </form>
    </section>
  );
}

function AssignProducer({ orgId, producer, onSaved }: { orgId: string; producer: ProducerDetail; onSaved: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState(producer.assigned_membership_id ?? '');
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api<Member[]>(`/api/v1/organizations/${orgId}/members`).then((m) => setMembers(m.filter((x) => x.status === 'ACTIVE'))).catch(() => setMembers([]));
  }, [orgId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/producers/${producer.id}/assignment`, {
        method: 'PUT', body: { expected_version: producer.row_version, membership_id: selected || null },
      });
      onSaved();
    } catch (err) {
      setError(err as ApiError);
    }
  }

  return (
    <section className="card">
      <h2>Responsable</h2>
      <form onSubmit={submit}>
        <label htmlFor="assignee">Técnico o responsable asignado</label>
        <select id="assignee" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Sin asignar</option>
          {members.map((m) => <option key={m.membership_id} value={m.membership_id}>{m.first_name} {m.last_name} ({m.email})</option>)}
        </select>
        {error && <ErrorPanel error={error} />}
        <button type="submit">Guardar responsable</button>
      </form>
    </section>
  );
}

function StatusProducer({ orgId, producer, onSaved }: { orgId: string; producer: ProducerDetail; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const archiving = producer.status !== 'INACTIVE';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/producers/${producer.id}/${archiving ? 'archive' : 'activate'}`, {
        method: 'POST', body: { expected_version: producer.row_version, reason },
      });
      setReason('');
      onSaved();
    } catch (err) {
      setError(err as ApiError);
    }
  }

  return (
    <section className="card">
      <h2>{archiving ? 'Dar de baja' : 'Reactivar productor'}</h2>
      <p className="muted">{archiving ? 'La baja es lógica: el productor y su historial se conservan.' : 'Vuelve a quedar disponible para operar.'}</p>
      {producer.status === 'DRAFT' && <p className="muted">Este productor es un borrador.</p>}
      <form onSubmit={submit}>
        <label htmlFor="p-reason">Motivo (queda en el historial)</label>
        <input id="p-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <ErrorPanel error={error} />}
        <button type="submit" className={archiving ? 'danger' : ''}>{archiving ? 'Dar de baja' : 'Reactivar'}</button>
      </form>
    </section>
  );
}
