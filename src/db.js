import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);
import mongoose from 'mongoose'
import { config } from './config.js'

export async function connectDb() {
  mongoose.set('strictQuery', true)
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 })
  console.log('MongoDB connected')
  // The one-view-per-campaign rule lives in the 'oneShotPerCampaign' index (created from the model); drop the older, unnamed one. Safe to run on every start.
  try { await mongoose.connection.collection('viewsessions').dropIndex('user_1_campaign_1') } catch { /* already gone */ }
}
