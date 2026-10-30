import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EN, EN_PATTERNS } from './i18n-en';
import { translate } from './i18n';
import { ROLE_LABELS, recoveryHint, ApiError } from './api';
import { AVAILABILITY } from './documents';
import { GEOMETRY_STATUS, GEOMETRY_TYPE_LABEL, METHOD_LABEL } from './plots';
import { SAT_ANALYSIS, SAT_COVERAGE, SAT_OPERATION, SAT_SCENARIO, SAT_STATUS } from './satellite';
import { GIS_STATUS, GIS_TABLES } from './gis-evaluation';
import { PROFILE_TABLES } from './geo-profile';
import { CONCESION_TABLAS } from './concesiones';
import { TRASPASO_TABLAS } from './traspasos';
import { GEO_PANEL_TABLAS } from './geo-eval-panel';
import { VINCULO_TABLAS } from './vinculo-catalogo';
import { REVISION_TABLAS } from './revision-perfil';
import { GEO_CONFIG_TABLAS } from './geo-config';
import { CONCLUSION_TABLAS } from './conclusion-humana';
import { textosGuia } from './guia-documental';

// P1-015 / D-54 — Español fuente, inglés segunda lengua (ADR-0007, opción B).
const PANTALLAS = [
  'app/page.tsx', 'app/acceso/sso/page.tsx', 'app/cuenta/page.tsx', 'app/organizaciones/[id]/coste/page.tsx',
  'app/organizaciones/[id]/limites/page.tsx', 'lib/workspace.tsx', 'lib/ui.tsx', 'lib/i18n.tsx', 'app/organizaciones/[id]/acceso-plataforma/page.tsx', 'app/plataforma/observabilidad/page.tsx', 'app/plataforma/usuarios/page.tsx',
  // A-01: recorrido de captura de campo
  'app/organizaciones/[id]/captura/page.tsx', 'app/organizaciones/[id]/parcelas/page.tsx', 'app/organizaciones/[id]/parcelas/[plotId]/page.tsx',
  'lib/mi-ubicacion-panel.tsx', 'app/organizaciones/[id]/legalidad/page.tsx', 'lib/entity-documents.tsx', 'lib/document-upload.tsx', 'app/organizaciones/[id]/mi-finca/page.tsx', 'lib/field-capture.tsx', 'lib/field-evidence.tsx', 'lib/manual-capture.tsx', 'lib/location-capture.tsx', 'lib/polygon-capture.tsx',
  'lib/geometry-import.tsx', 'lib/satellite.tsx', 'lib/satellite-autorizacion.tsx', 'lib/pais-produccion.tsx', 'app/organizaciones/[id]/analisis-autorizados/page.tsx', 'lib/producer-self-link.tsx', 'lib/plots.tsx',
  'lib/gis-evaluation.tsx', 'lib/geo-profile.tsx', 'lib/map-capture.tsx', 'app/organizaciones/[id]/concesiones/page.tsx',
  // A-03: traspaso de custodia entre organizaciones
  'app/organizaciones/[id]/traspasos/page.tsx', 'app/organizaciones/[id]/traspasos/[transferId]/page.tsx',
  // I1–I4: panel de evaluación geográfica técnica actual del expediente
  'lib/geo-eval-panel.tsx',
  // D-07.5(b) b-1: vinculación del catálogo de riesgo con un perfil jurídico
  'app/plataforma/catalogo-riesgo/page.tsx',
  'app/plataforma/perfil-juridico/page.tsx',
  'app/plataforma/geolocalizacion/page.tsx', 'app/organizaciones/[id]/geolocalizacion/page.tsx',
  // D-07.6: conclusión humana
  'app/organizaciones/[id]/riesgo/[lotId]/conclusion/page.tsx',
];

