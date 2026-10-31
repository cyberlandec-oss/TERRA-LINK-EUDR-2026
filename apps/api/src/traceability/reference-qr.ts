import qr from 'qrcode-generator';

// RF-33 — Representación visual (QR) de una referencia pública.
//
// QUÉ CODIFICA, Y QUÉ NO
// El QR lleva **solo el enlace de resolución** con la referencia opaca: `<base>/r/<referencia>`. **Nunca** un
// identificador interno, un nombre, un dato personal ni un token. La referencia ya es opaca por RF-47 (12
// bytes aleatorios en hexadecimal) y **no concede acceso**: quien lo escanee tendrá que autenticarse y tener
// permiso sobre el recurso, igual que por cualquier otra vía.
//
// POR QUÉ SE GENERA EN EL SERVIDOR
// Para que la **misma autorización** que protege la resolución proteja también la emisión: el QR se entrega a
// quien ya puede leer el recurso, y no a cualquiera que acierte una referencia. Además es texto (SVG), así
// que se puede comprobar en una prueba sin comparar imágenes.
//
// SIN SERVICIOS EXTERNOS
// `qrcode-generator` **no tiene dependencias** y codifica en memoria. No se llama a ningún generador de QR de
// terceros: eso enviaría la referencia fuera del entorno.

/** Corrección de errores media: tolera manchas y desgaste de una impresión, sin agrandar de más el código. */
const CORRECCION = 'M' as const;

/**
 * SVG del QR. Sin `width`/`height` fijos: el `viewBox` deja que la página lo escale, que es lo que hace falta
 * para que se vea bien en pantalla, en papel y a 390 px.
 */
export function qrSvg(contenido: string, { quietZone = 4 }: { quietZone?: number } = {}): string {
  const codigo = qr(0, CORRECCION);
  codigo.addData(contenido);
  codigo.make();
  const n = codigo.getModuleCount();
  const lado = n + quietZone * 2;

  // Un solo `path` con todos los módulos oscuros: pesa mucho menos que un rectángulo por módulo.
  let d = '';
  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      if (codigo.isDark(fila, col)) d += `M${col + quietZone} ${fila + quietZone}h1v1h-1z`;
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" role="img" shape-rendering="crispEdges">`,
    // La zona blanca es parte del código: sin ella muchos lectores fallan.
    `<rect width="${lado}" height="${lado}" fill="#ffffff"/>`,
    `<path d="${d}" fill="#000000"/>`,
    '</svg>',
  ].join('');
}

/** Enlace que resuelve la referencia en la interfaz. La base viene de la configuración, no de la petición. */
export function enlaceDeReferencia(base: string, reference: string): string {
  return `${base.replace(/\/+$/, '')}/r/${reference}`;
}
