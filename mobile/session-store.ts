import * as Keychain from 'react-native-keychain';
import type { SessionStore } from './network';

// Android Keystore encrypts the session token. AsyncStorage only holds UI preferences.
export const secureSessionStore: SessionStore = {
  async get(address) {
    const saved = await Keychain.getGenericPassword({ service: `durak.session:${address}` });
    return saved ? saved.password : '';
  },
  async set(address, cookie) {
    await Keychain.setGenericPassword('session', cookie, {
      service: `durak.session:${address}`,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    });
  }
};
