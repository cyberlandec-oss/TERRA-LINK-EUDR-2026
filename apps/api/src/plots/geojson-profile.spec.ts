import { ProfileError, parseGeoJson } from './geojson-profile';

const LIMITS = { maxBytes: 4096, maxPositions: 50, maxDepth: 10, maxComponents: 3, maxRingsPerPolygon: 3 };
const SQUARE = [[-80.16, -0.848], [-80.159, -0.848], [-80.159, -0.847], [-80.16, -0.847], [-80.16, -0.848]];
const buf = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o));
const code = (o: unknown, limits = LIMITS) => {
  try {
    parseGeoJson(buf(o), limits);
    return 'OK';
  } catch (e) {
    if (e instanceof ProfileError) return e.code;
    throw e;
  }
};

describe('perfil de importación GeoJSON (RFC 7946, sin cambios silenciosos)', () => {
  it('Polygon directo: conserva las coordenadas tal cual, [lon, lat]', () => {
    const r = parseGeoJson(buf({ type: 'Polygon', coordinates: [SQUARE] }), LIMITS);
    expect(r.envelope).toBe('GEOMETRY');
    expect(r.geometry.coordinates).toEqual([SQUARE]);
    expect(r.stats).toMatchObject({ components: 1, rings: 1, holes: 0, positions: 5 });
  });

  it('Feature y FeatureCollection de una feature: propiedades e id ignorados con advertencia', () => {
    const f = { type: 'Feature', id: 'x', properties: { organization_id: 'otra', plot_id: 'otra' }, geometry: { type: 'Polygon', coordinates: [SQUARE] } };
    const r = parseGeoJson(buf(f), LIMITS);
    expect(r.envelope).toBe('FEATURE');
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['PROPERTIES_IGNORED', 'ID_IGNORED']));
    expect(JSON.stringify(r.warnings)).not.toContain('otra'); // sin eco de valores
    const fc = parseGeoJson(buf({ type: 'FeatureCollection', features: [f] }), LIMITS);
    expect(fc.envelope).toBe('FEATURE_COLLECTION_SINGLE');
    expect(fc.warnings.map((w) => w.code)).toContain('FEATURE_COLLECTION_SINGLE');
  });

  it('FeatureCollection vacía o con varias features: rechazo explícito (no importa varias parcelas)', () => {
    const f = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [SQUARE] } };
    expect(code({ type: 'FeatureCollection', features: [] })).toBe('EMPTY_FEATURE_COLLECTION');
    expect(code({ type: 'FeatureCollection', features: [f, f] })).toBe('MULTIPLE_FEATURES');
  });

  it('MultiPolygon y huecos', () => {
    const hole = [[-80.1598, -0.8478], [-80.1592, -0.8478], [-80.1592, -0.8472], [-80.1598, -0.8472], [-80.1598, -0.8478]];
    const r = parseGeoJson(buf({ type: 'MultiPolygon', coordinates: [[SQUARE, hole], [SQUARE.map(([x, y]) => [x + 0.01, y])]] }), LIMITS);
    expect(r.stats).toMatchObject({ components: 2, rings: 3, holes: 1 });
  });

  it('JSON mal formado, no UTF-8, tipo no admitido, Feature sin geometría', () => {
    expect(code('{"type": "Polygon", ')).toBe('MALFORMED_JSON');
    expect(parseGeoJsonCode(Buffer.from([0xff, 0xfe, 0x00]))).toBe('INVALID_ENCODING');
    expect(code({ type: 'Point', coordinates: [-80, -1] })).toBe('TYPE_NOT_SUPPORTED');
    expect(code({ type: 'GeometryCollection', geometries: [] })).toBe('TYPE_NOT_SUPPORTED');
    expect(code({ type: 'Feature', properties: {}, geometry: null })).toBe('FEATURE_WITHOUT_GEOMETRY');
  });

  it('CRS: CRS84 heredado se acepta con advertencia; EPSG:4326 u otro CRS se rechazan sin reproyectar', () => {
    const crs = (name: string) => ({ type: 'Polygon', crs: { type: 'name', properties: { name } }, coordinates: [SQUARE] });
    const ok = parseGeoJson(buf(crs('urn:ogc:def:crs:OGC:1.3:CRS84')), LIMITS);
    expect(ok.warnings.map((w) => w.code)).toContain('LEGACY_CRS84_IGNORED');
    expect(code(crs('urn:ogc:def:crs:EPSG::4326'))).toBe('CRS_NOT_SUPPORTED');
    expect(code(crs('EPSG:32717'))).toBe('CRS_NOT_SUPPORTED');
  });

  it('dimensiones adicionales: altitud rechazada (no se elimina en silencio)', () => {
    expect(code({ type: 'Polygon', coordinates: [SQUARE.map(([x, y]) => [x, y, 12])] })).toBe('EXTRA_DIMENSIONS_NOT_SUPPORTED');
  });

  it('anillo abierto o corto, coordenadas no numéricas o fuera de rango', () => {
    expect(code({ type: 'Polygon', coordinates: [SQUARE.slice(0, 4)] })).toBe('RING_NOT_CLOSED');
    expect(code({ type: 'Polygon', coordinates: [[SQUARE[0], SQUARE[1], SQUARE[0]]] })).toBe('RING_TOO_SHORT');
    expect(code({ type: 'Polygon', coordinates: [[['-80', -0.8], ...SQUARE.slice(1)]] })).toBe('COORDINATE_NOT_NUMERIC');
    expect(code({ type: 'Polygon', coordinates: [[[-181, 0], [1, 0], [1, 1], [-181, 0]]] })).toBe('LONGITUDE_OUT_OF_RANGE');
  });

  it('límites configurables: bytes, posiciones, componentes, anillos y profundidad', () => {
    expect(code({ type: 'Polygon', coordinates: [SQUARE] }, { ...LIMITS, maxBytes: 20 })).toBe('FILE_TOO_LARGE');
    expect(code({ type: 'Polygon', coordinates: [SQUARE] }, { ...LIMITS, maxPositions: 4 })).toBe('TOO_MANY_POSITIONS');
    expect(code({ type: 'MultiPolygon', coordinates: [[SQUARE], [SQUARE], [SQUARE], [SQUARE]] })).toBe('TOO_MANY_COMPONENTS');
    expect(code({ type: 'Polygon', coordinates: [SQUARE, SQUARE, SQUARE, SQUARE] })).toBe('TOO_MANY_RINGS');
    expect(code({ type: 'Polygon', coordinates: [SQUARE] }, { ...LIMITS, maxDepth: 3 })).toBe('TOO_DEEP');
  });

  it('orden de ejes: [lat, lon] de Ecuador se advierte y NO se intercambia', () => {
    const swapped = SQUARE.map(([lon, lat]) => [lat, lon]);
    const r = parseGeoJson(buf({ type: 'Polygon', coordinates: [swapped] }), LIMITS);
    expect(r.warnings.map((w) => w.code)).toContain('POSSIBLE_AXIS_SWAP');
    expect(r.geometry.coordinates).toEqual([swapped]);
    expect(parseGeoJson(buf({ type: 'Polygon', coordinates: [SQUARE] }), LIMITS).warnings).toHaveLength(0);
  });
});

function parseGeoJsonCode(b: Buffer) {
  try {
    parseGeoJson(b, LIMITS);
    return 'OK';
  } catch (e) {
    return (e as ProfileError).code;
  }
}
