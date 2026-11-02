import { PENDING_ENTITIES, type Condition, type Requirement, type Validation, type ValueType } from './kde-schema';

// P0-014 — validador de KDE. Validadores tipados y acotados; nunca evalúa código del catálogo.
// Resultados por dato:
//   PRESENT_VALID · PRESENT_INVALID · PRESENT_NOT_VERIFIABLE (referencia a una entidad que aún no existe:
//   no es válida ni inválida) · REQUIRED_MISSING · OPTIONAL_MISSING · NOT_APPLICABLE ·
//   CONDITION_NOT_EVALUABLE (condición desconocida: no equivale a falsa).
// Ausencia = clave omitida o `null`. `0`, `false` y `""` son valores PRESENTES: se validan por su tipo
// (por ejemplo `""` en TEXT es inválido, `0` en una cantidad positiva es inválido). No se completan
// faltantes, no se convierten unidades ni se normalizan valores.
// Compuerta: una operación futura solo puede avanzar si `gate.transition_allowed`; cualquier dato
// REQUIRED_MISSING, PRESENT_INVALID, PRESENT_NOT_VERIFIABLE o CONDITION_NOT_EVALUABLE la bloquea.

export type KdeResult = 'PRESENT_VALID' | 'PRESENT_INVALID' | 'PRESENT_NOT_VERIFIABLE' | 'REQUIRED_MISSING' | 'OPTIONAL_MISSING' | 'NOT_APPLICABLE' | 'CONDITION_NOT_EVALUABLE' | 'DECLARED_UNKNOWN';
// DECLARED_UNKNOWN (P0-012, D-34): el dato se declaró expresamente como desconocido. Es un pendiente, no un valor válido.
export const BLOCKING: KdeResult[] = ['REQUIRED_MISSING', 'PRESENT_INVALID', 'PRESENT_NOT_VERIFIABLE', 'CONDITION_NOT_EVALUABLE', 'DECLARED_UNKNOWN'];

export interface KdeDef {
  id: string; code: string; version: number; value_type: ValueType; requirement: Requirement;
  condition: Condition | null; validation: Validation;
}

/** Resuelve referencias en la organización y el alcance del usuario. Devuelve los ids válidos e inactivos. */
export type RefResolver = (entity: string, ids: string[]) => Promise<{ found: Set<string>; inactive: Set<string>; verifiable: boolean }>;

export interface KdeItem { code: string; reference: string; result: KdeResult; error_code: string | null; message: string; action: string | null }

/**
 * Detalle de una compuerta bloqueada, tal como se devuelve al cliente.
 * El validador ya redacta el motivo y la acción de cada dato; omitirlos dejaba al usuario con un código
 * («DECIMAL_PRECISION_EXCEEDED») y sin saber qué corregir. Se rechaza **con su motivo** (D-32).
 */
