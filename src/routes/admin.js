import { Router } from 'express'
import { z } from 'zod'
import mongoose from 'mongoose'
import { User } from '../models/User.js'
import { Order } from '../models/Order.js'
import { Campaign } from '../models/Campaign.js'
import { ViewSession } from '../models/ViewSession.js'
import { Withdrawal } from '../models/Withdrawal.js'
import { Ledger } from '../models/Ledger.js'
import { Settings, Proposal } from '../models/Settings.js'
import { AuditLog, audit } from '../models/AuditLog.js'
import { ah } from '../utils/asyncHandler.js'
import { httpError } from '../utils/httpError.js'
import { validate } from '../middleware/validate.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { settleOrder } from '../services/orders.js'
import { moveWithdrawal } from '../services/withdrawals.js'
import { getSettings, changesSchema, assertConsistent } from '../services/settings.js'
import { inspectVideo, proofLink, videoUploadSignature, pingCloudinary, VIDEO_ID_RE } from '../services/cloudinary.js'
import { config } from '../config.js'
import { lagosDay } from '../utils/dates.js'
import { runReconcile } from '../jobs/reconcile.js'
import { sendEmail, sendSms } from '../services/notify.js'
import { normalizePhone } from '../utils/codes.js'
import { byUser, MIN } from '../middleware/limits.js'

const r = Router()
r.use(requireAuth, requireAdmin)

const oid = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id')
const idParam = z.object({ id: oid })
const reasonBody = z.object({ reason: z.string().trim().min(3).max(300) })
const page = z.object({ page: z.coerce.number().int().min(1).default(1), status: z.string().optional(), search: z.string().trim().max(80).optional() })

// ---------- overview + analytics ----------
r.get('/overview', ah(async (_req, res) => {
  const since = lagosDay(new Date(Date.now() - 6 * 86400000))
  const [users, deposits, pendingDeposits, pendingWd, paidOut, camps, active, watched, budget, liability, pendingProposals] = await Promise.all([
    User.countDocuments({ role: 'MEMBER' }),
    Order.aggregate([{ $match: { status: 'PAID' } }, { $group: { _id: null, t: { $sum: '$priceKobo' } } }]),
    Order.countDocuments({ status: 'PENDING_REVIEW' }),
    Withdrawal.aggregate([{ $match: { status: { $in: ['PENDING', 'APPROVED'] } } }, { $group: { _id: null, n: { $sum: 1 }, t: { $sum: '$amountKobo' } } }]),
    Withdrawal.aggregate([{ $match: { status: 'PAID' } }, { $group: { _id: null, t: { $sum: '$netKobo' } } }]),
    Campaign.countDocuments({ status: 'ACTIVE' }),
    ViewSession.aggregate([{ $match: { lagosDay: { $gte: since } } }, { $group: { _id: { d: '$lagosDay', u: '$user' } } }, { $group: { _id: '$_id.d', dau: { $sum: 1 } } }]),
    ViewSession.aggregate([{ $match: { status: 'COMPLETED', completedDay: { $gte: since } } }, { $group: { _id: '$completedDay', n: { $sum: 1 } } }]),
    Campaign.aggregate([{ $match: { status: 'ACTIVE' } }, { $group: { _id: null, funded: { $sum: '$budgetKobo' }, used: { $sum: '$consumedKobo' } } }]),
    User.aggregate([{ $match: { role: 'MEMBER' } }, { $group: { _id: null, t: { $sum: '$balanceKobo' } } }]),
    Proposal.countDocuments({ status: 'PENDING' }),
  ])
  const dau = Object.fromEntries(active.map((x) => [x._id, x.dau]))
  const vw = Object.fromEntries(watched.map((x) => [x._id, x.n]))
  const days = Array.from({ length: 7 }, (_, i) => lagosDay(new Date(Date.now() - (6 - i) * 86400000)))
  res.json({
    members: users, totalDepositsKobo: deposits[0]?.t || 0, pendingDeposits,
    pendingWithdrawals: pendingWd[0]?.n || 0, pendingWithdrawalsKobo: pendingWd[0]?.t || 0, paidOutKobo: paidOut[0]?.t || 0, activeCampaigns: camps,
    fundedBudgetKobo: budget[0]?.funded || 0, budgetRemainingKobo: (budget[0]?.funded || 0) - (budget[0]?.used || 0),
    rewardLiabilityKobo: liability[0]?.t || 0, pendingProposals,
    last7Days: days.map((d) => ({ date: d, dailyActiveUsers: dau[d] || 0, videosWatched: vw[d] || 0 })),
  })
}))

