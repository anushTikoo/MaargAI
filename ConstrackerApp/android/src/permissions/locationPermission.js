import { PermissionsAndroid, Platform } from 'react-native';

export async function requestLocationPermission() {
  if (Platform.OS !== 'android') return false;

  try {
    // Step 1: Request foreground location (FINE + COARSE)
    const fineLocation = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location Permission',
        message: 'Constracker needs access to your location for tracking.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      }
    );

    if (fineLocation !== PermissionsAndroid.RESULTS.GRANTED) {
      return false;
    }

    // Step 2: Request background location separately (required on Android 11+)
    // The OS mandates this is a separate request — not bundled with foreground.
    if (Platform.Version >= 29) {
      const backgroundLocation = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        {
          title: 'Background Location Permission',
          message:
            'Constracker needs to access your location in the background. ' +
            'Please select "Allow all the time" on the next screen.',
          buttonPositive: 'Open Settings',
          buttonNegative: 'Deny',
        }
      );

      if (backgroundLocation !== PermissionsAndroid.RESULTS.GRANTED) {
        return false;
      }
    }

    return true;
  } catch (err) {
    console.warn(err);
    return false;
  }
}