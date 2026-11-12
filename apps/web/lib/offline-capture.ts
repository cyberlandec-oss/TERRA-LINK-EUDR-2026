export type OfflineCaptureStatus = 'DRAFT' | 'PENDING' | 'SYNCING' | 'CONFLICT' | 'ERROR';

export interface OfflineLocationCapture {
  operation_id: string;
  owner_key: string;
  organization_id: string;
  plot_id: string;
  expected_version: number;
  source: 'BROWSER_GEOLOCATION';
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  captured_at: string;
  status: OfflineCaptureStatus;
  confirmed: boolean;
  last_error?: string;
  capture_kind?: 'LOCATION' | 'ATTACHMENT';
}

export interface OfflineAttachmentCapture {
  operation_id: string;
  owner_key: string;
  organization_id: string;
  plot_id: string;
  capture_kind: 'ATTACHMENT';
  file_name: string;
  mime_type: string;
  title: string;
  bytes: Blob;
  document_type: 'FIELD_EVIDENCE' | 'FIELD_PHOTO';
  status: 'DRAFT' | 'PENDING' | 'SYNCING' | 'ERROR';
  last_error?: string;
}

const DB_NAME = 'terra-link-offline-capture';
const STORE = 'location-captures';
const VERSION = 1;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'operation_id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB no disponible'));
  });
}

export async function saveOfflineCapture(capture: OfflineLocationCapture): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(capture);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('No se pudo guardar el borrador local')); };
  });
}

async function listAllOfflineCaptures(ownerKey: string, organizationId: string, plotId: string): Promise<OfflineLocationCapture[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as OfflineLocationCapture[]).filter((x) => x.owner_key === ownerKey && x.organization_id === organizationId && x.plot_id === plotId));
    };
    request.onerror = () => { db.close(); reject(request.error ?? new Error('No se pudo leer la cola local')); };
  });
}

export async function listOfflineCaptures(ownerKey: string, organizationId: string, plotId: string): Promise<OfflineLocationCapture[]> {
  const rows = await listAllOfflineCaptures(ownerKey, organizationId, plotId);
  return rows.filter((x) => (x.capture_kind ?? 'LOCATION') === 'LOCATION');
}

export async function updateOfflineCapture(operationId: string, patch: Partial<OfflineLocationCapture>): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(operationId);
    get.onsuccess = () => { if (get.result) store.put({ ...get.result, ...patch }); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('No se pudo actualizar la cola local')); };
  });
}

export async function removeOfflineCapture(operationId: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(operationId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('No se pudo limpiar la cola local')); };
  });
}

export async function saveOfflineAttachment(capture: OfflineAttachmentCapture): Promise<void> {
  await saveOfflineCapture(capture as unknown as OfflineLocationCapture);
}

export async function listOfflineAttachments(ownerKey: string, organizationId: string, plotId: string): Promise<OfflineAttachmentCapture[]> {
  const rows = await listAllOfflineCaptures(ownerKey, organizationId, plotId);
  return rows.filter((row) => row.capture_kind === 'ATTACHMENT') as unknown as OfflineAttachmentCapture[];
}
