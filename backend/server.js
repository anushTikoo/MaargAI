import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import basicAuth from './routes/basicAuth.js';
import googleAuthRoutes from './routes/googleAuth.js';
import trucksRoutes from './routes/trucks.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());
app.use('/api/auth', basicAuth);
app.use('/api/auth/google', googleAuthRoutes);
app.use('/api/trucks', trucksRoutes);

// Basic health check
app.get('/', (req, res) => {
  res.send('Server is running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});