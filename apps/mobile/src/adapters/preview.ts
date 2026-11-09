// Controles de la VISTA PREVIA WEB. En Android/iOS (este archivo) no existen: el servidor es el real y no hay escenarios.
// En web, Metro usa `preview.web.ts`.
import type { FetchLike } from '../app/session-manager';

export type PreviewScenario = 'NORMAL' | 'OFFLINE' | 'CONFLICT_NEXT' | 'DEVICE_REVOKED';
export const isWebPreview = false;
export const PREVIEW_DOMAIN = '';
export const apiFetch: FetchLike | undefined = undefined;
export const previewState = (): { scenario: PreviewScenario; storageFull: boolean } => ({ scenario: 'NORMAL', storageFull: false });
export const setPreviewScenario = (_s: PreviewScenario): void => undefined;
export const setPreviewStorageFull = (_v: boolean): void => undefined;
export const expirePreviewSession = async (): Promise<void> => undefined;
export const resetPreview = (): void => undefined;
