import Geolocation from 'react-native-geolocation-service';
import BackgroundService from 'react-native-background-actions';
import { LOCATION_CONFIG } from '../config/constants';
import { sendLocation } from './apiService';

let activeToken = null;
let onLocationCallback = null;
let onErrorCallback = null;
let onNotificationCallback = null;

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

// Safe default for interval in case parameters are missing/undefined.
const backgroundTask = async ({ interval = 30000 } = {}) => {
  // Use a resolve-ref pattern so the outer promise settles when the loop exits
  // cleanly, and errors inside the loop are NOT silently swallowed.
  await new Promise((resolve) => {
    const run = async () => {
      try {
        while (BackgroundService.isRunning()) {
          await new Promise((resolvePos) => {
            Geolocation.getCurrentPosition(
              async (position) => {
                const { latitude, longitude } = position.coords;

                console.log('Location:', latitude, longitude);

                // sendLocation returns a notification object if the server sends one.
                const notification = await sendLocation(activeToken, latitude, longitude).catch((error) => {
                  console.log('API Error:', error?.message || error);
                  return null;
                });

                if (typeof onLocationCallback === 'function') {
                  onLocationCallback({ latitude, longitude });
                }

                // Fire the notification callback if the server sent a message or link.
                if ((notification?.message || notification?.link) && typeof onNotificationCallback === 'function') {
                  onNotificationCallback(notification);
                }

                resolvePos();
              },
              (error) => {
                console.log('Location Error:', error);

                if (typeof onErrorCallback === 'function') {
                  onErrorCallback(error);
                }

                resolvePos();
              },
              {
                enableHighAccuracy: LOCATION_CONFIG.enableHighAccuracy,
                timeout: 20000,
                maximumAge: 0,
              },
            );
          });

          await sleep(interval);
        }
      } catch (error) {
        console.log('Background task error:', error);
        if (typeof onErrorCallback === 'function') {
          onErrorCallback(error);
        }
      } finally {
        resolve();
      }
    };

    run();
  });
};

const getBackgroundServiceOptions = (token) => ({
  taskName: 'ConstrackerTracking',
  taskTitle: 'Constracker tracking active',
  taskDesc: `Sharing location for ${token}`,
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  // Must be an array — Java reads this with getStringArrayList().
  // A plain string causes a ClassCastException that silently returns type=none,
  // which crashes on Android 14 with targetSdkVersion=34.
  foregroundServiceType: ['location'],
  color: '#38bdf8',
  parameters: {
    interval: LOCATION_CONFIG.interval,
  },
});

/**
 * @param token        User identifier sent with each location update.
 * @param onLocation   Called with { latitude, longitude } on each fix.
 * @param onError      Called when the GPS or network fails.
 * @param onNotification  Called with { message, link, showLink } when the server sends a notification.
 */
export async function startLocationTracking(token, onLocation, onError, onNotification) {
  const normalizedToken = token?.trim();

  if (!normalizedToken) {
    throw new Error('User ID is required to start tracking');
  }

  if (BackgroundService.isRunning()) {
    return;
  }

  activeToken = normalizedToken;
  onLocationCallback = onLocation;
  onErrorCallback = onError;
  onNotificationCallback = onNotification || null;

  await BackgroundService.start(
    backgroundTask,
    getBackgroundServiceOptions(normalizedToken),
  );
}

export async function stopLocationTracking() {
  if (BackgroundService.isRunning()) {
    await BackgroundService.stop();
  }

  activeToken = null;
  onLocationCallback = null;
  onErrorCallback = null;
  onNotificationCallback = null;
}