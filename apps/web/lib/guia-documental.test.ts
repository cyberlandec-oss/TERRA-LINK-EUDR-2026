import { describe, expect, it } from 'vitest';
import { ASPECTO_POR_TIPO, FECHA_FUENTES, GUIA, GUIA_REGISTROS, NOTAS_GENERALES, SITUACIONES_TRABAJO, textosGuia } from './guia-documental';
import { estadoRevision } from './documents';

// Guía documental ORIENTATIVA (A-05): no es una lista obligatoria uniforme, no promete aprobación y no inventa tipos de documento.
const TIPOS_DEL_CATALOGO = ['LAND_TENURE', 'DELIVERY_SUPPORT', 'FIELD_EVIDENCE', 'FIELD_PHOTO', 'ENVIRONMENTAL_SUPPORT', 'LABOR_SUPPORT', 'THIRD_PARTY_RIGHTS_SUPPORT']; // document_types de sistema vigente (migraciones 0018, 0029, 0057, 0066)

describe('guía documental', () => {
  it('cada aspecto declara su fuente y solo remite a tipos que existen en el catálogo', () => {
    for (const lista of Object.values(GUIA)) for (const a of lista) {
      expect(a.fuente.length).toBeGreaterThan(2);
      for (const c of a.tipos) expect(TIPOS_DEL_CATALOGO).toContain(c);
      if (a.tipos.length === 0) expect(a.nota).toBeTruthy(); // un aspecto sin tipo propio lo dice
    }
  });

  it('no usa lenguaje de certificación, validación ni obligatoriedad uniforme', () => {
    const todo = textosGuia().join('\n').toLowerCase();
    expect(todo).not.toMatch(/certific|garantiza|cumple con|aprobad[oa] autom|obligatori[oa] para todos/);
    expect(NOTAS_GENERALES.join(' ')).toContain('no una lista obligatoria');
    expect(NOTAS_GENERALES.join(' ')).toContain('no lo aprueba');
  });

  it('la situación de trabajo adapta la orientación: el trabajo familiar y los trabajadores contratados NO reciben lo mismo', () => {
    const fam = SITUACIONES_TRABAJO.find((s) => s.id === 'familiar')!;
    const con = SITUACIONES_TRABAJO.find((s) => s.id === 'contratados')!;
    expect(fam.orientacion).not.toBe(con.orientacion);
    expect(fam.orientacion).toContain('no suelen aplicar');
    expect(new Set(SITUACIONES_TRABAJO.map((s) => s.orientacion)).size).toBe(SITUACIONES_TRABAJO.length);
  });

  it('la revisión se deriva del contrato existente: sin revisión es PENDIENTE (subir no aprueba); rechazada es «con observaciones»', () => {
    const base = { availability: 'AVAILABLE' as const };
    expect(estadoRevision({ ...base, review: null }).label).toBe('Pendiente de revisión');
    expect(estadoRevision({ ...base, review: { decision: 'ACCEPTED', reason: 'ok', reviewed_at: '2026-10-23', reviewer_is_uploader: false } }).label).toBe('Revisado: aceptado');
    expect(estadoRevision({ ...base, review: { decision: 'REJECTED', reason: 'ilegible', reviewed_at: '2026-10-23', reviewer_is_uploader: false } }).label).toBe('Con observaciones');
  });

  it('los aspectos de registro dicen dónde se resuelven, citan fuente y no se ofrecen como documento a subir', () => {
    expect(GUIA_REGISTROS.length).toBeGreaterThan(0);
    for (const a of GUIA_REGISTROS) {
      expect(a.clase).toBe('registro');
      expect(a.donde?.etiqueta).toBeTruthy();
      expect(a.fuente.length).toBeGreaterThan(2);
      expect(a.tipos).toEqual([]);
    }
  });

  it('cada tipo remite a un aspecto existente y la fecha de incorporación de las fuentes es una fecha válida', () => {
    const ids = new Set([...Object.values(GUIA).flat(), ...GUIA_REGISTROS].map((a) => a.id));
    for (const aspecto of Object.values(ASPECTO_POR_TIPO)) expect(ids).toContain(aspecto);
    expect(FECHA_FUENTES).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(FECHA_FUENTES))).toBe(false);
  });
});
