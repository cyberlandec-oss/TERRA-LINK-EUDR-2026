import { ENTITY_REPORTS, GEOJSON_REQUIRES, GEOJSON_WHY, definitionOf, denialMessage, missingPermissions } from './reports-catalog';
import type { Permission } from '../authz/catalog';

// P0-030 — Autorización de los reportes por entidad (S1 §97), probada EN MEMORIA con conjuntos de permisos arbitrarios.
// No usa roles reales ni base de datos a propósito: la regla debe sostenerse por sí misma, de modo que si mañana alguien
// concede `producer:read` a un rol sin `plot:read`, el reporte de productores siga denegándose en vez de revelar cuántas
// parcelas tiene cada productor.
describe('P0-030 catálogo de reportes: permiso de CADA dominio del que se muestran datos', () => {
  const kinds = ENTITY_REPORTS.map((d) => d.kind);

  it('cada reporte exige los dominios de los datos que publica, no solo el de sus filas', () => {
    // Expectativa escrita a mano desde las columnas de cada reporte: si alguien añade una columna de otro dominio y no
    // añade su permiso, esta prueba falla.
    const esperado: Record<string, Permission[]> = {
      producers: ['producer:read', 'plot:read', 'delivery:read'],   // cuenta parcelas y entregas por productor
      plots: ['plot:read', 'producer:read'],                        // muestra el código del productor
      lots: ['lot:read', 'product:read'],                           // muestra el código del producto
      risk: ['risk:read', 'lot:read'],                              // el sujeto evaluado es un lote
      traceability: ['lot:read', 'delivery:read', 'plot:read'],     // cuenta entregas y parcelas por lote
      dd: ['dd:read', 'lot:read'],                                  // el expediente identifica su lote
    };
    for (const kind of kinds) expect(definitionOf(kind)!.requires).toEqual(esperado[kind]);
    expect(GEOJSON_REQUIRES).toEqual(['report:export', 'plot:read', 'plot:read_geometry', 'producer:read']);
  });

  it('cada permiso exigido declara POR QUÉ se exige, para que la denegación sea comprensible', () => {
    for (const d of ENTITY_REPORTS) {
      for (const p of d.requires) {
        expect(typeof d.why[p]).toBe('string');
        expect(d.why[p].length).toBeGreaterThan(10);
      }
      // Y no sobra ninguna explicación de un permiso que no se exige.
      expect(Object.keys(d.why).sort()).toEqual([...d.requires].sort());
    }
    expect(Object.keys(GEOJSON_WHY).sort()).toEqual([...GEOJSON_REQUIRES].sort());
  });

  it('negativo: leer la entidad principal NO basta; falta el dominio de cada dato relacionado', () => {
    // Un lector con producer:read y nada más: el reporte de productores revelaría conteos de parcelas y entregas.
    expect(missingPermissions(['report:read', 'producer:read'], definitionOf('producers')!.requires))
      .toEqual(['plot:read', 'delivery:read']);
    // Con lot:read y nada más, trazabilidad revelaría cuántas entregas y parcelas hay detrás de cada lote.
    expect(missingPermissions(['report:read', 'lot:read'], definitionOf('traceability')!.requires))
      .toEqual(['delivery:read', 'plot:read']);
    // Parcelas sin producer:read revelaría los códigos de los productores.
    expect(missingPermissions(['report:read', 'plot:read'], definitionOf('plots')!.requires)).toEqual(['producer:read']);
    // Riesgo sin lot:read revelaría qué lotes existen y cuántos hay.
    expect(missingPermissions(['report:read', 'risk:read'], definitionOf('risk')!.requires)).toEqual(['lot:read']);
    // DD sin lot:read revelaría el código del lote sujeto de cada expediente.
    expect(missingPermissions(['report:read', 'dd:read'], definitionOf('dd')!.requires)).toEqual(['lot:read']);
    // Lotes sin product:read revelaría el catálogo de productos.
    expect(missingPermissions(['report:read', 'lot:read'], definitionOf('lots')!.requires)).toEqual(['product:read']);
  });

  it('negativo: la exportación GeoJSON exige geometría, parcelas, productor y permiso de exportación', () => {
    const todos = ['report:export', 'plot:read', 'plot:read_geometry', 'producer:read'];
    expect(missingPermissions(todos, GEOJSON_REQUIRES)).toEqual([]);
    for (const quitado of todos) {
      expect(missingPermissions(todos.filter((p) => p !== quitado), GEOJSON_REQUIRES)).toEqual([quitado]);
    }
    // Tener la pantalla de reportes no acerca a las coordenadas.
    expect(missingPermissions(['report:read'], GEOJSON_REQUIRES)).toEqual(GEOJSON_REQUIRES);
  });

  it('con todos los permisos no falta ninguno, y uno de más no concede nada distinto', () => {
    for (const d of ENTITY_REPORTS) {
      expect(missingPermissions(d.requires, d.requires)).toEqual([]);
      expect(missingPermissions([...d.requires, 'audit:read', 'shipment:dispatch'], d.requires)).toEqual([]);
    }
  });

  it('el mensaje de denegación dice qué falta y por qué, y no filtra ningún conteo del dominio restringido', () => {
    const d = definitionOf('producers')!;
    const faltan = missingPermissions(['producer:read'], d.requires);
    const msg = denialMessage(d.requires, faltan, d.why);
    expect(msg).toContain('plot:read');
    expect(msg).toContain('delivery:read');
    expect(msg).toContain('cuenta sus parcelas');
    expect(msg).toMatch(/no se entrega una versión parcial/i);
    // Ni cifras ni identificadores: el mensaje explica la regla, no el contenido oculto.
    expect(msg).not.toMatch(/\b\d+\b/);
  });

  it('la clave de paginación de cada reporte es un código natural, estable y único en la organización', () => {
    const esperado: Record<string, string> = {
      producers: 'producer_code', plots: 'plot_code', lots: 'lot_code',
      risk: 'lot_code', traceability: 'lot_code', dd: 'case_number',
    };
    for (const kind of kinds) expect(definitionOf(kind)!.key).toBe(esperado[kind]);
    expect(definitionOf('inventado')).toBeUndefined();
  });

  it('los seis reportes de S1 §97 están, y cada uno cita su fuente', () => {
    expect(kinds).toEqual(['producers', 'plots', 'lots', 'risk', 'traceability', 'dd']);
    for (const d of ENTITY_REPORTS) expect(d.source).toMatch(/S1 §97/);
  });
});
