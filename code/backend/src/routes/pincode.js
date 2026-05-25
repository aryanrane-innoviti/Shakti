import { Router } from 'express';
import http from 'node:http';
import https from 'node:https';
import { config } from '../config.js';

const router = Router();

/**
 * api.postalpincode.in is currently served with an expired / wrong-host TLS
 * certificate, which makes a normal fetch() reject the connection. The pincode
 * data it returns is public and non-sensitive, so we skip certificate
 * verification for this single upstream lookup rather than letting a
 * third-party cert lapse block address entry across the app.
 */
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function getJson(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const opts = isHttps ? { agent: insecureHttpsAgent } : {};
    const req = client.get(url, opts, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('pincode lookup timed out')));
  });
}

router.get('/:code', async (req, res) => {
  const code = req.params.code;
  if (!/^\d{6}$/.test(code)) return res.status(422).json({ error: 'invalid_pincode' });
  try {
    const r = await getJson(config.pincodeApiUrl + code);
    if (r.status < 200 || r.status >= 300) return res.status(502).json({ error: 'lookup_failed' });
    const data = JSON.parse(r.body);
    const block = Array.isArray(data) ? data[0] : data;
    if (!block || block.Status !== 'Success' || !block.PostOffice || !block.PostOffice.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const cities = [
      ...new Set(
        block.PostOffice.map((po) => po.District || po.Name).filter(Boolean)
      ),
    ];
    const state = block.PostOffice[0].State;
    res.json({ pincode: code, state, cities });
  } catch (e) {
    res.status(502).json({ error: 'lookup_failed', message: e.message });
  }
});

export default router;
