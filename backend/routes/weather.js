import express from 'express';
import { getWeather } from '../services/weatherService.js';

const router = express.Router();

// GET /api/weather?lat=...&lon=...
router.get('/', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        
        if (!lat || !lon) {
            return res.status(400).json({ error: 'Latitude and longitude are required' });
        }
        
        const weatherData = await getWeather(lat, lon);
        res.json(weatherData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch weather data' });
    }
});

export default router;
