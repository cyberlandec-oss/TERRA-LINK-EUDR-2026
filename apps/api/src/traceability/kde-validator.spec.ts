import { validateKde, type KdeDef, type RefResolver } from './kde-validator';
import { schemaProblems } from './kde-schema';
import { KDE_1_0_0 } from '../db/migrations/0016_kde_catalog';

// FIXTURES SINTÉTICOS: definiciones y valores de prueba. Acreditan el validador, no operaciones reales.
const KG = { allowed_units: ['KG'], dimension: 'MASS' };
const D = (code: string, o: Partial<KdeDef>): KdeDef => ({ id: code, code, version: 1, value_type: 'TEXT', requirement: 'REQUIRED', condition: null, validation: {}, ...o });
const DEFS: KdeDef[] = [
  D('F_WEIGHT', { value_type: 'QUANTITY', validation: { ...KG, positive: true } }),
  D('F_LOSS', { value_type: 'QUANTITY', validation: { ...KG, non_negative: true } }),
  D('F_NOTE', { value_type: 'TEXT', requirement: 'OPTIONAL', validation: { max_length: 10 } }),
  D('F_MEASURED', { value_type: 'BOOLEAN', requirement: 'OPTIONAL' }),
  D('F_QTY_IF_MEASURED', { value_type: 'QUANTITY', requirement: 'CONDITIONAL', condition: { kind: 'equals', kde: 'F_MEASURED', value: true }, validation: { ...KG, positive: true } }),
  D('F_DECLARED', { value_type: 'QUANTITY', requirement: 'OPTIONAL', validation: { ...KG, positive: true } }),
  D('F_REASON', { value_type: 'TEXT', requirement: 'CONDITIONAL', condition: { kind: 'quantities_differ', a: 'F_WEIGHT', b: 'F_DECLARED' }, validation: { max_length: 50 } }),
  D('F_UNDEFINED', { value_type: 'DATE', requirement: 'CONDITIONAL', condition: { kind: 'undefined_in_contract', note: 'fixture' } }),
  D('F_PRODUCT', { value_type: 'ENTITY_REF', validation: { entity: 'product' } }),
  D('F_LOT', { value_type: 'ENTITY_REF', requirement: 'OPTIONAL', validation: { entity: 'counterparty' } }), // entidad aún no disponible (D-33); «lot» ya es verificable (P0-016)
];
const ALL = new Map(DEFS.map((d) => [d.code, d]));
const OK_ID = '11111111-1111-4111-8111-111111111111';
const INACTIVE_ID = '22222222-2222-4222-8222-222222222222';
const resolver: RefResolver = async (_e, ids) => ({ found: new Set(ids.filter((i) => i === OK_ID || i === INACTIVE_ID)), inactive: new Set([INACTIVE_ID]), verifiable: true });
const run = (values: Record<string, unknown>) => validateKde(DEFS, values, resolver, ALL);
const res = (r: Awaited<ReturnType<typeof run>>, code: string) => r.items.find((i) => i.code === code)!;
const BASE = { F_WEIGHT: { value: '10.5', unit: 'KG' }, F_LOSS: { value: '0', unit: 'KG' }, F_PRODUCT: OK_ID, F_MEASURED: false };

