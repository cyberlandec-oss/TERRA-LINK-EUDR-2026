import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { isStorageFull, storageFullMessage } from '../core/ports';
import type { DatasetPlot, LocalDeliveryView, LocalPlotView, LocalProducerView, LocalState, LocalStore, ReferenceData, ReferenceProducer } from '../core/store';
import { rejectionGuide, type CorrectableField } from '../core/rejections';
import { Badge, Button, Card, Field, Notice, s } from './kit';

// D — Altas sin conexión: productor nuevo y parcela nueva. Lo creado aquí es un BORRADOR LOCAL con su propia referencia hasta que el
// servidor lo acepta; sus dependientes (ubicación, vértices, fotos) citan esa referencia. No se resuelve por nombre ni por cercanía.
const msg = (e: unknown) => (isStorageFull(e) ? storageFullMessage(e) : e instanceof Error ? e.message : 'Error inesperado.');
const STATE: Record<LocalState, [string, 'neutral' | 'process' | 'valid' | 'blocked' | 'review']> = {
  DRAFT: ['Borrador local (no enviado)', 'neutral'], PENDING: ['En cola (pendiente de sincronización)', 'process'], SYNCED: ['Registrado en el servidor', 'valid'],
  REJECTED: ['Rechazado por el servidor', 'blocked'], CONFLICT: ['En conflicto', 'review'],
};

export interface AltasPermisos { producer: boolean; plot: boolean; delivery: boolean }

// Recuperación de un alta rechazada: ofrece solo los campos que el servidor puede aceptar de nuevo y explica el resto.
function Rejected({ kind, id, op, lastError, values, labels, onFix }: { kind: 'PRODUCER' | 'PLOT' | 'DELIVERY'; id: string; op: string | null; lastError: string | null; values: Partial<Record<CorrectableField, string>>; labels: Partial<Record<CorrectableField, string>>; onFix: (op: string, patch: Record<string, string | null>) => void }) {
  const g = rejectionGuide(kind, lastError);
  const [edit, setEdit] = useState<Partial<Record<CorrectableField, string>>>({});
  return (
    <View key={id}>
      <Notice tone={g.external ? 'blocked' : 'review'} title={g.external ? 'Requiere una intervención externa' : 'Puedes corregirlo'}>{g.explanation}{g.code ? ` (código ${g.code})` : ''}</Notice>
      {!g.external && op && g.fields.map((fl) => <Field key={fl} label={`Corregir: ${labels[fl] ?? fl}`} value={edit[fl] ?? values[fl] ?? ''} onChangeText={(v) => setEdit({ ...edit, [fl]: v })} maxLength={fl === 'notes' ? 500 : 40} />)}
      {!g.external && op && g.fields.length > 0 && <Button kind="secondary" label="Corregir y reenviar (el rechazo queda en el historial)" onPress={() => onFix(op, Object.fromEntries(g.fields.map((fl) => [fl, (edit[fl] ?? values[fl] ?? '').trim()])))} />}
    </View>
  );
}

