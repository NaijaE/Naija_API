import mongoose from 'mongoose'
const { Schema } = mongoose

// Atomic per-member, per-Lagos-day count of validated videos (enforces the daily limit under concurrency).
const dailyCounterSchema = new Schema({
  user: { type: Schema.Types.ObjectId, required: true },
  day: { type: String, required: true },
  count: { type: Number, default: 0 },
})
dailyCounterSchema.index({ user: 1, day: 1 }, { unique: true })
export const DailyCounter = mongoose.model('DailyCounter', dailyCounterSchema)
