import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';

const ca = fs.readFileSync(process.env.TL_TEST_CA ?? '/certs/ca.crt');
const fail = (message) => { console.error(`ASSERTION_FAILED ${message}`); process.exitCode = 1; };
const httpsRequest = (servername, trust = true) => new Promise((resolve) => {
  const req = https.request({ host: 'proxy', port: 8443, path: '/health/live', servername, ca: trust ? ca : undefined, rejectUnauthorized: true }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', (error) => resolve({ error: error.code }));
  req.end();
});
const httpRequest = () => new Promise((resolve) => {
  const req = http.get('http://proxy:8080/health/live', (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
  });
  req.on('error', (error) => resolve({ error: error.code }));
});
const directRequest = () => fetch('http://api:4000/health/live').then((res) => ({ status: res.status })).catch((error) => ({ error: error.cause?.code ?? error.code }));

const valid = await httpsRequest('terra-link.test');
if (valid.status !== 200 || !valid.body.includes('"status":"ok"')) fail(`HTTPS válido: ${JSON.stringify(valid)}`);
const wrongCa = await httpsRequest('terra-link.test', false);
if (wrongCa.error !== 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') fail(`CA no confiable: ${JSON.stringify(wrongCa)}`);
const wrongName = await httpsRequest('wrong.test');
if (wrongName.error !== 'ERR_TLS_CERT_ALTNAME_INVALID') fail(`nombre incorrecto: ${JSON.stringify(wrongName)}`);
const redirect = await httpRequest();
if (redirect.status !== 308 || redirect.location !== 'https://proxy:8443/health/live') fail(`redirección HTTP: ${JSON.stringify(redirect)}`);
const direct = await directRequest();
if (direct.error !== 'ENOTFOUND') fail(`bypass directo: ${JSON.stringify(direct)}`);
if (!process.exitCode) console.log('TLS_ASSERTIONS_OK');
