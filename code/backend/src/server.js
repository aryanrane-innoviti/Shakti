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
import vendorSkuRoutes from './routes/vendorSkus.js';
import locationRoutes from './routes/locations.js';
import changeLogRoutes from './routes/changeLog.js';
import backupRoutes, { takeDailySnapshot } from './routes/backup.js';
import pincodeRoutes from './routes/pincode.js';
import dashboardRoutes from './routes/dashboard.js';
import loadRoutes from './routes/loads.js';
import stockRoutes from './routes/stock.js';
import auditSessionRoutes, { runAuditSuspensionJob } from './routes/auditSessions.js';
import accessoryStockRoutes from './routes/accessoryStock.js';
import auditReportRoutes from './routes/auditReports.js';

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
  app.use('/vendor-skus', vendorSkuRoutes);
  app.use('/locations', locationRoutes);
  app.use('/change-log', changeLogRoutes);
  app.use('/backup', backupRoutes);
  app.use('/pincode', pincodeRoutes);
  app.use('/dashboard', dashboardRoutes);
  app.use('/loads', loadRoutes);
  app.use('/stock', stockRoutes);
  // Phase 3 ASO slice. The ASO's audit location lives on users.location_id
  // (assigned via PUT /locations/:id/assigned-users) — there is no separate
  // audit-location router.
  app.use('/audit-sessions', auditSessionRoutes);
  app.use('/accessory-stock', accessoryStockRoutes);
  // Phase 3 Report slice — Store review of ASO-authored PARs (STU reviewer;
  // SA/Admin read-only oversight). Owns PendingReview -> Completed/Rejected.
  app.use('/audit-reports', auditReportRoutes);

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

  // Phase 3 ASO: every 5 minutes, mark Incomplete audit sessions whose last
  // activity is >30 minutes old as auto-suspended. Same pattern as the daily
  // snapshot above — single-instance scheduler, no extra deps.
  const FIVE_MIN_MS = 5 * 60 * 1000;
  setInterval(() => {
    runAuditSuspensionJob().catch((e) => console.error('audit suspension job failed', e.message));
  }, FIVE_MIN_MS);

  app.listen(config.port, () => {
    console.log(`Shakti backend listening on http://localhost:${config.port}`);
  });
}

main().catch((e) => {
  console.error('Fatal boot error:', e);
  process.exit(1);
});
