// Resumen de precisión de un conjunto de muestras (doc 10 «GPS de campo», P0-008).
// - No se inventa una precisión agregada: se informa cuántas muestras tienen precisión, cuántas no y la
//   peor CONOCIDA, con esa etiqueta.
// - Un 0 reportado cuenta como informado (se conserva tal cual; no implica precisión perfecta).
// - Si falta precisión en alguna muestra, el resumen está incompleto.
// - Sin umbrales de calidad: la política está pendiente (D-25).

export interface AccuracySummary {
  with_accuracy: number;
  without_accuracy: number;
  worst_known_m: number | null;
  complete: boolean;
  label: string;
}

const fmt = (m: number) => m.toLocaleString('es-EC', { maximumFractionDigits: 1 });

export function summarizeAccuracy(values: Array<number | null>): AccuracySummary {
  const known = values.filter((v): v is number => v !== null);
  const withAcc = known.length;
  const without = values.length - withAcc;
  const worst = withAcc ? Math.max(...known) : null;
  let label: string;
  if (values.length === 0) label = 'Sin vértices';
  else if (withAcc === 0) label = 'Precisión no informada';
  else {
    label = `${withAcc} vértice${withAcc === 1 ? '' : 's'} con precisión informada; ${without} sin informar; peor precisión conocida ${fmt(worst!)} m`;
    if (without > 0) label += ' (resumen incompleto)';
  }
  return { with_accuracy: withAcc, without_accuracy: without, worst_known_m: worst, complete: values.length > 0 && without === 0, label };
}
