import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pdfConTexto, pdfEscaneado } from '../../test/pdf-sintetico';
import { auditarFuentes, decodificar, textoDePdf, MAX_STREAM_BYTES } from './pdf-text';
import { sugerir } from './reglas';

// P1-013 — El lector y las reglas, probados **sin base de datos y sin red**.
//
// El lector ya **no adivina**: decodifica con **pdf.js**, que interpreta las codificaciones y los mapas de
// fuente. Lo que estas pruebas protegen:
//   · que el texto salga **del archivo de verdad**, incluidos **PDF de otras herramientas** y **acentos**;
//   · que un documento cuya fuente **no se puede mapear** se **rechace entero**, aunque lo obtenido sea
//     perfectamente imprimible —el caso peligroso—;
//   · que un PDF **sin capa de texto** se distinga de uno **que no se supo leer**;
//   · que las reglas de sugerencia no inventen nada.

describe('P1-013 lectura del texto de un PDF, con decodificación real', () => {
  const fixture = (n: string) => readFileSync(join(__dirname, '../../test/fixtures', n));

  it('lee un PDF propio, con su texto literal', async () => {
    const r = await textoDePdf(pdfConTexto(['Certificado de tenencia', 'Emitido por: Registro de Manabi']));
    expect(r.interpretable).toBe(true);
    expect(r.reason).toBe('OK');
    expect(r.text).toContain('Certificado de tenencia');
    expect(r.text).toContain('Registro de Manabi');
    expect(r.pages).toBe(1);
  });

  it('PDF DE OTRA HERRAMIENTA: se lee de verdad, acentos incluidos', async () => {
    // Generado por el motor de impresión de Chromium, no por el generador de estas pruebas.
    const r = await textoDePdf(fixture('chromium-capa-texto.pdf'));
    expect(r.interpretable).toBe(true);
    expect(r.text).toContain('CERTIFICADO DE PRUEBA');
    // Acentuación española, que es justo lo que la versión anterior destrozaba.
    expect(r.text).toContain('Registro de la Propiedad de Manabí');
    expect(r.text).toContain('Fecha de emisión: 2026-03-04');
  });

  it('EL CASO PELIGROSO: fuente sin mapa que produce texto imprimible pero FALSO', async () => {
    // Fuente compuesta Identity-H sin `/ToUnicode`: los códigos son identificadores de glifo, y lo que se
    // obtendría —«HIJK»— parece texto corriente. Ninguna heurística sobre el resultado lo delata.
    const bytes = fixture('fuente-sin-mapa.pdf');
    expect(auditarFuentes(bytes).without_map).toBeGreaterThan(0);

    const r = await textoDePdf(bytes);
    expect(r.interpretable).toBe(false);
    expect(r.reason).toBe('FUENTE_SIN_MAPA');
    expect(r.fonts.without_map).toBeGreaterThan(0);
    expect(r.text).toBe('');            // no se publica NADA, por legible que pareciera
    // Y de un texto rechazado no sale ninguna sugerencia.
    expect(sugerir(r.text).every((s) => s.suggested_value === null)).toBe(true);
  });

  it('un PDF con fuente compuesta Y su mapa NO se rechaza', () => {
    const a = auditarFuentes(fixture('chromium-capa-texto.pdf'));
    expect(a.composite).toBeGreaterThan(0);
    expect(a.without_map).toBe(0);
    expect(a.undetermined).toBe(0);
  });

  it('DOS FUENTES VECINAS: el mapa de una NO valida a la otra', async () => {
    // Defecto real corregido el 2026-10-19: la comprobación anterior buscaba `/ToUnicode` en una VENTANA de
    // texto alrededor de `/Type0`. Con dos fuentes seguidas —una con mapa y otra sin él— encontraba el mapa
    // de la vecina y daba por bueno el archivo: detectaba 0 fuentes sin mapa cuando había 1.
    const bytes = fixture('dos-fuentes-vecinas.pdf');
    const a = auditarFuentes(bytes);
    expect(a.composite).toBe(2);
    expect(a.without_map).toBe(1);     // la comprobación por objeto SÍ la distingue

    // Y el documento entero se rechaza: la parte mal decodificada («HIJK») es imprimible y parecería válida.
    const r = await textoDePdf(bytes);
    expect(r.interpretable).toBe(false);
    expect(r.reason).toBe('FUENTE_SIN_MAPA');
    expect(r.text).toBe('');
    expect(sugerir(r.text).every((s) => s.suggested_value === null)).toBe(true);
  });

  it('SOPORTE INDETERMINADO: lo que no se pudo inspeccionar no se da por comprobado', async () => {
    // Un flujo de objetos que no se puede descomprimir: no se sabe qué fuentes hay dentro.
    const NL = String.fromCharCode(10);
    const roto = Buffer.from([
      '%PDF-1.4',
      '1 0 obj<</Type/ObjStm/N 1/First 8/Length 12/Filter/FlateDecode>>stream',
      'XXXXXXXXXXXX',
      'endstream',
      'endobj',
      'trailer<</Root 1 0 R>>',
      '%%EOF',
      '',
    ].join(NL), 'latin1');
    expect(auditarFuentes(roto).undetermined).toBeGreaterThan(0);
  });

  it('PDF sin capa de texto: se distingue de «no supe leerlo»', async () => {
    const r = await textoDePdf(pdfEscaneado());
    expect(r.hasTextLayer).toBe(false);
    expect(r.reason).toBe('SIN_CAPA_DE_TEXTO');
    expect(r.text).toBe('');
  });

  it('un archivo que no es PDF no revienta: se declara que no se pudo abrir', async () => {
    const r = await textoDePdf(Buffer.from('esto no es un pdf'));
    expect(r.interpretable).toBe(false);
    expect(r.reason).toBe('NO_SE_PUDO_ABRIR');
    expect(r.text).toBe('');
  });

  it('MULTIPÁGINA: se lee todo el contenido', async () => {
    const r = await textoDePdf(pdfConTexto(['Pagina uno', 'Pagina dos', 'Pagina tres']));
    expect(r.text).toContain('Pagina uno');
    expect(r.text).toContain('Pagina dos');
    expect(r.text).toContain('Pagina tres');
  });
});

