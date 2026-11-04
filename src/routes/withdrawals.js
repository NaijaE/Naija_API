import { Router } from 'express'
import { z } from 'zod'
import { Withdrawal } from '../models/Withdrawal.js'
import { ah } from '../utils/asyncHandler.js'
import { validate } from '../middleware/validate.js'
import { requireAuth, requireMember, requireVerified } from '../middleware/auth.js'
import { requestWithdrawal } from '../services/withdrawals.js'

const r = Router()
r.use(requireAuth, requireVerified, requireMember)

r.get('/', ah(async (req, res) => {
  res.json({ withdrawals: await Withdrawal.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean() })
}))

const body = z.object({
  amountKobo: z.number().int().positive(),
  bankName: z.string().trim().min(2).max(60),
  accountName: z.string().trim().min(3).max(80),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
})
r.post('/', validate(body), ah(async (req, res) => {
  const w = await requestWithdrawal(req.user, req.body)
  res.status(201).json({ withdrawal: w })
}))
export default r
