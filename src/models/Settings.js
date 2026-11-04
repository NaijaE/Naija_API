import mongoose from 'mongoose'
const { Schema } = mongoose

const pkg = new Schema({ id: String, name: String, priceKobo: Number, completions: Number, memberRewardKobo: Number }, { _id: false })
// Immutable, versioned configuration. The newest version is the live one.
const settingsSchema = new Schema({
  version: { type: Number, required: true, unique: true },
  dailyCap: Number,
  minWithdrawalKobo: Number,
  withdrawalFeeKobo: Number,
  referralRewardKobo: Number,
  packages: [pkg],
  by: String,
  reason: String,
  effectiveAt: { type: Date, default: Date.now },
})
export const Settings = mongoose.model('Settings', settingsSchema)

const proposalSchema = new Schema({
  changes: Schema.Types.Mixed,
  reason: { type: String, required: true },
  proposedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  proposedByEmail: String,
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  decidedBy: String,
  decidedAt: Date,
  note: String,
}, { timestamps: true })
export const Proposal = mongoose.model('Proposal', proposalSchema)
