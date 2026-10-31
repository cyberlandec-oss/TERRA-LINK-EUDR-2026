// P1-013 — Reglas de sugerencia sobre el texto extraído (RF-44; `docs/18:214` «fuente/**confianza**»).
//
// LA «CONFIANZA» NO ES UN NÚMERO INVENTADO
// No hay modelo, no hay puntuación y no hay umbral. La confianza es **la regla que disparó la sugerencia**,
// que cualquiera puede comprobar mirando el texto:
//
//   · `ETIQUETA_EXPLICITA` → el documento **rotula** el valor: «Fecha de emisión: 2026-03-04» → **ALTA**
//   · `PATRON_UNICO`       → hay **exactamente un** candidato de esa forma en todo el texto → **MEDIA**
//   · `PATRON_AMBIGUO`     → hay **varios** candidatos: **no se sugiere ninguno** y se listan → **BAJA**
//
// Cada sugerencia lleva **el fragmento literal** del que sale y **su posición** en el texto: eso es la
// «evidencia de extracción» que pide RF-44, y permite comprobarla sin confiar en nadie.
//
// LO QUE NO HACE
//   · no normaliza fechas ambiguas: `03/04/2026` **no se decide** entre marzo y abril —se marca ambigua—;
//   · no completa un año de dos cifras;
//   · no elige entre candidatos: eso es de la persona;
//   · **no basta con que la etiqueta aparezca**: tiene que **rotular** —dos puntos para el emisor, o una
//     fecha ISO justo detrás— porque una mención suelta no es un dato.

export type Campo = 'ISSUER' | 'ISSUED_AT' | 'EXPIRES_AT';
export type Base = 'ETIQUETA_EXPLICITA' | 'PATRON_UNICO' | 'PATRON_AMBIGUO';

export interface Sugerencia {
  field_code: Campo;
  suggested_value: string | null;
  basis: Base;
  confidence: 'ALTA' | 'MEDIA' | 'BAJA';
  source_excerpt: string | null;
  source_offset: number | null;
  candidates: Array<{ value: string; excerpt: string; offset: number }>;
}

const CONFIANZA: Record<Base, Sugerencia['confidence']> = {
  ETIQUETA_EXPLICITA: 'ALTA', PATRON_UNICO: 'MEDIA', PATRON_AMBIGUO: 'BAJA',
};

/** Etiquetas que el documento puede usar para cada campo. Cerradas y en español. */
const ETIQUETAS: Record<Campo, string[]> = {
  ISSUER: ['emitido por', 'emisor', 'expedido por', 'entidad emisora', 'razón social del emisor'],
  ISSUED_AT: ['fecha de emisión', 'fecha de expedición', 'emitido el', 'expedido el', 'fecha de otorgamiento'],
  EXPIRES_AT: ['fecha de vencimiento', 'fecha de caducidad', 'válido hasta', 'vigente hasta', 'vence el'],
};

/** Una fecha ISO sin ambigüedad: AAAA-MM-DD. Lo demás no se interpreta. */
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
/** Fechas con separador y día/mes delante: NO se normalizan, se marcan como ambiguas. */
const AMBIGUA = /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g;

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function recorte(texto: string, offset: number, largo: number) {
  const desde = Math.max(0, offset - 30);
  const hasta = Math.min(texto.length, offset + largo + 30);
  return texto.slice(desde, hasta).replace(/\s+/g, ' ').trim();
}

