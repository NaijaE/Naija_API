import { User } from '../models/User.js'
import { getSettings, packageReferralReward } from './settings.js'
import { credit, hasPackage } from './rewards.js'

// Called when a member's package payment is confirmed (inside the same transaction as the order).
// The person who invited them earns the reward of the package they bought (Spark, Boost or Prime),
// once per invited member (their first package), and only if the referrer already has a package.
// With no package on the referrer's side nothing is paid and the member stays unpaid, so the catch-up script can pay it later.
export async function payReferralBonus(buyer, packageId, session) {
  if (!buyer || !buyer.referredBy) return 0
  const cfg = await getSettings()
  const amountKobo = packageReferralReward(cfg.packages.find((p) => p.id === packageId))
  if (!(amountKobo > 0)) return 0
  const referrer = await User.findOne({ _id: buyer.referredBy, status: 'ACTIVE' }).session(session || null)
  if (!referrer || !(await hasPackage(referrer._id))) return 0
  const flagged = await User.updateOne({ _id: buyer._id, referralBonusPaid: false }, { referralBonusPaid: true }, session ? { session } : {})
  if (!flagged.modifiedCount) return 0
  const label = (cfg.packages.find((p) => p.id === packageId) || {}).name || packageId
  await credit(session, { userId: referrer._id, type: 'REFERRAL_REWARD', amountKobo, referred: buyer._id, note: `Referral bonus: ${buyer.name} bought the ${label} package` })
  return amountKobo
}
