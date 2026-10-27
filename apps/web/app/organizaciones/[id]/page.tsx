'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, ROLE_LABELS, api, type Organization } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../lib/ui';

// Capacidades que SIGUEN sin implementarse para ciertos roles (docs/UX_UI.md §7; revisado 2026-10-12, P0-027). Se muestran
// en una superficie separada y rotulada; nunca como entradas de menú ni con datos. Lo ya implementado no aparece aquí.
const PENDING_BY_ROLE: Record<string, Array<{ capability: string; story: string }>> = {
  FIELD_TECHNICIAN: [{ capability: 'Trabajo de campo sin conexión', story: 'App móvil (P0-023/P0-024): el ensayo en teléfono físico sigue pendiente; la web no guarda datos sin conexión' }],
};
const PLATFORM_PENDING = { capability: 'Acceso a datos operativos de una organización', story: 'La elevación supervisada y aprobada existe en el servidor, pero la web aún no tiene la pantalla para solicitarla. La administración de plataforma no da acceso implícito' };

interface FilaTrabajo {
  code: string; title: string; queue: 'MINE' | 'SUPERVISION';
  entity: { type: string; id: string; code: string; href: string };
  reason: string; impact: string;
  assignee: { membership_id: string; name: string } | null; assignee_note: string;
  due_date: string | null; due_state: 'OVERDUE' | 'DUE_SOON' | 'SCHEDULED' | 'NONE';
  priority: 'ALTA' | 'MEDIA' | 'BAJA'; priority_rule: string;
  status: string; evidence_required: string | null;
  action: string; action_href: string;
}
interface ColaTrabajo {
  queues: { mine: number; supervision: number };
  filters: { queue: string | null; assignee: string | null; status: string | null };
  rows: FilaTrabajo[]; total: number; shown: number; truncated: boolean;
  tasks: Array<{ code: string; count: number }>;
  note: string; priority_note: string;
}

const TONO_PRIORIDAD: Record<string, 'blocked' | 'review' | 'neutral'> = { ALTA: 'blocked', MEDIA: 'review', BAJA: 'neutral' };
const ESTADOS: Array<[string, string]> = [
  ['DRAFT', 'Borrador'], ['REGISTERED', 'Registrada'], ['PENDING', 'Pendiente'],
  ['ACTIVE', 'Activa'], ['OPEN', 'Abierta'], ['SUBMITTED', 'Entregada'],
];
const PLAZO: Record<string, string> = { OVERDUE: 'Vencido', DUE_SOON: 'Próximo', SCHEDULED: 'Con plazo', NONE: 'Sin plazo en el dominio' };

/**
 * Mi trabajo (RF-34, P1-003; docs/14 §My Work; UX_UI §11; QA-14).
 *
 * Dos colas separadas y filtros REALES: lo que se elige aquí viaja al backend, que es quien filtra y quien
 * autoriza. Los filtros viven en la URL, así que abrir una tarea y volver conserva la vista.
 * Aquí NO se completa nada: cada fila desaparece cuando su caso de uso del dominio la resuelve.
 */
