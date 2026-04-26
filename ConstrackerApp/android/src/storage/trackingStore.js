import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = "TRACKING_ENABLED";

export async function setTrackingStatus(status) {
  await AsyncStorage.setItem(KEY, JSON.stringify(status));
}

export async function getTrackingStatus() {
  const value = await AsyncStorage.getItem(KEY);
  return value ? JSON.parse(value) : false;
}