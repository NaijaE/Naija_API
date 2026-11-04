import { z } from 'zod'
import { Settings } from '../models/Settings.js'
import { httpError } from '../utils/httpError.js'
import { naira } from '../utils/money.js'

export const DEFAULTS = {
  dailyCap: 3,
  minWithdrawalKobo: 500000,
  withdrawalFeeKobo: 2500,
  referralRewardKobo: 0,
  // ADVERTISER packages. Placeholders: the admin sets the real prices. Members never pay these.
  packages: [
    { id: 'spark', name: 'Spark', priceKobo: 500000, completions: 100, memberRewardKobo: 3000 },
    { id: 'boost', name: 'Boost', priceKobo: 2000000, completions: 400, memberRewardKobo: 3500 },
    { id: 'prime', name: 'Prime', priceKobo: 5000000, completions: 1000, memberRewardKobo: 4000 },
  ],
}

export async function ensureSettings() {
  const existing = await Settings.findOne().sort({ version: -1 }).lean()
  if (existing) return existing
  try {
    const doc = await Settings.create({ version: 1, ...DEFAULTS, by: 'system', reason: 'Initial configuration' })
    return doc.toObject()
  } catch (e) {
    if (e.code === 11000) return Settings.findOne().sort({ version: -1 }).lean()
    throw e
  }
}
export const getSettings = async () => (await Settings.findOne().sort({ version: -1 }).lean()) || ensureSettings()

const int = z.number().int()
const pkgSchema = z.object({ id: z.enum(['spark', 'boost', 'prime']), name: z.string().min(2).max(20), priceKobo: int.positive(), completions: int.min(1), memberRewardKobo: int.positive() })
export const changesSchema = z.object({
  dailyCap: int.min(1).max(20),
  minWithdrawalKobo: int.min(100),
  withdrawalFeeKobo: int.min(0),
  referralRewardKobo: int.min(0),
  packages: z.array(pkgSchema).length(3),
}).partial().strict().refine((o) => Object.keys(o).length > 0, 'Provide at least one change')

export function assertConsistent(next) {
  if (next.minWithdrawalKobo <= next.withdrawalFeeKobo) throw httpError(400, 'Minimum withdrawal must be higher than the withdrawal fee.')
  if (new Set(next.packages.map((p) => p.id)).size !== 3) throw httpError(400, 'Packages must be spark, boost and prime.')
  for (const p of next.packages) {
    const rate = Math.floor(p.priceKobo / p.completions)
    if (p.memberRewardKobo > rate) throw httpError(400, `${p.name}: member reward cannot exceed the advertiser rate per view (${naira(rate)}).`)
  }
}
