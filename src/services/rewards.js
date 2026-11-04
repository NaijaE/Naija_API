import { ViewSession } from '../models/ViewSession.js'
import { Campaign } from '../models/Campaign.js'
import { DailyCounter } from '../models/DailyCounter.js'
import { Ledger } from '../models/Ledger.js'
import { User } from '../models/User.js'
import { httpError } from '../utils/httpError.js'
import { withTxn } from '../utils/txn.js'
import { lagosDay } from '../utils/dates.js'
import { getSettings } from './settings.js'

const STALE_MS = 10 * 60 * 1000
const hasBudget = { $expr: { $and: [
  { $gte: [{ $subtract: ['$budgetKobo', '$consumedKobo'] }, '$advertiserRateKobo'] },
  { $lt: ['$completions', '$completionCap'] },
] } }
export const liveFilter = { status: 'ACTIVE', ...hasBudget }

async function credit(session, { userId, type, amountKobo, campaign, sessionId, note }) {
  await User.updateOne({ _id: userId }, { $inc: { balanceKobo: amountKobo } }, { session })
  await Ledger.create([{ user: userId, type, amountKobo, campaign, session: sessionId, lagosDay: lagosDay(), note }], { session })
}

export async function watchedToday(userId) {
  const row = await DailyCounter.findOne({ user: userId, day: lagosDay() }).lean()
  return row ? row.count : 0
}

export async function startView(user, campaignId) {
  const cfg = await getSettings()
  if ((await watchedToday(user._id)) >= cfg.dailyCap) throw httpError(429, `You have reached today's limit of ${cfg.dailyCap} videos. It resets at midnight (Africa/Lagos).`)
  await ViewSession.updateMany({ user: user._id, status: 'STARTED', startedAt: { $lt: new Date(Date.now() - STALE_MS) } }, { status: 'EXPIRED' })

  const campaign = await Campaign.findOne({ _id: campaignId, ...liveFilter })
  if (!campaign) throw httpError(404, 'This video is not available.')
  if (await ViewSession.exists({ user: user._id, campaign: campaign._id, status: 'COMPLETED' })) throw httpError(409, 'You have already watched this video.')

  let vs = await ViewSession.findOne({ user: user._id, status: 'STARTED' })
  if (vs && String(vs.campaign) !== String(campaign._id)) throw httpError(409, 'Finish the video you are currently watching first.')
  if (!vs) {
    try { vs = await ViewSession.create({ user: user._id, campaign: campaign._id, lagosDay: lagosDay() }) }
    catch (e) { if (e.code === 11000) throw httpError(409, 'Finish the video you are currently watching first.'); throw e }
  }
  const elapsed = Math.floor((Date.now() - vs.startedAt.getTime()) / 1000)
  return { sessionId: vs._id, videoUrl: campaign.videoUrl, title: campaign.title, durationSec: campaign.durationSec, remainingSec: Math.max(0, campaign.durationSec - elapsed) }
}

export async function completeView(user, sessionId) {
  const cfg = await getSettings()
  return withTxn(async (session) => {
    const vs = await ViewSession.findOne({ _id: sessionId, user: user._id, status: 'STARTED' }).session(session)
    if (!vs) throw httpError(404, 'Session not found or already finished.')
    const camp = await Campaign.findById(vs.campaign).session(session)
    const elapsed = (Date.now() - vs.startedAt.getTime()) / 1000
    if (elapsed < camp.durationSec - 1) throw httpError(400, 'The video has not played to the end yet.')
    if (elapsed > STALE_MS / 1000) throw httpError(410, 'This session expired. Start the video again.')

    const day = lagosDay()
    try {
      await DailyCounter.findOneAndUpdate({ user: user._id, day, count: { $lt: cfg.dailyCap } }, { $inc: { count: 1 } }, { upsert: true, session })
    } catch (e) { if (e.code === 11000) throw httpError(429, 'Daily limit reached.'); throw e }

    // Pay only from this campaign's prepaid budget, atomically.
    const c = await Campaign.findOneAndUpdate(
      { _id: camp._id, ...liveFilter },
      { $inc: { consumedKobo: camp.advertiserRateKobo, completions: 1 } },
      { new: true, session },
    )
    if (!c) throw httpError(409, 'This campaign has just run out of funds. No reward was taken from you.')
    if (c.budgetKobo - c.consumedKobo < c.advertiserRateKobo || c.completions >= c.completionCap) {
      await Campaign.updateOne({ _id: c._id }, { status: 'EXHAUSTED' }, { session })
    }

    vs.status = 'COMPLETED'; vs.completedAt = new Date(); vs.completedDay = day; vs.rewardKobo = c.rewardKobo
    await vs.save({ session })
    await credit(session, { userId: user._id, type: 'VIDEO_REWARD', amountKobo: c.rewardKobo, campaign: c._id, sessionId: vs._id, note: `${c.name || c.title} (${c.sponsor})` })

    // Optional referral bonus: once, from the campaign margin only (rate minus member reward).
    let bonus = 0
    if (cfg.referralRewardKobo > 0 && user.referredBy && c.advertiserRateKobo - c.rewardKobo >= cfg.referralRewardKobo) {
      const flagged = await User.updateOne({ _id: user._id, referralBonusPaid: false }, { referralBonusPaid: true }, { session })
      const referrer = flagged.modifiedCount ? await User.findOne({ _id: user.referredBy, status: 'ACTIVE' }).session(session) : null
      if (referrer) {
        bonus = cfg.referralRewardKobo
        await credit(session, { userId: referrer._id, type: 'REFERRAL_REWARD', amountKobo: bonus, campaign: c._id, sessionId: vs._id, note: `Referral bonus: ${user.name} completed a first video` })
      }
    }
    return { rewardKobo: c.rewardKobo, referralBonusPaidKobo: bonus }
  })
}
