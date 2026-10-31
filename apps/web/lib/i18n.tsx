'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EN, EN_PATTERNS } from './i18n-en';

// Internacionalización de la interfaz (P1-015 / D-54; ADR-0007, opción B).
//
// REGLAS
//   · El ESPAÑOL es la fuente: la clave de cada texto ES el texto en español. Si no existe traducción, se muestra el
//     español —nunca una clave—, así que el peor caso es ver español (RF-46: «español primero»).
//   · Es traducción de INTERFAZ (etiquetas, estados, errores y navegación). No es traducción jurídica certificada, y
//     no toca los documentos ni las evidencias: esos se conservan tal como se aportaron.
//   · La preferencia es de quien usa la pantalla y vive en su navegador; no cambia datos ni permisos.

export type Locale = 'es' | 'en';
export const LOCALES: Array<{ code: Locale; label: string }> = [{ code: 'es', label: 'Español' }, { code: 'en', label: 'English' }];
const KEY = 'tl_lang';

export function translate(locale: Locale, es: string, vars?: Record<string, string | number>): string {
  let base = es;
  if (locale === 'en') {
    base = EN[es] ?? es;
    if (base === es) for (const [re, out] of EN_PATTERNS) if (re.test(es)) { base = es.replace(re, out); break; }
  }
  return vars ? base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : base;
}

/** Etiqueta regional para fechas y números: la interfaz en inglés no mezcla formatos ecuatorianos. */
export const regionOf = (l: Locale) => (l === 'en' ? 'en-US' : 'es-EC');

interface I18n {
  locale: Locale; setLocale: (l: Locale) => void; t: (es: string, vars?: Record<string, string | number>) => string;
  /** Fecha y hora en el idioma de la interfaz. */
  dt: (v: string | number | Date) => string;
  /** Número con los separadores del idioma de la interfaz. */
  num: (v: number, max?: number) => string;
}
const Ctx = createContext<I18n>({
  locale: 'es', setLocale: () => undefined, t: (es, vars) => translate('es', es, vars),
  dt: (v) => new Date(v).toLocaleString(regionOf('es')), num: (v, max = 4) => v.toLocaleString(regionOf('es'), { maximumFractionDigits: max }),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('es');

  // Se lee tras montar: el primer pintado es siempre español, igual que el HTML del servidor.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'en' || saved === 'es') setLocaleState(saved);
    } catch { /* almacenamiento bloqueado: se queda en español */ }
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(KEY, l); } catch { /* sin almacenamiento */ }
  }, []);
  const t = useCallback((es: string, vars?: Record<string, string | number>) => translate(locale, es, vars), [locale]);
  const dt = useCallback((v: string | number | Date) => new Date(v).toLocaleString(regionOf(locale)), [locale]);
  const num = useCallback((v: number, max = 4) => v.toLocaleString(regionOf(locale), { maximumFractionDigits: max }), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t, dt, num }), [locale, setLocale, t, dt, num]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

/** Selector de idioma accesible con teclado (un `select` nativo). */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <span className="lang-switch">
      <label htmlFor="lang-switch" className="visually-hidden">{t('Idioma de la interfaz')}</label>
      <select id="lang-switch" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </span>
  );
}
