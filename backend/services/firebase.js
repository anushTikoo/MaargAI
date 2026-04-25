import admin from "firebase-admin"
import dotenv from "dotenv"

dotenv.config()

const privateKey = process.env.FIREBASE_PRIVATE_KEY

if (!privateKey) {
  throw new Error("FIREBASE_PRIVATE_KEY is not configured.")
}

const serviceAccount = {
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: privateKey.replace(/\\n/g, "\n"),
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL,
  })
}

const realtimeDB = admin.database()

export default realtimeDB