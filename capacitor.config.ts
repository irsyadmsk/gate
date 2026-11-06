import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.irsyads.gate',
  appName: 'Irsyads Gate',
  webDir: 'dist',
  android: {
    loggingBehavior: 'none',
    webContentsDebuggingEnabled: false,
  },
};

export default config;
