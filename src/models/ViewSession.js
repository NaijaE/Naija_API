import mongoose from 'mongoose'
const { Schema } = mongoose

const viewSessionSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
  status: { type: String, enum: ['STARTED', 'COMPLETED', 'EXPIRED'], default: 'STARTED' },
  startedAt: { type: Date, default: Date.now },
  completedAt: Date,
  lagosDay: String,
  completedDay: String,
  rewardKobo: Number,
  oneShot: Boolean, // always true: one validated view per member per campaign (a relaunched video is a NEW campaign)
}, { timestamps: true })

// One validated view per member per campaign, and only one video in progress at a time.
viewSessionSchema.index({ user: 1, campaign: 1 }, { name: 'oneShotPerCampaign', unique: true, partialFilterExpression: { status: 'COMPLETED', oneShot: true } })
viewSessionSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { status: 'STARTED' } })
viewSessionSchema.index({ lagosDay: 1 })
viewSessionSchema.index({ completedDay: 1 })

export const ViewSession = mongoose.model('ViewSession', viewSessionSchema)
