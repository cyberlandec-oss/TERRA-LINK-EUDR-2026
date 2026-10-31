'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, session } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';

interface Side {
  id: string;
  producer_code: string;
  display_name: string;
  community: string | null;
  parish: string | null;
  status: string;
  document_type?: string | null;
  document_number?: string | null;
}

interface Review {
  id: string;
  rule_code: string;
  status: 'PENDING' | 'NOT_DUPLICATE' | 'DUPLICATE_CONFIRMED';
  detected_at: string;
  resolution_note: string | null;
  row_version: number;
  identity_visible: boolean;
  producer_a: Side;
  producer_b: Side;
}

const PRODUCER_STATUS: Record<string, string> = { DRAFT: 'Borrador', ACTIVE: 'Activo', INACTIVE: 'De baja' };
const STATUS: Record<Review['status'], string> = { PENDING: 'Pendiente', NOT_DUPLICATE: 'No es duplicado', DUPLICATE_CONFIRMED: 'Duplicado confirmado' };
const RULE: Record<string, string> = { IDENTITY_DOCUMENT: 'Mismo tipo y número de documento' };

// P0-005: revisión asistida. Ninguna acción de esta página fusiona, modifica ni da de baja productores.
export default function MatchReviewsPage() {
  const { id: orgId } = useParams<{ id: string }>();
  const router = useRouter();
  const ws = useWorkspace();
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState<Review[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const allowed = ws.can('producer:review_duplicates');
  const load = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    try {
      setRows(await api<Review[]>(`/api/v1/organizations/${orgId}/producer-match-reviews?status=${status}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        session.clear();
        router.replace('/');
        return;
      }
      setError(err as ApiError);
    }
  }, [orgId, status, router, allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coherente con el resto de módulos: sin permiso efectivo se explica la denegación (UX_UI §9.2).
  if (!allowed) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite revisar posibles duplicados.', request_id: null })} />;
  }
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg?.name ?? 'Organización', href: `/organizaciones/${orgId}` }, { label: 'Productores', href: `/organizaciones/${orgId}/productores` }, { label: 'Posibles duplicados' }]} />
      <PageHeader title="Posibles duplicados" meta="Resolver un caso solo registra la decisión: los productores no se fusionan ni se modifican." />
      <label htmlFor="status">Estado</label>
      <select id="status" style={{ maxWidth: 320 }} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="PENDING">Pendientes</option>
        <option value="DUPLICATE_CONFIRMED">Duplicados confirmados</option>
        <option value="NOT_DUPLICATE">No duplicados</option>
        <option value="ALL">Todos</option>
      </select>
      {error && (
        <ErrorPanel error={error} onRetry={load} />
      )}
      {!rows && !error && <Loading label="Cargando casos…" />}
      {rows && rows.length === 0 && <EmptyState title="No hay casos en este estado." />}
      {rows?.map((r) => <ReviewCard key={r.id} orgId={orgId} review={r} onDone={load} />)}
    </>
  );
}

function SideView({ orgId, side, identity }: { orgId: string; side: Side; identity: boolean }) {
  return (
    <div>
      <Link href={`/organizaciones/${orgId}/productores/${side.id}`}>{side.producer_code} · {side.display_name}</Link>
      <div className="muted">{[side.community, side.parish].filter(Boolean).join(' · ') || 'Sin ubicación'} · {PRODUCER_STATUS[side.status] ?? side.status}</div>
      {identity && side.document_number && <div className="muted">{side.document_type} {side.document_number}</div>}
    </div>
  );
}

function ReviewCard({ orgId, review, onDone }: { orgId: string; review: Review; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolve(e: FormEvent, decision: 'NOT_DUPLICATE' | 'DUPLICATE_CONFIRMED') {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/producer-match-reviews/${review.id}/resolve`, {
        method: 'POST', body: { decision, note, expected_version: review.row_version },
      });
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label={`Caso ${review.producer_a.producer_code} y ${review.producer_b.producer_code}`}>
      <p><StatusBadge tone={review.status === 'PENDING' ? 'review' : review.status === 'DUPLICATE_CONFIRMED' ? 'blocked' : 'valid'}>{STATUS[review.status]}</StatusBadge> <span className="muted">{RULE[review.rule_code] ?? review.rule_code} · {new Date(review.detected_at).toLocaleString('es-EC')}</span></p>
      <div className="grid-2">
        <SideView orgId={orgId} side={review.producer_a} identity={review.identity_visible} />
        <SideView orgId={orgId} side={review.producer_b} identity={review.identity_visible} />
      </div>
      {review.resolution_note && <p className="muted">Nota: {review.resolution_note}</p>}
      {review.status === 'PENDING' && (
        <form onSubmit={(e) => resolve(e, 'NOT_DUPLICATE')}>
          <label htmlFor={`note-${review.id}`}>Nota de la decisión (queda en la auditoría)</label>
          <input id={`note-${review.id}`} required minLength={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" disabled={busy}>No es duplicado</button>{' '}
          <button type="button" className="secondary" disabled={busy || note.trim().length < 3} onClick={(e) => resolve(e as unknown as FormEvent, 'DUPLICATE_CONFIRMED')}>
            Es duplicado (sin fusionar)
          </button>
          {error && <ErrorPanel error={error} />}
        </form>
      )}
    </section>
  );
}
