import mongoose from 'mongoose'
const { Schema } = mongoose

const ledgerSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['VIDEO_REWARD', 'REFERRAL_REWARD', 'WITHDRAWAL_RESERVE', 'WITHDRAWAL_REFUND', 'REVERSAL', 'ADJUSTMENT'], required: true },
  amountKobo: { type: Number, required: true }, // signed: credits positive, debits negative
  campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },
  session: { type: Schema.Types.ObjectId, ref: 'ViewSession' },
  withdrawal: { type: Schema.Types.ObjectId, ref: 'Withdrawal' },
  lagosDay: String,
  note: String,
}, { timestamps: true })
ledgerSchema.index({ user: 1, createdAt: -1 })
export const Ledger = mongoose.model('Ledger', ledgerSchema)
