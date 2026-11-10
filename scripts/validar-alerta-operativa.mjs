import { readFileSync } from 'node:fs';

const input = process.argv[2];
const secretKey = /(password|secret|token|private.?key|authorization|database_url|access.?key)/i;
const fail = (message) => { console.error(`ALERT_INVALID: ${message}`); process.exitCode = 1; };
try {
  if (!input) throw new Error('falta archivo de alerta');
  const alert = JSON.parse(readFileSync(input, 'utf8'));
  const required = ['alert_id', 'severity', 'component', 'occurred_at', 'correlation_id', 'runbook_ref'];
  const missing = required.filter((key) => typeof alert[key] !== 'string' || !alert[key].trim());
  if (missing.length) throw new Error(`faltan campos: ${missing.join(', ')}`);
  if (!['warning', 'critical'].includes(alert.severity)) throw new Error('severity inválida');
  const serialized = JSON.stringify(alert);
  if (secretKey.test(serialized)) throw new Error('payload contiene un campo sensible');
  console.log(JSON.stringify({ status: 'PASS', alert_id: alert.alert_id, severity: alert.severity, component: alert.component, correlation_id: alert.correlation_id, runbook_ref: alert.runbook_ref }));
} catch (error) { fail(error.message); }
