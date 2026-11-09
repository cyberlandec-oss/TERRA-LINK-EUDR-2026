import { catalogNote, severityBucket } from './reports-risk';

// P0-030 — Reparto por severidad, probado EN MEMORIA con conjuntos sintéticos: combinaciones que contra la base
// exigirían publicar catálogos y adoptarlos, y que aquí se cubren una a una (incluido el MIXTO: lotes clasificados y
// sin clasificar a la vez). La integración comprueba aparte que los candados de la base existen.
describe('P0-030 severidad de riesgo: cero observado, desconocido y caso mixto', () => {
  // Publicado globalmente y ADOPTADO por esta organización: es el único estado en que puede haber severidad.
  const catalogo = { publicada: { version: '1.0.0', approval_status: 'APPROVED' }, adoptada: '1.0.0' };
  const base = { sev: 'HIGH' as const, label: 'alto', catalogo };

  it('sin evaluaciones: NO_DENOMINATOR, y la ausencia de evaluaciones es un hecho observado', () => {
    const r = severityBucket({ ...base, lotesTotal: 7, porSeveridad: {} });
    expect(r).toMatchObject({ status: 'NO_DENOMINATOR', value: null, denominator: 0 });
    expect(r.observed).toEqual({ lotes_del_tenant: 7, lotes_evaluados: 0, sin_severidad_asignada: 0, con_severidad_asignada: 0 });
    expect(r.reason).toMatch(/denominador es cero/i);
    expect(r.reason).toContain('7 lote(s) en el tenant');
  });

  it('evaluados pero ninguno clasificado: UNKNOWN citando el catálogo real, no una lista de historias', () => {
    const r = severityBucket({ ...base, lotesTotal: 5, porSeveridad: { NOT_ASSESSED: 3 } });
    expect(r).toMatchObject({ status: 'UNKNOWN', value: null, denominator: 3 });
    expect(r.observed).toMatchObject({ lotes_evaluados: 3, sin_severidad_asignada: 3, con_severidad_asignada: 0 });
    // Con catálogo adoptado, la causa es de las evaluaciones: A.2 o reglas sin severidad declarada. No se inventa otra.
    expect(r.reason).toContain('adoptado el catálogo 1.0.0');
    expect(r.reason).toMatch(/A\.2/);
    expect(r.reason).toMatch(/reglas sin severidad declarada/i);
    expect(r.reason).toMatch(/D-07/);
    expect(r.reason).toMatch(/P0-021, implementada/);
    expect(r.reason).toMatch(/no asigna severidad/i);
    // No se atribuye el bloqueo a cerrar el satélite ni las mitigaciones.
    expect(r.reason).not.toMatch(/mientras.*P0-028/i);
  });

  it('publicado pero NO adoptado: el motivo es la falta de adopción propia, no la falta de aprobación global', () => {
    const sinAdoptar = { publicada: { version: '1.0.0', approval_status: 'APPROVED' }, adoptada: null };
    const r = severityBucket({ ...base, catalogo: sinAdoptar, lotesTotal: 5, porSeveridad: { NOT_ASSESSED: 3 } });
    expect(r.status).toBe('UNKNOWN');
    expect(r.reason).toContain('1.0.0');
    expect(r.reason).toContain('APPROVED'); // el estado real, no uno antiguo
    expect(r.reason).toMatch(/NO lo ha adoptado/);
    expect(r.reason).toMatch(/actos distintos \(D-07\.1\)/);
    expect(r.reason).toMatch(/NOT_ASSESSED/);
  });

  it('adoptada una versión antigua, se avisa de la nueva publicada sin darla por aplicada', () => {
    const atrasada = { publicada: { version: '1.1.0', approval_status: 'APPROVED' }, adoptada: '1.0.0' };
    const r = severityBucket({ ...base, catalogo: atrasada, lotesTotal: 5, porSeveridad: { NOT_ASSESSED: 3 } });
    expect(r.reason).toContain('adoptado el catálogo 1.0.0');
    expect(r.reason).toContain('versión más reciente publicada (1.1.0)');
    expect(r.reason).toMatch(/no se aplica sola/i);
  });

  it('UNDETERMINED cuenta como «sin severidad», igual que NOT_ASSESSED', () => {
    const r = severityBucket({ ...base, lotesTotal: 4, porSeveridad: { NOT_ASSESSED: 1, UNDETERMINED: 2 } });
    expect(r.status).toBe('UNKNOWN');
    expect(r.observed).toMatchObject({ lotes_evaluados: 3, sin_severidad_asignada: 3 });
  });

  it('CASO MIXTO: el conteo sale sobre la base de los clasificados, nunca como distribución de todos los lotes', () => {
    // 10 lotes: 6 evaluados (2 HIGH, 1 MEDIUM, 3 sin severidad) y 4 sin evaluar.
    const porSeveridad = { HIGH: 2, MEDIUM: 1, NOT_ASSESSED: 3 };
    const alto = severityBucket({ ...base, lotesTotal: 10, porSeveridad });
    expect(alto).toMatchObject({ status: 'OK', value: '2', numerator: 2, denominator: 3 }); // 3 clasificados, no 6 ni 10
    expect(alto.observed).toEqual({ lotes_del_tenant: 10, lotes_evaluados: 6, sin_severidad_asignada: 3, con_severidad_asignada: 3 });
    expect(alto.reason).toContain('Sobre los 3 lote(s) CON severidad asignada');
    expect(alto.reason).toContain('Quedan 3 evaluado(s) sin severidad y 4 sin evaluar');
    expect(alto.reason).toContain('NO es la distribución de los 10 lote(s) del tenant');
    // Una distribución parcial no se presenta como completa: se dice de qué catálogo sale y qué NO acredita.
    expect(alto.reason).toContain('HALLAZGOS EVALUADOS del catálogo adoptado (1.0.0)');
    expect(alto.reason).toMatch(/puede no cubrir todas las categorías/i);
    expect(alto.reason).toMatch(/NO es una conclusión regulatoria: esa sigue UNDETERMINED/);

    // La severidad sin ningún lote es CERO OBSERVADO sobre esa misma base, no «desconocido».
    const bajo = severityBucket({ sev: 'LOW', label: 'bajo', catalogo, lotesTotal: 10, porSeveridad });
    expect(bajo).toMatchObject({ status: 'OK', value: '0', numerator: 0, denominator: 3 });
    expect(bajo.reason).toMatch(/^Cero observado/);
    // Los tres conteos suman exactamente los clasificados: ninguno absorbe a los desconocidos.
    const medio = severityBucket({ sev: 'MEDIUM', label: 'medio', catalogo, lotesTotal: 10, porSeveridad });
    expect(Number(alto.value) + Number(medio.value) + Number(bajo.value)).toBe(3);
  });

  it('CRÍTICO no se diluye en ALTO: cada severidad tiene su propio conteo sobre la misma base', () => {
    // 5 clasificados: 2 CRITICAL, 1 HIGH, 2 MEDIUM. El crítico es visible por sí mismo.
    const porSeveridad = { CRITICAL: 2, HIGH: 1, MEDIUM: 2, NOT_ASSESSED: 4 };
    const critico = severityBucket({ sev: 'CRITICAL', label: 'crítico', catalogo, lotesTotal: 12, porSeveridad });
    const alto = severityBucket({ ...base, lotesTotal: 12, porSeveridad });
    expect(critico).toMatchObject({ status: 'OK', value: '2', numerator: 2, denominator: 5 });
    expect(alto).toMatchObject({ status: 'OK', value: '1', numerator: 1, denominator: 5 }); // NO 3: el crítico no entra aquí
    const medio = severityBucket({ sev: 'MEDIUM', label: 'medio', catalogo, lotesTotal: 12, porSeveridad });
    const bajo = severityBucket({ sev: 'LOW', label: 'bajo', catalogo, lotesTotal: 12, porSeveridad });
    expect(bajo).toMatchObject({ status: 'OK', value: '0' }); // cero observado, no «desconocido»
    expect([critico, alto, medio, bajo].reduce((a, r) => a + Number(r.value), 0)).toBe(5); // suman los clasificados
  });

  it('una severidad desconocida en el catálogo no se reparte entre las conocidas', () => {
    // Si una versión futura publicara otra etiqueta, no se suma a ninguna de las cuatro: cuenta como clasificada y punto.
    const porSeveridad = { CRITICAL: 1, OTRA_COSA: 2 };
    const critico = severityBucket({ sev: 'CRITICAL', label: 'crítico', catalogo, lotesTotal: 3, porSeveridad });
    expect(critico).toMatchObject({ status: 'OK', value: '1', denominator: 3 });
    const alto = severityBucket({ ...base, lotesTotal: 3, porSeveridad });
    expect(alto).toMatchObject({ value: '0', denominator: 3 });
  });

  it('todos clasificados: el denominador es el total evaluado y no queda nada desconocido', () => {
    const r = severityBucket({ ...base, lotesTotal: 3, porSeveridad: { HIGH: 1, LOW: 2 } });
    expect(r).toMatchObject({ status: 'OK', value: '1', denominator: 3 });
    expect(r.observed).toMatchObject({ sin_severidad_asignada: 0, con_severidad_asignada: 3 });
    expect(r.reason).toContain('Quedan 0 evaluado(s) sin severidad y 0 sin evaluar');
  });

  it('sin catálogo publicado se dice así, en vez de inventar una causa', () => {
    expect(catalogNote(null)).toMatch(/No hay catálogo de reglas de riesgo publicado/);
    expect(catalogNote({ publicada: null, adoptada: null })).toMatch(/No hay catálogo de reglas de riesgo publicado/);
    expect(severityBucket({ ...base, lotesTotal: 2, porSeveridad: { NOT_ASSESSED: 2 }, catalogo: null }).reason)
      .toMatch(/No hay catálogo de reglas de riesgo publicado/);
  });
});
