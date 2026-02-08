import { Capacitor } from '@capacitor/core';

/**
 * Enable/disable OS-level screenshot protection on native platforms (iOS/Android).
 * On web this is a no-op — web image protection is handled via CSS
 * (user-select, context menu blocking) driven by the
 * `imageProtection` state in AuthContext.
 */
export async function setNativeScreenshotProtection(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // Dynamic import: the package only exists in the native Capacitor build (mobile/).
  // Use a variable to prevent Vite from statically analyzing the import.
  const pkg = '@capacitor-community/privacy-screen';
  const { PrivacyScreen } = await import(/* @vite-ignore */ pkg);

  if (enabled) {
    await PrivacyScreen.enable();
  } else {
    await PrivacyScreen.disable();
  }
}
