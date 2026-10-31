'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { EmptyState, ErrorPanel, Loading, StatusBadge } from '../../../../../lib/ui';
import { GEOMETRY_STATUS, type Plot } from '../../../../../lib/plots';

// Parcelas del productor y alta contextual (UI-06). La API decide el alcance (técnico: solo productores
// asignados); la UI muestra el formulario solo con permiso de alta.
export function ProducerPlots({ orgId, producerId, producerActive }: { orgId: string; producerId: string; producerActive: boolean }) {
  const ws = useWorkspace();
  const router = useRouter();
  const canRead = ws.can('plot:read') || ws.can('plot:read_assigned') || ws.can('plot:read_own');
  const canCreate = (ws.can('plot:create') || ws.can('plot:create_assigned') || ws.can('plot:create_own')) && producerActive && ws.activeOrg?.status === 'ACTIVE';
  const [plots, setPlots] = useState<Plot[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [form, setForm] = useState({ plot_code: '', crop: 'Cacao', name: '', variety: '' });
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canRead) return;
    setError(null);
    try {
      setPlots((await api<{ items: Plot[] }>(`/api/v1/organizations/${orgId}/plots?producer_id=${producerId}&status=ALL&limit=100`)).items);
    } catch (err) {
      setError(err as ApiError);
    }
  }, [orgId, producerId, canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const p = await api<Plot>(`/api/v1/organizations/${orgId}/plots`, {
        method: 'POST',
        body: { producer_id: producerId, plot_code: form.plot_code.trim(), crop: form.crop, ...(form.name.trim() ? { name: form.name } : {}), ...(form.variety.trim() ? { variety: form.variety } : {}) },
      });
      router.push(`/organizaciones/${orgId}/parcelas/${p.id}?productor=${producerId}`);
    } catch (err) {
      setFormError(err as ApiError); // el formulario conserva lo escrito
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) return null;
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }) });

  return (
    <section className="card" aria-labelledby="parcelas-productor">
      <h2 id="parcelas-productor">Parcelas</h2>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!plots && !error && <Loading label="Cargando parcelas…" />}
      {plots && plots.length === 0 && <EmptyState title="Este productor aún no tiene parcelas." />}
      {plots && plots.length > 0 && (
        <ul className="plain" aria-label="Parcelas del productor">
          {plots.map((p) => (
            <li key={p.id}>
              <Link href={`/organizaciones/${orgId}/parcelas/${p.id}?productor=${producerId}`}>{p.plot_code}{p.name ? ` · ${p.name}` : ''}</Link>{' '}
              <StatusBadge tone={GEOMETRY_STATUS[p.geometry_status].tone}>{GEOMETRY_STATUS[p.geometry_status].label}</StatusBadge>{' '}
              {p.status === 'INACTIVE' && <StatusBadge tone="blocked">De baja</StatusBadge>}
              <div className="muted">{p.crop}</div>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <form onSubmit={submit} className="form" aria-labelledby="nueva-parcela">
          <h3 id="nueva-parcela">Registrar parcela de este productor</h3>
          <div className="grid-2">
            <div><label htmlFor="pc-code">Código de parcela</label><input id="pc-code" required pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{0,39}" {...field('plot_code')} /></div>
            <div><label htmlFor="pc-crop">Cultivo</label><input id="pc-crop" required {...field('crop')} /></div>
            <div><label htmlFor="pc-name">Nombre <span className="muted">(opcional)</span></label><input id="pc-name" {...field('name')} /></div>
            <div><label htmlFor="pc-variety">Variedad <span className="muted">(opcional)</span></label><input id="pc-variety" {...field('variety')} /></div>
          </div>
          <p className="field-help">La ubicación y la superficie se registran después, desde la ficha de la parcela.</p>
          {formError && <ErrorPanel error={formError} />}
          <button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Registrando…' : 'Registrar parcela'}</button>
        </form>
      )}
    </section>
  );
}
