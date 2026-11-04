import mongoose from 'mongoose'
const { Schema } = mongoose

// An advertiser's purchase of a package. When PAID it funds a Campaign budget (it is NOT a membership fee).
const orderSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  packageId: String,
  packageName: String,
  priceKobo: { type: Number, required: true },
  completions: Number,
  memberRewardKobo: Number,
  advertiserRateKobo: Number,
  method: { type: String, enum: ['PAYSTACK', 'FLUTTERWAVE', 'BANK_TRANSFER'], required: true },
  title: String,
  durationSec: Number,
  videoPublicId: String,
  videoUrl: String,
  proof: { publicId: String, resourceType: String, format: String, name: String },
  status: { type: String, enum: ['AWAITING_PAYMENT', 'PENDING_REVIEW', 'PAID', 'REJECTED', 'CANCELLED'], required: true, index: true },
  gatewayRef: { type: String, index: true, sparse: true },
  ref: String,
  paidAt: Date,
  rejectReason: String,
  reviewedBy: String,
  campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },
  refundDue: { type: Boolean, default: false },
}, { timestamps: true })

export const Order = mongoose.model('Order', orderSchema)
