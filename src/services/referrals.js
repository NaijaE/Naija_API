import { User } from '../models/User.js'
import { withTxn } from '../utils/txn.js'
import { getSettings } from './settings.js'
import { credit, hasPackage } from './rewards.js'

// Pays the referrer once, when the referred member has verified BOTH email and phone,
// and only if the referrer has already subscribed to a package. Without a package nothing is paid and
// the person stays unpaid (referralBonusPaid stays false), so the one-off catch-up script can pay it later.
// The reward is credited straight away (balance + ledger) so it shows on the referrer's dashboard,
// but withdrawing is gated separately (see REFERRALS_REQUIRED in services/withdrawals.js).
export async function payReferralBonus(user) {
  const cfg = await getSettings()
  if (!(cfg.referralRewardKobo > 0) || !user.referredBy || !user.emailVerified || !user.phoneVerified) return 0
  const referrer = await User.findOne({ _id: user.referredBy, status: 'ACTIVE' })
  if (!referrer || !(await hasPackage(referrer._id))) return 0
  return withTxn(async (session) => {
    const flagged = await User.updateOne({ _id: user._id, referralBonusPaid: false }, { referralBonusPaid: true }, { session })
    if (!flagged.modifiedCount) return 0
    await credit(session, { userId: referrer._id, type: 'REFERRAL_REWARD', amountKobo: cfg.referralRewardKobo, referred: user._id, note: `Referral bonus: ${user.name} verified their account` })
    return cfg.referralRewardKobo
  })
}
