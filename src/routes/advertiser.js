import { Router } from 'express'
import { z } from 'zod'
import mongoose from 'mongoose'
import { Order } from '../models/Order.js'
import { Campaign } from '../models/Campaign.js'
import { ViewSession } from '../models/ViewSession.js'
import { ah } from '../utils/asyncHandler.js'
import { httpError } from '../utils/httpError.js'
import { validate } from '../middleware/validate.js'
import { requireAuth, requireMember, requireVerified } from '../middleware/auth.js'
import { lagosDay } from '../utils/dates.js'
import { buildItem, summarize, buildTimeline, fillDays, receiptNumber, deriveStatus } from '../services/advertiserView.js'

// Read-only advertiser dashboard. Every query is scoped to the signed-in member's own orders.
// Advertisers only ever see counts: never who watched.
const r = Router()
r.use(requireAuth, requireVerified, requireMember)
const idParam = z.object({ id: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id') })

r.get('/campaigns', ah(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(200).lean()
  const camps = await Campaign.find({ order: { $in: orders.map((o) => o._id) } }).lean()
  const byOrder = new Map(camps.map((c) => [String(c.order), c]))
  const items = orders.map((o) => buildItem(o, byOrder.get(String(o._id))))
  res.json({ summary: summarize(items), items })
}))

r.get('/campaigns/:id', validate(idParam, 'params'), ah(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id }).lean()
  if (!order) throw httpError(404, 'Campaign not found.')
  const campaign = await Campaign.findOne({ order: order._id }).lean()
  const item = buildItem(order, campaign)
  const days = Array.from({ length: 30 }, (_, i) => lagosDay(new Date(Date.now() - (29 - i) * 86400000)))
  const rows = campaign
    ? await ViewSession.aggregate([{ $match: { campaign: campaign._id, status: 'COMPLETED', completedDay: { $gte: days[0] } } }, { $group: { _id: '$completedDay', n: { $sum: 1 } } }])
    : []
  res.json({
    item, ref: order.ref || null, videoUrl: order.videoUrl, videoPublicId: order.videoPublicId,
    timeline: buildTimeline(order, campaign, deriveStatus(order, campaign)), daily: fillDays(rows, days),
  })
}))

r.get('/receipts/:id', validate(idParam, 'params'), ah(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id, status: 'PAID' }).lean()
  if (!order) throw httpError(404, 'Receipt not found. Receipts exist only for confirmed payments.')
  res.json({
    receiptNumber: receiptNumber(order), issuedAt: order.paidAt, buyer: { name: req.user.name, email: req.user.email, phone: req.user.phone },
    description: `${order.packageName} advertising package: "${order.title}"`, packageName: order.packageName, views: order.completions,
    advertiserRateKobo: order.advertiserRateKobo, amountKobo: order.priceKobo, method: order.method, reference: order.ref,
  })
}))
export default r
