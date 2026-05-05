import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ritualhabits.app',
  appName: 'Ritual',
  webDir: 'build',
  // App loads from local bundle for instant launch (critical for NFC tap flow).
  // Capgo handles OTA updates to keep the bundle current.
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#F2EDE7',
    scheme: 'Ritual'
  },
  server: {
    iosScheme: 'capacitor',
  },
  plugins: {
    CapacitorUpdater: {
      autoUpdate: false
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#F2EDE7',
      showSpinner: false
    }
  }
};

export default config;
