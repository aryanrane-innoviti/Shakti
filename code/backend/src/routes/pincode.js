import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

router.get('/:code', async (req, res) => {
  const code = req.params.code;
  if (!/^\d{6}$/.test(code)) return res.status(422).json({ error: 'invalid_pincode' });
  try {
    const r = await fetch(config.pincodeApiUrl + code);
    if (!r.ok) return res.status(502).json({ error: 'lookup_failed' });
    const data = await r.json();
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
