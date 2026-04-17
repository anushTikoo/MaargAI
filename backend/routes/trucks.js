import express from 'express';
import pool from '../db.js';

const router = express.Router();

const TRUCK_DEFAULTS = {
    mini: { capacity: 1000, height: 2.0, mileage: 18 },
    light: { capacity: 4000, height: 2.5, mileage: 10 },
    medium: { capacity: 10000, height: 3.0, mileage: 6 },
    heavy: { capacity: 25000, height: 3.5, mileage: 4 },
    trailer: { capacity: 45000, height: 4.0, mileage: 3 }
};

function inferCategory(capacity) {
    if (capacity <= 2000) return 'mini';
    if (capacity <= 7000) return 'light';
    if (capacity <= 16000) return 'medium';
    if (capacity <= 40000) return 'heavy';
    return 'trailer';
}

// POST /api/trucks
router.post('/', async (req, res) => {
    let {
        fleet_manager_id,
        truck_number,
        capacity_kg,
        height_m,
        mileage_kmpl,
        truck_type,
        truck_weight
    } = req.body;

    // Validate Minimum Input
    if (!fleet_manager_id || !truck_number) {
        return res.status(400).json({ error: 'fleet_manager_id and truck_number are required.' });
    }

    if (!truck_type && !capacity_kg) {
        return res.status(400).json({ error: 'At least one of truck_type or capacity_kg is required.' });
    }

    // Determine Category & Handle mismatches
    let final_type = truck_type ? truck_type.toLowerCase() : null;
    let final_capacity = capacity_kg ? parseFloat(capacity_kg) : null;

    if (final_capacity) {
        // Prioritize capacity if provided, override type
        final_type = inferCategory(final_capacity);
    } else if (final_type) {
        // Only type provided
        if (!TRUCK_DEFAULTS[final_type]) {
            return res.status(400).json({ error: 'Invalid truck_type provided.' });
        }
        final_capacity = TRUCK_DEFAULTS[final_type].capacity;
    }

    const defaults = TRUCK_DEFAULTS[final_type];
    
    if (!defaults) {
        return res.status(400).json({ error: 'Invalid truck specifications could not be resolved.' });
    }

    // Field Resolution Logic
    const final_height = height_m ? parseFloat(height_m) : defaults.height;
    const final_mileage = mileage_kmpl ? parseFloat(mileage_kmpl) : defaults.mileage;
    const final_weight = truck_weight ? parseFloat(truck_weight) : Math.round(final_capacity * 1.5);
    
    // Custom Check
    const is_custom = !!(
        req.body.height_m || 
        req.body.mileage_kmpl || 
        req.body.truck_weight || 
        (req.body.capacity_kg && parseFloat(req.body.capacity_kg) !== defaults.capacity)
    );

    // Validate Constraints
    if (final_capacity <= 0) return res.status(400).json({ error: 'capacity_kg must be > 0' });
    if (final_height < 1.5 || final_height > 5.0) return res.status(400).json({ error: 'height_m must be between 1.5 and 5.0' });
    if (final_mileage <= 0) return res.status(400).json({ error: 'mileage_kmpl must be > 0' });
    if (final_weight <= 0) return res.status(400).json({ error: 'truck_weight must be > 0' });

    try {
        const result = await pool.query(
            `INSERT INTO trucks (
                fleet_manager_id, truck_number, truck_type, capacity_kg, height_m, mileage_kmpl, truck_weight, is_custom
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [fleet_manager_id, truck_number, final_type, final_capacity, final_height, final_mileage, final_weight, is_custom]
        );

        res.status(201).json({
            message: 'Truck added successfully.',
            truck: result.rows[0]
        });
    } catch (error) {
        console.error('Error adding truck:', error);
        
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Truck with this number already exists.' });
        }
        
        if (error.code === '23503') {
             return res.status(400).json({ error: 'Invalid fleet_manager_id. User does not exist.' });
        }
        
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// GET /api/trucks
// Allows fetching all trucks, or filtering by fleet_manager_id
router.get('/', async (req, res) => {
    try {
        const { fleet_manager_id } = req.query;
        let query = 'SELECT * FROM trucks';
        let params = [];

        if (fleet_manager_id) {
            query += ' WHERE fleet_manager_id = $1';
            params.push(fleet_manager_id);
        }

        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching trucks:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// GET /api/trucks/:id
// Get a single truck by its ID
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM trucks WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Truck not found.' });
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching truck:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;
