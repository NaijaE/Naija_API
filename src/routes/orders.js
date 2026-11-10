import { Router } from 'express'
import { z } from 'zod'
import mongoose from 'mongoose'
import { Order } from '../models/Order.js'
import { audit } from '../models/AuditLog.js'
import { ah } from '../utils/asyncHandler.js'
import { httpError } from '../utils/httpError.js'
import { validate } from '../middleware/validate.js'
import { requireAuth, requireMember, requireVerified } from '../middleware/auth.js'
import { proofUpload } from '../middleware/upload.js'
import { getSettings } from '../services/settings.js'
import { uploadProof } from '../services/cloudinary.js'
import { initPaystack, initFlutterwave } from '../services/payments.js'
import { verifyAndSettleGateway } from '../services/orders.js'
import { config } from '../config.js'
import { naira } from '../utils/money.js'

const r = Router()
r.use(requireAuth, requireVerified, requireMember)

const create = z.object({
  packageId: z.enum(['spark', 'boost', 'prime']),
  method: z.enum(['PAYSTACK', 'FLUTTERWAVE', 'BANK_TRANSFER']),
})

r.get('/', ah(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).select('-proof -videoPublicId').lean()
  res.json({ orders })
}))

r.post('/', proofUpload.single('proof'), validate(create), ah(async (req, res) => {
  const b = req.body
  const cfg = await getSettings()
  const pkg = cfg.packages.find((p) => p.id === b.packageId)
  if (!pkg) throw httpError(400, 'Unknown package.')
  if (b.method === 'BANK_TRANSFER' && !req.file) throw httpError(400, 'Upload your proof of payment for a bank transfer.')
  const proof = b.method === 'BANK_TRANSFER' ? await uploadProof(req.file.buffer, req.file.originalname) : undefined

  const order = await Order.create({
    user: req.user._id, packageId: pkg.id, packageName: pkg.name, priceKobo: pkg.priceKobo, completions: pkg.completions,
    memberRewardKobo: pkg.memberRewardKobo, advertiserRateKobo: Math.floor(pkg.priceKobo / pkg.completions),
    method: b.method, proof,
    status: b.method === 'BANK_TRANSFER' ? 'PENDING_REVIEW' : 'AWAITING_PAYMENT',
  })
  await audit(req.user.email, 'DEPOSIT_STARTED', `${order._id} ${pkg.name} ${naira(pkg.priceKobo)} ${b.method}`)

  if (b.method === 'BANK_TRANSFER') {
    return res.status(201).json({ order: { id: order._id, status: order.status }, bank: { ...config.bank, reference: String(order._id) },
      message: 'Proof received. An admin will match it to our bank statement and confirm your deposit. After that, add your video from My campaigns.' })
  }
  order.gatewayRef = `NE-${order._id}`
  const returnUrl = `${config.paymentReturnUrl}${config.paymentReturnUrl.includes('?') ? '&' : '?'}order=${order._id}`
  try {
    const init = b.method === 'PAYSTACK'
      ? await initPaystack({ email: req.user.email, amountKobo: order.priceKobo, reference: order.gatewayRef, callbackUrl: returnUrl })
      : await initFlutterwave({ email: req.user.email, name: req.user.name, phone: req.user.phone, amountKobo: order.priceKobo, reference: order.gatewayRef, callbackUrl: returnUrl })
    await order.save()
    res.status(201).json({ order: { id: order._id, status: order.status }, paymentUrl: init.paymentUrl })
  } catch (e) {
    order.status = 'CANCELLED'; await order.save()
    throw e
  }
}))

const idParam = z.object({ id: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id') })
// Call this when the buyer returns from the payment page. Only the provider's verified answer can mark an order paid.
r.post('/:id/verify', validate(idParam, 'params'), ah(async (req, res) => {
  const o = await Order.findOne({ _id: req.params.id, user: req.user._id })
  if (!o) throw httpError(404, 'Order not found.')
  if (o.method === 'BANK_TRANSFER') return res.json({ status: o.status })
  const out = await verifyAndSettleGateway(o)
  res.json({ status: out.status, settled: out.settled })
}))

r.post('/:id/cancel', validate(idParam, 'params'), ah(async (req, res) => {
  const o = await Order.findOneAndUpdate({ _id: req.params.id, user: req.user._id, status: 'AWAITING_PAYMENT' }, { status: 'CANCELLED' }, { new: true })
  if (!o) throw httpError(404, 'Order not found or not cancellable.')
  res.json({ status: o.status })
}))
export default r
