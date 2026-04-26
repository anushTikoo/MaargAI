import express from 'express';
import { processActiveTrips } from '../services/monitoringService.js';

const router = express.Router();

/**
 * Endpoint for Cloud Scheduler to trigger the monitoring loop.
 * POST /api/worker/process-active-trips
 */
router.post('/process-active-trips', async (req, res) => {
    console.log('[Worker Route] Triggered by Scheduler/Manual POST');
    
    try {
        const stats = await processActiveTrips();
        res.json({
            status: 'success',
            message: 'Active trips processed',
            stats
        });
    } catch (err) {
        console.error('[Worker Route] Loop failed:', err);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error during monitoring loop',
            error: err.message
        });
    }
});

export default router;
