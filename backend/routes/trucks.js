import express from 'express';
import pool from '../db.js';
import { buildTruckPayload, insertTruckRecord } from '../utils/truckPersistence.js';

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

    let payload;

    try {
        payload = buildTruckPayload(req.body);
    } catch (error) {
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
        return res.status(statusCode).json({ error: error.message || 'Invalid truck payload.' });
    }

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
            [
                payload.truck_number,
                payload.truck_type,
                payload.capacity_kg,
                payload.height_m,
                payload.mileage_kmpl,
                payload.truck_weight,
                payload.is_custom,
                id,
                payload.fleet_manager_id,
            ]
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
