'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Filtros de un listado conservados en la URL (UX_UI §6.2 «vínculo de regreso conservando filtros»; P0-027).
 * Al montar lee la consulta actual; al cambiar la reescribe con history.replaceState (sin navegar ni recargar), de modo que
 * volver desde un detalle restaura los filtros. `ready` evita una primera carga con los valores por omisión.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T): [T, (next: Partial<T>) => void, boolean] {
  const [values, setValues] = useState<T>(defaults);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const read = Object.fromEntries(Object.keys(defaults).map((k) => [k, params.get(k) ?? defaults[k]])) as T;
    setValues(read);
    setReady(true);
    // Solo al montar: los valores por omisión son constantes de la página.
  }, []);

  const update = useCallback((next: Partial<T>) => {
    setValues((prev) => {
      const merged = { ...prev, ...next } as T;
      const params = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(merged)) {
        if (v && v !== defaults[k]) params.set(k, v);
        else params.delete(k);
      }
      const qs = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      return merged;
    });
  }, []);

  return [values, update, ready];
}
