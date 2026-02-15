import { Capacitor, registerPlugin } from '@capacitor/core';

interface PrivacyScreenPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
}

// Register the plugin via Capacitor's bridge — no need to bundle the
// community package because the native side is already linked by
// mobile/node_modules.  On web this is never called (guarded below).
const PrivacyScreen = registerPlugin<PrivacyScreenPlugin>('PrivacyScreen');

/**
 * Enable/disable OS-level screenshot protection on native platforms (iOS/Android).
 * On web this is a no-op — web image protection is handled via CSS
 * (user-select, context menu blocking) driven by the
 * `imageProtection` state in AuthContext.
 */
export async function setNativeScreenshotProtection(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  if (enabled) {
    await PrivacyScreen.enable();
  } else {
    await PrivacyScreen.disable();
  }
}
