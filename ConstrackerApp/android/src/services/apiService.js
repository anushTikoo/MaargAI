import { API_URL } from '../config/constants';

let successfulPostCount = 0;

/**
 * Sends a location update to the server.
 *
 * Returns a notification object `{ message, link, showLink }` if the server includes one
 * in its response body, otherwise returns null. The link is sourced from the
 * trip's Google Maps URL when available.
 */
export async function sendLocation(token, lat, lng) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        lat,
        lng,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.log('API Response Status:', response.status);
      console.log('API Response Body:', responseText || 'No response body');
      throw new Error(
        `Request failed with status ${response.status}: ${responseText || 'No response body'}`,
      );
    }

    successfulPostCount += 1;

    // Attempt to parse a server-sent notification from the response.
    // The server can include the Maps URL at trip.ai_recommendation.google_maps_url.
    try {
      const data = await response.json();
      const message = data?.message || null;
      const googleMapsUrl = data?.trip?.ai_recommendation?.google_maps_url || data?.link || null;
      if (message || googleMapsUrl) {
        const showLink = successfulPostCount >= 2;
        return { message, link: googleMapsUrl, showLink };
      }
    } catch (_) {
      // Response body is not JSON — that is fine, just no notification.
    }

    return null;
  } catch (error) {
    console.log('API Error:', error.message);
    return null;
  }
}