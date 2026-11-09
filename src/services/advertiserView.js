// Pure helpers (no database access) that turn an order + its campaign into what an advertiser sees.

// One plain-language status per order, combining payment state and campaign state.
export function deriveStatus(order, campaign) {
  switch (order.status) {
    case 'AWAITING_PAYMENT': return 'WAITING_PAYMENT'
    case 'PENDING_REVIEW': return 'PAYMENT_REVIEW'
    case 'REJECTED': return 'PAYMENT_REJECTED'
    case 'CANCELLED': return 'CANCELLED'
    case 'PAID': break
    default: return order.status
  }
  if (!campaign) return 'IN_REVIEW'
  switch (campaign.status) {
    case 'ACTIVE': return 'LIVE'
    case 'PAUSED': return 'PAUSED'
    case 'EXHAUSTED': return 'COMPLETED'
    case 'CLOSED':
      if (order.refundDue) return 'REJECTED'
      return campaign.completions >= campaign.completionCap ? 'COMPLETED' : 'CLOSED'
    default: return 'IN_REVIEW'
  }
}

const DAY = 86400000
// Rough finish estimate from the pace so far. Returns null when there is not enough data to say anything useful.
export function estimateDaysLeft(campaign, now = Date.now()) {
  if (!campaign || campaign.status !== 'ACTIVE' || !campaign.liveAt) return null
  const hoursLive = (now - new Date(campaign.liveAt).getTime()) / 3600000
  if (hoursLive < 6 || campaign.completions < 3) return null
  const remaining = campaign.completionCap - campaign.completions
  if (remaining <= 0) return 0
  const perDay = campaign.completions / (hoursLive / 24)
  return Math.ceil(remaining / perDay)
}

const UNUSED_BUDGET_STATES = ['CONTENT_REVIEW', 'ACTIVE', 'PAUSED']
export function buildItem(order, campaign, now = Date.now()) {
  const status = deriveStatus(order, campaign)
  const paid = order.status === 'PAID'
  return {
    id: order._id, title: order.title, packageId: order.packageId, packageName: order.packageName, status,
    priceKobo: order.priceKobo, viewsPurchased: order.completions, viewsDelivered: campaign ? campaign.completions : 0,
    advertiserRateKobo: order.advertiserRateKobo, method: order.method, createdAt: order.createdAt, paidAt: order.paidAt || null,
    liveAt: campaign ? campaign.liveAt || null : null, estimatedDaysLeft: estimateDaysLeft(campaign, now),
    budgetRemainingKobo: campaign && UNUSED_BUDGET_STATES.includes(campaign.status) ? campaign.budgetKobo - campaign.consumedKobo : 0,
    refundDue: Boolean(order.refundDue), rejectReason: order.rejectReason || null, hasReceipt: paid,
  }
}

export function summarize(items) {
  const paid = items.filter((i) => i.hasReceipt)
  const kept = paid.filter((i) => !i.refundDue)
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0)
  const purchased = sum(kept, (i) => i.viewsPurchased)
  const delivered = sum(kept, (i) => i.viewsDelivered)
  return {
    totalSpentKobo: sum(kept, (i) => i.priceKobo), refundDueKobo: sum(paid.filter((i) => i.refundDue), (i) => i.priceKobo),
    viewsPurchased: purchased, viewsDelivered: delivered, viewsRemaining: Math.max(0, purchased - delivered),
    budgetRemainingKobo: sum(items, (i) => i.budgetRemainingKobo),
    live: items.filter((i) => i.status === 'LIVE').length,
    inReview: items.filter((i) => ['IN_REVIEW', 'PAYMENT_REVIEW'].includes(i.status)).length,
    waitingPayment: items.filter((i) => i.status === 'WAITING_PAYMENT').length,
    campaigns: items.length,
  }
}

export function buildTimeline(order, campaign, status) {
  const ev = [{ key: 'ordered', label: 'Order placed', at: order.createdAt }]
  if (order.paidAt) ev.push({ key: 'paid', label: 'Payment confirmed', at: order.paidAt })
  if (status === 'PAYMENT_REJECTED') ev.push({ key: 'payment_rejected', label: 'Payment rejected', at: order.updatedAt, note: order.rejectReason })
  if (campaign && campaign.liveAt) ev.push({ key: 'live', label: 'Video approved and live', at: campaign.liveAt })
  if (status === 'REJECTED') ev.push({ key: 'rejected', label: 'Video not approved', at: campaign ? campaign.updatedAt : order.updatedAt, note: order.rejectReason })
  if (status === 'COMPLETED') ev.push({ key: 'completed', label: 'All purchased views delivered', at: campaign.updatedAt })
  return ev.sort((a, b) => new Date(a.at) - new Date(b.at))
}

// rows: [{ _id: 'YYYY-MM-DD', n }]; days: ['YYYY-MM-DD', ...] in order. Missing days become 0.
export function fillDays(rows, days) {
  const m = Object.fromEntries(rows.map((r) => [r._id, r.n]))
  return days.map((d) => ({ date: d, views: m[d] || 0 }))
}

export function receiptNumber(order) {
  const d = new Date(order.paidAt || order.createdAt).toISOString().slice(0, 10).replaceAll('-', '')
  return `NE-${d}-${String(order._id).slice(-6).toUpperCase()}`
}
