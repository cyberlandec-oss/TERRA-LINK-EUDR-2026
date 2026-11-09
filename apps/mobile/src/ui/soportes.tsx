import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { writeCacheFile } from '../adapters/expo';
import type { DraftView, LocalStore, ReferenceDocumentType, SupportView } from '../core/store';
import { Button, Card, Field, Notice, s } from './kit';

// Soportes documentales (PDF o imagen) sobre la parcela de la captura. Reutiliza Documentos: el tipo sale del catálogo que descarga la sincronización según el rol,
// el archivo se valida por su contenido, viaja aparte con su SHA-256 y su estado (registro, archivo, análisis) es independiente. Aportar un soporte NO lo revisa,
// no lo aprueba y no lo convierte en evidencia de ningún requisito.
export const SUPPORT_STATE = (x: Pick<SupportView, 'upload_state' | 'server_status'>) => x.upload_state === 'LOCAL' ? 'archivo pendiente de subir' : x.server_status === 'AVAILABLE' ? 'archivo disponible en el servidor (sin revisar)' : x.server_status === 'PENDING_SCAN' ? 'archivo recibido, análisis pendiente' : x.server_status === 'REJECTED' ? 'archivo rechazado por el servidor' : `archivo ${x.server_status ?? x.upload_state}`;
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const PDF_SINTETICO = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

export function Soportes({ store, draft, editable, synthetic, act, busy }: { store: LocalStore; draft: DraftView; editable: boolean; synthetic: boolean; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; busy: boolean }) {
  const [types, setTypes] = useState<ReferenceDocumentType[]>([]);
  const [type, setType] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void store.supportTypes().then(setTypes); }, [store]);

  const aportar = async () => {
    setErr(null);
    if (!type) { setErr('Elige primero el tipo de soporte.'); return; }
    try {
      if (synthetic) {
        await act(() => store.addSupport(draft.id, writeCacheFile(PDF_SINTETICO, `soporte-${Date.now()}.pdf`), 'application/pdf', { document_type: type, title: title || 'Soporte sintético' }), 'Soporte de prueba (sintético) guardado en el dispositivo.');
      } else {
        const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
        if (r.canceled || !r.assets?.[0]) return;
        const a = r.assets[0];
        await act(() => store.addSupport(draft.id, a.uri, a.mimeType ?? '', { document_type: type, title: title || a.name || 'Soporte' }), 'Soporte guardado en el dispositivo; el archivo se sube con «Sincronizar ahora».');
      }
      setTitle('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo aportar el soporte.'); }
  };

  return (
    <Card title="Soportes documentales (PDF o imagen)">
      <Text style={s.muted}>Se vinculan a esta parcela y pasan por Documentos: tipo del catálogo, comprobación del contenido, SHA-256 y análisis. Aportar un soporte no lo revisa ni lo aprueba, y no es evidencia de ningún requisito.</Text>
      {draft.supports.length === 0 ? <Text style={s.muted}>Sin soportes.</Text> : draft.supports.map((x) => (
        <View key={x.id} style={{ marginTop: 6 }}>
          <Text style={s.p}>{x.title} · {types.find((t) => t.code === x.document_type)?.label ?? x.document_type}</Text>
          <Text style={s.muted}>{x.mime_type === 'application/pdf' ? 'PDF' : 'Imagen'} · {kb(x.size_bytes)} · SHA-256 {x.sha256.slice(0, 10)}… · {SUPPORT_STATE(x)}{x.server_detail && x.upload_state !== 'UPLOADED' ? ` (${x.server_detail})` : ''}</Text>
          {editable && x.upload_state === 'LOCAL' && <Button kind="secondary" label="Quitar este soporte" onPress={() => void act(() => store.removeSupport(draft.id, x.id), 'Soporte quitado del borrador.')} disabled={busy} />}
        </View>
      ))}
      {!editable ? null : types.length === 0
        ? <Notice tone="review" title="No hay tipos de soporte disponibles">Tu rol no aporta documentos desde el móvil, o falta sincronizar con conexión para descargar la lista de tipos. Esto no es un error.</Notice>
        : (
          <>
            <Text style={s.muted}>Tipo de soporte:</Text>
            {types.map((t) => <Button key={t.code} kind={type === t.code ? 'primary' : 'secondary'} label={`${type === t.code ? '✓ ' : ''}${t.label}`} onPress={() => setType(t.code)} disabled={busy} />)}
            <Field label="Título del soporte" value={title} onChangeText={setTitle} maxLength={160} />
            <Button kind="secondary" label={synthetic ? 'Usar soporte de prueba (PDF sintético)' : 'Elegir PDF o imagen'} hint="El archivo se copia al almacenamiento protegido del dispositivo" onPress={() => void aportar()} disabled={busy || !type} />
          </>
        )}
      {err && <Notice tone="blocked" title="No se aportó">{err}</Notice>}
    </Card>
  );
}
