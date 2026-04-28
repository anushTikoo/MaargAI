import React from 'react';
import {useEffect, useRef, useState} from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {requestLocationPermission} from './android/src/permissions/locationPermission';
import {
  startLocationTracking,
  stopLocationTracking,
} from './android/src/services/locationService';
import {sendLocation} from './android/src/services/apiService';
import {LOCATION_CONFIG} from './android/src/config/constants';

function App() {
  const [userId, setUserId] = useState('');
  const [userIdSet, setUserIdSet] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [status, setStatus] = useState('Tracking is idle');
  const [location, setLocation] = useState<{latitude: number; longitude: number} | null>(null);
  const [postLog, setPostLog] = useState<string>('');

  const updatePostLog = (lat: number, lng: number) => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour12: false });
    setPostLog(`Sent post request at ${timeString} with Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`);
  };
  // Server-sent notification state
  const [notification, setNotification] = useState<{
    message: string | null;
    link: string | null;
    showLink?: boolean;
  } | null>(null);

  // Manual location override state
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [isSendingManual, setIsSendingManual] = useState(false);
  const manualIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopManualLocationLoop = () => {
    if (manualIntervalRef.current) {
      clearInterval(manualIntervalRef.current);
      manualIntervalRef.current = null;
    }
  };

  const startManualLocationLoop = (lat: number, lng: number) => {
    stopManualLocationLoop();
    manualIntervalRef.current = setInterval(() => {
      void sendLocation(userId, lat, lng)
        .then((result) => {
          updatePostLog(lat, lng);
          if (result?.message || result?.link) {
            setNotification(result);
          }
        })
        .catch(() => {
          // Keep retrying on next interval tick.
        });
    }, LOCATION_CONFIG.interval);
  };

  useEffect(() => {
    return () => {
      stopManualLocationLoop();
      void stopLocationTracking();
    };
  }, []);

  const handleSetUserId = () => {
    if (userId.trim().length === 0) {
      setStatus('Please enter a valid license plate number');
      return;
    }
    setUserIdSet(true);
    setStatus('License plate set. Ready to track.');
  };

  const handleStartStopTracking = async () => {
    if (isTracking) {
      await stopLocationTracking();
      setIsTracking(false);
      setStatus('Tracking stopped');
      return;
    }

    const granted = await requestLocationPermission();

    if (!granted) {
      setStatus('Location permission denied');
      return;
    }

    // Switch from manual-repeat mode to live GPS mode.
    stopManualLocationLoop();
    setStatus('Waiting for the first location fix...');
    try {
      await startLocationTracking(
        userId,
        ({latitude, longitude}: {latitude: number; longitude: number}) => {
          setLocation({latitude, longitude});
          updatePostLog(latitude, longitude);
          setIsTracking(true);
          setStatus('Live tracking active');
        },
        (error: any) => {
          setIsTracking(false);
          setStatus(error?.message || 'Unable to read location');
        },
        (notif: {message: string | null; link: string | null; showLink?: boolean}) => {
          setNotification(notif);
        },
      );
    } catch (error: any) {
      setIsTracking(false);
      setStatus(error?.message || 'Unable to start background tracking');
    }
  };

  const handleSendManualLocation = async () => {
    if (isTracking) {
      setStatus('Stop live tracking before enabling manual repeat mode');
      return;
    }

    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);

    if (isNaN(lat) || isNaN(lng)) {
      setStatus('Enter valid latitude and longitude');
      return;
    }
    if (lat < -90 || lat > 90) {
      setStatus('Latitude must be between -90 and 90');
      return;
    }
    if (lng < -180 || lng > 180) {
      setStatus('Longitude must be between -180 and 180');
      return;
    }

    setIsSendingManual(true);
    try {
      const result = await sendLocation(userId, lat, lng);
      updatePostLog(lat, lng);
      startManualLocationLoop(lat, lng);
      // Update the displayed location with the manually entered values
      setLocation({latitude: lat, longitude: lng});
      setStatus('Manual location is being sent continuously');
      if (result?.message || result?.link) {
        setNotification(result);
      }
    } catch (e: any) {
      setStatus(e?.message || 'Failed to send manual location');
    } finally {
      setIsSendingManual(false);
    }
  };

  const handleOpenLink = (link: string) => {
    Linking.openURL(link).catch(() => setStatus('Could not open link'));
  };

  const trackingLabel = isTracking ? 'Stop tracking' : 'Start tracking';
  const isManualRepeatActive = !isTracking && manualIntervalRef.current !== null;
  const modeLabel = isTracking
    ? 'Live Tracking'
    : isManualRepeatActive
      ? 'Manual Repeat'
      : 'Idle';
  const locationLabel = location
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : 'No coordinates yet';

  if (!userIdSet) {
    return (
      <SafeAreaProvider>
        <StatusBar
          barStyle="light-content"
          backgroundColor={styles.container.backgroundColor}
        />
        <SafeAreaView style={styles.container}>
          <View style={styles.hero}>
            <Text style={styles.kicker}>Constracker</Text>
            <Text style={styles.title}>Live location tracking</Text>
            <Text style={styles.subtitle}>
              Enter a license plate number so we can track your vehicle.
            </Text>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>License Plate Number</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g., ABC-1234"
                placeholderTextColor="#64748b"
                value={userId}
                onChangeText={setUserId}
              />
            </View>

            <Pressable
              onPress={handleSetUserId}
              style={({pressed}) => [styles.button, styles.buttonStart, pressed && styles.buttonPressed]}>
              <Text style={styles.buttonText}>Set Plate and Continue</Text>
            </Pressable>

            <Text style={styles.footer}>
              This license plate will be sent with each location update so your backend can
              identify which vehicle is being tracked.
            </Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle="light-content"
        backgroundColor={styles.container.backgroundColor}
      />
      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">

          <Text style={styles.kicker}>Constracker</Text>
          <Text style={styles.title}>Live location tracking</Text>
          <Text style={styles.subtitle}>
            Tracking plate: <Text style={styles.userId}>{userId}</Text>
          </Text>

          {/* Status card */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Status</Text>
            <Text style={styles.cardValue}>{status}</Text>
          </View>

          <View style={styles.modeCard}>
            <Text style={styles.cardLabel}>Mode</Text>
            <Text style={styles.modeValue}>{modeLabel}</Text>
          </View>

          {/* Current location card */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Current location</Text>
            <Text style={styles.cardValue}>{locationLabel}</Text>
          </View>

          {/* Post Log card */}
          {postLog ? (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Last Request</Text>
              <Text style={styles.cardValue}>{postLog}</Text>
            </View>
          ) : null}

          {/* ── Feature 1: Server notification banner ── */}
          {notification && (
            <View style={styles.notificationCard}>
              <View style={styles.notificationHeader}>
                <Text style={styles.notificationIcon}>📍</Text>
                <Text style={styles.notificationLabel}>Route Update</Text>
                <Pressable
                  onPress={() => setNotification(null)}
                  style={styles.dismissButton}
                  hitSlop={8}>
                  <Text style={styles.dismissText}>✕</Text>
                </Pressable>
              </View>
              <Text style={styles.notificationMessage}>{notification.message || 'Route update available'}</Text>
              {notification.link && notification.showLink && (
                <Pressable
                  onPress={() => handleOpenLink(notification.link!)}
                  style={({pressed}) => [
                    styles.notificationLinkButton,
                    pressed && styles.buttonPressed,
                  ]}>
                  <Text style={styles.notificationLinkText}>Open Link →</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Start / Stop tracking button */}
          <Pressable
            onPress={handleStartStopTracking}
            style={({pressed}) => [
              styles.button,
              isTracking ? styles.buttonStop : styles.buttonStart,
              pressed && styles.buttonPressed,
            ]}>
            <Text style={styles.buttonText}>{trackingLabel}</Text>
          </Pressable>

          {/* ── Feature 2: Manual location entry ── */}
          <View style={styles.manualCard}>
            <Text style={styles.cardLabel}>Manual location override</Text>
            <Text style={styles.manualHint}>
              Enter coordinates to send a one-off location to the server.
            </Text>

            <View style={styles.coordRow}>
              <View style={styles.coordInputWrapper}>
                <Text style={styles.coordLabel}>Latitude</Text>
                <TextInput
                  style={styles.coordInput}
                  placeholder="-90 to 90"
                  placeholderTextColor="#475569"
                  value={manualLat}
                  onChangeText={setManualLat}
                  keyboardType="numeric"
                  returnKeyType="next"
                />
              </View>
              <View style={styles.coordInputWrapper}>
                <Text style={styles.coordLabel}>Longitude</Text>
                <TextInput
                  style={styles.coordInput}
                  placeholder="-180 to 180"
                  placeholderTextColor="#475569"
                  value={manualLng}
                  onChangeText={setManualLng}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
              </View>
            </View>

            <Pressable
              onPress={handleSendManualLocation}
              disabled={isSendingManual}
              style={({pressed}) => [
                styles.button,
                styles.buttonManual,
                pressed && styles.buttonPressed,
                isSendingManual && styles.buttonDisabled,
              ]}>
              <Text style={styles.buttonText}>
                {isSendingManual ? 'Sending…' : 'Send Manual Location'}
              </Text>
            </Pressable>
          </View>

        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07111f',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 14,
  },
  hero: {
    paddingHorizontal: 24,
    gap: 14,
  },
  kicker: {
    color: '#7dd3fc',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f8fafc',
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 42,
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 320,
  },
  card: {
    marginTop: 4,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cardLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  cardValue: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  modeCard: {
    marginTop: 4,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#081826',
    borderWidth: 1,
    borderColor: '#155e75',
  },
  modeValue: {
    color: '#67e8f9',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 8,
  },

  // ── Notification banner ──────────────────────────────
  notificationCard: {
    marginTop: 4,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#1c1207',
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  notificationIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  notificationLabel: {
    flex: 1,
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  dismissButton: {
    padding: 2,
  },
  dismissText: {
    color: '#78716c',
    fontSize: 14,
    fontWeight: '700',
  },
  notificationMessage: {
    color: '#fef3c7',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  notificationLinkButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f59e0b',
  },
  notificationLinkText: {
    color: '#1c1207',
    fontSize: 13,
    fontWeight: '800',
  },

  // ── Manual location card ─────────────────────────────
  manualCard: {
    marginTop: 4,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 12,
  },
  manualHint: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
  },
  coordRow: {
    flexDirection: 'row',
    gap: 10,
  },
  coordInputWrapper: {
    flex: 1,
    gap: 4,
  },
  coordLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  coordInput: {
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 14,
    backgroundColor: '#07111f',
  },

  // ── Buttons ──────────────────────────────────────────
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
  },
  buttonStart: {
    backgroundColor: '#38bdf8',
  },
  buttonStop: {
    backgroundColor: '#f87171',
  },
  buttonManual: {
    backgroundColor: '#818cf8',
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#08111f',
    fontSize: 15,
    fontWeight: '800',
  },

  // ── Misc ─────────────────────────────────────────────
  textInput: {
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 14,
    backgroundColor: '#0f172a',
    marginTop: 8,
  },
  userId: {
    color: '#7dd3fc',
    fontWeight: '700',
  },
  footer: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
});

export default App;
