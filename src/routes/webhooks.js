import { Router } from 'express'
import crypto from 'crypto'
import { Order } from '../models/Order.js'
import { audit } from '../models/AuditLog.js'
import { config } from '../config.js'
import { verifyAndSettleGateway } from '../services/orders.js'

const r = Router()
const safeEqual = (a, b) => { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y) }

// A webhook only tells us WHERE to look. We always re-verify with the provider before crediting anything.
async function handle(ref) {
  const order = await Order.findOne({ gatewayRef: ref })
  if (order) await verifyAndSettleGateway(order)
}

r.post('/paystack', async (req, res) => {
  try {
    if (!config.paystackSecret) return res.sendStatus(503)
    const sig = crypto.createHmac('sha512', config.paystackSecret).update(req.body).digest('hex')
    if (!safeEqual(sig, req.headers['x-paystack-signature'])) return res.sendStatus(401)
    const evt = JSON.parse(req.body.toString('utf8'))
    if (evt.event === 'charge.success' && evt.data && evt.data.reference) await handle(evt.data.reference)
    res.sendStatus(200)
  } catch (e) { console.error('paystack webhook', e); await audit('system', 'WEBHOOK_ERROR', `paystack: ${e.message}`).catch(() => {}); res.sendStatus(500) }
})

r.post('/flutterwave', async (req, res) => {
  try {
    if (!config.flutterwave.hash) return res.sendStatus(503)
    if (!safeEqual(req.headers['verif-hash'], config.flutterwave.hash)) return res.sendStatus(401)
    const evt = JSON.parse(req.body.toString('utf8'))
    const ref = evt.data && (evt.data.tx_ref || (evt['event.type'] && evt.txRef))
    if (ref) await handle(ref)
    res.sendStatus(200)
  } catch (e) { console.error('flutterwave webhook', e); await audit('system', 'WEBHOOK_ERROR', `flutterwave: ${e.message}`).catch(() => {}); res.sendStatus(500) }
})
export default r
