import fetch from 'node-fetch'; // if needed, but native fetch works in Node 18+

const BASE_URL = 'http://localhost:3000/api';

async function testEndpoints() {
    console.log('--- Starting API Tests ---');

    // 1. Test the Worker Endpoint
    console.log('\n[TEST 1] Triggering Worker (process-active-trips)...');
    try {
        const workerRes = await fetch(`${BASE_URL}/worker/process-active-trips`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const workerData = await workerRes.json();
        console.log('Worker Response:', workerData);
        if (workerRes.ok) {
            console.log('✅ Worker endpoint is reachable and returning data.');
        } else {
            console.error('❌ Worker endpoint failed.');
        }
    } catch (err) {
        console.error('❌ Error hitting Worker endpoint:', err.message);
    }

    // 2. Test Simulation: Inject Delay (assuming trip ID 1 exists, if not it might fail gracefully or return 0 rows updated)
    // You should change '1' to an actual active trip ID in your database to see full effects.
    const testTripId = 1;
    
    console.log(`\n[TEST 2] Injecting 20-min delay into Trip ${testTripId}...`);
    try {
        const delayRes = await fetch(`${BASE_URL}/simulation/inject-delay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trip_id: testTripId, delay_minutes: 20 })
        });
        const delayData = await delayRes.json();
        console.log('Delay Response:', delayData);
        if (delayRes.ok) {
             console.log('✅ Simulation delay endpoint works.');
        } else {
             console.error('❌ Simulation delay endpoint failed.');
        }
    } catch (err) {
        console.error('❌ Error hitting Simulation delay endpoint:', err.message);
    }

    // 3. Test Simulation: Reset
    console.log(`\n[TEST 3] Resetting Simulation for Trip ${testTripId}...`);
    try {
        const resetRes = await fetch(`${BASE_URL}/simulation/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trip_id: testTripId })
        });
        const resetData = await resetRes.json();
        console.log('Reset Response:', resetData);
        if (resetRes.ok) {
            console.log('✅ Simulation reset endpoint works.');
        } else {
            console.error('❌ Simulation reset endpoint failed.');
        }
    } catch (err) {
        console.error('❌ Error hitting Simulation reset endpoint:', err.message);
    }

    console.log('\n--- Tests Complete ---');
    console.log('Note: To fully test the Google Maps ETA recalculation, ensure you have an active trip with a valid source/dest lat/lng in your database.');
}

testEndpoints();
