// E2E test ports — single source of truth. playwright.config.ts imports these directly.
// Kept separate from the dev server (8787/5173) so both can run simultaneously.
export const E2E_BACKEND_PORT = 8788;
export const E2E_FRONTEND_PORT = 5174;

export const API_BASE = `http://localhost:${E2E_BACKEND_PORT}`;
export const FRONTEND_BASE = `http://localhost:${E2E_FRONTEND_PORT}`;
