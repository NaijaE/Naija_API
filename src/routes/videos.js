import { Router } from 'express'
import { z } from 'zod'
import mongoose from 'mongoose'
import { Campaign } from '../models/Campaign.js'
import { ViewSession } from '../models/ViewSession.js'
import { ah } from '../utils/asyncHandler.js'
import { httpError } from '../utils/httpError.js'
import { validate } from '../middleware/validate.js'
import { requireAuth, requireMember, requireVerified } from '../middleware/auth.js'
import { liveFilter, startView, completeView, watchedToday } from '../services/rewards.js'
import { getSettings } from '../services/settings.js'

const r = Router()
r.use(requireAuth, requireVerified, requireMember)

// Today's list of funded, approved videos. The video URL is only handed out when a view starts.
r.get('/', ah(async (req, res) => {
  const [cfg, watched, camps, done] = await Promise.all([
    getSettings(), watchedToday(req.user._id),
    Campaign.find(liveFilter).sort({ liveAt: -1 }).select('title sponsor durationSec rewardKobo liveAt').lean(),
    ViewSession.find({ user: req.user._id, status: 'COMPLETED' }).select('campaign').lean(),
  ])
  const seen = new Set(done.map((d) => String(d.campaign)))
  res.json({
    watchedToday: watched, dailyCap: cfg.dailyCap, remainingToday: Math.max(0, cfg.dailyCap - watched),
    videos: camps.map((c) => ({ id: c._id, title: c.title, sponsor: c.sponsor, durationSec: c.durationSec, rewardKobo: c.rewardKobo, liveAt: c.liveAt, watched: seen.has(String(c._id)) })),
  })
}))

const idParam = z.object({ id: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id') })
r.post('/:id/start', validate(idParam, 'params'), ah(async (req, res) => { res.json(await startView(req.user, req.params.id)) }))
r.post('/sessions/:id/complete', validate(idParam, 'params'), ah(async (req, res) => {
  const out = await completeView(req.user, req.params.id)
  res.json({ ok: true, ...out })
}))
export default r
