import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { isStorageFull, storageFullMessage } from '../core/ports';
import type { DatasetPlot, LocalPlotView, LocalProducerView, LocalState, LocalStore } from '../core/store';
import { Badge, Button, Card, Field, Notice, s } from './kit';

// D — Altas sin conexión: productor nuevo y parcela nueva. Lo creado aquí es un BORRADOR LOCAL con su propia referencia hasta que el
// servidor lo acepta; sus dependientes (ubicación, vértices, fotos) citan esa referencia. No se resuelve por nombre ni por cercanía.
const msg = (e: unknown) => (isStorageFull(e) ? storageFullMessage(e) : e instanceof Error ? e.message : 'Error inesperado.');
const STATE: Record<LocalState, [string, 'neutral' | 'process' | 'valid' | 'blocked' | 'review']> = {
  DRAFT: ['Borrador local (no enviado)', 'neutral'], PENDING: ['En cola (pendiente de sincronización)', 'process'], SYNCED: ['Registrado en el servidor', 'valid'],
  REJECTED: ['Rechazado por el servidor', 'blocked'], CONFLICT: ['En conflicto', 'review'],
};

export function Altas({ store, canCreateProducer }: { store: LocalStore; canCreateProducer: boolean }) {
  const [producers, setProducers] = useState<LocalProducerView[]>([]);
  const [plots, setPlots] = useState<LocalPlotView[]>([]);
  const [dataset, setDataset] = useState<DatasetPlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pCode, setPCode] = useState(''); const [pFirst, setPFirst] = useState(''); const [pLast, setPLast] = useState(''); const [pLegal, setPLegal] = useState(''); const [pCommunity, setPCommunity] = useState('');
  const [qCode, setQCode] = useState(''); const [qCrop, setQCrop] = useState('Cacao'); const [qName, setQName] = useState('');
  const [chosen, setChosen] = useState<{ kind: 'SERVER' | 'LOCAL'; id: string } | null>(null);
  const [fix, setFix] = useState<Record<string, string>>({});
  const load = useCallback(async () => { setProducers(await store.localProducers()); setPlots(await store.localPlots()); setDataset(await store.plots()); }, [store]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setError(null); setInfo(null); try { await fn(); setInfo(ok); await load(); } catch (e) { setError(msg(e)); } };

  // productores del servidor conocidos por las parcelas descargadas (única forma de referenciarlos: por su identificador, no por nombre)
  const serverProducers = Array.from(new Map(dataset.map((p) => [p.producer_id, p])).values());
  const syncedLocal = new Set(plots.filter((p) => p.server_id).map((p) => p.server_id));
  void syncedLocal;

  return (
    <>
      <Text accessibilityRole="header" style={s.h1}>Altas sin conexión</Text>
      <Notice tone="process" title="Qué es esto">Lo que registras aquí se guarda en este dispositivo con su propia referencia y se envía cuando haya red, en orden: primero el productor, después la parcela y después sus capturas. El servidor decide: puede rechazar un código repetido o un productor fuera de tu alcance. Nada de esto es una recepción, un pesaje ni una validación.</Notice>
      {error && <Notice tone="blocked" title="No se completó">{error}</Notice>}
      {info && <Notice tone="valid">{info}</Notice>}

      {canCreateProducer && (
        <Card title="Nuevo productor">
          <Field label="Código del productor" value={pCode} onChangeText={setPCode} maxLength={40} autoCapitalize="characters" />
          <Field label="Nombre" value={pFirst} onChangeText={setPFirst} maxLength={100} />
          <Field label="Apellido" value={pLast} onChangeText={setPLast} maxLength={100} />
          <Field label="o Razón social (si no hay nombre y apellido)" value={pLegal} onChangeText={setPLegal} maxLength={200} />
          <Field label="Comunidad" value={pCommunity} onChangeText={setPCommunity} maxLength={120} />
          <Button label="Guardar productor como borrador local" onPress={() => void act(async () => {
            await store.createLocalProducer({ producer_code: pCode, first_name: pFirst, last_name: pLast, legal_name: pLegal, community: pCommunity });
            setPCode(''); setPFirst(''); setPLast(''); setPLegal(''); setPCommunity('');
          }, 'Productor guardado como borrador local. Ponlo en cola cuando esté listo.')} />
          {producers.map((p) => {
            const [label, tone] = STATE[p.state];
            return (
              <View key={p.id} style={{ marginTop: 8 }}>
                <Text style={s.p}>{p.producer_code} · {p.legal_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()}</Text>
                <Badge tone={tone}>{label}</Badge>
                {p.server_id && <Text style={s.muted}>Identificador definitivo recibido del servidor.</Text>}
                {p.last_error && p.state !== 'SYNCED' && <Text style={s.muted}>{p.last_error}</Text>}
                {p.status === 'DRAFT' && <Button kind="secondary" label="Poner el alta en cola" onPress={() => void act(() => store.enqueueLocalProducer(p.id), 'Alta del productor en cola.')} />}
              </View>
            );
          })}
        </Card>
      )}

      <Card title="Nueva parcela">
        <Text style={s.muted}>Productor de la parcela (se referencia por su identificador, nunca por su nombre):</Text>
        {producers.filter((p) => p.state !== 'REJECTED').map((p) => (
          <Button key={p.id} kind={chosen?.id === p.id ? 'primary' : 'secondary'} label={`Nuevo: ${p.producer_code}`} onPress={() => setChosen({ kind: 'LOCAL', id: p.id })} />
        ))}
        {serverProducers.map((p) => (
          <Button key={p.producer_id} kind={chosen?.id === p.producer_id ? 'primary' : 'secondary'} label={`${p.producer_code ?? 'Productor'}${p.producer_display_name ? ` · ${p.producer_display_name}` : ''}`} onPress={() => setChosen({ kind: 'SERVER', id: p.producer_id })} />
        ))}
        {!producers.length && !serverProducers.length && <Text style={s.muted}>Sin productores disponibles: descarga tus parcelas con conexión{canCreateProducer ? ' o registra un productor nuevo' : ''}.</Text>}
        <Field label="Código de la parcela" value={qCode} onChangeText={setQCode} maxLength={40} autoCapitalize="characters" />
        <Field label="Cultivo" value={qCrop} onChangeText={setQCrop} maxLength={60} />
        <Field label="Nombre de la parcela (opcional)" value={qName} onChangeText={setQName} maxLength={120} />
        <Button label="Guardar parcela como borrador local" disabled={!chosen} onPress={() => void act(async () => {
          await store.createLocalPlot({ producer: chosen!, plot_code: qCode, crop: qCrop, name: qName });
          setQCode(''); setQName('');
        }, 'Parcela guardada como borrador local.')} />
        {plots.map((p) => {
          const [label, tone] = STATE[p.state];
          return (
            <View key={p.id} style={{ marginTop: 8 }}>
              <Text style={s.p}>{p.plot_code} · {p.crop}{p.name ? ` · ${p.name}` : ''}</Text>
              <Badge tone={tone}>{label}</Badge>
              {p.server_id && <Text style={s.muted}>Identificador definitivo recibido del servidor.</Text>}
              {p.last_error && p.state !== 'SYNCED' && <Text style={s.muted}>{p.last_error}</Text>}
              {p.status === 'DRAFT' && <Button kind="secondary" label="Poner el alta en cola" onPress={() => void act(() => store.enqueueLocalPlot(p.id), 'Alta de la parcela en cola.')} />}
              {p.state === 'REJECTED' && p.operation_id && (
                <>
                  <Field label="Corregir el código de la parcela" value={fix[p.id] ?? p.plot_code} onChangeText={(v) => setFix({ ...fix, [p.id]: v })} maxLength={40} />
                  <Button kind="secondary" label="Corregir y reenviar (el rechazo queda en el historial)" onPress={() => void act(() => store.correctRejectedCreate(p.operation_id!, { plot_code: (fix[p.id] ?? p.plot_code).trim() }), 'Corrección en cola.')} />
                </>
              )}
            </View>
          );
        })}
      </Card>
    </>
  );
}
