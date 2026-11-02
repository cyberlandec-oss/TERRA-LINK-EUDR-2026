import { atributosSeguros, claseEstado, rutaSegura, sqlSeguro, textoSeguro } from './sanitize';

// RNF-13 — El saneamiento es lo que decide si la instrumentación es segura. Se prueba con los casos REALES
// del producto: rutas con UUID, referencias públicas de 24 hex, correos, coordenadas y SQL de PostGIS.

describe('RNF-13 saneamiento de la instrumentación', () => {
  describe('rutaSegura: la etiqueta es el patrón, nunca el valor', () => {
    it('sustituye los identificadores de las rutas reales del producto', () => {
      expect(rutaSegura('/api/v1/organizations/3f2504e0-4f89-11d3-9a0c-0305e82c3301/lots/9c1d7b2a-0000-4000-8000-000000000001'))
        .toBe('/api/v1/organizations/:id/lots/:id');
      expect(rutaSegura('/api/v1/organizations/3f2504e0-4f89-11d3-9a0c-0305e82c3301/producers/1/history'))
        .toBe('/api/v1/organizations/:id/producers/1/history');
    });

    it('sustituye una referencia pública (24 hex), que no es un UUID', () => {
      expect(rutaSegura('/api/v1/public-references/a3f9c21e8b4d7a60c5e1f204')).toBe('/api/v1/public-references/:id');
    });

    it('descarta la cadena de consulta ENTERA: puede llevar filtros con nombres o fechas', () => {
      expect(rutaSegura('/api/v1/organizations/x/audit?email=ana@coop.ec&request_id=abc')).toBe('/api/v1/organizations/x/audit');
    });

    it('no deja pasar un correo aunque venga en el camino', () => {
      expect(rutaSegura('/api/v1/users/ana.perez@coop.ec/profile')).toBe('/api/v1/users/:correo/profile');
    });

    it('acota la longitud: una ruta rara no crea una serie temporal gigante', () => {
      expect(rutaSegura(`/a/${'b'.repeat(300)}`).length).toBeLessThanOrEqual(121);
    });

    it('una ruta vacía sigue siendo una etiqueta válida', () => {
      expect(rutaSegura('')).toBe('/');
    });
  });

  describe('sqlSeguro: verbo y tabla, nunca valores', () => {
    it('reduce una consulta parametrizada a verbo y tabla', () => {
      expect(sqlSeguro('select "id", "document_number_enc" from "producers" where "blind_index" = $1')).toBe('SELECT producers');
      expect(sqlSeguro('insert into "audit_logs" ("id", "action") values ($1, $2)')).toBe('INSERT audit_logs');
      expect(sqlSeguro('update "lots" set "status" = $1 where "id" = $2')).toBe('UPDATE lots');
    });

    it('no deja pasar coordenadas aunque vinieran literales en el texto', () => {
      const s = sqlSeguro("select ST_IsValid(ST_GeomFromText('POINT(-80.164231 -0.848125)')) from plot_versions");
      expect(s).toBe('SELECT plot_versions');
      expect(s).not.toContain('80.16');
      expect(s).not.toContain('POINT');
    });

    it('un verbo que no reconoce no hace que se devuelva el texto entero', () => {
      // EXPLAIN no está en la lista de verbos, pero lo que importa es que NO salga la consulta ni su valor.
      const s = sqlSeguro('EXPLAIN ANALYZE select * from producers where email = \'ana@coop.ec\'');
      expect(s).toBe('SQL producers');
      expect(s).not.toContain('ana@coop.ec');
      expect(s).not.toContain('where');
    });
  });

  describe('textoSeguro: la red que atrapa lo que se cuele', () => {
    it('tapa correos, identificadores, coordenadas y secretos', () => {
      const t = textoSeguro('ana@coop.ec 3f2504e0-4f89-11d3-9a0c-0305e82c3301 -0.848125 password=hunter2 Bearer abc.def');
      expect(t).toContain('[correo]');
      expect(t).toContain('[id]');
      expect(t).toContain('[coord]');
      expect(t).not.toContain('hunter2');
      expect(t).not.toContain('ana@coop.ec');
      expect(t).not.toContain('0.848125');
    });

    it('recorta y nunca devuelve undefined', () => {
      expect(textoSeguro(undefined)).toBe('');
      expect(textoSeguro('x'.repeat(500), 50)).toHaveLength(50);
    });
  });

  describe('atributosSeguros: lista blanca, no lista negra', () => {
    it('conserva lo nombrado y DESCARTA todo lo demás', () => {
      const a = atributosSeguros({
        'http.method': 'GET',
        'http.status': 200,
        // Nada de esto está en la lista: no puede salir aunque alguien lo pase por error.
        'user.email': 'ana@coop.ec',
        'organization.id': '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        'db.statement': "select * from producers where id = '…'",
        'plot.coordinates': '-0.848125,-80.164231',
        'request.body': '{"password":"hunter2"}',
      });
      expect(a).toEqual({ 'http.method': 'GET', 'http.status': 200 });
      const texto = JSON.stringify(a);
      expect(texto).not.toContain('ana@coop.ec');
      expect(texto).not.toContain('hunter2');
      expect(texto).not.toContain('0.848125');
    });

    it('sanea también el valor de un atributo permitido', () => {
      expect(atributosSeguros({ 'http.route': '/u/ana@coop.ec' })['http.route']).toBe('/u/[correo]');
    });
  });

  it('claseEstado agrupa: no multiplica series por cada código', () => {
    expect(claseEstado(200)).toBe('2xx');
    expect(claseEstado(404)).toBe('4xx');
    expect(claseEstado(503)).toBe('5xx');
  });
});
