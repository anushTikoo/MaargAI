import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/maargai'
});

async function migrate() {
    try {
        console.log('Adding live_slack_time_hours...');
        await pool.query('ALTER TABLE trips ADD COLUMN IF NOT EXISTS live_slack_time_hours NUMERIC(10,2);');
        console.log('Adding live_distance_meters...');
        await pool.query('ALTER TABLE trips ADD COLUMN IF NOT EXISTS live_distance_meters INT;');
        console.log('Migration complete!');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

migrate();
