import { Order } from '../models/Order.js'
import { audit } from '../models/AuditLog.js'
import { verifyAndSettleGateway } from '../services/orders.js'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let running = false

// Safety net for missed webhooks (server asleep, provider outage, buyer closed the tab).
// It asks Paystack/Flutterwave about every unpaid gateway order and settles the ones that were actually paid.
// Safe to run on several servers at once: settling an order is idempotent.
export async function runReconcile() {
  if (running) return { skipped: true }
  running = true
  const out = { checked: 0, settled: 0, expired: 0, errors: 0 }
  try {
    const now = Date.now()
    const pending = await Order.find({
      status: 'AWAITING_PAYMENT', method: { $in: ['PAYSTACK', 'FLUTTERWAVE'] }, gatewayRef: { $exists: true, $ne: null },
      createdAt: { $lt: new Date(now - 3 * MIN) },
    }).sort({ createdAt: 1 }).limit(50)
    for (const o of pending) {
      out.checked += 1
      try { const r = await verifyAndSettleGateway(o, 'reconcile'); if (r.settled) out.settled += 1 }
      catch (e) { out.errors += 1; console.error(`reconcile ${o._id}:`, e.message) }
      await sleep(250) // be gentle with the provider's API
    }
    // Give up on orders still unpaid after 48 hours. A late payment can still settle them through a webhook or "Check payment".
    const expired = await Order.updateMany({ status: 'AWAITING_PAYMENT', createdAt: { $lt: new Date(now - 48 * HOUR) } }, { status: 'CANCELLED' })
    out.expired = expired.modifiedCount
    if (out.settled || out.expired) await audit('system', 'RECONCILE', JSON.stringify(out))
  } finally { running = false }
  return out
}

export function startReconcileJob() {
  const tick = () => runReconcile().catch((e) => console.error('reconcile failed:', e.message))
  setTimeout(tick, 30 * 1000) // shortly after boot, to catch payments made while the server was asleep
  setInterval(tick, 5 * MIN)
  console.log('Payment reconciliation job started (every 5 minutes)')
}
