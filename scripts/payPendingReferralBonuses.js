// One-off catch-up: pays referral rewards that were never paid, for referred members who already bought a package,
// but only to referrers who now have a package. Each referred member pays out once, for their FIRST paid package.
// Usage: node scripts/payPendingReferralBonuses.js   (safe to run twice)
import mongoose from 'mongoose'
import { config } from '../src/config.js'
import { User } from '../src/models/User.js'
import { Order } from '../src/models/Order.js'
import { withTxn } from '../src/utils/txn.js'
import { payReferralBonus } from '../src/services/referrals.js'

await mongoose.connect(config.mongoUri)
const rows = await User.find({ referredBy: { $exists: true, $ne: null }, referralBonusPaid: false })
let paid = 0
for (const u of rows) {
  const first = await Order.findOne({ user: u._id, status: 'PAID', refundDue: { $ne: true } }).sort({ paidAt: 1 })
  if (!first) continue
  if ((await withTxn((session) => payReferralBonus(u, first.packageId, session))) > 0) paid++
}
console.log(`Checked ${rows.length} referred members, paid ${paid} rewards.`)
await mongoose.disconnect()
