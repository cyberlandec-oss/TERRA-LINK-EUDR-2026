import { periodoDeProduccion } from './indicadores';

// Contrato adoptado: el período de producción NO se deduce de la fecha de entrega. Rastrear la procedencia no
// basta; lo deducido no puede ocupar el lugar del dato declarado. Estos casos son los tres acordados.

/** Fila tal como la devuelve `deliveries`, con los límites que el CHECK 0021 obliga a mantener coherentes. */
const fila = (p: Partial<Parameters<typeof periodoDeProduccion>[0][number]> = {}) => ({
  harvest_precision: null, harvest_start: null, harvest_end: null,
  harvest_derived_start: null, harvest_derived_end: null, ...p,
});

describe('periodoDeProduccion', () => {
  it('cosecha declarada: conserva fechas y precisión originales, no los límites expandidos', () => {
    // Un MONTH declarado se guarda además expandido a días para consultar por rango. Lo que se publica es
    // «2026-03» con precisión de mes, NUNCA «2026-03-01 – 2026-03-31» como si fuese una fecha exacta.
    const p = periodoDeProduccion([
      fila({ harvest_precision: 'MONTH', harvest_start: '2026-03', harvest_end: '2026-03', harvest_derived_start: '2026-03-01', harvest_derived_end: '2026-03-31' }),
    ]);
    expect(p).toMatchObject({ precision: 'MONTH', start: '2026-03', end: '2026-03', inherited_range: null });
    expect(p.start).not.toBe('2026-03-01');
  });

  it('cosecha declarada por día: se conserva tal cual', () => {
    const p = periodoDeProduccion([
      fila({ harvest_precision: 'DAY', harvest_start: '2026-04-02', harvest_end: '2026-04-09', harvest_derived_start: '2026-04-02', harvest_derived_end: '2026-04-09' }),
    ]);
    expect(p).toMatchObject({ precision: 'DAY', start: '2026-04-02', end: '2026-04-09' });
  });

  it('precisiones mezcladas: manda la más gruesa, sin fingir exactitud', () => {
    const p = periodoDeProduccion([
      fila({ harvest_precision: 'DAY', harvest_start: '2026-04-02', harvest_end: '2026-04-02', harvest_derived_start: '2026-04-02', harvest_derived_end: '2026-04-02' }),
      fila({ harvest_precision: 'MONTH', harvest_start: '2026-05', harvest_end: '2026-05', harvest_derived_start: '2026-05-01', harvest_derived_end: '2026-05-31' }),
    ]);
    expect(p.precision).toBe('MONTH');
  });

  it('cosecha desconocida y entrega conocida: el período sigue DESCONOCIDO', () => {
    // La entrega existe y tiene fecha; eso no produce período. El CHECK deja los derivados en NULL.
    const p = periodoDeProduccion([fila({ harvest_precision: 'UNKNOWN' })]);
    expect(p).toMatchObject({ precision: 'UNKNOWN', start: null, end: null, inherited_range: null });
    expect(p.note).toMatch(/desconocido/i);
    // Y en ningún caso aparece una precisión deducida.
    expect(p.precision).not.toBe('DERIVED');
  });

  it('sin cosecha declarada: desconocido, y se dice que no se deduce de la entrega', () => {
    const p = periodoDeProduccion([fila()]);
    expect(p).toMatchObject({ precision: 'NONE', start: null, end: null });
    expect(p.note).toMatch(/no se deduce de la fecha de entrega/i);
  });

  it('declaración parcial del lote: el resto sigue desconocido y queda dicho', () => {
    const p = periodoDeProduccion([
      fila({ harvest_precision: 'DAY', harvest_start: '2026-04-02', harvest_end: '2026-04-02', harvest_derived_start: '2026-04-02', harvest_derived_end: '2026-04-02' }),
      fila({ harvest_precision: 'UNKNOWN' }),
    ]);
    expect(p.precision).toBe('DAY');
    expect(p.note).toMatch(/1 de 2 entregas/);
    expect(p.note).toMatch(/desconocido/i);
  });

  it('límites heredados sin declaración: se conservan APARTE y no ocupan el período', () => {
    // Hoy el CHECK 0021 impide esta forma; si un dato histórico la trajese, no se reconstruye ni se corrige:
    // se conserva su procedencia, separada, y el período permanece desconocido.
    const p = periodoDeProduccion([fila({ harvest_derived_start: '2026-01-10', harvest_derived_end: '2026-01-20' })]);
    expect(p.precision).toBe('NONE');
    expect(p.start).toBeNull();
    expect(p.end).toBeNull();
    expect(p.inherited_range).toMatchObject({ start: '2026-01-10', end: '2026-01-20' });
    expect(p.inherited_range!.note).toMatch(/NO acreditan/);
    expect(p.inherited_range!.note).toMatch(/NO son una cosecha declarada/);
  });

  it('heredados junto a una declaración: la declaración manda y los heredados siguen separados', () => {
    const p = periodoDeProduccion([
      fila({ harvest_precision: 'MONTH', harvest_start: '2026-06', harvest_end: '2026-06', harvest_derived_start: '2026-06-01', harvest_derived_end: '2026-06-30' }),
      fila({ harvest_derived_start: '2026-01-10', harvest_derived_end: '2026-01-20' }),
    ]);
    expect(p).toMatchObject({ precision: 'MONTH', start: '2026-06', end: '2026-06' });
    expect(p.inherited_range).toMatchObject({ start: '2026-01-10' });
  });
});
