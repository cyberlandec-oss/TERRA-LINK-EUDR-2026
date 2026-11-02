'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiError, recoveryHint } from './api';
import { useI18n } from './i18n';

// Componentes compartidos (docs/UX_UI.md §8–§9). Presentación únicamente: la autorización la decide la API.

export type Tone = 'neutral' | 'valid' | 'review' | 'blocked' | 'process';

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function PageHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="tl-page-header">
      <div>
        <h1>{title}</h1>
        {meta && <div className="meta">{meta}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  const { t } = useI18n();
  return (
    <nav className="tl-breadcrumb" aria-label={t('Ruta de navegación')}>
      <ol>
        {items.map((it, i) => (
          <li key={i}>{it.href && i < items.length - 1 ? <Link href={it.href}>{it.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{it.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <p className="muted">{label}</p>
      <div className="skeleton" style={{ width: '70%' }} />
      <div className="skeleton" style={{ width: '50%' }} />
    </div>
  );
}

/** Vacío autorizado (no hay registros) — distinto de filtro sin resultados y de denegación. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <p className="alert-title">{title}</p>
      {children}
    </div>
  );
}

export function Alert({ tone, title, children }: { tone: 'info' | 'review' | 'blocked' | 'valid'; title?: string; children?: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === 'blocked' ? 'alert' : 'status'}>
      {title && <p className="alert-title">{title}</p>}
      {children}
    </div>
  );
}

/**
 * Panel de error según la respuesta real (UX_UI §9.2): 403 denegación, 404 no disponible, 409 conflicto,
 * 429/503 espera, red caída. Nunca convierte un 403 en «sin datos».
 */
export function ErrorPanel({ error, onRetry, onReload }: { error: ApiError; onRetry?: () => void; onReload?: () => void }) {
  const { t } = useI18n();
  const status = error.status;
  const title =
    status === 403 ? t('No tienes permiso para realizar esta acción.')
      : status === 404 ? t('El recurso no está disponible.')
        : status === 409 ? t('Hay un conflicto con el estado actual.')
          : status === 0 ? t('Sin conexión con el servidor.')
            : status === 429 || status === 503 ? t('Servicio temporalmente no disponible.')
              : t('No pudimos completar la operación.');
  return (
    <div className="error" role="alert">
      <p className="alert-title">{title}</p>
      <p>{t(error.message)}</p>
      <p className="muted">{t(recoveryHint(error))}</p>
      <div className="actions">
        {onReload && status === 409 && <button type="button" onClick={onReload}>{t('Recargar versión actual')}</button>}
        {onRetry && status !== 403 && status !== 404 && <button type="button" className="secondary" onClick={onRetry}>{t('Reintentar')}</button>}
      </div>
    </div>
  );
}