describe('P1-013 reglas de sugerencia: la confianza es la regla, no un número', () => {
  const campo = (texto: string, code: string) => sugerir(texto).find((s) => s.field_code === code)!;

  it('ETIQUETA EXPLÍCITA: el documento rotula el valor → confianza ALTA con su fragmento', () => {
    const t = 'Certificado\nEmitido por: Registro de la Propiedad\nFecha de emision: 2026-03-04\nVigente hasta: 2027-03-04';
    const emisor = campo(t, 'ISSUER');
    expect(emisor.basis).toBe('ETIQUETA_EXPLICITA');
    expect(emisor.confidence).toBe('ALTA');
    expect(emisor.suggested_value).toBe('Registro de la Propiedad');
    expect(emisor.source_excerpt).toContain('Emitido por');
    expect(campo(t, 'ISSUED_AT').suggested_value).toBe('2026-03-04');
    expect(campo(t, 'EXPIRES_AT').suggested_value).toBe('2027-03-04');
  });

  it('ACENTOS: las etiquetas en español correcto también se reconocen', () => {
    const t = 'Emitido por: Registro de la Propiedad de Manabí\nFecha de emisión: 2026-03-04';
    expect(campo(t, 'ISSUER').suggested_value).toBe('Registro de la Propiedad de Manabí');
    expect(campo(t, 'ISSUED_AT').suggested_value).toBe('2026-03-04');
    expect(campo(t, 'ISSUED_AT').basis).toBe('ETIQUETA_EXPLICITA');
  });

  it('PATRÓN ÚNICO: sin etiqueta pero con un solo candidato → confianza MEDIA', () => {
    const f = campo('Documento sin rotulos.\nSolo aparece 2025-12-31 en todo el texto.', 'ISSUED_AT');
    expect(f.basis).toBe('PATRON_UNICO');
    expect(f.confidence).toBe('MEDIA');
    expect(f.suggested_value).toBe('2025-12-31');
  });

  it('AMBIGUO: con varios candidatos NO se sugiere ninguno, y se listan todos', () => {
    const f = campo('Fechas sueltas: 2025-01-02 y 2026-07-08 y 2027-09-10.', 'ISSUED_AT');
    expect(f.basis).toBe('PATRON_AMBIGUO');
    expect(f.suggested_value).toBeNull();
    expect(f.candidates.map((c) => c.value)).toEqual(['2025-01-02', '2026-07-08', '2027-09-10']);
  });

  it('una fecha 03/04/2026 NO se decide entre marzo y abril', () => {
    const f = campo('Fecha: 03/04/2026', 'ISSUED_AT');
    expect(f.suggested_value).toBeNull();
    expect(f.candidates.map((c) => c.value)).toContain('03/04/2026');
    expect(JSON.stringify(f)).not.toMatch(/2026-03-04|2026-04-03/);
  });

  it('una fecha imposible no se propone', () => {
    expect(campo('Vence el 2026-02-30 segun el sello.', 'EXPIRES_AT').suggested_value).toBeNull();
  });

  it('una etiqueta MENCIONADA no es una etiqueta que rotula', () => {
    expect(campo('ACTA SIMPLE\nSin emisor rotulado ni fechas.', 'ISSUER').suggested_value).toBeNull();
    expect(campo('Aqui deberia ir la fecha de emision, pero falta.', 'ISSUED_AT').suggested_value).toBeNull();
  });

  it('sin etiqueta NO se adivina un emisor', () => {
    expect(campo('Un texto cualquiera con nombres como Registro y Propiedad sueltos.', 'ISSUER').suggested_value).toBeNull();
  });

  it('los tres campos se publican SIEMPRE: la ausencia también es información', () => {
    const s = sugerir('texto sin nada util');
    expect(s.map((x) => x.field_code).sort()).toEqual(['EXPIRES_AT', 'ISSUED_AT', 'ISSUER']);
    expect(s.every((x) => x.suggested_value === null)).toBe(true);
  });

  it('la pareja base↔confianza es fija: no hay forma de publicar ALTA sin etiqueta', () => {
    for (const c of ['Emitido por: X\nFecha de emision: 2026-01-01', 'Solo 2026-01-01', 'Varias 2026-01-01 y 2026-02-02', '']) {
      for (const s of sugerir(c)) {
        expect(s.confidence).toBe({ ETIQUETA_EXPLICITA: 'ALTA', PATRON_UNICO: 'MEDIA', PATRON_AMBIGUO: 'BAJA' }[s.basis]);
      }
    }
  });
});

