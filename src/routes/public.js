import { Router } from 'express'
import { ah } from '../utils/asyncHandler.js'
import { getSettings } from '../services/settings.js'
import { config } from '../config.js'

const r = Router()
// Everything the landing page needs: packages and the public rules.
r.get('/config', ah(async (_req, res) => {
  const s = await getSettings()
  res.json({
    dailyCap: s.dailyCap, minWithdrawalKobo: s.minWithdrawalKobo, withdrawalFeeKobo: s.withdrawalFeeKobo, referralRewardKobo: s.referralRewardKobo,
    packages: s.packages.map((p) => ({ ...p, advertiserRateKobo: Math.floor(p.priceKobo / p.completions) })),
    bank: config.bank,
  })
}))
export default r
