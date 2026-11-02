'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from './api';
import { useI18n } from './i18n';
import { Alert, ErrorPanel, StatusBadge } from './ui';

// País de producción de la parcela (origen): una DECLARACIÓN explícita, versionada y de solo añadir. Tres estados que no se mezclan:
// «Sin declarar» (nadie dijo nada), «Declarado como desconocido» (alguien responsable dejó constancia de que no se sabe) y «Declarado: XX».
// Nunca se rellena con el país de la organización, del comprador ni del destino. El servidor decide quién puede declarar.

interface Declaracion { declaration_number: number; state: 'DECLARED' | 'DECLARED_UNKNOWN' | 'NOT_DECLARED'; country: string | null; note?: string | null; declared_at?: string; declared_by?: string }
interface Respuesta { plot_code: string; current: Declaracion; history: Declaracion[]; note: string }

// Códigos de uso frecuente en la cadena del cacao; «Otro país» admite cualquier código ISO de dos letras.
const PAISES: Array<[string, string]> = [['EC', 'Ecuador'], ['PE', 'Perú'], ['CO', 'Colombia'], ['BR', 'Brasil'], ['DO', 'República Dominicana'], ['GH', 'Ghana'], ['CI', 'Costa de Marfil']];

export function PaisDeProduccionPanel({ orgId, plotId, canUpdate }: { orgId: string; plotId: string; canUpdate: boolean }) {
  const { t, dt } = useI18n();
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [valor, setValor] = useState('');
  const [otro, setOtro] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const op = useRef<string | null>(null);
  const base = `/api/v1/organizations/${orgId}/plots/${plotId}/production-country`;

  const cargar = useCallback(async () => {
    try { setR(await api<Respuesta>(base)); setError(null); } catch (e) { setError(e as ApiError); }
  }, [base]);
  useEffect(() => { void cargar(); }, [cargar]);

  const codigo = valor === 'OTRO' ? otro.trim().toUpperCase() : valor;
  const valido = valor === 'DESCONOCIDO' || /^[A-Z]{2}$/.test(codigo);

  const guardar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!r || !valido) return;
    setGuardando(true); setAviso(null);
    op.current ??= crypto.randomUUID();
    try {
      await api(base, { method: 'POST', body: {
        operation_id: op.current, expected_declaration_number: r.current.declaration_number,
        country: valor === 'DESCONOCIDO' ? null : codigo, ...(nota.trim() ? { note: nota.trim() } : {}),
      } });
      op.current = null; setValor(''); setOtro(''); setNota(''); setAviso(t('Declaración guardada. La anterior se conserva en el historial.'));
      await cargar();
    } catch (e) { setError(e as ApiError); } finally { setGuardando(false); }
  };

  const etiqueta = (d: Declaracion) => d.state === 'DECLARED' ? `${t('Declarado')}: ${d.country}` : d.state === 'DECLARED_UNKNOWN' ? t('Declarado como desconocido') : t('Sin declarar');

  return (
    <section className="card" aria-labelledby="pais-titulo">
      <h2 id="pais-titulo">{t('País de producción')}</h2>
      <p className="field-help">{t('Dónde se produjo el cacao de esta parcela. Es una declaración tuya: no se deduce del país de la organización, del comprador ni del destino, y Terra Link no la verifica.')}</p>
      {error && <ErrorPanel error={error} onRetry={() => void cargar()} />}
      {r && (
        <>
          <p>
            <StatusBadge tone={r.current.state === 'DECLARED' ? 'valid' : r.current.state === 'DECLARED_UNKNOWN' ? 'review' : 'neutral'}>{etiqueta(r.current)}</StatusBadge>
            {r.current.declaration_number > 0 && <span className="muted"> · {t('Declaración')} {r.current.declaration_number}{r.current.declared_by ? ` · ${r.current.declared_by}` : ''}{r.current.declared_at ? ` · ${dt(r.current.declared_at)}` : ''}</span>}
          </p>
          {aviso && <Alert tone="valid" title={aviso} />}
          {canUpdate && (
            <form onSubmit={(e) => void guardar(e)} aria-label={t('Declarar el país de producción')}>
              <label htmlFor="pais-valor">{r.current.declaration_number > 0 ? t('Corregir la declaración') : t('Declarar el país de producción')}</label>
              <select id="pais-valor" value={valor} onChange={(e) => { setValor(e.target.value); op.current = null; }}>
                <option value="">{t('Elige una opción')}</option>
                {PAISES.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
                <option value="OTRO">{t('Otro país (código de dos letras)')}</option>
                <option value="DESCONOCIDO">{t('No se sabe (declarar como desconocido)')}</option>
              </select>
              {valor === 'OTRO' && (
                <>
                  <label htmlFor="pais-otro">{t('Código ISO de dos letras')}</label>
                  <input id="pais-otro" value={otro} maxLength={2} onChange={(e) => { setOtro(e.target.value); op.current = null; }} />
                </>
              )}
              <label htmlFor="pais-nota">{t('Aclaración (opcional)')}</label>
              <input id="pais-nota" value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} />
              <div className="actions"><button type="submit" disabled={!valido || guardando}>{guardando ? t('Guardando…') : t('Guardar declaración')}</button></div>
            </form>
          )}
          {r.history.length > 1 && (
            <details>
              <summary>{t('Historial de declaraciones')}</summary>
              <ul className="plain">{r.history.map((h) => <li key={h.declaration_number}>{t('Declaración')} {h.declaration_number}: {etiqueta(h)}{h.declared_at ? ` · ${dt(h.declared_at)}` : ''}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
