import express from 'express';
import pool from '../db.js';
import { TRUCK_DEFAULTS, inferCategory, insertTruckRecord } from '../utils/truckPersistence.js';

const router = express.Router();

// POST /api/trucks
router.post('/', async (req, res) => {
    try {
        const truck = await insertTruckRecord(pool, req.body);

        res.status(201).json({
            message: 'Truck added successfully.',
            truck,
        });
    } catch (error) {
        console.error('Error adding truck:', error);

        if (error?.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }

        return res.status(500).json({ error: 'Internal server error.' });
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

// PUT /api/trucks/:id
// Update an existing truck
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    let {
        fleet_manager_id,
        truck_number,
        capacity_kg,
        height_m,
        mileage_kmpl,
        truck_type,
        truck_weight
    } = req.body;

    if (!fleet_manager_id || !truck_number) {
        return res.status(400).json({ error: 'fleet_manager_id and truck_number are required.' });
    }

    if (!truck_type && !capacity_kg) {
        return res.status(400).json({ error: 'At least one of truck_type or capacity_kg is required.' });
    }

    let final_type = truck_type ? truck_type.toLowerCase() : null;
    let final_capacity = capacity_kg ? parseFloat(capacity_kg) : null;

    if (final_capacity) {
        final_type = inferCategory(final_capacity);
    } else if (final_type) {
        if (!TRUCK_DEFAULTS[final_type]) {
            return res.status(400).json({ error: 'Invalid truck_type provided.' });
        }
        final_capacity = TRUCK_DEFAULTS[final_type].capacity;
    }

    const defaults = TRUCK_DEFAULTS[final_type];

    if (!defaults) {
        return res.status(400).json({ error: 'Invalid truck specifications could not be resolved.' });
    }

    const final_height = height_m ? parseFloat(height_m) : defaults.height;
    const final_mileage = mileage_kmpl ? parseFloat(mileage_kmpl) : defaults.mileage;
    const final_weight = truck_weight ? parseFloat(truck_weight) : Math.round(final_capacity * 1.5);

    const is_custom = !!(
        req.body.height_m ||
        req.body.mileage_kmpl ||
        req.body.truck_weight ||
        (req.body.capacity_kg && parseFloat(req.body.capacity_kg) !== defaults.capacity)
    );

    if (final_capacity <= 0) return res.status(400).json({ error: 'capacity_kg must be > 0' });
    if (final_height < 1.5 || final_height > 5.0) return res.status(400).json({ error: 'height_m must be between 1.5 and 5.0' });
    if (final_mileage <= 0) return res.status(400).json({ error: 'mileage_kmpl must be > 0' });
    if (final_weight <= 0) return res.status(400).json({ error: 'truck_weight must be > 0' });

    try {
        const result = await pool.query(
            `UPDATE trucks SET
                truck_number = $1,
                truck_type = $2,
                capacity_kg = $3,
                height_m = $4,
                mileage_kmpl = $5,
                truck_weight = $6,
                is_custom = $7
            WHERE id = $8 AND fleet_manager_id = $9
            RETURNING *`,
            [truck_number, final_type, final_capacity, final_height, final_mileage, final_weight, is_custom, id, fleet_manager_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Truck not found or you do not have permission to edit it.' });
        }

        res.status(200).json({
            message: 'Truck updated successfully.',
            truck: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating truck:', error);

        if (error.code === '23505') {
            return res.status(409).json({ error: 'Truck with this number already exists.' });
        }
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// DELETE /api/trucks/:id
// Delete a truck by ID
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { fleet_manager_id } = req.query;

    if (!fleet_manager_id) {
        return res.status(400).json({ error: 'fleet_manager_id is required.' });
    }

    try {
        const result = await pool.query('DELETE FROM trucks WHERE id = $1 AND fleet_manager_id = $2 RETURNING id', [id, fleet_manager_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Truck not found or you do not have permission to delete it.' });
        }

        res.status(200).json({ message: 'Truck deleted successfully.', deletedId: id });
    } catch (error) {
        console.error('Error deleting truck:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;
