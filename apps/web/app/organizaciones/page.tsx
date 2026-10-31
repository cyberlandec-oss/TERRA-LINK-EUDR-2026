'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, ROLE_LABELS, api, type Organization } from '../../lib/api';
import { useWorkspace } from '../../lib/workspace';
import { EmptyState, ErrorPanel, PageHeader, StatusBadge } from '../../lib/ui';

interface OrgType { code: string; label_es: string; status: string }

// UI-02 Organizaciones (docs/UX_UI.md §10.2). Miembro: sus organizaciones. Plataforma: todas, con alta y
// estado; sin acceso a operación ni miembros de cada tenant (D-04).
export default function OrganizationsPage() {
  const ws = useWorkspace();
  const [types, setTypes] = useState<OrgType[]>([]);
  const list = ws.isPlatformAdmin ? ws.allOrgs ?? [] : ws.myOrgs;

  useEffect(() => {
    api<OrgType[]>('/api/v1/catalog/organization-types').then(setTypes).catch(() => setTypes([]));
  }, []);
  const typeLabel = (code: string) => types.find((t) => t.code === code)?.label_es ?? code;

  return (
    <>
      <PageHeader
        title={ws.isPlatformAdmin ? 'Organizaciones de la plataforma' : 'Mis organizaciones'}
        meta={ws.isPlatformAdmin ? 'Administración de plataforma: alta, estado e incorporación del administrador de cada organización.' : 'Elige la organización con la que vas a trabajar.'}
      />
      {list.length === 0 ? (
        <EmptyState title={ws.isPlatformAdmin ? 'Aún no hay organizaciones.' : 'No tienes membresías activas.'}>
          {!ws.isPlatformAdmin && <p className="muted">Pide al administrador de tu organización que te invite.</p>}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">Organizaciones</caption>
            <thead>
              <tr><th scope="col">Organización</th><th scope="col">Tipo</th><th scope="col">Estado</th>{!ws.isPlatformAdmin && <th scope="col">Tus roles</th>}</tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/organizaciones/${o.id}`}>{o.name}</Link></td>
                  <td>{typeLabel(o.organization_type)}</td>
                  <td><StatusBadge tone={o.status === 'ACTIVE' ? 'valid' : 'blocked'}>{o.status === 'ACTIVE' ? 'Activa' : 'Suspendida'}</StatusBadge></td>
                  {!ws.isPlatformAdmin && <td>{(o.roles ?? []).map((r) => ROLE_LABELS[r] ?? r).join(', ') || '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ws.isPlatformAdmin && <CreateOrganization types={types} onCreated={ws.refresh} />}
    </>
  );
}

function CreateOrganization({ types, onCreated }: { types: OrgType[]; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', organization_type: '', country: 'EC', initial_admin_email: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const o = await api<Organization>('/api/v1/organizations', {
        method: 'POST',
        body: {
          name: form.name,
          organization_type: form.organization_type,
          country: form.country.toUpperCase(),
          ...(form.initial_admin_email ? { initial_admin_email: form.initial_admin_email } : {}),
        },
      });
      setCreated(o.name);
      setForm({ name: '', organization_type: '', country: 'EC', initial_admin_email: '' });
      await onCreated();
    } catch (err) {
      setError(err as ApiError); // el formulario conserva lo escrito
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }) });

  return (
    <section className="card form" aria-labelledby="nueva-org">
      <h2 id="nueva-org">Nueva organización</h2>
      <form onSubmit={submit}>
        <label htmlFor="name">Nombre</label>
        <input id="name" required {...field('name')} />
        <label htmlFor="type">Tipo de organización (catálogo provisional, no concede permisos)</label>
        <select id="type" required {...field('organization_type')}>
          <option value="">Elige un tipo…</option>
          {types.map((t) => <option key={t.code} value={t.code}>{t.label_es}</option>)}
        </select>
        <label htmlFor="country">País (código ISO de 2 letras)</label>
        <input id="country" required pattern="[A-Za-z]{2}" maxLength={2} {...field('country')} />
        <label htmlFor="admin">Correo del administrador inicial (opcional; debe tener cuenta)</label>
        <input id="admin" type="email" {...field('initial_admin_email')} />
        <p className="field-help">Si aún no tiene cuenta, crea la organización y luego invítalo desde «Incorporar administrador».</p>
        {error && <ErrorPanel error={error} />}
        {created && <p className="alert valid" role="status">Organización «{created}» creada.</p>}
        <button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Creando…' : 'Crear organización'}</button>
      </form>
    </section>
  );
}