export const gateDetails = (blocking: Array<{ code: string; result: string; error_code: string | null; message: string }>) =>
  blocking.map((b) => ({ field: b.code, reason: b.error_code ?? b.result, message: b.message }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^-?\d{1,14}(\.\d{1,6})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const isAbsent = (v: unknown) => v === undefined || v === null;

/** Decimal en string → entero escalado a 6 decimales (comparación exacta, sin coma flotante). */
export function scaled(s: string): bigint {
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  const v = BigInt(i) * 1_000_000n + BigInt((f + '000000').slice(0, 6));
  return neg ? -v : v;
}
const validDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

interface Check { ok: boolean; code?: string; message?: string; action?: string }
const bad = (code: string, message: string, action: string): Check => ({ ok: false, code, message, action });

function checkNumber(v: unknown, val: Validation, integer: boolean): Check {
  if (typeof v !== 'string') return bad('DECIMAL_MUST_BE_STRING', 'El valor debe enviarse como texto decimal (p. ej. "12.5").', 'Envía el número como texto, sin convertirlo.');
  if (integer ? !/^-?\d{1,14}$/.test(v) : !DECIMAL.test(v)) {
    // Precisión superior a la que el almacenamiento conserva: se RECHAZA con su motivo. Nunca se redondea al
    // escribir, porque redondear descartaría en silencio la precisión que informó quien midió (D-32).
    const decimales = /^-?\d+\.(\d+)$/.exec(v)?.[1]?.length ?? 0;
    if (!integer && decimales > 6) return bad('DECIMAL_PRECISION_EXCEEDED', `El valor tiene ${decimales} decimales y solo se conservan 6. No se redondea: corrige el valor a la precisión que se puede guardar.`, 'Envía el valor con 6 decimales como máximo.');
    return bad(integer ? 'INTEGER_INVALID' : 'DECIMAL_INVALID', integer ? 'Debe ser un número entero.' : 'Debe ser un decimal con hasta 6 decimales.', 'Corrige el formato del número.');
  }
  const n = scaled(v);
  if (val.positive && n <= 0n) return bad('MUST_BE_POSITIVE', 'Debe ser mayor que cero.', 'Registra un valor mayor que cero.');
  if (val.non_negative && n < 0n) return bad('MUST_BE_NON_NEGATIVE', 'No puede ser negativo.', 'Registra cero o un valor positivo.');
  // Tope ESTRUCTURAL del dato (un porcentaje no pasa de 100). No es un límite de aceptación de calidad.
  if (val.max !== undefined && n > scaled(String(val.max))) return bad('ABOVE_MAXIMUM', `No puede superar ${val.max}.`, 'Corrige el valor; este tope es estructural, no un criterio de calidad.');
  return { ok: true };
}

function checkValue(type: ValueType, v: unknown, val: Validation): Check {
  switch (type) {
    case 'QUANTITY': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('QUANTITY_SHAPE', 'Debe incluir valor y unidad: { "value": "…", "unit": "…" }.', 'Envía la cantidad con su unidad explícita.');
      const q = v as { value?: unknown; unit?: unknown };
      if (isAbsent(q.unit) || q.unit === '') return bad('UNIT_REQUIRED', 'Falta la unidad de la cantidad.', 'Indica la unidad; no se asume ninguna.');
      if (typeof q.unit !== 'string' || !val.allowed_units?.includes(q.unit)) return bad('UNIT_NOT_ALLOWED', `Unidad no admitida para este dato (admitidas: ${val.allowed_units?.join(', ')}).`, 'Usa una unidad admitida; no se convierten unidades.');
      if (isAbsent(q.value)) return bad('QUANTITY_VALUE_REQUIRED', 'Falta el valor de la cantidad.', 'Indica el valor medido.');
      return checkNumber(q.value, val, false);
    }
    case 'DECIMAL': return checkNumber(v, val, false);
    case 'INTEGER': return checkNumber(v, val, true);
    case 'TEXT': {
      if (typeof v !== 'string') return bad('TEXT_INVALID', 'Debe ser texto.', 'Corrige el valor.');
      if (v.trim() === '') return bad('TEXT_EMPTY', 'El texto está vacío.', 'Completa el dato o déjalo ausente si no aplica; un texto vacío no cuenta como dato.');
      if (val.max_length && v.length > val.max_length) return bad('TEXT_TOO_LONG', `Supera ${val.max_length} caracteres.`, 'Acorta el texto.');
      if (val.pattern === 'ISO_4217' && !/^[A-Z]{3}$/.test(v)) return bad('CURRENCY_FORMAT', 'La moneda debe ser un código de 3 letras mayúsculas (ISO 4217).', 'Corrige el código de moneda.');
      return { ok: true };
    }
    case 'BOOLEAN': return typeof v === 'boolean' ? { ok: true } : bad('BOOLEAN_INVALID', 'Debe ser verdadero o falso.', 'Envía true o false.');
    case 'DATE': return typeof v === 'string' && validDate(v) ? { ok: true } : bad('DATE_INVALID', 'Debe ser una fecha válida AAAA-MM-DD.', 'Corrige la fecha.');
    case 'DATETIME': return typeof v === 'string' && DATETIME.test(v) && !Number.isNaN(Date.parse(v)) ? { ok: true } : bad('DATETIME_INVALID', 'Debe ser fecha y hora ISO 8601 con zona (Z o ±hh:mm).', 'Incluye la zona horaria; no se asume ninguna.');
    case 'DATE_RANGE': {
      const r = v as { start?: unknown; end?: unknown };
      if (!r || typeof r !== 'object' || typeof r.start !== 'string' || typeof r.end !== 'string' || !validDate(r.start) || !validDate(r.end)) return bad('DATE_RANGE_INVALID', 'Debe ser { "start": "AAAA-MM-DD", "end": "AAAA-MM-DD" }.', 'Indica inicio y fin.');
      return r.start <= r.end ? { ok: true } : bad('DATE_RANGE_INVERTED', 'El inicio es posterior al fin.', 'Corrige el periodo.');
    }
    case 'HARVEST_PERIOD': {
      // Precisión declarada (D-34): DAY = fechas civiles; MONTH = AAAA-MM o intervalo de meses; UNKNOWN = sin fechas.
      const r = v as { precision?: unknown; start?: unknown; end?: unknown };
      if (!r || typeof r !== 'object' || Array.isArray(r)) return bad('HARVEST_PERIOD_SHAPE', 'Debe ser { "precision": "DAY" | "MONTH" | "UNKNOWN", "start", "end" }.', 'Indica la precisión del periodo.');
      if (r.precision === 'UNKNOWN') return isAbsent(r.start) && isAbsent(r.end) ? { ok: true } : bad('HARVEST_PERIOD_UNKNOWN_WITH_DATES', 'Un periodo desconocido no lleva fechas.', 'Quita las fechas o elige la precisión correspondiente.');
      if (r.precision === 'DAY') {
        if (typeof r.start !== 'string' || typeof r.end !== 'string' || !validDate(r.start) || !validDate(r.end)) return bad('HARVEST_PERIOD_DAY_INVALID', 'Con precisión de día, inicio y fin deben ser fechas válidas AAAA-MM-DD.', 'Corrige las fechas.');
        return r.start <= r.end ? { ok: true } : bad('HARVEST_PERIOD_INVERTED', 'El inicio es posterior al fin.', 'Corrige el periodo.');
      }
      if (r.precision === 'MONTH') {
        const M = /^\d{4}-(0[1-9]|1[0-2])$/;
        if (typeof r.start !== 'string' || typeof r.end !== 'string' || !M.test(r.start) || !M.test(r.end)) return bad('HARVEST_PERIOD_MONTH_INVALID', 'Con precisión de mes, inicio y fin deben ser AAAA-MM (un mes: inicio = fin).', 'Corrige los meses; no se completan días.');
        return r.start <= r.end ? { ok: true } : bad('HARVEST_PERIOD_INVERTED', 'El mes inicial es posterior al final.', 'Corrige el periodo.');
      }
      return bad('HARVEST_PERIOD_PRECISION', 'Precisión no admitida (DAY, MONTH o UNKNOWN).', 'Elige la precisión declarada.');
    }
    case 'ENUM': return typeof v === 'string' && val.values?.includes(v) ? { ok: true } : bad('ENUM_INVALID', `Valor no admitido (admitidos: ${val.values?.join(', ')}).`, 'Elige un valor del catálogo.');
    case 'ENTITY_REF': return typeof v === 'string' && UUID.test(v) ? { ok: true } : bad('REFERENCE_FORMAT', 'Debe ser un identificador válido.', 'Selecciona el registro de la lista.');
    case 'ENTITY_REF_LIST': {
      if (!Array.isArray(v)) return bad('REFERENCE_LIST_FORMAT', 'Debe ser una lista de identificadores.', 'Selecciona los registros.');
      if (v.length < (val.min_items ?? 0)) return bad('REFERENCE_LIST_TOO_SHORT', `Se necesita al menos ${val.min_items}.`, 'Agrega los registros que faltan o registra el dato como ausente.');
      return v.every((x) => typeof x === 'string' && UUID.test(x)) && new Set(v).size === v.length ? { ok: true } : bad('REFERENCE_LIST_FORMAT', 'La lista tiene identificadores inválidos o repetidos.', 'Corrige la lista.');
    }
  }
}

type Tri = 'TRUE' | 'FALSE' | 'UNKNOWN';

export async function validateKde(defs: KdeDef[], values: Record<string, unknown>, resolve: RefResolver, allDefsByCode: Map<string, KdeDef>) {
  const refCheck = async (d: KdeDef, v: unknown): Promise<KdeResult | Check> => {
    const ids = d.value_type === 'ENTITY_REF' ? [v as string] : (v as string[]);
    const entity = d.validation.entity!;
    if (entity in PENDING_ENTITIES) return 'PRESENT_NOT_VERIFIABLE';
    const r = await resolve(entity, ids);
    if (!r.verifiable) return 'PRESENT_NOT_VERIFIABLE';
    if (ids.some((id) => !r.found.has(id))) return bad('REFERENCE_NOT_FOUND', 'No existe o no está disponible para ti.', 'Selecciona un registro de tu organización al que tengas acceso.');
    if (ids.some((id) => r.inactive.has(id))) return entity === 'document'
      ? bad('DOCUMENT_NOT_AVAILABLE', 'El documento no está disponible: su análisis antimalware está pendiente, falló o lo rechazó.', 'Espera el análisis o sube una versión válida.')
      : bad('REFERENCE_INACTIVE', 'El registro está inactivo.', 'Selecciona un registro activo.');
    return { ok: true };
  };
  // Validez de cada valor presente (incluye valores usados por condiciones aunque pertenezcan a otro hito).
  const validity = async (d: KdeDef): Promise<KdeResult | Check | null> => {
    const v = values[d.code];
    if (isAbsent(v)) return null;
    const c = checkValue(d.value_type, v, d.validation);
    if (!c.ok) return c;
    if (d.value_type === 'ENTITY_REF' || d.value_type === 'ENTITY_REF_LIST') return refCheck(d, v);
    return c;
  };
  const cache = new Map<string, KdeResult | Check | null>();
  const validityOf = async (code: string) => {
    if (!cache.has(code)) {
      const d = allDefsByCode.get(code);
      cache.set(code, d ? await validity(d) : null);
    }
    return cache.get(code)!;
  };
  const isValidPresent = (r: KdeResult | Check | null) => r !== null && typeof r === 'object' && r.ok;

  const evalCondition = async (c: Condition): Promise<Tri> => {
    if (c.kind === 'undefined_in_contract') return 'UNKNOWN';
    if (c.kind === 'present') {
      const v = values[c.kde];
      if (isAbsent(v)) return 'FALSE';
      return isValidPresent(await validityOf(c.kde)) ? 'TRUE' : 'UNKNOWN';
    }
    if (c.kind === 'equals') {
      if (isAbsent(values[c.kde]) || !isValidPresent(await validityOf(c.kde))) return 'UNKNOWN';
      return values[c.kde] === c.value ? 'TRUE' : 'FALSE';
    }
    // quantities_differ: ambas presentes y válidas y con la misma unidad (sin conversión)
    const [a, b] = [values[c.a] as { value: string; unit: string }, values[c.b] as { value: string; unit: string }];
    if (!isValidPresent(await validityOf(c.a)) || !isValidPresent(await validityOf(c.b))) return 'UNKNOWN';
    if (a.unit !== b.unit) return 'UNKNOWN';
    return scaled(a.value) !== scaled(b.value) ? 'TRUE' : 'FALSE';
  };

  const items: KdeItem[] = [];
  for (const d of defs) {
    const reference = `${d.code}@${d.version}`;
    const v = values[d.code];
    const absent = isAbsent(v);
    let applies: Tri = 'TRUE';
    if (d.requirement === 'CONDITIONAL') applies = await evalCondition(d.condition!);
    if (absent) {
      if (d.requirement === 'REQUIRED' || applies === 'TRUE' && d.requirement === 'CONDITIONAL') items.push({ code: d.code, reference, result: 'REQUIRED_MISSING', error_code: 'REQUIRED', message: 'Dato requerido ausente.', action: 'Registra el dato; si se desconoce, queda como faltante y bloquea la operación.' });
      else if (d.requirement === 'OPTIONAL') items.push({ code: d.code, reference, result: 'OPTIONAL_MISSING', error_code: null, message: 'Dato opcional no registrado.', action: null });
      else if (applies === 'FALSE') items.push({ code: d.code, reference, result: 'NOT_APPLICABLE', error_code: null, message: 'No aplica: la condición no se cumple.', action: null });
      else items.push({ code: d.code, reference, result: 'CONDITION_NOT_EVALUABLE', error_code: d.condition?.kind === 'undefined_in_contract' ? 'CONDITION_UNDEFINED_IN_CONTRACT' : 'CONDITION_UNKNOWN', message: d.condition?.kind === 'undefined_in_contract' ? 'La condición de este dato no está definida en el contrato.' : 'No se puede saber si el dato es necesario: falta información para evaluar la condición.', action: d.condition?.kind === 'undefined_in_contract' ? 'Requiere decisión de producto (D-34).' : 'Completa los datos de los que depende la condición.' });
      continue;
    }
    const r = await validityOf(d.code);
    if (r === 'PRESENT_NOT_VERIFIABLE') { items.push({ code: d.code, reference, result: 'PRESENT_NOT_VERIFIABLE', error_code: 'REFERENCE_TYPE_NOT_AVAILABLE', message: `La referencia no se puede verificar todavía (entidad prevista en ${PENDING_ENTITIES[d.validation.entity!] ?? 'una historia futura'}).`, action: 'No cuenta como válida hasta que la entidad exista.' }); continue; }
    const c = r as Check;
    if (c.ok && d.value_type === 'HARVEST_PERIOD' && (v as { precision?: string }).precision === 'UNKNOWN') {
      items.push({ code: d.code, reference, result: 'DECLARED_UNKNOWN', error_code: 'DECLARED_UNKNOWN', message: 'Declarado como desconocido: queda pendiente.', action: 'Complétalo cuando se conozca; no se infiere de otros datos.' });
      continue;
    }
    items.push(c.ok
      ? { code: d.code, reference, result: 'PRESENT_VALID', error_code: null, message: 'Correcto.', action: null }
      : { code: d.code, reference, result: 'PRESENT_INVALID', error_code: c.code!, message: c.message!, action: c.action! });
  }
  const blocking = items.filter((i) => BLOCKING.includes(i.result));
  return {
    items,
    gate: {
      transition_allowed: blocking.length === 0,
      blocking: blocking.map((i) => ({ code: i.code, result: i.result, error_code: i.error_code })),
      outcome: blocking.some((i) => i.result === 'PRESENT_INVALID') ? 'INVALID' : blocking.some((i) => i.result === 'REQUIRED_MISSING' || i.result === 'DECLARED_UNKNOWN') ? 'INCOMPLETE' : blocking.length ? 'UNDETERMINED' : 'COMPLETE',
    },
  };
}
