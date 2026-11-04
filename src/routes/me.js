import { Router } from 'express'
import { User, publicUser } from '../models/User.js'
import { Order } from '../models/Order.js'
import { Ledger } from '../models/Ledger.js'
import { Withdrawal } from '../models/Withdrawal.js'
import { ah } from '../utils/asyncHandler.js'
import { requireAuth, requireMember, requireVerified } from '../middleware/auth.js'
import { lagosDay } from '../utils/dates.js'
import { getSettings } from '../services/settings.js'
import { watchedToday } from '../services/rewards.js'

const r = Router()
r.use(requireAuth)

r.get('/', (req, res) => res.json({ user: publicUser(req.user) }))

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