// ---------- users ----------
r.get('/users', validate(page, 'query'), ah(async (req, res) => {
  const { page: p, search } = req.query
  const q = { role: 'MEMBER', ...(search ? { $or: [{ name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] } : {}) }
  const [users, total] = await Promise.all([User.find(q).sort({ createdAt: -1 }).skip((p - 1) * 50).limit(50).lean(), User.countDocuments(q)])
  const dep = await Order.aggregate([{ $match: { status: 'PAID', user: { $in: users.map((u) => u._id) } } }, { $group: { _id: '$user', t: { $sum: '$priceKobo' } } }])
  const depMap = Object.fromEntries(dep.map((d) => [String(d._id), d.t]))
  res.json({ total, page: p, users: users.map((u) => ({ id: u._id, name: u.name, email: u.email, phone: u.phone, status: u.status, verified: u.emailVerified && u.phoneVerified,
    balanceKobo: u.balanceKobo, totalDepositsKobo: depMap[String(u._id)] || 0, createdAt: u.createdAt })) })
}))
r.patch('/users/:id/status', validate(idParam, 'params'), validate(reasonBody.extend({ status: z.enum(['ACTIVE', 'SUSPENDED']) })), ah(async (req, res) => {
  const u = await User.findOneAndUpdate({ _id: req.params.id, role: 'MEMBER' }, { status: req.body.status, $inc: { tokenVersion: req.body.status === 'SUSPENDED' ? 1 : 0 } }, { new: true })
  if (!u) throw httpError(404, 'User not found.')
  await audit(req.user.email, `USER_${req.body.status}`, `${u.email}: ${req.body.reason}`)
  res.json({ ok: true })
}))

// ---------- deposits ----------
r.get('/deposits', validate(page, 'query'), ah(async (req, res) => {
  const q = req.query.status ? { status: req.query.status } : {}
  const orders = await Order.find(q).sort({ createdAt: -1 }).skip((req.query.page - 1) * 50).limit(50).populate('user', 'name email').lean()
  res.json({ deposits: orders.map((o) => ({ ...o, proofUrl: proofLink(o.proof) })) })
}))
r.post('/deposits/:id/approve', validate(idParam, 'params'), validate(z.object({ reference: z.string().trim().min(3).max(100) })), ah(async (req, res) => {
  const o = await Order.findById(req.params.id)
  if (!o || o.method !== 'BANK_TRANSFER') throw httpError(404, 'Manual deposit not found.')
  const out = await settleOrder(o._id, { ref: req.body.reference, actor: req.user.email, fromStatuses: ['PENDING_REVIEW'] })
  if (!out.settled) throw httpError(409, 'This deposit is not waiting for review.')
  await Order.updateOne({ _id: o._id }, { reviewedBy: req.user.email })
  res.json({ ok: true })
}))
r.post('/deposits/:id/reject', validate(idParam, 'params'), validate(reasonBody), ah(async (req, res) => {
  const o = await Order.findOneAndUpdate({ _id: req.params.id, status: 'PENDING_REVIEW' }, { status: 'REJECTED', rejectReason: req.body.reason, reviewedBy: req.user.email }, { new: true })
  if (!o) throw httpError(409, 'This deposit is not waiting for review.')
  await audit(req.user.email, 'DEPOSIT_REJECTED', `${o._id}: ${req.body.reason}`)
  res.json({ ok: true })
}))

// ---------- campaigns ----------
r.get('/campaigns', validate(page, 'query'), ah(async (req, res) => {
  const q = req.query.status ? { status: req.query.status } : {}
  res.json({ campaigns: await Campaign.find(q).sort({ createdAt: -1 }).limit(100).lean() })
}))
r.post('/campaigns', validate(z.object({
  name: z.string().trim().min(3).max(100), sponsor: z.string().trim().min(2).max(80), title: z.string().trim().min(3).max(100),
  videoPublicId: z.string().regex(VIDEO_ID_RE), rewardKobo: z.number().int().positive(), advertiserRateKobo: z.number().int().positive(),
})), ah(async (req, res) => {
  const b = req.body
  if (b.rewardKobo > b.advertiserRateKobo) throw httpError(400, 'Reward cannot exceed the advertiser rate per view.')
  const v = await inspectVideo(b.videoPublicId)
  if (v.durationSec < 10 || v.durationSec > 120) throw httpError(400, 'Video must be between 10 and 120 seconds.')
  const c = await Campaign.create({ ...b, videoUrl: v.url, durationSec: v.durationSec, status: 'PENDING_REVIEW', createdBy: req.user.email })
  await audit(req.user.email, 'CAMPAIGN_CREATED', String(c._id))
  res.status(201).json({ campaign: c })
}))
// Record cleared advertiser money for an admin-created campaign, then it goes live.
r.post('/campaigns/:id/fund', validate(idParam, 'params'), validate(z.object({ amountKobo: z.number().int().positive(), reference: z.string().trim().min(3).max(100) })), ah(async (req, res) => {
  const c = await Campaign.findOne({ _id: req.params.id, status: 'PENDING_REVIEW' })
  if (!c) throw httpError(409, 'Campaign is not waiting for funding.')
  const cap = Math.floor(req.body.amountKobo / c.advertiserRateKobo)
  if (cap < 1) throw httpError(400, 'Amount is less than the cost of one view.')
  Object.assign(c, { budgetKobo: req.body.amountKobo, completionCap: cap, prepaymentRef: req.body.reference, status: 'ACTIVE', liveAt: new Date() })
  await c.save()
  await audit(req.user.email, 'CAMPAIGN_FUNDED', `${c._id} ref ${req.body.reference}`)
  res.json({ campaign: c })
}))
// Add a video to a paid package on the advertiser's behalf (or replace one that is still waiting for review).
// With goLive the admin approves it at the same time; without it the video goes to the review queue.
r.post('/campaigns/:id/video', validate(idParam, 'params'), validate(z.object({
  title: z.string().trim().min(3).max(100), videoPublicId: z.string().regex(VIDEO_ID_RE, 'Invalid video reference'), goLive: z.boolean().default(true),
})), ah(async (req, res) => {
  const b = req.body
  const v = await inspectVideo(b.videoPublicId)
  if (v.durationSec < 10 || v.durationSec > 120) throw httpError(400, 'Video must be between 10 and 120 seconds.')
  const set = { title: b.title, videoPublicId: b.videoPublicId, videoUrl: v.url, durationSec: v.durationSec, videoSubmittedAt: new Date(),
    status: b.goLive ? 'ACTIVE' : 'CONTENT_REVIEW', ...(b.goLive ? { liveAt: new Date() } : {}), $unset: { videoRejectReason: 1 } }
  const c = await Campaign.findOneAndUpdate({ _id: req.params.id, status: { $in: ['AWAITING_VIDEO', 'CONTENT_REVIEW'] } }, set, { new: true })
  if (!c) throw httpError(409, 'This campaign is not waiting for a video.')
  await audit(req.user.email, b.goLive ? 'VIDEO_ADDED_LIVE' : 'VIDEO_ADDED', `${c._id} "${b.title}"`)
  res.json({ campaign: c })
}))

// Review a submitted video. Three outcomes:
//   approve                     -> goes live
//   reject + requestNewVideo    -> sent back; the paid budget stays and the advertiser uploads a corrected video
//   reject                      -> campaign closed and a refund is flagged
r.post('/campaigns/:id/content', validate(idParam, 'params'), validate(z.object({ approve: z.boolean(), requestNewVideo: z.boolean().optional(), reason: z.string().trim().max(300).optional() })), ah(async (req, res) => {
  const { approve, requestNewVideo, reason } = req.body
  if (!approve && !(reason && reason.length >= 3)) throw httpError(400, 'A reason is required when a video is not approved.')
  let c
  if (approve) {
    c = await Campaign.findOneAndUpdate({ _id: req.params.id, status: 'CONTENT_REVIEW', videoUrl: { $exists: true, $ne: null } }, { status: 'ACTIVE', liveAt: new Date() }, { new: true })
    if (!c) throw httpError(409, 'Campaign is not waiting for content review, or it has no video.')
    await audit(req.user.email, 'CONTENT_APPROVED', String(c._id))
  } else if (requestNewVideo) {
    c = await Campaign.findOneAndUpdate({ _id: req.params.id, status: 'CONTENT_REVIEW' },
      { status: 'AWAITING_VIDEO', videoRejectReason: reason, $unset: { videoUrl: 1, videoPublicId: 1, durationSec: 1, videoSubmittedAt: 1 } }, { new: true })
    if (!c) throw httpError(409, 'Campaign is not waiting for content review.')
    await audit(req.user.email, 'CONTENT_RETURNED', `${c._id}: ${reason}`)
  } else {
    c = await Campaign.findOneAndUpdate({ _id: req.params.id, status: 'CONTENT_REVIEW' }, { status: 'CLOSED' }, { new: true })
    if (!c) throw httpError(409, 'Campaign is not waiting for content review.')
    if (c.order) await Order.updateOne({ _id: c.order }, { refundDue: true, rejectReason: reason })
    await audit(req.user.email, 'CONTENT_REJECTED', `${c._id}: ${reason} (refund due: handle outside the API)`)
  }
  res.json({ campaign: c })
}))
r.patch('/campaigns/:id/status', validate(idParam, 'params'), validate(reasonBody.extend({ status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']) })), ah(async (req, res) => {
  const from = req.body.status === 'ACTIVE' ? ['PAUSED'] : ['ACTIVE', 'PAUSED']
  const c = await Campaign.findOneAndUpdate({ _id: req.params.id, status: { $in: from } }, { status: req.body.status }, { new: true })
  if (!c) throw httpError(409, 'That change is not allowed from the current status.')
  await audit(req.user.email, `CAMPAIGN_${req.body.status}`, `${c._id}: ${req.body.reason}`)
  res.json({ campaign: c })
}))

// ---------- withdrawals ----------
r.get('/withdrawals', validate(page, 'query'), ah(async (req, res) => {
  const q = req.query.status ? { status: req.query.status } : {}
  res.json({ withdrawals: await Withdrawal.find(q).sort({ createdAt: -1 }).limit(100).populate('user', 'name email phone').lean() })
}))
r.post('/withdrawals/:id/approve', validate(idParam, 'params'), ah(async (req, res) => res.json({ withdrawal: await moveWithdrawal(req.user, req.params.id, 'APPROVED') })))
r.post('/withdrawals/:id/reject', validate(idParam, 'params'), validate(reasonBody), ah(async (req, res) => res.json({ withdrawal: await moveWithdrawal(req.user, req.params.id, 'REJECTED', { reason: req.body.reason }) })))
r.post('/withdrawals/:id/paid', validate(idParam, 'params'), validate(z.object({ payoutRef: z.string().trim().min(3).max(100) })), ah(async (req, res) => res.json({ withdrawal: await moveWithdrawal(req.user, req.params.id, 'PAID', { payoutRef: req.body.payoutRef }) })))

// ---------- settings (two-person rule) ----------
r.get('/settings', ah(async (_req, res) => {
  const [current, history, proposals] = await Promise.all([getSettings(), Settings.find().sort({ version: -1 }).limit(20).lean(), Proposal.find().sort({ createdAt: -1 }).limit(20).lean()])
  res.json({ current, history, proposals })
}))
r.post('/settings/proposals', validate(z.object({ changes: changesSchema, reason: z.string().trim().min(5).max(300) })), ah(async (req, res) => {
  const cur = await getSettings()
  assertConsistent({ ...cur, ...req.body.changes })
  const p = await Proposal.create({ changes: req.body.changes, reason: req.body.reason, proposedBy: req.user._id, proposedByEmail: req.user.email })
  await audit(req.user.email, 'SETTINGS_PROPOSED', String(p._id))
  res.status(201).json({ proposal: p })
}))
r.post('/settings/proposals/:id/approve', validate(idParam, 'params'), ah(async (req, res) => {
  const p = await Proposal.findOne({ _id: req.params.id, status: 'PENDING' })
  if (!p) throw httpError(409, 'Proposal is not pending.')
  if (String(p.proposedBy) === String(req.user._id)) throw httpError(403, 'A different admin must approve this change.')
  const cur = await getSettings()
  const next = { ...cur, ...p.changes }
  assertConsistent(next)
  const { _id, ...rest } = next
  await Settings.create({ ...rest, version: cur.version + 1, by: `${p.proposedByEmail} / ${req.user.email}`, reason: p.reason, effectiveAt: new Date() })
  p.status = 'APPROVED'; p.decidedBy = req.user.email; p.decidedAt = new Date(); await p.save()
  await audit(req.user.email, 'SETTINGS_APPROVED', `${p._id} -> v${cur.version + 1}`)
  res.json({ ok: true, version: cur.version + 1 })
}))
r.post('/settings/proposals/:id/reject', validate(idParam, 'params'), validate(reasonBody), ah(async (req, res) => {
  const p = await Proposal.findOneAndUpdate({ _id: req.params.id, status: 'PENDING' }, { status: 'REJECTED', decidedBy: req.user.email, decidedAt: new Date(), note: req.body.reason }, { new: true })
  if (!p) throw httpError(409, 'Proposal is not pending.')
  await audit(req.user.email, 'SETTINGS_REJECTED', `${p._id}: ${req.body.reason}`)
  res.json({ ok: true })
}))

r.post('/uploads/video-signature', (_req, res) => res.json(videoUploadSignature()))

// Re-check unpaid Paystack/Flutterwave orders with the provider right now (the same job that runs every 5 minutes).
r.post('/reconcile', ah(async (_req, res) => res.json(await runReconcile())))

// Send yourself a test email and/or SMS to confirm the providers are set up.
r.post('/test-notify', byUser(60 * MIN, 10), validate(z.object({ email: z.string().trim().email().optional(), phone: z.string().optional() })), ah(async (req, res) => {
  const out = {}
  if (req.body.email) out.email = await sendEmail(req.body.email, 'Naija Earn test email', 'If you can read this, email sending works.')
  if (req.body.phone) {
    const phone = normalizePhone(req.body.phone)
    out.sms = phone ? await sendSms(phone, 'Naija Earn test SMS. If you can read this, SMS sending works.') : { ok: false, error: 'Not a valid Nigerian phone number' }
  }
  if (!out.email && !out.sms) throw httpError(400, 'Provide an email and/or a phone number.')
  res.json(out)
}))

// One call that tests every outside service the platform depends on. It never returns a key.
r.get('/diagnostics', byUser(10 * MIN, 20), ah(async (_req, res) => {
  const check = async (fn) => {
    try { return { ok: true, ...((await fn()) || {}) } }
    catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 200) } }
  }
  const get = async (url, headers) => {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${j.message || j.error || 'no detail'}`)
    return j
  }
  const missing = (what) => ({ ok: false, error: `${what} is not set` })
  const c = config.cloudinary
  const ps = config.paystackSecret
  res.json({
    environment: config.env,
    clientOrigins: config.clientOrigins,
    paymentReturnUrl: config.paymentReturnUrl,
    mongo: { ok: mongoose.connection.readyState === 1 },
    cloudinary: c.cloudName && c.apiKey && c.apiSecret
      ? await check(async () => { await pingCloudinary(); return { cloudName: c.cloudName } })
      : missing('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY or CLOUDINARY_API_SECRET'),
    paystack: ps
      ? await check(async () => {
        await get('https://api.paystack.co/bank?perPage=1', { Authorization: `Bearer ${ps}` })
        return { keyMode: ps.startsWith('sk_live_') ? 'live' : ps.startsWith('sk_test_') ? 'test' : 'unrecognised' }
      })
      : missing('PAYSTACK_SECRET_KEY'),
    brevo: config.brevoApiKey
      ? await check(async () => { await get('https://api.brevo.com/v3/account', { 'api-key': config.brevoApiKey, accept: 'application/json' }) })
      : (config.smtp.host ? { ok: true, via: 'smtp (not tested here)' } : missing('BREVO_API_KEY')),
    termii: config.termii.apiKey
      ? await check(async () => {
        const j = await get(`https://api.ng.termii.com/api/get-balance?api_key=${encodeURIComponent(config.termii.apiKey)}`)
        return { balance: j.balance, currency: j.currency, channel: config.termii.channel, senderId: config.termii.senderId }
      })
      : missing('TERMII_API_KEY'),
    flutterwave: { configured: Boolean(config.flutterwave.secret), webhookHashSet: Boolean(config.flutterwave.hash) },
  })
}))

