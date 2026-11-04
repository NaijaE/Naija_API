import mongoose from 'mongoose'
const { Schema } = mongoose

const withdrawalSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amountKobo: { type: Number, required: true },
  feeKobo: { type: Number, default: 0 },
  netKobo: { type: Number, required: true },
  bankName: { type: String, required: true },
  accountName: { type: String, required: true },
  accountNumber: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'PAID', 'REJECTED'], default: 'PENDING', index: true },
  rejectReason: String,
  payoutRef: String,
  reviewedBy: String,
  history: [{ status: String, by: String, note: String, at: { type: Date, default: Date.now }, _id: false }],
}, { timestamps: true })
export const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema)
