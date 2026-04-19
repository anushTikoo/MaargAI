
import { getRoutes } from '../services/routesService.js';
import dotenv from 'dotenv';
dotenv.config();

async function testFetch() {
    const sourceLat = 16.914111;
    const sourceLng = 82.59118;
    const destLat = 21.472917;
    const destLng = 71.874694;

    console.log(`Testing Routes API from (${sourceLat}, ${sourceLng}) to (${destLat}, ${destLng})`);
    try {
        const routes = await getRoutes(sourceLat, sourceLng, destLat, destLng);
        console.log(`Success! Found ${routes.length} routes.`);
        if (routes.length > 0) {
            console.log('First route sample:', JSON.stringify(routes[0], null, 2).substring(0, 200));
        }
    } catch (e) {
        console.error('Test Failed:', e);
    } finally {
        process.exit();
    }
}

testFetch();
