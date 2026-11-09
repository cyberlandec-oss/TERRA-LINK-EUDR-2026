import { structuralIssues } from './geometry';

const square = [[[-80.1, -1.1], [-80.09, -1.1], [-80.09, -1.09], [-80.1, -1.09], [-80.1, -1.1]]];

describe('comprobaciones estructurales de geometría (no validación GIS)', () => {
  it('acepta punto, polígono y multipolígono bien formados', () => {
    expect(structuralIssues({ type: 'Point', coordinates: [-80.1, -1.1] })).toEqual([]);
    expect(structuralIssues({ type: 'Polygon', coordinates: square })).toEqual([]);
    expect(structuralIssues({ type: 'MultiPolygon', coordinates: [square] })).toEqual([]);
  });

  it('rechaza tipos no admitidos, coordenadas fuera de rango o no numéricas y CRS declarado', () => {
    expect(structuralIssues({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })[0].reason).toBe('TYPE_MUST_BE_POINT_POLYGON_OR_MULTIPOLYGON');
    expect(structuralIssues({ type: 'Point', coordinates: [-200, 0] }).map((i) => i.reason)).toContain('LONGITUDE_OUT_OF_RANGE');
    expect(structuralIssues({ type: 'Point', coordinates: [0, 95] }).map((i) => i.reason)).toContain('LATITUDE_OUT_OF_RANGE');
    expect(structuralIssues({ type: 'Point', coordinates: ['a', 1] })[0].reason).toBe('COORDINATE_NOT_NUMERIC');
    expect(structuralIssues({ type: 'Point', coordinates: [0, 0], crs: { type: 'name' } })[0].reason).toBe('CRS_MEMBER_NOT_ALLOWED_WGS84_ONLY');
    expect(structuralIssues(null)[0].reason).toBe('GEOMETRY_MUST_BE_OBJECT');
  });

  it('exige anillos cerrados con al menos 4 posiciones', () => {
    const open = [[[-80.1, -1.1], [-80.09, -1.1], [-80.09, -1.09], [-80.1, -1.09]]];
    expect(structuralIssues({ type: 'Polygon', coordinates: open }).map((i) => i.reason)).toContain('RING_NOT_CLOSED');
    expect(structuralIssues({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] }).map((i) => i.reason)).toContain('RING_NEEDS_AT_LEAST_4_POSITIONS');
  });

  it('no juzga validez topológica: un polígono autointersectado bien formado pasa (lo evalúa P0-010)', () => {
    const bowtie = [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]];
    expect(structuralIssues({ type: 'Polygon', coordinates: bowtie })).toEqual([]);
  });
});
