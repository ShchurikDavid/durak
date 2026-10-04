import { NativeModules, Vibration } from 'react-native';

export function tapHaptic() {
  if (NativeModules.GameHaptics?.tap) NativeModules.GameHaptics.tap();
  else Vibration.vibrate(45);
}