function MyWork({ orgId }: { orgId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const queue = params.get('cola') ?? '';
  const assignee = params.get('responsable') ?? '';
  const status = params.get('estado') ?? '';
  const hayFiltros = Boolean(queue || assignee || status);

  const [data, setData] = useState<ColaTrabajo | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const q = new URLSearchParams();
    if (queue) q.set('queue', queue);
    if (assignee) q.set('assignee', assignee);
    if (status) q.set('status', status);
    const cadena = q.toString();
    try { setData(await api<ColaTrabajo>(`/api/v1/organizations/${orgId}/my-work${cadena ? `?${cadena}` : ''}`)); }
    catch (err) { setError(err as ApiError); }
  }, [orgId, queue, assignee, status]);
  useEffect(() => { setData(null); void load(); }, [load]);

  /** El filtro vive en la URL: volver de una tarea devuelve la misma vista filtrada. */
  const cambiar = (clave: string, valor: string) => {
    const q = new URLSearchParams(params.toString());
    if (valor) q.set(clave, valor); else q.delete(clave);
    const cadena = q.toString();
    router.replace(`/organizaciones/${orgId}${cadena ? `?${cadena}` : ''}`, { scroll: false });
  };

  const seccion = (titulo: string, cola: 'MINE' | 'SUPERVISION', vacio: string) => {
    const filas = (data?.rows ?? []).filter((r) => r.queue === cola);
    return (
      <section aria-labelledby={`cola-${cola}`}>
        <h3 id={`cola-${cola}`}>{titulo} <StatusBadge tone="neutral">{filas.length}</StatusBadge></h3>
        {filas.length === 0 ? <p className="muted">{vacio}</p> : (
          <div className="table-wrap"><table aria-label={titulo}>
            <thead><tr>
              <th scope="col">Prioridad</th><th scope="col">Tarea</th><th scope="col">Entidad</th>
              <th scope="col">Responsable</th><th scope="col">Plazo</th><th scope="col">Estado</th><th scope="col">Acción</th>
            </tr></thead>
            <tbody>{filas.map((r) => (
              <tr key={`${r.code}-${r.entity.id}`}>
                <td><StatusBadge tone={TONO_PRIORIDAD[r.priority]}>{r.priority}</StatusBadge>
                  <div className="muted">{r.priority_rule}</div></td>
                <td>{r.title}<div className="muted">{r.reason}</div><div className="muted">{r.impact}</div>
                  {r.evidence_required && <div className="muted">Evidencia requerida: {r.evidence_required}</div>}</td>
                <td><Link href={r.entity.href}>{r.entity.code}</Link></td>
                <td>{r.assignee?.name ?? 'Sin responsable'}<div className="muted">{r.assignee_note}</div></td>
                <td>{r.due_date ?? '—'}<div className="muted">{PLAZO[r.due_state]}</div></td>
                <td>{r.status}</td>
                <td><Link href={r.action_href}>{r.action}</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    );
  };

  return (
    <section className="card" aria-labelledby="mi-trabajo">
      <h2 id="mi-trabajo">Mi trabajo</h2>
      {error ? <ErrorPanel error={error} onRetry={load} />
        : !data ? <Loading label="Cargando tus pendientes…" />
          : (
            <>
              <p className="muted">{data.note}</p>
              <fieldset aria-label="Filtros de la cola">
                <label htmlFor="f-cola">Cola</label>
                <select id="f-cola" value={queue} onChange={(e) => cambiar('cola', e.target.value)}>
                  <option value="">Todas</option><option value="MINE">Personal</option><option value="SUPERVISION">Supervisión</option>
                </select>
                <label htmlFor="f-resp">Responsable</label>
                <select id="f-resp" value={assignee} onChange={(e) => cambiar('responsable', e.target.value)}>
                  <option value="">Cualquiera</option><option value="ME">Yo</option><option value="UNASSIGNED">Sin responsable</option>
                </select>
                <label htmlFor="f-estado">Estado</label>
                <select id="f-estado" value={status} onChange={(e) => cambiar('estado', e.target.value)}>
                  <option value="">Cualquiera</option>
                  {ESTADOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {hayFiltros && <button type="button" onClick={() => router.replace(`/organizaciones/${orgId}`, { scroll: false })}>Quitar filtros</button>}
              </fieldset>
              <p className="muted">
                Personal: {data.queues.mine} · Supervisión: {data.queues.supervision}. El filtro lo aplica el servidor;
                no amplía lo que puedes ver. {data.priority_note}
              </p>
              {data.total === 0 ? (
                <p>{hayFiltros ? 'Ningún pendiente coincide con estos filtros.' : 'No tienes pendientes en esta organización.'}</p>
              ) : (
                <>
                  {queue !== 'SUPERVISION' && seccion('Cola personal', 'MINE', 'No hay tareas asignadas a ti.')}
                  {queue !== 'MINE' && seccion('Supervisión', 'SUPERVISION', 'No hay trabajo del equipo pendiente de supervisión.')}
                </>
              )}
              {data.truncated && <p className="muted">Se muestran {data.shown} de {data.total} tareas que coinciden. Los recuentos de arriba son los reales; afina los filtros para ver el resto.</p>}
            </>
          )}
    </section>
  );
}

export default function OrganizationHomePage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id;
  const canRead = ws.can('organization:read') || ws.isPlatformAdmin;
  const [org, setOrg] = useState<Organization | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !canRead) return;
    setError(null);
    try {
      setOrg(await api<Organization>(`/api/v1/organizations/${orgId}`));
    } catch (err) {
      setError(err as ApiError);
    }
  }, [orgId, canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  const roles = ws.activePerms?.roles ?? [];
  const pending = [...roles.flatMap((r) => (PENDING_BY_ROLE[r] ?? []).map((p) => ({ ...p, role: r }))),
    ...(ws.isPlatformAdmin && !ws.activePerms ? [{ ...PLATFORM_PENDING, role: 'SUPER_ADMIN' }] : [])];

  return (
    <>
      <Breadcrumb items={[{ label: ws.isPlatformAdmin ? 'Organizaciones' : 'Mis organizaciones', href: '/organizaciones' }, { label: ws.activeOrg.name }]} />
      {!canRead ? (
        <>
          <PageHeader title="Mi espacio" meta={<>{ws.activeOrg.name} · {roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</>} />
          <Alert tone="info" title="Esta organización no tiene un resumen para tu rol.">
            <p>Tu cuenta y tu membresía están activas. Entra por tus accesos:</p>
            <ul>
              {ws.can('producer:read_own') && <li><Link href={`/organizaciones/${ws.activeOrg.id}/mi-finca`}>Mi finca</Link></li>}
              {(ws.can('delivery:read') || ws.can('delivery:read_assigned')) && <li><Link href={`/organizaciones/${ws.activeOrg.id}/entregas`}>Entregas</Link></li>}
              <li><Link href="/compartido">Compartido conmigo</Link></li>
            </ul>
          </Alert>
          {ws.activePerms && <MyWork orgId={ws.activeOrg.id} />}
        </>
      ) : error ? (
        <ErrorPanel error={error} onRetry={load} />
      ) : !org ? (
        <Loading label="Cargando la organización…" />
      ) : (
        <>
          <PageHeader
            title={org.name}
            meta={<>
              <StatusBadge tone={org.status === 'ACTIVE' ? 'valid' : 'blocked'}>{org.status === 'ACTIVE' ? 'Activa' : 'Suspendida'}</StatusBadge>
              <span>{org.organization_type} · {org.country} · versión {org.row_version}</span>
            </>}
          />
          {ws.activePerms && <MyWork orgId={org.id} />}
          {org.status === 'SUSPENDED' && (
            <Alert tone="review" title={`Organización suspendida: ${org.status_reason ?? ''}`}>
              <p>El historial sigue disponible para consulta; no se admiten nuevas operaciones.</p>
            </Alert>
          )}
          {ws.can('organization:update') ? <EditOrganization org={org} onSaved={setOrg} onReload={load} /> : <OrgDetails org={org} />}
          {(ws.can('producer:read') || ws.can('producer:read_assigned')) && (
            <section className="card">
              <h2>Productores</h2>
              <Link href={`/organizaciones/${org.id}/productores`}>Ver y registrar productores</Link>
            </section>
          )}
          {ws.isPlatformAdmin && <StatusControl org={org} onChanged={setOrg} />}
        </>
      )}
      {pending.length > 0 && (
        <section className="card" aria-labelledby="pendientes-rol">
          <h2 id="pendientes-rol">Capacidades aún no disponibles para tu rol</h2>
          <p className="muted">Se listan para orientar, no son accesos ni se muestran como operativas.</p>
          <ul className="plain">
            {pending.map((p, i) => (
              <li key={i}>
                <StatusBadge tone="neutral">Pendiente de implementación</StatusBadge> {p.capability}
                <div className="muted">{ROLE_LABELS[p.role] ?? p.role} · {p.story}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function OrgDetails({ org }: { org: Organization }) {
  return (
    <section className="card">
      <h2>Datos de la organización</h2>
      <p className="muted">Puedes consultar estos datos; la edición corresponde al administrador de la organización.</p>
      <dl className="props">
        <dt>Razón social</dt><dd>{org.legal_name ?? 'Sin registrar'}</dd>
        <dt>Identificación tributaria</dt><dd>{org.tax_id ?? 'Sin registrar'}</dd>
        <dt>Provincia / cantón / parroquia</dt><dd>{[org.province, org.canton, org.parish].map((v) => v ?? '—').join(' / ')}</dd>
      </dl>
    </section>
  );
}

function EditOrganization({ org, onSaved, onReload }: { org: Organization; onSaved: (o: Organization) => void; onReload: () => void }) {
  const [form, setForm] = useState({
    name: org.name, legal_name: org.legal_name ?? '', tax_id: org.tax_id ?? '',
    province: org.province ?? '', canton: org.canton ?? '', parish: org.parish ?? '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const o = await api<Organization>(`/api/v1/organizations/${org.id}`, { method: 'PATCH', body: { expected_version: org.row_version, ...form } });
      onSaved({ ...org, ...o });
      setSaved(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }) });

  return (
    <section className="card form">
      <h2>Configuración</h2>
      <form onSubmit={submit}>
        <fieldset disabled={org.status !== 'ACTIVE'}>
          <div className="grid-2">
            <div><label htmlFor="name">Nombre</label><input id="name" required {...field('name')} /></div>
            <div><label htmlFor="legal">Razón social</label><input id="legal" {...field('legal_name')} /></div>
            <div><label htmlFor="tax">Identificación tributaria</label><input id="tax" {...field('tax_id')} /></div>
            <div><label htmlFor="prov">Provincia</label><input id="prov" {...field('province')} /></div>
            <div><label htmlFor="canton">Cantón</label><input id="canton" {...field('canton')} /></div>
            <div><label htmlFor="parish">Parroquia</label><input id="parish" {...field('parish')} /></div>
          </div>
          <button type="submit" disabled={busy || org.status !== 'ACTIVE'} aria-busy={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </fieldset>
        {saved && <p className="alert valid" role="status">Cambios guardados.</p>}
        {error && <ErrorPanel error={error} onReload={onReload} />}
      </form>
    </section>
  );
}

function StatusControl({ org, onChanged }: { org: Organization; onChanged: (o: Organization) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const suspending = org.status === 'ACTIVE';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const o = await api<Organization>(`/api/v1/organizations/${org.id}/${suspending ? 'suspend' : 'reactivate'}`, { method: 'POST', body: { reason } });
      onChanged({ ...org, ...o });
      setReason('');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card form">
      <h2>{suspending ? 'Suspender organización' : 'Reactivar organización'}</h2>
      <p className="muted">
        {suspending
          ? `Bloquea nuevas operaciones de todos los miembros de «${org.name}». No borra información ni historial.`
          : 'Los miembros con permiso podrán volver a registrar operaciones.'}
      </p>
      <form onSubmit={submit}>
        <label htmlFor="reason">Motivo (queda en la auditoría)</label>
        <input id="reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <ErrorPanel error={error} />}
        <button type="submit" className={suspending ? 'danger' : ''} disabled={busy} aria-busy={busy}>
          {busy ? 'Aplicando…' : suspending ? 'Suspender' : 'Reactivar'}
        </button>
      </form>
    </section>
  );
}