function fechaValida(a: string, m: string, d: string) {
  const anio = Number(a); const mes = Number(m); const dia = Number(d);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

/** Busca el valor que sigue a una etiqueta explícita, si la hay. */
function porEtiqueta(texto: string, plano: string, campo: Campo): Sugerencia | null {
  for (const etiqueta of ETIQUETAS[campo]) {
    const aguja = sinAcentos(etiqueta);
    const i = plano.indexOf(aguja);
    if (i < 0) continue;
    // La etiqueta tiene que ser una palabra completa, no un trozo de otra.
    const antes = i === 0 ? ' ' : plano[i - 1];
    const despues = plano[i + aguja.length] ?? ' ';
    if (/[a-z0-9]/.test(antes) || /[a-z0-9]/.test(despues)) continue;
    const cola = texto.slice(i + etiqueta.length, i + etiqueta.length + 120);
    if (campo === 'ISSUER') {
      // Exige DOS PUNTOS: la etiqueta tiene que ROTULAR, no solo mencionarse. Sin esto, un texto como
      // «Sin emisor rotulado ni fechas» propondría «rotulado ni fechas» con confianza ALTA.
      const m = /^\s*:\s*([^\n:]{3,80})/.exec(cola);
      const valor = m?.[1]?.trim().replace(/\s+/g, ' ');
      if (valor && !/^\d+$/.test(valor)) {
        return {
          field_code: campo, suggested_value: valor, basis: 'ETIQUETA_EXPLICITA', confidence: 'ALTA',
          source_excerpt: recorte(texto, i, etiqueta.length + valor.length), source_offset: i, candidates: [],
        };
      }
      continue;
    }
    const iso = /\s*:?\s*(\d{4})-(\d{2})-(\d{2})\b/.exec(cola);
    if (iso && fechaValida(iso[1], iso[2], iso[3])) {
      const valor = `${iso[1]}-${iso[2]}-${iso[3]}`;
      return {
        field_code: campo, suggested_value: valor, basis: 'ETIQUETA_EXPLICITA', confidence: 'ALTA',
        source_excerpt: recorte(texto, i, etiqueta.length + 24), source_offset: i, candidates: [],
      };
    }
  }
  return null;
}

/** Candidatos por forma, cuando no hay etiqueta. */
function porPatron(texto: string, campo: Campo): Sugerencia {
  const candidatos: Sugerencia['candidates'] = [];
  if (campo === 'ISSUER') {
    // Sin etiqueta no se adivina un emisor: eso sería inventarlo.
    return {
      field_code: campo, suggested_value: null, basis: 'PATRON_AMBIGUO', confidence: 'BAJA',
      source_excerpt: null, source_offset: null, candidates: [],
    };
  }
  ISO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ISO.exec(texto)) !== null) {
    if (!fechaValida(m[1], m[2], m[3])) continue;
    candidatos.push({ value: m[0], excerpt: recorte(texto, m.index, m[0].length), offset: m.index });
  }
  AMBIGUA.lastIndex = 0;
  while ((m = AMBIGUA.exec(texto)) !== null) {
    // Se registra como candidato SIN normalizar: no se decide entre día y mes.
    candidatos.push({ value: m[0], excerpt: recorte(texto, m.index, m[0].length), offset: m.index });
  }
  if (candidatos.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(candidatos[0].value)) {
    return {
      field_code: campo, suggested_value: candidatos[0].value, basis: 'PATRON_UNICO', confidence: 'MEDIA',
      source_excerpt: candidatos[0].excerpt, source_offset: candidatos[0].offset, candidates: candidatos,
    };
  }
  return {
    field_code: campo, suggested_value: null, basis: 'PATRON_AMBIGUO', confidence: 'BAJA',
    source_excerpt: null, source_offset: null, candidates: candidatos.slice(0, 20),
  };
}

/** Sugerencias para los tres campos de destino, siempre las tres: la ausencia también se publica. */
export function sugerir(texto: string): Sugerencia[] {
  const plano = sinAcentos(texto);
  return (['ISSUER', 'ISSUED_AT', 'EXPIRES_AT'] as Campo[]).map((campo) => {
    const etiqueta = porEtiqueta(texto, plano, campo);
    if (etiqueta) return etiqueta;
    const patron = porPatron(texto, campo);
    return { ...patron, confidence: CONFIANZA[patron.basis] };
  });
}

/** Texto que explica, en la respuesta, qué significa cada base. No se deja al lector adivinarlo. */
export const EXPLICACION_BASE: Record<Base, string> = {
  ETIQUETA_EXPLICITA: 'El documento rotula este valor con una etiqueta reconocida; la sugerencia es lo que viene después.',
  PATRON_UNICO: 'No hay etiqueta, pero en todo el texto hay exactamente un valor con esta forma.',
  PATRON_AMBIGUO: 'Hay varios candidatos, o ninguno reconocible: NO se sugiere valor y se listan los encontrados para que decidas.',
};
