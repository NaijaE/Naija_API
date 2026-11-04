import mongoose from 'mongoose'
const { Schema } = mongoose

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['MEMBER', 'ADMIN'], default: 'MEMBER' },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  tokenVersion: { type: Number, default: 0 },
  emailVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  emailCodeHash: { type: String, select: false },
  phoneCodeHash: { type: String, select: false },
  codeExpires: Date,
  codeAttempts: { type: Number, default: 0 },
  resetCodeHash: { type: String, select: false },
  resetExpires: Date,
  resetAttempts: { type: Number, default: 0 },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  referralBonusPaid: { type: Boolean, default: false },
  // Cached spendable balance in kobo. The Ledger is the audit trail; both change in one transaction.
  balanceKobo: { type: Number, default: 0, min: 0 },
  consentAt: Date,
}, { timestamps: true })

export const User = mongoose.model('User', userSchema)
export const publicUser = (u) => ({
  id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status,
  emailVerified: u.emailVerified, phoneVerified: u.phoneVerified, referralCode: u.referralCode, createdAt: u.createdAt,
})
