import mongoose from 'mongoose'
const { Schema } = mongoose

const campaignSchema = new Schema({
  name: String,
  sponsor: String,
  // A paid package creates the campaign FIRST (status AWAITING_VIDEO). The video is added afterwards.
  title: String,
  durationSec: { type: Number, min: 10, max: 120 },
  videoPublicId: String,
  videoUrl: String,
  videoSubmittedAt: Date,
  videoRejectReason: String,
  rewardKobo: { type: Number, required: true, min: 1 },
  advertiserRateKobo: { type: Number, required: true, min: 1 },
  budgetKobo: { type: Number, default: 0, min: 0 },
  consumedKobo: { type: Number, default: 0, min: 0 },
  completionCap: { type: Number, default: 0 },
  completions: { type: Number, default: 0 },
  status: { type: String, enum: ['PENDING_REVIEW', 'AWAITING_VIDEO', 'CONTENT_REVIEW', 'ACTIVE', 'PAUSED', 'EXHAUSTED', 'CLOSED'], default: 'PENDING_REVIEW', index: true },
  prepaymentRef: String,
  order: { type: Schema.Types.ObjectId, ref: 'Order' },
  packageId: String,
  liveAt: Date,
  createdBy: String,
}, { timestamps: true })

// A member reward must always be covered by what the advertiser pays per view.
campaignSchema.pre('validate', function check(next) {
  if (this.rewardKobo > this.advertiserRateKobo) return next(new Error('Reward cannot exceed the advertiser rate per view'))
  next()
})
export const Campaign = mongoose.model('Campaign', campaignSchema)
