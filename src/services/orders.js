import { Order } from '../models/Order.js'
import { Campaign } from '../models/Campaign.js'
import { audit } from '../models/AuditLog.js'
import { User } from '../models/User.js'
import { withTxn } from '../utils/txn.js'
import { naira } from '../utils/money.js'
import { verifyPaystack, verifyFlutterwave } from './payments.js'

// Marks an order PAID exactly once and creates the funded campaign (waiting for content review).
// Idempotent: webhooks can be retried and the browser can also ask us to verify; only one wins.
export async function settleOrder(orderId, { ref, actor, fromStatuses }) {
  return withTxn(async (session) => {
    const o = await Order.findOneAndUpdate(
      { _id: orderId, status: { $in: fromStatuses } },
      { status: 'PAID', ref, paidAt: new Date() },
      { new: true, session },
    )
    if (!o) return { settled: false }
    const buyer = await User.findById(o.user).session(session)
    const [c] = await Campaign.create([{
      name: `${o.packageName} package: ${o.title}`, sponsor: buyer ? buyer.name : 'Advertiser', title: o.title, durationSec: o.durationSec,
      videoPublicId: o.videoPublicId, videoUrl: o.videoUrl, rewardKobo: o.memberRewardKobo, advertiserRateKobo: o.advertiserRateKobo,
      budgetKobo: o.priceKobo, completionCap: o.completions, status: 'CONTENT_REVIEW', prepaymentRef: ref, order: o._id, packageId: o.packageId,
    }], { session })
    o.campaign = c._id
    await o.save({ session })
    await audit(actor, 'DEPOSIT_CONFIRMED', `${o._id} ${naira(o.priceKobo)} via ${o.method} ref ${ref}`, session)
    return { settled: true, order: o }
  })
}

// Asks the provider whether this order was really paid, and settles it only if amount and currency match.
export async function verifyAndSettleGateway(order) {
  if (order.status !== 'AWAITING_PAYMENT') return { settled: false, status: order.status }
  const v = order.method === 'PAYSTACK' ? await verifyPaystack(order.gatewayRef) : await verifyFlutterwave(order.gatewayRef)
  if (!v.paid) return { settled: false, status: order.status }
  if (v.amountKobo !== order.priceKobo) {
    await audit('system', 'DEPOSIT_AMOUNT_MISMATCH', `${order._id} expected ${order.priceKobo} got ${v.amountKobo}`)
    return { settled: false, status: order.status, mismatch: true }
  }
  const r = await settleOrder(order._id, { ref: v.ref, actor: `gateway:${order.method}`, fromStatuses: ['AWAITING_PAYMENT'] })
  return { settled: r.settled, status: 'PAID' }
}
