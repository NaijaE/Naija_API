import { User } from '../models/User.js'
import { Ledger } from '../models/Ledger.js'
import { Withdrawal } from '../models/Withdrawal.js'
import { audit } from '../models/AuditLog.js'
import { httpError } from '../utils/httpError.js'
import { withTxn } from '../utils/txn.js'
import { lagosDay } from '../utils/dates.js'
import { naira } from '../utils/money.js'
import { getSettings } from './settings.js'

export async function requestWithdrawal(user, { amountKobo, bankName, accountName, accountNumber }) {
  const cfg = await getSettings()
  if (amountKobo < cfg.minWithdrawalKobo) throw httpError(400, `Minimum withdrawal is ${naira(cfg.minWithdrawalKobo)}.`)
  if (amountKobo <= cfg.withdrawalFeeKobo) throw httpError(400, 'Amount must be higher than the withdrawal fee.')
  if (await Withdrawal.exists({ user: user._id, status: { $in: ['PENDING', 'APPROVED'] } })) throw httpError(409, 'You already have a withdrawal in progress.')
  return withTxn(async (session) => {
    // The balance check and the deduction are one atomic step: no double-spending.
    const u = await User.findOneAndUpdate({ _id: user._id, balanceKobo: { $gte: amountKobo } }, { $inc: { balanceKobo: -amountKobo } }, { new: true, session })
    if (!u) throw httpError(400, 'Insufficient balance.')
    const [w] = await Withdrawal.create([{
      user: user._id, amountKobo, feeKobo: cfg.withdrawalFeeKobo, netKobo: amountKobo - cfg.withdrawalFeeKobo, bankName, accountName, accountNumber,
      history: [{ status: 'PENDING', by: user.email, note: 'Requested' }],
    }], { session })
    await Ledger.create([{ user: user._id, type: 'WITHDRAWAL_RESERVE', amountKobo: -amountKobo, withdrawal: w._id, lagosDay: lagosDay(), note: 'Withdrawal requested' }], { session })
    return w
  })
}

const NEXT = { PENDING: ['APPROVED', 'REJECTED'], APPROVED: ['PAID', 'REJECTED'] }

export async function moveWithdrawal(admin, id, to, { reason, payoutRef } = {}) {
  if (to === 'REJECTED' && !(reason || '').trim()) throw httpError(400, 'A reason is required to reject a withdrawal.')
  if (to === 'PAID' && !(payoutRef || '').trim()) throw httpError(400, 'Enter the bank transfer reference for this payout.')
  return withTxn(async (session) => {
    const from = Object.keys(NEXT).filter((s) => NEXT[s].includes(to))
    const w = await Withdrawal.findOneAndUpdate(
      { _id: id, status: { $in: from } },
      { status: to, reviewedBy: admin.email, ...(to === 'REJECTED' ? { rejectReason: reason.trim() } : {}), ...(to === 'PAID' ? { payoutRef: payoutRef.trim() } : {}),
        $push: { history: { status: to, by: admin.email, note: reason || payoutRef || '' } } },
      { new: true, session },
    )
    if (!w) throw httpError(409, 'This withdrawal cannot be moved to that status.')
    if (to === 'REJECTED') {
      await User.updateOne({ _id: w.user }, { $inc: { balanceKobo: w.amountKobo } }, { session })
      await Ledger.create([{ user: w.user, type: 'WITHDRAWAL_REFUND', amountKobo: w.amountKobo, withdrawal: w._id, lagosDay: lagosDay(), note: `Rejected: ${reason.trim()}` }], { session })
    }
    await audit(admin.email, `WITHDRAWAL_${to}`, `${w._id} ${naira(w.amountKobo)}`, session)
    return w
  })
}
