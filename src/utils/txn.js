import mongoose from 'mongoose'

// Runs fn(session) inside a MongoDB transaction (needs a replica set, e.g. MongoDB Atlas).
export async function withTxn(fn) {
  const session = await mongoose.startSession()
  try {
    let out
    await session.withTransaction(async () => { out = await fn(session) })
    return out
  } finally {
    session.endSession()
  }
}
