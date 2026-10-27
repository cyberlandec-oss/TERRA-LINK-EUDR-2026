// Reporter de tiempos (diagnóstico del timeout intermitente de P0-004). Acotado: duración por suite y
// por prueba y estado. No cambia timeouts ni resultados. Escribe apps/api/test-results/timings.json.
const fs = require('fs');
const path = require('path');

class TimingReporter {
  onRunComplete(_contexts, results) {
    const dir = path.resolve(__dirname, '..', 'test-results');
    fs.mkdirSync(dir, { recursive: true });
    const suites = results.testResults.map((s) => ({
      suite: path.relative(path.resolve(__dirname, '..'), s.testFilePath).replace(/\\/g, '/'),
      duration_ms: s.perfStats.end - s.perfStats.start,
      setup_ms: s.perfStats.setupDuration ?? null,
      tests: s.testResults.map((t) => ({ name: t.fullName, status: t.status, duration_ms: t.duration ?? null })),
    }));
    fs.writeFileSync(path.join(dir, 'timings.json'), JSON.stringify({ generated_at: new Date().toISOString(), suites }, null, 2));
  }
}
module.exports = TimingReporter;
