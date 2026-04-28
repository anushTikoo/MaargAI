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

// Basic health check
app.get('/', (req, res) => {
  res.send('Server is running');
});

let lastWorkerStats = {
  lastRun: null,
  duration: null,
  tripsProcessed: 0,
  error: null,
  status: 'initialized'
};

app.get('/api/worker/status', (req, res) => {
  res.json({
    worker_name: 'MaargAI Internal Monitoring Loop',
    interval: '1 minute',
    ...lastWorkerStats
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);

  // HACKATHON AUTOMATION: Run the monitoring loop every 2 minutes
  const MONITORING_INTERVAL_MS = 1 * 60 * 1000;
  setInterval(async () => {
    console.log('[Internal Worker] Starting background monitoring check...');
    const start = Date.now();
    try {
      lastWorkerStats.status = 'running';
      const stats = await processActiveTrips();
      lastWorkerStats = {
        lastRun: new Date().toISOString(),
        duration: `${(Date.now() - start) / 1000}s`,
        tripsProcessed: stats.processed || 0,
        error: null,
        status: 'idle'
      };
      console.log(`[Internal Worker] Check complete. Processed ${lastWorkerStats.tripsProcessed} trips.`);
    } catch (err) {
      lastWorkerStats.lastRun = new Date().toISOString();
      lastWorkerStats.error = err.message;
      lastWorkerStats.status = 'error';
      console.error('[Internal Worker] Error in background monitoring:', err.message);
    }
  }, MONITORING_INTERVAL_MS);
});
