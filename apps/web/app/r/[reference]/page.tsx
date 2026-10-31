'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, session } from '../../../lib/api';
import { Alert, ErrorPanel, Loading, PageHeader } from '../../../lib/ui';

// RF-33 — Apertura de una referencia pública hasta **el recurso correcto**.
//
// Es el destino del QR y del enlace copiado. Resuelve contra la API y lleva a la pantalla del recurso,
// **conservando autenticación, permisos y alcance**: usa la misma ruta autorizada de RF-47, así que si quien
// abre no puede leer el recurso recibe la respuesta opaca —no se filtra ni su existencia—.
//
// Vive FUERA del espacio de trabajo (`/organizaciones`) a propósito: un enlace escaneado llega sin contexto de
// organización, y la organización **sale del registro**, no de la URL. Por eso no usa el proveedor de
// espacio de trabajo y se apoya solo en la sesión.
//
// Qué NO hace: no muestra contenido del recurso. Redirige a la pantalla que ya aplica sus propios permisos.

/** Pantalla de cada tipo. Solo los tipos que TIENEN pantalla propia: no se inventa un destino. */
const DESTINO: Record<string, (org: string, id: string) => string> = {
  PRODUCER: (o, id) => `/organizaciones/${o}/productores/${id}`,
  PLOT: (o, id) => `/organizaciones/${o}/parcelas/${id}`,
  DELIVERY: (o, id) => `/organizaciones/${o}/entregas/${id}`,
  LOT: (o, id) => `/organizaciones/${o}/lotes/${id}`,
  SHIPMENT: (o, id) => `/organizaciones/${o}/embarques/${id}`,
  // DD_SNAPSHOT se resuelve, pero **no se enruta**: la pantalla de diligencia se abre por EXPEDIENTE y la
  // referencia identifica una INSTANTÁNEA. Mandar el identificador de instantánea a una ruta de expediente
  // daría una pantalla equivocada o un error confuso, así que se muestra el dato y se dice por qué.
};

interface Resuelta {
  reference: string; entity_type: string; organization_id: string; id: string; code: string;
  /** Por qué se resolvió: miembro de la organización, o destinatario de una concesión vigente. */
  audience: 'MEMBER' | 'GRANTEE';
  grant_id?: string;
}

export default function ResolverReferenciaPage() {
  const params = useParams<{ reference: string }>();
  const reference = String(params?.reference ?? '');
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [resuelta, setResuelta] = useState<Resuelta | null>(null);
  const [haySesion, setHaySesion] = useState<boolean | null>(null);

  const resolver = useCallback(async () => {
    if (!reference) return;
    if (!session.get()) { setHaySesion(false); return; }
    setHaySesion(true);
    try {
      const r = await api<Resuelta>(`/api/v1/public-references/${reference}`);
      setResuelta(r);
      setError(null);
      // La audiencia decide el destino. Un destinatario de concesión **no es miembro**: llevarlo a la pantalla
      // interna le daría un 403 o una pantalla vacía. Va a su vista compartida, que es lo que le corresponde.
      if (r.audience === 'GRANTEE') { router.replace('/compartido'); return; }
      const destino = DESTINO[r.entity_type];
      if (destino) router.replace(destino(r.organization_id, r.id));
    } catch (e) { setError(e as ApiError); }
  }, [reference, router]);
  useEffect(() => { void resolver(); }, [resolver]);

  if (haySesion === false) {
    return (
      <main className="tl-access"><div className="tl-access-card">
        <PageHeader title="Referencia pública" meta={<code>{reference}</code>} />
        <Alert tone="info" title="Esta referencia no concede acceso">
          <p>
            Conocer una referencia no abre nada por sí misma. <Link href="/">Inicia sesión</Link> y, si tienes
            permiso sobre el recurso, podrás abrirlo desde aquí.
          </p>
        </Alert>
      </div></main>
    );
  }

  return (
    <main className="tl-access"><div className="tl-access-card">
      <PageHeader title="Abriendo la referencia" meta={<code>{reference}</code>} />
      {error && (
        <>
          <ErrorPanel error={error} onRetry={resolver} />
          {error.status === 404 && (
            <Alert tone="review" title="No hay ningún recurso a tu alcance con esa referencia">
              <p>
                La respuesta es la misma tanto si la referencia no existe, como si pertenece a otra
                organización, como si está fuera de tu alcance: <strong>la referencia no revela qué recursos
                existen</strong>.
              </p>
            </Alert>
          )}
          {error.status === 401 && (
            <p><Link href="/">Inicia sesión</Link> para abrirla.</p>
          )}
        </>
      )}
      {!error && !resuelta && <Loading label="Resolviendo la referencia…" />}
      {!error && resuelta && !DESTINO[resuelta.entity_type] && (
        <Alert tone="info" title={`Referencia de ${resuelta.entity_type}`}>
          <p>
            Recurso <code>{resuelta.code}</code>. Este tipo se resuelve pero todavía no tiene pantalla propia a
            la que llevarte; ábrelo desde su expediente.
          </p>
        </Alert>
      )}
    </div></main>
  );
}
