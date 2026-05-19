import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDb } from './db.js';
import { runSeed } from './lib/seed.js';
import { authMiddleware, attachInitialSetupFlag } from './lib/auth.js';
import { ValidationError } from './lib/validate.js';

import authRoutes from './routes/auth.js';
import userTypeRoutes from './routes/userTypes.js';
import userRoutes from './routes/users.js';
import contactRoutes from './routes/contacts.js';
import vendorTypeRoutes from './routes/vendorTypes.js';
import vendorRoutes from './routes/vendors.js';
import skuTypeRoutes from './routes/skuTypes.js';
import skuRoutes from './routes/skus.js';
import terminalParentRoutes from './routes/terminalParentSkus.js';
import locationRoutes from './routes/locations.js';
import changeLogRoutes from './routes/changeLog.js';
import backupRoutes, { takeDailySnapshot } from './routes/backup.js';
import pincodeRoutes from './routes/pincode.js';
import dashboardRoutes from './routes/dashboard.js';

async function main() {
  await initDb();
  await runSeed();

  const app = express();
  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(authMiddleware);
  app.use(attachInitialSetupFlag);

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/auth', authRoutes);
  app.use('/user-types', userTypeRoutes);
  app.use('/users', userRoutes);
  app.use('/contacts', contactRoutes);
  app.use('/vendor-types', vendorTypeRoutes);
  app.use('/vendors', vendorRoutes);
  app.use('/sku-types', skuTypeRoutes);
  app.use('/skus', skuRoutes);
  app.use('/terminal-parent-skus', terminalParentRoutes);
  app.use('/locations', locationRoutes);
  app.use('/change-log', changeLogRoutes);
  app.use('/backup', backupRoutes);
  app.use('/pincode', pincodeRoutes);
  app.use('/dashboard', dashboardRoutes);

  app.use((err, req, res, _next) => {
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message, fields: err.fields });
    }
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  });

  const DAY_MS = 24 * 3600_000;
  setInterval(() => {
    takeDailySnapshot().catch((e) => console.error('daily snapshot failed', e.message));
  }, DAY_MS);

  app.listen(config.port, () => {
    console.log(`Shakti backend listening on http://localhost:${config.port}`);
  });
}

main().catch((e) => {
  console.error('Fatal boot error:', e);
  process.exit(1);
});
