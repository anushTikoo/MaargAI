import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import basicAuth from './routes/basicAuth.js';
import googleAuthRoutes from './routes/googleAuth.js';
import trucksRoutes from './routes/trucks.js';
import tripsRoutes from './routes/trips.js';
import fleetUploadRoutes from './routes/fleetUpload.js';
import weatherRoutes from './routes/weather.js';
import workerRoutes from './routes/worker.js';
import simulationRoutes from './routes/simulation.js';
import { processActiveTrips } from './services/monitoringService.js';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth', basicAuth);
app.use('/api/auth/google', googleAuthRoutes);
app.use('/api/trucks', trucksRoutes);
app.use('/api/trips', tripsRoutes);
app.use('/api/fleet', fleetUploadRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/worker', workerRoutes);
app.use('/api/simulation', simulationRoutes);


// Basic health check
app.get('/', (req, res) => {
  res.send('Server is running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);

  // HACKATHON AUTOMATION: Run the monitoring loop every 2 minutes
  // This replaces the need for an external Cloud Scheduler.
  const MONITORING_INTERVAL_MS = 2 * 60 * 1000;
  setInterval(async () => {
    console.log('[Internal Worker] Starting background monitoring check...');
    try {
      const stats = await processActiveTrips();
      console.log(`[Internal Worker] Check complete. Processed ${stats.tripsProcessed} trips.`);
    } catch (err) {
      console.error('[Internal Worker] Error in background monitoring:', err.message);
    }
  }, MONITORING_INTERVAL_MS);
});
