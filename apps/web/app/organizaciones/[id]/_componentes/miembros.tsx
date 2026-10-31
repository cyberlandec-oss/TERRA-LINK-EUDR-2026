'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ApiError, ROLE_LABELS, api, invitationLink,
  type Invitation, type Member, type Organization,
} from '../../../../lib/api';
import { ErrorPanel, Loading, StatusBadge } from '../../../../lib/ui';

const INVITATION_STATUS: Record<Invitation['status'], string> = {
  PENDING: 'Pendiente', ACCEPTED: 'Aceptada', REVOKED: 'Revocada', EXPIRED: 'Vencida',
};

// P0-002: miembros e invitaciones. La API decide qué puede hacer el usuario; esta vista solo
// muestra acciones según permisos efectivos y roles asignables devueltos por el servidor.
export function MembersSection({ org, canManage }: { org: Organization; canManage: boolean }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [onboardingOnly, setOnboardingOnly] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      let onboarding = false;
      if (canManage) {
        const a = await api<{ roles: string[]; onboarding_only: boolean }>(`/api/v1/organizations/${org.id}/assignable-roles`);
        setRoles(a.roles);
        onboarding = a.onboarding_only;
        setOnboardingOnly(onboarding);
      }
      // En modo incorporación (plataforma sin membresía) la API no entrega miembros (D-04).
      const [m, i] = await Promise.all([
        onboarding ? Promise.resolve(null) : api<Member[]>(`/api/v1/organizations/${org.id}/members`),
        api<Invitation[]>(`/api/v1/organizations/${org.id}/invitations`),
      ]);
      setMembers(m);
      setInvitations(i);
    } catch (err) {
      setError(err as ApiError);
    }
  }, [org.id, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = org.status === 'ACTIVE';

  return (
    <section className="card">
      <h2>{onboardingOnly ? 'Incorporación del administrador' : 'Miembros'}</h2>
      {onboardingOnly && (
        <p className="notice">
          Desde la administración de plataforma solo puedes invitar al administrador de la organización. Ver o gestionar
          miembros requiere una elevación auditada que aún no está definida (decisión D-04).
        </p>
      )}
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!members && !error && !onboardingOnly && <Loading label="Cargando miembros…" />}
      {members && (
        <ul className="plain" aria-label="Miembros">
          {members.map((m) => (
            <MemberRow key={m.membership_id} orgId={org.id} member={m} canManage={canManage && active} assignable={roles} onChanged={load} />
          ))}
        </ul>
      )}
      {canManage && active && <InviteForm orgId={org.id} roles={roles} onCreated={load} />}
      {canManage && !active && <p className="notice">La organización está suspendida: no se pueden invitar ni modificar miembros.</p>}
      {invitations && invitations.length > 0 && (
        <>
          <h3>Invitaciones</h3>
          <ul className="plain" aria-label="Invitaciones">
            {invitations.map((i) => (
              <li key={i.id}>
                {i.email} · {ROLE_LABELS[i.role_code] ?? i.role_code} · <StatusBadge tone={i.status === 'PENDING' ? 'process' : i.status === 'ACCEPTED' ? 'valid' : 'neutral'}>{INVITATION_STATUS[i.status]}</StatusBadge>
                {i.status === 'PENDING' && <span className="muted"> · vence {new Date(i.expires_at).toLocaleString('es-EC')}</span>}
                {canManage && active && i.status === 'PENDING' && <RevokeButton orgId={org.id} invitationId={i.id} onDone={load} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function MemberRow({ orgId, member, canManage, assignable, onChanged }: {
  orgId: string; member: Member; canManage: boolean; assignable: string[]; onChanged: () => void;
}) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [editingRoles, setEditingRoles] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const deactivating = member.status === 'ACTIVE';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/members/${member.membership_id}/${deactivating ? 'deactivate' : 'reactivate'}`, {
        method: 'POST', body: { reason },
      });
      setOpen(false);
      setReason('');
      onChanged();
    } catch (err) {
      setError(err as ApiError);
    }
  }

  return (
    <li>
      <strong>{member.first_name} {member.last_name}</strong> <span className="muted">{member.email}</span>{' '}
      <StatusBadge tone={member.status === 'ACTIVE' ? 'valid' : 'blocked'}>{member.status === 'ACTIVE' ? 'Activo' : 'Desactivado'}</StatusBadge>
      <div className="muted">
        {member.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') || 'Sin rol'}
        {!member.email_verified_at && ' · correo no verificado'}
        {member.status_reason && ` · motivo: ${member.status_reason}`}
      </div>
      {canManage && !open && !editingRoles && (
        <>
          <button className="secondary" onClick={() => setOpen(true)}>{deactivating ? 'Desactivar' : 'Reactivar'}</button>{' '}
          {member.status === 'ACTIVE' && member.roles.every((r) => assignable.includes(r)) && (
            <button className="secondary" onClick={() => setEditingRoles(true)}>Cambiar roles</button>
          )}
        </>
      )}
      {editingRoles && (
        <RolesEditor orgId={orgId} member={member} assignable={assignable}
          onDone={() => { setEditingRoles(false); onChanged(); }} onCancel={() => setEditingRoles(false)} />
      )}
      {open && (
        <form onSubmit={submit}>
          <label htmlFor={`reason-${member.membership_id}`}>Motivo (queda en la auditoría)</label>
          <input id={`reason-${member.membership_id}`} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="submit" className={deactivating ? 'danger' : ''}>{deactivating ? 'Confirmar desactivación' : 'Confirmar reactivación'}</button>{' '}
          <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button>
          {error && <ErrorPanel error={error} />}
        </form>
      )}
    </li>
  );
}

function RolesEditor({ orgId, member, assignable, onDone, onCancel }: {
  orgId: string; member: Member; assignable: string[]; onDone: () => void; onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(member.roles);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/members/${member.membership_id}/roles`, { method: 'PUT', body: { roles: selected, reason } });
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={`Roles de ${member.email}`}>
      <fieldset>
        <legend className="muted">Roles (el cambio aplica de inmediato)</legend>
        {assignable.map((r) => (
          <label key={r} className="checkbox-row">
            <input type="checkbox" checked={selected.includes(r)}
              onChange={(e) => setSelected(e.target.checked ? [...selected, r] : selected.filter((x) => x !== r))} />
            {ROLE_LABELS[r] ?? r}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`roles-reason-${member.membership_id}`}>Motivo del cambio (queda en la auditoría)</label>
      <input id={`roles-reason-${member.membership_id}`} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      {selected.length === 0 && <p className="muted">Selecciona al menos un rol; para quitar todo el acceso, desactiva la membresía.</p>}
      <button type="submit" disabled={busy || selected.length === 0}>{busy ? 'Guardando…' : 'Guardar roles'}</button>{' '}
      <button type="button" className="secondary" onClick={onCancel}>Cancelar</button>
      {error && <ErrorPanel error={error} />}
    </form>
  );
}

function RevokeButton({ orgId, invitationId, onDone }: { orgId: string; invitationId: string; onDone: () => void }) {
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <>
      {' '}
      <button
        className="secondary"
        onClick={async () => {
          try {
            await api(`/api/v1/organizations/${orgId}/invitations/${invitationId}/revoke`, { method: 'POST' });
            onDone();
          } catch (err) {
            setError(err as ApiError);
          }
        }}
      >
        Revocar
      </button>
      {error && <span className="error" role="alert">{error.message}</span>}
    </>
  );
}

function InviteForm({ orgId, roles, onCreated }: { orgId: string; roles: string[]; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLink(null);
    setCopied(false);
    try {
      const res = await api<{ token: string }>(`/api/v1/organizations/${orgId}/invitations`, {
        method: 'POST', body: { email, role_code: role },
      });
      setLink(invitationLink(window.location.origin, res.token));
      setEmail('');
      onCreated();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3>Invitar a una persona</h3>
      <form onSubmit={submit}>
        <label htmlFor="invite-email">Correo</label>
        <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="invite-role">Rol</label>
        <select id="invite-role" required value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Elige un rol…</option>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
        </select>
        <button type="submit" disabled={busy}>{busy ? 'Generando…' : 'Generar enlace de invitación'}</button>
        {error && <ErrorPanel error={error} />}
      </form>
      {link && (
        <div className="notice" role="status">
          <p><strong>Enlace secreto de un solo uso.</strong> Cualquiera que lo tenga puede aceptar la invitación:
            compártelo solo con la persona invitada por un canal privado. No se volverá a mostrar.
            (Mecanismo provisional mientras no exista envío por correo.)</p>
          <input readOnly aria-label="Enlace de invitación" value={link} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copiado' : 'Copiar enlace'}
          </button>{' '}
          <button type="button" className="secondary" onClick={() => setLink(null)}>Ocultar</button>
        </div>
      )}
    </>
  );
}
