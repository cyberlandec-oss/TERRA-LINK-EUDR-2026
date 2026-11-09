import { porPlazo } from './my-work';

// P1-003 — La prioridad de «Mi trabajo» tiene que salir de una REGLA EXPLICABLE (UX_UI §11): cada fila dice por
// qué tiene la suya. Aquí se prueba la regla sola, sin base de datos.
describe('prioridad de Mi trabajo', () => {
  const HOY = '2026-10-17';

  it('plazo vencido: ALTA, y el motivo dice desde cuándo', () => {
    const r = porPlazo('MITIGATIONS_ASSIGNED', '2026-10-10', HOY);
    expect(r).toMatchObject({ due_state: 'OVERDUE', priority: 'ALTA' });
    expect(r.priority_rule).toMatch(/vencido el 2026-10-10 \(hace 7 día/);
  });

  it('plazo próximo (≤ 7 días): MEDIA, diciendo cuántos faltan', () => {
    expect(porPlazo('MITIGATIONS_ASSIGNED', '2026-10-20', HOY)).toMatchObject({ due_state: 'DUE_SOON', priority: 'MEDIA' });
    expect(porPlazo('MITIGATIONS_ASSIGNED', HOY, HOY).priority_rule).toMatch(/dentro de 0 día/);
  });

  it('plazo lejano: manda la prioridad del tipo de tarea, y el plazo se dice igual', () => {
    const r = porPlazo('DELIVERY_DRAFTS', '2026-12-31', HOY);
    expect(r).toMatchObject({ due_state: 'SCHEDULED', priority: 'BAJA' });
    expect(r.priority_rule).toMatch(/Vence el 2026-12-31/);
  });

  it('el plazo VENCIDO manda sobre la prioridad del tipo, incluso en una tarea de prioridad baja', () => {
    expect(porPlazo('DELIVERY_DRAFTS', '2026-01-01', HOY).priority).toBe('ALTA');
  });

  it('sin plazo en el dominio: no se inventa uno, y se dice que no existe', () => {
    const r = porPlazo('PLOTS_WITHOUT_LOCATION', null, HOY);
    expect(r).toMatchObject({ due_state: 'NONE', priority: 'MEDIA' });
    expect(r.priority_rule).toMatch(/no registra plazo para esta tarea; no se inventa uno/);
  });
});
