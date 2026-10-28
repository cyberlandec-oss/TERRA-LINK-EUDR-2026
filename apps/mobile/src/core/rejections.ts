// D — Qué puede hacer la persona ante un alta rechazada por el servidor. Solo ofrece la corrección que el servidor puede aceptar de
// verdad (el mismo registro, con su referencia local); lo que depende de otra persona o de otro dato se explica sin ofrecer reintentos
// inútiles. El código del rechazo viene del servidor en `last_error` con formato «CODIGO: mensaje».
export type AltaKind = 'PRODUCER' | 'PLOT' | 'DELIVERY';
export type CorrectableField = 'producer_code' | 'plot_code' | 'quantity_declared' | 'delivery_date' | 'notes';
export interface RejectionGuide {
  code: string | null;
  /** Campos que el usuario puede corregir y reenviar (se conserva la referencia local, el rechazo y la sustituta). */
  fields: CorrectableField[];
  /** Explicación en español de qué pasó y qué sigue. */
  explanation: string;
  /** true si requiere una acción fuera de este dispositivo (otra persona, permisos, datos en el servidor). */
  external: boolean;
}

export function rejectionCode(lastError: string | null): string | null {
  const m = /^([A-Z][A-Z0-9_]+):/.exec((lastError ?? '').trim());
  return m ? m[1] : null;
}

const CODE_FIELD: Record<AltaKind, CorrectableField> = { PRODUCER: 'producer_code', PLOT: 'plot_code', DELIVERY: 'quantity_declared' };

export function rejectionGuide(kind: AltaKind, lastError: string | null): RejectionGuide {
  const code = rejectionCode(lastError);
  const dependentsNote = kind === 'DELIVERY' ? '' : ' Lo que depende de este registro (parcelas, capturas, entregas) sigue en cola y se reenvía con la corrección, sin duplicarse.';
  if (code === 'PRODUCER_CODE_TAKEN' || code === 'PLOT_CODE_TAKEN') return { code, fields: [CODE_FIELD[kind]], external: false,
    explanation: `Ese código ya existe en tu organización. Cámbialo y reenvía.${dependentsNote}` };
  if (code === 'VALIDATION_FAILED' || code === 'PAYLOAD_INVALID') return { code, fields: kind === 'DELIVERY' ? ['quantity_declared', 'delivery_date', 'notes'] : [CODE_FIELD[kind]], external: false,
    explanation: `El servidor no aceptó el contenido. Revisa los datos y reenvía.${dependentsNote}` };
  if (kind === 'DELIVERY' && (code === 'ORIGIN_QUANTITY_EXCEEDS' || code === 'MUST_BE_POSITIVE' || code === 'DATE_INVALID' || code === 'CAPTURED_AT_IN_FUTURE')) return { code, fields: ['quantity_declared', 'delivery_date'], external: false,
    explanation: 'La cantidad o la fecha no son válidas para el servidor. Corrígelas y reenvía.' };
  if (code === 'PERMISSION_DENIED' || code === 'FORBIDDEN') return { code, fields: [], external: true,
    explanation: 'Tu rol no tiene este permiso en la organización (o cambió después de iniciar sesión). Reenviar no lo arregla: pide a quien administra tu organización que lo revise. El registro y el rechazo se conservan en este dispositivo.' };
  if (code === 'PRODUCER_INACTIVE' || code === 'PLOT_INACTIVE' || code === 'LOCATION_INACTIVE') return { code, fields: [], external: true,
    explanation: 'El productor, la parcela o el centro ya no está activo en el servidor. Requiere que lo reactive quien administra la organización; no se reenvía hasta entonces.' };
  if (code === 'PRODUCER_REFERENCE_INVALID' || code === 'ORIGIN_REFERENCE_INVALID' || code === 'NOT_FOUND' || code === 'ORIGIN_DUPLICATED' || code === 'ORIGIN_PRODUCER_MISMATCH') return { code, fields: [], external: true,
    explanation: 'Una referencia del registro (productor, parcela de origen, producto o centro) no es válida o salió de tu alcance en el servidor. No se corrige aquí: sincroniza para actualizar tus datos y crea el registro de nuevo si procede. Lo rechazado se conserva como historial.' };
  return { code, fields: [], external: true,
    explanation: 'El servidor rechazó este registro por una razón que no se corrige con un cambio simple en el dispositivo. Se conserva con su rechazo; consulta a quien administra tu organización con el código indicado.' };
}
