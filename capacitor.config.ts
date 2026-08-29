import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ritualhabits.app',
  appName: 'Ritual',
  webDir: 'build',
  // App loads from local bundle for instant launch (critical for NFC tap flow).
  // Capgo handles OTA updates to keep the bundle current.
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#F1F4EC',
    scheme: 'Ritual'
  },
  server: {
    iosScheme: 'capacitor',
  },
  plugins: {
    CapacitorUpdater: {
      // Safe only while the anti-downgrade guardrails hold: bundle versions
      // ≥ MARKETING_VERSION, --no-downgrade on the production channel, and a
      // Capgo publish alongside every native build. See CAPGO_OTA_RESTORE.md.
      autoUpdate: true
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#F1F4EC',
      showSpinner: false
    }
  }
};

export default config;
