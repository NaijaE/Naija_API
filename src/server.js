import mongoose from 'mongoose'
import { config } from './config.js'
import { connectDb } from './db.js'
import { createApp } from './app.js'
import { ensureSettings } from './services/settings.js'
import { startReconcileJob } from './jobs/reconcile.js'
import { emailConfigured, smsConfigured } from './services/notify.js'

async function main() {
  await connectDb()
  await ensureSettings()
  const app = createApp()
  const server = app.listen(config.port, () => console.log(`API listening on :${config.port} (${config.env})`))
  if (config.reconcileEnabled) startReconcileJob()
  if (config.isProd && !emailConfigured()) console.warn('WARNING: no email provider configured (BREVO_API_KEY or SMTP_*). Members cannot verify their email.')
  if (config.isProd && !smsConfigured()) console.warn('WARNING: TERMII_API_KEY is not set. Members cannot verify their phone.')
  const stop = async () => {
    server.close(async () => { await mongoose.disconnect(); process.exit(0) })
    setTimeout(() => process.exit(1), 10000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
main().catch((e) => { console.error('Fatal startup error:', e); process.exit(1) })
