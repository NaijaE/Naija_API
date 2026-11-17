// One-off: pays referral bonuses still unpaid for verified members, but only to referrers who now have a package.
// Usage: node scripts/payPendingReferralBonuses.js   (safe to run twice: each person pays once)
import mongoose from 'mongoose'
import { config } from '../src/config.js'
import { User } from '../src/models/User.js'
import { payReferralBonus } from '../src/services/referrals.js'

await mongoose.connect(config.mongoUri)
const rows = await User.find({ referredBy: { $exists: true }, emailVerified: true, phoneVerified: true, referralBonusPaid: false })
let paid = 0
for (const u of rows) { if ((await payReferralBonus(u)) > 0) paid++ }
console.log(`Checked ${rows.length} verified referred members, paid ${paid} bonuses.`)
await mongoose.disconnect()