describe('validador KDE [fixtures sintéticos]', () => {
  it('conjunto completo: compuerta abierta; 0 y false son valores presentes', async () => {
    const r = await run(BASE);
    expect(res(r, 'F_LOSS').result).toBe('PRESENT_VALID'); // 0 kg de merma ≠ ausente
    expect(res(r, 'F_MEASURED').result).toBe('PRESENT_VALID'); // false ≠ ausente
    expect(res(r, 'F_QTY_IF_MEASURED').result).toBe('NOT_APPLICABLE'); // condición falsa
    expect(res(r, 'F_NOTE').result).toBe('OPTIONAL_MISSING');
    expect(res(r, 'F_REASON').result).toBe('CONDITION_NOT_EVALUABLE'); // falta el declarado: desconocida, no falsa
    expect(res(r, 'F_UNDEFINED')).toMatchObject({ result: 'CONDITION_NOT_EVALUABLE', error_code: 'CONDITION_UNDEFINED_IN_CONTRACT' });
    expect(r.gate).toMatchObject({ transition_allowed: false, outcome: 'UNDETERMINED' }); // lo desconocido bloquea
  });

  it('requerido ausente (omitido o null) bloquea; nada se completa', async () => {
    const r = await run({ ...BASE, F_WEIGHT: null, F_PRODUCT: undefined });
    expect(res(r, 'F_WEIGHT').result).toBe('REQUIRED_MISSING');
    expect(res(r, 'F_PRODUCT').result).toBe('REQUIRED_MISSING');
    expect(r.gate).toMatchObject({ transition_allowed: false, outcome: 'INCOMPLETE' });
  });

  it('valores inválidos: 0 en positivo, número sin texto, cadena vacía, unidad incompatible o ausente, formato', async () => {
    const r = await run({ ...BASE, F_WEIGHT: { value: '0', unit: 'KG' }, F_NOTE: '   ', F_DECLARED: { value: 5, unit: 'KG' } });
    expect(res(r, 'F_WEIGHT')).toMatchObject({ result: 'PRESENT_INVALID', error_code: 'MUST_BE_POSITIVE' });
    expect(res(r, 'F_NOTE')).toMatchObject({ result: 'PRESENT_INVALID', error_code: 'TEXT_EMPTY' }); // "" no es ausente
    expect(res(r, 'F_DECLARED')).toMatchObject({ result: 'PRESENT_INVALID', error_code: 'DECIMAL_MUST_BE_STRING' });
    expect(r.gate.outcome).toBe('INVALID');
    const u = await run({ ...BASE, F_WEIGHT: { value: '10', unit: 'QQ' }, F_LOSS: { value: '1' } });
    expect(res(u, 'F_WEIGHT').error_code).toBe('UNIT_NOT_ALLOWED'); // sin conversión
    expect(res(u, 'F_LOSS').error_code).toBe('UNIT_REQUIRED'); // no se asume KG
    // Más precisión de la que se conserva: motivo propio y explícito, nunca redondeo silencioso (D-32).
    const exceso = res(await run({ ...BASE, F_WEIGHT: { value: '1.1234567', unit: 'KG' } }), 'F_WEIGHT');
    expect(exceso.error_code).toBe('DECIMAL_PRECISION_EXCEEDED');
    expect(exceso.message).toMatch(/No se redondea/);
    // Un formato sencillamente mal escrito sigue siendo DECIMAL_INVALID.
    expect(res(await run({ ...BASE, F_WEIGHT: { value: '1.2.3', unit: 'KG' } }), 'F_WEIGHT').error_code).toBe('DECIMAL_INVALID');
  });

  it('condición verdadera, falsa y no evaluable', async () => {
    expect(res(await run({ ...BASE, F_MEASURED: true }), 'F_QTY_IF_MEASURED').result).toBe('REQUIRED_MISSING');
    expect(res(await run({ ...BASE, F_MEASURED: true, F_QTY_IF_MEASURED: { value: '3', unit: 'KG' } }), 'F_QTY_IF_MEASURED').result).toBe('PRESENT_VALID');
    expect(res(await run({ ...BASE, F_MEASURED: undefined }), 'F_QTY_IF_MEASURED').result).toBe('CONDITION_NOT_EVALUABLE');
    expect(res(await run({ ...BASE, F_MEASURED: 'sí' }), 'F_QTY_IF_MEASURED').result).toBe('CONDITION_NOT_EVALUABLE'); // inválido ≠ falso
    // cantidades: iguales → no aplica; distintas → requerida; inválida → no evaluable
    expect(res(await run({ ...BASE, F_DECLARED: { value: '10.500000', unit: 'KG' } }), 'F_REASON').result).toBe('NOT_APPLICABLE');
    expect(res(await run({ ...BASE, F_DECLARED: { value: '11', unit: 'KG' } }), 'F_REASON').result).toBe('REQUIRED_MISSING');
    expect(res(await run({ ...BASE, F_DECLARED: { value: '11', unit: 'KG' }, F_REASON: 'Humedad' }), 'F_REASON').result).toBe('PRESENT_VALID');
    expect(res(await run({ ...BASE, F_DECLARED: { value: '-1', unit: 'KG' } }), 'F_REASON').result).toBe('CONDITION_NOT_EVALUABLE');
  });

  it('referencias: encontrada, ajena/inexistente (mismo resultado), inactiva y entidad aún no disponible', async () => {
    expect(res(await run({ ...BASE, F_PRODUCT: '33333333-3333-4333-8333-333333333333' }), 'F_PRODUCT')).toMatchObject({ result: 'PRESENT_INVALID', error_code: 'REFERENCE_NOT_FOUND' });
    expect(res(await run({ ...BASE, F_PRODUCT: INACTIVE_ID }), 'F_PRODUCT').error_code).toBe('REFERENCE_INACTIVE');
    expect(res(await run({ ...BASE, F_PRODUCT: 'no-uuid' }), 'F_PRODUCT').error_code).toBe('REFERENCE_FORMAT');
    const lot = await run({ ...BASE, F_LOT: OK_ID });
    expect(res(lot, 'F_LOT').result).toBe('PRESENT_NOT_VERIFIABLE'); // no cuenta como válida
    expect(lot.gate.blocking.map((b) => b.code)).toContain('F_LOT');
  });

  it('el catálogo 1.0.0 usa solo el esquema cerrado; nada ejecutable', () => {
    expect(KDE_1_0_0.flatMap((d) => schemaProblems(d))).toEqual([]);
    expect(schemaProblems({ code: 'X', value_type: 'TEXT', requirement: 'REQUIRED', condition: null, validation: { script: 'return 1' } as never })).toEqual(['X: regla «script» fuera del esquema']);
    expect(schemaProblems({ code: 'Y', value_type: 'QUANTITY', requirement: 'REQUIRED', condition: null, validation: {} })).toContain('Y: QUANTITY exige unidades y dimensión explícitas');
  });
});