r.get('/regulator', ah(async (_req, res) => {
  const [camp, rewards, liab, held, paid, deps, cfg] = await Promise.all([
    Campaign.aggregate([{ $group: { _id: null, funded: { $sum: '$budgetKobo' }, consumed: { $sum: '$consumedKobo' } } }]),
    Ledger.aggregate([{ $match: { type: { $in: ['VIDEO_REWARD', 'REFERRAL_REWARD'] } } }, { $group: { _id: null, t: { $sum: '$amountKobo' } } }]),
    User.aggregate([{ $match: { role: 'MEMBER' } }, { $group: { _id: null, t: { $sum: '$balanceKobo' } } }]),
    Withdrawal.aggregate([{ $match: { status: { $in: ['PENDING', 'APPROVED'] } } }, { $group: { _id: null, t: { $sum: '$amountKobo' } } }]),
    Withdrawal.aggregate([{ $match: { status: 'PAID' } }, { $group: { _id: null, t: { $sum: '$netKobo' } } }]),
    Order.aggregate([{ $match: { status: 'PAID' } }, { $group: { _id: null, t: { $sum: '$priceKobo' } } }]),
    getSettings(),
  ])
  res.json({
    fundedKobo: camp[0]?.funded || 0, consumedKobo: camp[0]?.consumed || 0, rewardsCreditedKobo: rewards[0]?.t || 0,
    liabilityKobo: liab[0]?.t || 0, heldInWithdrawalsKobo: held[0]?.t || 0, paidOutKobo: paid[0]?.t || 0, depositsKobo: deps[0]?.t || 0, settings: cfg,
  })
}))
r.get('/ledger', ah(async (_req, res) => res.json({ entries: await Ledger.find().sort({ createdAt: -1 }).limit(5000).lean() })))

r.get('/audit', ah(async (_req, res) => res.json({ logs: await AuditLog.find().sort({ createdAt: -1 }).limit(200).lean() })))
export default r
