import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { User } from '../models/User.js'
import { Order } from '../models/Order.js'
import { Campaign } from '../models/Campaign.js'
import { Withdrawal } from '../models/Withdrawal.js'
import { Ledger } from '../models/Ledger.js'
import { audit } from '../models/AuditLog.js'
import { httpError } from '../utils/httpError.js'
import { withTxn } from '../utils/txn.js'
import { lagosDay } from '../utils/dates.js'
import { sendEmail } from './notify.js'

const OPEN_CAMPAIGN = ['AWAITING_VIDEO', 'CONTENT_REVIEW', 'ACTIVE', 'PAUSED']

// Deletes an account by anonymising it. Money records (ledger, orders, withdrawals) are kept for financial
// record-keeping, but the name, email, phone and password are removed and the account can never log in again.
export async function deleteAccount(userId, { actor, byAdmin = false, forfeitBalance = false, reason = '' } = {}) {
  const u0 = await User.findById(userId)
  if (!u0 || u0.status === 'DELETED') throw httpError(404, 'Account not found.')
  const email = u0.email

  if (u0.role === 'ADMIN') {
    const others = await User.countDocuments({ role: 'ADMIN', status: 'ACTIVE', _id: { $ne: u0._id } })
    if (others < 1) throw httpError(409, 'This is the only active admin account. Create another admin before deleting it.')
  }
  const orderIds = (await Order.find({ user: u0._id }).select('_id').lean()).map((o) => o._id)
  if (orderIds.length && await Campaign.exists({ order: { $in: orderIds }, status: { $in: OPEN_CAMPAIGN } })) {
    throw httpError(409, 'An advertising campaign on this account has not finished yet. Wait until it completes, or ask an admin to close it.')
  }
  const newHash = await bcrypt.hash(crypto.randomUUID(), 4) // nobody knows this password

  const forfeitedKobo = await withTxn(async (session) => {
    const u = await User.findOne({ _id: u0._id, status: { $ne: 'DELETED' } }).session(session)
    if (!u) throw httpError(404, 'Account not found.')
    if (await Withdrawal.exists({ user: u._id, status: { $in: ['PENDING', 'APPROVED'] } }).session(session)) {
      throw httpError(409, 'A withdrawal is still being processed. Wait until it is paid or rejected, then try again.')
    }
    const lost = u.balanceKobo || 0
    if (lost > 0 && !forfeitBalance) throw httpError(409, 'There is still a balance on this account. Withdraw it first, or confirm that it will be given up.', { balanceKobo: lost })
    if (lost > 0) await Ledger.create([{ user: u._id, type: 'ADJUSTMENT', amountKobo: -lost, lagosDay: lagosDay(), note: 'Account deleted: remaining balance forfeited' }], { session })
    await User.updateOne({ _id: u._id }, {
      $set: { name: 'Deleted user', email: `deleted-${u._id}@deleted.invalid`, phone: `deleted-${u._id}`, status: 'DELETED', deletedAt: new Date(),
        emailVerified: false, phoneVerified: false, balanceKobo: 0, passwordHash: newHash },
      $inc: { tokenVersion: 1 },
      $unset: { referralCode: 1, emailCodeHash: 1, phoneCodeHash: 1, resetCodeHash: 1, codeExpires: 1, resetExpires: 1 },
    }, { session })
    await audit(byAdmin ? actor : `${u.role.toLowerCase()} ${u._id}`, 'ACCOUNT_DELETED',
      `${u._id}${byAdmin ? ' by admin' : ' by owner'}${lost ? `; forfeited ${lost} kobo` : ''}${reason ? `; ${reason}` : ''}`, session)
    return lost
  })

  try {
    await sendEmail(email, 'Your Naija Earn account was deleted',
      byAdmin ? 'Your Naija Earn account was deleted by an administrator. If you think this is a mistake, contact support.'
        : 'Your Naija Earn account was deleted and your personal details were removed. If this was not you, contact support straight away.')
  } catch { /* the account is already deleted; a failed email must not undo that */ }
  return { forfeitedKobo }
}
