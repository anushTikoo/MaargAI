import dotenv from 'dotenv';
dotenv.config();

export async function getWeather(lat, lon) {
    try {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
        
        const response = await fetch(url, { method: 'GET' });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`OpenWeather API Error (${response.status}):`, errorText);
            throw new Error(`OpenWeather API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Extract and filter required fields
        return {
            main: data.weather?.[0]?.main || '',
            description: data.weather?.[0]?.description || '',
            visibility: data.visibility ?? ''
        };
    } catch (error) {
        console.error('Error fetching weather data:', error.message);
        throw error;
    }
}
