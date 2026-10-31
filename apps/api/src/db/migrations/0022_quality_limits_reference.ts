import { Kysely } from 'kysely';
import { publishKdeRelease } from '../../traceability/kde-release';
import { KDE_1_0_0 } from './0016_kde_catalog';

// Revisión P0-012 (2026-10-10): el dato que acompaña a «liberar calidad» es una REFERENCIA DECLARADA por quien
// decide, no una versión comprobada contra un catálogo de límites (que no existe). KDE 1.2.0 republica solo esa
// definición con nombre y diferencia explícitos; la regla (requerida al liberar) no cambia. Sin parámetros,
// límites ni tolerancias nuevos.
export async function up(db: Kysely<unknown>): Promise<void> {
  const base = KDE_1_0_0.find((d) => d.code === 'CLASSIFICATION_LIMITS_VERSION')!;
  await publishKdeRelease(db, {
    version: '1.2.0', source: 'Revisión de P0-012 (contrato de calidad)',
    notes: 'CLASSIFICATION_LIMITS_VERSION se presenta como referencia declarada, no verificada; no existe catálogo publicado de límites.',
    publish: [{ ...base, name: 'Referencia de límites declarada (no verificada)',
      difference: 'Texto escrito por quien decide. No hay catálogo publicado de parámetros ni límites: el sistema no comprueba la referencia ni contrasta mediciones contra límites, y la decisión no habilita operaciones posteriores.' }],
  });
}

export async function down(): Promise<void> {
  // Catálogo append-only: no se retira una versión publicada.
}
