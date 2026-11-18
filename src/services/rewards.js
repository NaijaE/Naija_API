import { ViewSession } from '../models/ViewSession.js'
import { Campaign } from '../models/Campaign.js'
import { DailyCounter } from '../models/DailyCounter.js'
import { Ledger } from '../models/Ledger.js'
import { User } from '../models/User.js'
import { Order } from '../models/Order.js'
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

export async function credit(session, { userId, type, amountKobo, campaign, sessionId, referred, note }) {
  await User.updateOne({ _id: userId }, { $inc: { balanceKobo: amountKobo } }, { session })
  await Ledger.create([{ user: userId, type, amountKobo, campaign, session: sessionId, referred, lagosDay: lagosDay(), note }], { session })
}

export async function watchedToday(userId) {
  const row = await DailyCounter.findOne({ user: userId, day: lagosDay() }).lean()
  return row ? row.count : 0
}

// Only members with at least one paid advertising package can earn from videos.
// A package whose video was rejected and is waiting for a refund does not count.
export const NO_PACKAGE_MESSAGE = 'Only members with an advertising package can earn from videos. Buy a package to start earning.'
export async function hasPackage(userId) {
  return Boolean(await Order.exists({ user: userId, status: 'PAID', refundDue: { $ne: true } }))
}

// A member only earns from videos of the package tiers they own (spark, boost, prime).
// Every campaign now carries a tier. A campaign with no tier (old data) is hidden until an admin assigns one.
export const WRONG_PACKAGE_MESSAGE = 'This video belongs to a different package. You can only earn from videos of the package you bought.'
export async function memberPackageIds(userId) {
  return Order.distinct('packageId', { user: userId, status: 'PAID', refundDue: { $ne: true } })
}
export const packageFilter = (ids) => ({ packageId: { $in: ids } })

export async function startView(user, campaignId) {
  const cfg = await getSettings()
  if (!(await hasPackage(user._id))) throw httpError(403, NO_PACKAGE_MESSAGE)
  if ((await watchedToday(user._id)) >= cfg.dailyCap) throw httpError(429, `You have reached today's limit of ${cfg.dailyCap} videos. It resets at midnight (Africa/Lagos).`)
  await ViewSession.updateMany({ user: user._id, status: 'STARTED', startedAt: { $lt: new Date(Date.now() - STALE_MS) } }, { status: 'EXPIRED' })

  const ids = await memberPackageIds(user._id)
  const campaign = await Campaign.findOne({ _id: campaignId, ...liveFilter, ...packageFilter(ids) })
  if (!campaign) {
    if (await Campaign.exists({ _id: campaignId, ...liveFilter })) throw httpError(403, WRONG_PACKAGE_MESSAGE)
    throw httpError(404, 'This video is not available.')
  }
  if (await ViewSession.exists({ user: user._id, campaign: campaign._id, status: 'COMPLETED' })) throw httpError(409, 'You have already watched this video.')

  let vs = await ViewSession.findOne({ user: user._id, status: 'STARTED' })
  if (vs && String(vs.campaign) !== String(campaign._id)) throw httpError(409, 'Finish the video you are currently watching first.')
  if (!vs) {
    try { vs = await ViewSession.create({ user: user._id, campaign: campaign._id, lagosDay: lagosDay(), oneShot: true }) }
    catch (e) { if (e.code === 11000) throw httpError(409, 'Finish the video you are currently watching first.'); throw e }
  }
  const elapsed = Math.floor((Date.now() - vs.startedAt.getTime()) / 1000)
  return { sessionId: vs._id, videoUrl: campaign.videoUrl, title: campaign.title, durationSec: campaign.durationSec, remainingSec: Math.max(0, campaign.durationSec - elapsed) }
}

export async function completeView(user, sessionId) {
  const cfg = await getSettings()
  if (!(await hasPackage(user._id))) throw httpError(403, NO_PACKAGE_MESSAGE)
  return withTxn(async (session) => {
    const vs = await ViewSession.findOne({ _id: sessionId, user: user._id, status: 'STARTED' }).session(session)
    if (!vs) throw httpError(404, 'Session not found or already finished.')
    const camp = await Campaign.findById(vs.campaign).session(session)
    if (!camp.packageId || !(await memberPackageIds(user._id)).includes(camp.packageId)) throw httpError(403, WRONG_PACKAGE_MESSAGE)
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
      const ended = await Campaign.updateOne({ _id: c._id, status: { $ne: 'EXHAUSTED' } }, { status: 'EXHAUSTED' }, { session })
      // A house campaign (platform-funded, no advertiser order) that has run out starts again by itself: a NEW campaign with
      // the same video, tier and budget. Members who watched the old one can earn from the new one. The old campaign is untouched.
      if (ended.modifiedCount === 1 && c.fundingSource === 'PLATFORM' && !c.order && c.autoRelaunch !== false && c.videoUrl) {
        const tier = cfg.packages.find((p) => p.id === c.packageId)
        const rate = tier ? tier.memberRewardKobo : c.advertiserRateKobo
        if (c.budgetKobo >= rate) {
          await Campaign.create([{
            name: c.name, sponsor: c.sponsor, title: c.title, videoPublicId: c.videoPublicId, videoUrl: c.videoUrl, durationSec: c.durationSec,
            packageId: c.packageId, rewardKobo: rate, advertiserRateKobo: rate, budgetKobo: c.budgetKobo, completionCap: Math.floor(c.budgetKobo / rate),
            fundingSource: 'PLATFORM', prepaymentRef: 'PLATFORM-FUNDS', status: 'ACTIVE', liveAt: new Date(), createdBy: 'auto-relaunch', relaunchedFrom: c._id, autoRelaunch: true,
          }], { session })
        }
      }
    }

    vs.status = 'COMPLETED'; vs.completedAt = new Date(); vs.completedDay = day; vs.rewardKobo = c.rewardKobo
    await vs.save({ session })
    await credit(session, { userId: user._id, type: 'VIDEO_REWARD', amountKobo: c.rewardKobo, campaign: c._id, sessionId: vs._id, note: `${c.name || c.title} (${c.sponsor})` })

    return { rewardKobo: c.rewardKobo }
  })
}