export function Altas({ store, permisos }: { store: LocalStore; permisos: AltasPermisos }) {
  const canCreateProducer = permisos.producer;
  const [producers, setProducers] = useState<LocalProducerView[]>([]);
  const [plots, setPlots] = useState<LocalPlotView[]>([]);
  const [dataset, setDataset] = useState<DatasetPlot[]>([]); const [refProducers, setRefProducers] = useState<ReferenceProducer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pCode, setPCode] = useState(''); const [pFirst, setPFirst] = useState(''); const [pLast, setPLast] = useState(''); const [pLegal, setPLegal] = useState(''); const [pCommunity, setPCommunity] = useState('');
  const [qCode, setQCode] = useState(''); const [qCrop, setQCrop] = useState('Cacao'); const [qName, setQName] = useState('');
  const [chosen, setChosen] = useState<{ kind: 'SERVER' | 'LOCAL'; id: string } | null>(null);
  const [products, setProducts] = useState<ReferenceData['products']>([]); const [locations, setLocations] = useState<ReferenceData['locations']>([]);
  const [deliveries, setDeliveries] = useState<LocalDeliveryView[]>([]);
  const [dProduct, setDProduct] = useState<string | null>(null); const [dLocation, setDLocation] = useState<string | null>(null);
  const [dDate, setDDate] = useState(new Date().toISOString().slice(0, 10)); const [dQty, setDQty] = useState('');
  const [dOrigins, setDOrigins] = useState<Array<{ kind: 'SERVER' | 'LOCAL'; id: string }>>([]); const [dRegister, setDRegister] = useState(false);
  const load = useCallback(async () => { setProducers(await store.localProducers()); setPlots(await store.localPlots()); setDataset(await store.plots()); setRefProducers(await store.serverProducers()); setProducts(await store.products()); setLocations(await store.locations()); setDeliveries(await store.localDeliveries()); }, [store]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setError(null); setInfo(null); try { await fn(); setInfo(ok); await load(); } catch (e) { setError(msg(e)); } };

  // productores del servidor conocidos por las parcelas descargadas (única forma de referenciarlos: por su identificador, no por nombre)
  const serverProducers = refProducers;
  // parcelas de origen posibles: SOLO las del productor elegido (por su referencia), nunca por nombre
  const originOptions: Array<{ kind: 'SERVER' | 'LOCAL'; id: string; label: string }> = chosen ? [
    ...plots.filter((p) => p.producer.kind === chosen.kind && p.producer.id === chosen.id).map((p) => ({ kind: 'LOCAL' as const, id: p.id, label: `${p.plot_code} (nueva)` })),
    ...dataset.filter((p) => chosen.kind === 'SERVER' && p.producer_id === chosen.id).map((p) => ({ kind: 'SERVER' as const, id: p.id, label: p.plot_code })),
  ] : [];

  return (
    <>
      <Text accessibilityRole="header" style={s.h1}>Altas sin conexión</Text>
      <Notice tone="process" title="Qué es esto">Lo que registras aquí se guarda en este dispositivo con su propia referencia y se envía cuando haya red, en orden: primero el productor, después la parcela y después sus capturas. El servidor decide: puede rechazar un código repetido o un productor fuera de tu alcance. Nada de esto es una recepción, un pesaje ni una validación.</Notice>
      {!permisos.producer && !permisos.plot && !permisos.delivery && <Notice tone="review" title="Tu rol no registra altas">Con los permisos de tu rol en esta organización no puedes registrar productores, parcelas ni entregas desde el teléfono. Puedes seguir capturando en tus parcelas desde «Captura». Esto no es un error ni falta descargar datos.</Notice>}
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
          {!producers.length && <Text style={s.muted}>Aún no hay productores nuevos en este dispositivo.</Text>}
          {producers.map((p) => {
            const [label, tone] = STATE[p.state];
            return (
              <View key={p.id} style={{ marginTop: 8 }}>
                <Text style={s.p}>{p.producer_code} · {p.legal_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()}</Text>
                <Badge tone={tone}>{label}</Badge>
                {p.server_id && <Text style={s.muted}>Identificador definitivo recibido del servidor.</Text>}
                {p.last_error && p.state !== 'SYNCED' && <Text style={s.muted}>{p.last_error}</Text>}
                {p.status === 'DRAFT' && <Button kind="secondary" label="Poner el alta en cola" onPress={() => void act(() => store.enqueueLocalProducer(p.id), 'Alta del productor en cola.')} />}
                {p.state === 'REJECTED' && <Rejected kind="PRODUCER" id={p.id} op={p.operation_id} lastError={p.last_error} values={{ producer_code: p.producer_code }} labels={{ producer_code: 'código del productor' }} onFix={(op, patch) => void act(() => store.correctRejectedCreate(op, patch), 'Corrección en cola: las parcelas y entregas que dependen de este productor se reenvían con ella.')} />}
              </View>
            );
          })}
        </Card>
      )}

      {permisos.plot && <Card title="Nueva parcela">
        <Text style={s.muted}>Productor de la parcela (se referencia por su identificador, nunca por su nombre):</Text>
        {producers.filter((p) => p.state !== 'REJECTED').map((p) => (
          <Button key={p.id} kind={chosen?.id === p.id ? 'primary' : 'secondary'} label={`Nuevo: ${p.producer_code}`} onPress={() => setChosen({ kind: 'LOCAL', id: p.id })} />
        ))}
        {serverProducers.map((p) => (
          <Button key={p.id} kind={chosen?.id === p.id ? 'primary' : 'secondary'} label={`${p.producer_code}${p.display_name ? ` · ${p.display_name}` : ''}`} onPress={() => setChosen({ kind: 'SERVER', id: p.id })} />
        ))}
        {!producers.length && !serverProducers.length && <Text style={s.muted}>Sin productores disponibles en este dispositivo. Sincroniza con conexión para descargar los de tu alcance{canCreateProducer ? ' o registra un productor nuevo' : ''}.</Text>}
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
              {p.state === 'REJECTED' && <Rejected kind="PLOT" id={p.id} op={p.operation_id} lastError={p.last_error} values={{ plot_code: p.plot_code }} labels={{ plot_code: 'código de la parcela' }} onFix={(op, patch) => void act(() => store.correctRejectedCreate(op, patch), 'Corrección en cola: sus capturas y entregas se reenvían con ella.')} />}
            </View>
          );
        })}
      </Card>}
      {permisos.delivery && <Card title="Nueva entrega (declaración)">
        <Text style={s.muted}>Declaras lo que entregó un productor: cantidad en KG, producto, centro y parcelas de origen. No es una recepción, un pesaje ni un movimiento de inventario: esas son transiciones del servidor, con su autorización.</Text>
        {!products.length || !locations.length ? <Notice tone="review" title="Falta el catálogo">Tu rol sí declara entregas, pero este dispositivo aún no tiene los productos y centros: sincroniza una vez con conexión para descargarlos.</Notice> : (
          <>
            <Text style={s.muted}>Productor: {chosen ? (chosen.kind === 'LOCAL' ? `nuevo ${producers.find((p) => p.id === chosen.id)?.producer_code ?? ''}` : serverProducers.find((p) => p.id === chosen.id)?.producer_code ?? 'del servidor') : 'elígelo en la lista de productores (arriba)'}</Text>
            {products.map((p) => <Button key={p.id} kind={dProduct === p.id ? 'primary' : 'secondary'} label={`Producto: ${p.code} · ${p.name}`} onPress={() => setDProduct(p.id)} />)}
            {locations.map((l) => <Button key={l.id} kind={dLocation === l.id ? 'primary' : 'secondary'} label={`Centro: ${l.code} · ${l.name}`} onPress={() => setDLocation(l.id)} />)}
            <Field label="Fecha de entrega (AAAA-MM-DD)" value={dDate} onChangeText={setDDate} maxLength={10} />
            <Field label="Cantidad declarada (KG)" value={dQty} onChangeText={setDQty} keyboardType="decimal-pad" maxLength={16} />
            <Text style={s.muted}>Parcelas de origen del productor elegido:</Text>
            {chosen && !originOptions.length && <Text style={s.muted}>Este productor aún no tiene parcelas disponibles. Crea una parcela nueva para él y úsala de origen.</Text>}
            {originOptions.map((o) => <Button key={`${o.kind}:${o.id}`} kind={dOrigins.some((x) => x.id === o.id) ? 'primary' : 'secondary'} label={`${dOrigins.some((x) => x.id === o.id) ? '✓ ' : ''}${o.label}`} onPress={() => setDOrigins(dOrigins.some((x) => x.id === o.id) ? dOrigins.filter((x) => x.id !== o.id) : [...dOrigins, { kind: o.kind, id: o.id }])} />)}
            <Button kind={dRegister ? 'primary' : 'secondary'} label={dRegister ? 'Se pedirá REGISTRAR la declaración (si la compuerta lo permite)' : 'Dejar como borrador de entrega (recomendado)'} onPress={() => setDRegister(!dRegister)} />
            <Button label="Guardar entrega como borrador local" disabled={!chosen || !dProduct || !dLocation} onPress={() => void act(async () => {
              await store.createLocalDelivery({ producer: chosen!, product_id: dProduct!, location_id: dLocation!, delivery_date: dDate, quantity_declared: dQty.trim(), unit: 'KG', origins: dOrigins, register: dRegister });
              setDQty(''); setDOrigins([]);
            }, 'Entrega guardada como borrador local.')} />
          </>
        )}
        {deliveries.map((d) => {
          const [label, tone] = STATE[d.state];
          return (
            <View key={d.id} style={{ marginTop: 8 }}>
              <Text style={s.p}>{d.quantity_declared} {d.unit} · {d.delivery_date} · {d.origins.length} parcela(s) de origen</Text>
              <Badge tone={tone}>{label}</Badge>
              {d.server_id && <Text style={s.muted}>Declaración registrada con su identificador definitivo. Sigue siendo una declaración: la recepción es otro paso.</Text>}
              {d.last_error && d.state !== 'SYNCED' && <Text style={s.muted}>{d.last_error}</Text>}
              {d.status === 'DRAFT' && <Button kind="secondary" label="Poner la declaración en cola" onPress={() => void act(() => store.enqueueLocalDelivery(d.id), 'Declaración en cola.')} />}
              {d.state === 'REJECTED' && <Rejected kind="DELIVERY" id={d.id} op={d.operation_id} lastError={d.last_error} values={{ quantity_declared: d.quantity_declared, delivery_date: d.delivery_date, notes: d.notes ?? '' }} labels={{ quantity_declared: 'cantidad (KG)', delivery_date: 'fecha (AAAA-MM-DD)', notes: 'notas' }} onFix={(op, patch) => void act(() => store.correctRejectedCreate(op, patch), 'Corrección en cola.')} />}
            </View>
          );
        })}
      </Card>}
    </>
  );
}