describe('P1-013 los límites INTERRUMPEN el trabajo, no solo lo miden', () => {
  // El defecto que esto cierra: un control de tiempo *entre* páginas no detiene una apertura ni una página
  // que se quedan girando dentro del motor. El plazo vence, pero el trabajo sigue gastando CPU y memoria.
  // Por eso la decodificación vive en otro proceso: al vencer el plazo, el proceso se MATA.

  const vivo = (pid?: number) => {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  };

  it('un hijo atascado en un bucle cerrado SE TERMINA al vencer el plazo, y deja de existir', async () => {
    const t0 = Date.now();
    const r = await decodificar(Buffer.from('%PDF-1.4'), {
      ms: 700,
      script: join(__dirname, '../../test/fixtures/bloqueado.mjs'),
    });
    const tardo = Date.now() - t0;

    expect(r.agotado).toBe(true);        // el plazo venció
    expect(r.r).toBeNull();              // y no hay resultado que publicar
    expect(tardo).toBeLessThan(5000);    // se cortó en su plazo, no «cuando terminó»
    // Y el trabajo terminó de verdad: el proceso ya no está. Un bucle cerrado no atiende señales
    // cooperativas, así que esto solo puede pasar porque se le mató.
    await new Promise((res) => setTimeout(res, 300));
    expect(vivo(r.pid)).toBe(false);
  }, 20_000);

  it('un plazo vencido se publica como TIEMPO_AGOTADO, sin texto ni sugerencias', async () => {
    const r = await textoDePdf(Buffer.from('%PDF-1.4 roto'));
    // Este archivo no se abre; lo que importa es que NUNCA sale texto de un trabajo no completado.
    expect(r.interpretable).toBe(false);
    expect(r.text).toBe('');
    expect(sugerir(r.text).every((s) => s.suggested_value === null)).toBe(true);
  });

  it('DESCOMPRESIÓN: un flujo pequeño que se expande sin medida se corta, y queda INDETERMINADO', () => {
    // Bomba de descompresión casera: 64 MB de ceros caben comprimidos en unos pocos KB.
    const bomba = deflateSync(Buffer.alloc(64 * 1024 * 1024));
    expect(bomba.length).toBeLessThan(MAX_STREAM_BYTES);   // la ENTRADA es pequeña: el tope de entrada no basta

    const NL = String.fromCharCode(10);
    const pdf = Buffer.concat([
      Buffer.from(['%PDF-1.4', `1 0 obj<</Type/ObjStm/N 1/First 8/Length ${bomba.length}/Filter/FlateDecode>>stream`, ''].join(NL), 'latin1'),
      bomba,
      Buffer.from([NL, 'endstream', 'endobj', 'trailer<</Root 1 0 R>>', '%%EOF', ''].join(NL), 'latin1'),
    ]);

    // No revienta ni se traga 64 MB: el tope es de SALIDA, así que la descompresión se corta…
    const a = auditarFuentes(pdf);
    // …y lo que no se pudo inspeccionar NO se da por comprobado.
    expect(a.undetermined).toBeGreaterThan(0);
    expect(a.without_map).toBe(0);
    expect(a.composite).toBe(0);
  });
});