describe('internacionalización', () => {
  it('todo texto marcado con t(…) en el recorrido tiene su traducción al inglés', () => {
    const faltan: string[] = [];
    for (const f of PANTALLAS) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\('([^']*)'/g)) if (!(m[1] in EN)) faltan.push(`${f}: ${m[1]}`);
    }
    expect(faltan).toEqual([]);
  });

  it('la guía documental (A-05) y los estados de revisión tienen su traducción al inglés', () => {
    const faltan = [...textosGuia(), 'Revisado: aceptado', 'Con observaciones', 'Pendiente de revisión'].filter((x) => !(x in EN));
    expect(faltan).toEqual([]);
  });

  it('las etiquetas que se traducen por tabla (métodos, estados, satélite, disponibilidad) tienen su traducción', () => {
    const valores: string[] = [
      ...Object.values(METHOD_LABEL), ...Object.values(GEOMETRY_TYPE_LABEL), ...Object.values(GEOMETRY_STATUS).map((x) => x.label),
      ...Object.values(AVAILABILITY).map((x) => x.label), ...Object.values(SAT_STATUS).map((x) => x.label), ...Object.values(SAT_ANALYSIS).map((x) => x.label),
      ...Object.values(SAT_OPERATION), ...Object.values(SAT_COVERAGE), ...Object.values(SAT_SCENARIO),
      ...Object.values(GIS_STATUS).map((x) => x.label), ...Object.values(GIS_TABLES).flatMap((t) => Object.values(t)),
      ...Object.values(PROFILE_TABLES.STATUS).map((x) => x.label), ...Object.values(PROFILE_TABLES.OUTCOME),
      ...Object.values(PROFILE_TABLES.CHECK_LABEL), ...Object.values(PROFILE_TABLES.LAYER),
      ...Object.values(CONCESION_TABLAS.TIPOS), ...Object.values(CONCESION_TABLAS.ESTADOS).map((x) => x.label),
      ...Object.values(TRASPASO_TABLAS.ESTADO_TRASPASO).map((x) => x.label), ...Object.values(TRASPASO_TABLAS.ESTADO_VINCULO).map((x) => x.label),
      ...Object.values(TRASPASO_TABLAS.PASOS), ...Object.values(TRASPASO_TABLAS.DIFERENCIAS), ...Object.values(TRASPASO_TABLAS.RESOLUCIONES), ...Object.values(TRASPASO_TABLAS.CIERRES),
      ...Object.values(TRASPASO_TABLAS.LADOS), ...Object.values(TRASPASO_TABLAS.COMPROBACIONES),
      ...Object.values(GEO_PANEL_TABLAS.PENDING_LABEL), ...Object.values(GEO_PANEL_TABLAS.REQ_LABEL),
      ...Object.values(VINCULO_TABLAS).flatMap((t) => Object.values(t)),
      ...Object.values(REVISION_TABLAS).flatMap((t) => Object.values(t)),
      ...Object.values(GEO_CONFIG_TABLAS).flatMap((t) => Object.values(t)),
      ...Object.values(CONCLUSION_TABLAS).flatMap((t) => Object.values(t)),
    ];
    expect(valores.filter((v) => !(v in EN))).toEqual([]);
  });

  it('los textos que entrega la API del panel geográfico (vigencia, motivos, siguientes acciones, avisos) tienen su traducción', () => {
    const src = readFileSync('../api/src/dd/geo-panel.ts', 'utf8');
    const bloque = src.slice(src.indexOf('export const GEO_PANEL_NOTE'), src.indexOf('interface EvalRow')) + src.slice(src.indexOf("'Tener todas"), src.indexOf("'Tener todas") + 400);
    const textos = [...bloque.matchAll(/'([^'\n]{5,})'/g)].map((m) => m[1]).filter((x) => x.includes(' ') || ['Vigente', 'Obsoleta'].includes(x)).filter((x) => !/^[A-Z_]+$/.test(x));
    expect(textos.length).toBeGreaterThan(10);
    expect(textos.filter((x) => !(x in EN))).toEqual([]);
  });

  it('el español es fuente y reserva: sin traducción devuelve el español, nunca una clave', () => {
    expect(translate('es', 'Iniciar sesión')).toBe('Iniciar sesión');
    expect(translate('en', 'Iniciar sesión')).toBe('Sign in');
    expect(translate('en', 'Un texto que no está en el diccionario')).toBe('Un texto que no está en el diccionario');
    expect(translate('en', 'Por seguridad, espera unos {minutes} min antes de volver a intentarlo.', { minutes: 3 })).toBe('For security, wait about 3 min before trying again.');
    expect(translate('es', 'Vincular {proveedor}', { proveedor: 'X' })).toBe('Vincular X');
  });

  it('ninguna traducción está vacía, ni es igual al español por descuido salvo nombres propios', () => {
    const iguales = new Set(['Authorization Code + PKCE', 'Auditor', 'General', 'No', 'Zoom']);
    for (const [es, en] of Object.entries(EN)) {
      expect(en.trim().length, es).toBeGreaterThan(0);
      if (!iguales.has(es)) expect(en, `sin traducir: ${es}`).not.toBe(es);
      // Las variables {x} se conservan.
      expect([...es.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), es).toEqual([...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });

  it('roles, pistas de recuperación y mensajes con cifras también se traducen', () => {
    for (const rol of Object.values(ROLE_LABELS)) expect(rol in EN, rol).toBe(true);
    for (const code of ['UNAUTHENTICATED', 'VERSION_CONFLICT', 'ORGANIZATION_SUSPENDED', 'PERMISSION_DENIED', 'NOT_FOUND', 'TOO_MANY_ATTEMPTS', 'LOGIN_TEMPORARILY_UNAVAILABLE']) {
      const hint = recoveryHint(new ApiError(403, { code, message: 'x', request_id: null }));
      expect(hint in EN, `${code}: ${hint}`).toBe(true);
    }
    expect(translate('en', 'El archivo supera el límite de 65536 bytes.')).toBe('The file exceeds the limit of 65536 bytes.');
    expect(EN_PATTERNS.length).toBeGreaterThan(0);
  });
});
