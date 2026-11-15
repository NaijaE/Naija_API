import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { User, publicUser } from '../models/User.js'
import { Order } from '../models/Order.js'
import { Ledger } from '../models/Ledger.js'
import { Withdrawal } from '../models/Withdrawal.js'
import { ah } from '../utils/asyncHandler.js'
import { requireAuth, requireMember, requireVerified } from '../middleware/auth.js'
import { lagosDay } from '../utils/dates.js'
import { getSettings } from '../services/settings.js'
import { watchedToday } from '../services/rewards.js'
import { deleteAccount } from '../services/accountDeletion.js'
import { validate } from '../middleware/validate.js'
import { httpError } from '../utils/httpError.js'
import { byUser, MIN } from '../middleware/limits.js'

const r = Router()
r.use(requireAuth)

r.get('/', (req, res) => res.json({ user: publicUser(req.user) }))

// Delete my own account (members and admins). Needs the password and the typed word DELETE.
r.post('/delete', byUser(15 * MIN, 5), validate(z.object({
  password: z.string().min(1).max(72), confirm: z.literal('DELETE'), forfeitBalance: z.boolean().optional(),
})), ah(async (req, res) => {
  const u = await User.findById(req.user._id).select('+passwordHash')
  if (!(await bcrypt.compare(req.body.password, u.passwordHash))) throw httpError(400, 'Your password is incorrect.')
  const out = await deleteAccount(u._id, { forfeitBalance: req.body.forfeitBalance === true })
  res.json({ ok: true, forfeitedKobo: out.forfeitedKobo })
}))

r.get('/dashboard', requireVerified, requireMember, ah(async (req, res) => {
  const uid = req.user._id
  const cfg = await getSettings()
  const day = lagosDay()
  const [today, refEarn, refCount, deposits, withdrawals, paid, recent, watched] = await Promise.all([
    Ledger.aggregate([{ $match: { user: uid, lagosDay: day, type: { $in: ['VIDEO_REWARD', 'REFERRAL_REWARD'] } } }, { $group: { _id: null, t: { $sum: '$amountKobo' } } }]),
    Ledger.aggregate([{ $match: { user: uid, type: 'REFERRAL_REWARD' } }, { $group: { _id: null, t: { $sum: '$amountKobo' } } }]),
    User.countDocuments({ referredBy: uid, emailVerified: true, phoneVerified: true }),
    Order.find({ user: uid }).sort({ createdAt: -1 }).limit(20).select('-proof -videoPublicId').lean(),
    Withdrawal.find({ user: uid }).sort({ createdAt: -1 }).limit(20).lean(),
    Order.exists({ user: uid, status: 'PAID' }),
    Ledger.find({ user: uid }).sort({ createdAt: -1 }).limit(10).lean(),
    watchedToday(uid),
  ])
  res.json({
    user: publicUser(req.user),
    balanceKobo: req.user.balanceKobo,
    todayEarningsKobo: today[0]?.t || 0,
    referralEarningsKobo: refEarn[0]?.t || 0,
    verifiedReferrals: refCount,
    watchedToday: watched, dailyCap: cfg.dailyCap, minWithdrawalKobo: cfg.minWithdrawalKobo,
    advertiserStatus: paid ? 'SUBSCRIBED' : 'FREE',
    deposits, withdrawals, recentActivity: recent,
  })
}))

r.get('/referrals', requireVerified, requireMember, ah(async (req, res) => {
  const people = await User.find({ referredBy: req.user._id }).select('name emailVerified phoneVerified referralBonusPaid createdAt').lean()
  const cfg = await getSettings()
  res.json({
    code: req.user.referralCode, bonusKobo: cfg.referralRewardKobo,
    referred: people.map((p) => ({ name: p.name.split(' ')[0], verified: p.emailVerified && p.phoneVerified, bonusPaid: p.referralBonusPaid, joinedAt: p.createdAt })),
  })
}))
export default r
