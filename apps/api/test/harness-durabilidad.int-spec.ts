import { sql } from 'kysely';
import { TEST_URL, describeDb, setupHarness } from './helpers';

// Arnés de pruebas: `synchronous_commit = off` solo en la base DESECHABLE `*_test` y nunca en comprobaciones de durabilidad o recuperación.
// (PostgreSQL: con commit asíncrono, una caída puede perder las últimas transacciones confirmadas.)
describeDb('arnés: commit asíncrono limitado a la base desechable', () => {
  it('por defecto la base *_test usa commit asíncrono y conserva las opciones de sesión del producto', async () => {
    const h = await setupHarness();
    try {
      expect(new URL(TEST_URL!).pathname.endsWith('_test')).toBe(true);
      const v = async (n: string) => (await sql<{ v: string }>`SELECT current_setting(${n}) AS v`.execute(h.db)).rows[0].v;
      expect(await v('synchronous_commit')).toBe('off');
      expect(await v('client_min_messages')).toBe('warning');
    } finally { await h.close(); }
  });

  it('con `durable: true` se conserva la configuración OPERATIVA de commit (la de las comprobaciones de durabilidad y recuperación)', async () => {
    const h = await setupHarness({}, { durable: true });
    try {
      const v = async (n: string) => (await sql<{ v: string }>`SELECT current_setting(${n}) AS v`.execute(h.db)).rows[0].v;
      expect(await v('synchronous_commit')).toBe('on');
      expect(await v('client_min_messages')).toBe('warning');
    } finally { await h.close(); }
  });

  it('el arnés se niega a operar sobre una base que no sea *_test (la operativa nunca recibe este ajuste)', () => {
    expect(new URL(TEST_URL!).pathname).toMatch(/_test$/);
  });
});
