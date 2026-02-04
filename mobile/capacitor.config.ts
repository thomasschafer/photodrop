import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.photodrop.app',
  appName: 'photodrop',
  webDir: 'dist',

  // Server/network config
  server: {
    // Allow navigation to our API domain
    allowNavigation: ['*.perryschafer.com'],
    // For development with live reload, uncomment and set your IP:
    // url: 'http://YOUR_IP:5173',
    // cleartext: true,
  },

  plugins: {
    // Privacy screen - prevents screenshots
    PrivacyScreen: {
      enable: true,
      preventScreenshots: true,
    },
    // Push notifications
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
