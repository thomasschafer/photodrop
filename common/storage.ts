/**
 * Browser storage keys and payloads shared between the frontend and the e2e
 * suite, which seeds them to control what the app shows on a fresh browser.
 */

export const INSTALL_PROMPT_STORAGE_KEY = 'installPrompt';

export interface InstallPromptState {
  dismissed?: boolean;
  dismissedAt?: number;
}

/** Value that suppresses the install prompt for good. */
export const INSTALL_PROMPT_DISMISSED: InstallPromptState = { dismissed: true };
