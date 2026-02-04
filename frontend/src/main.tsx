import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { DEEP_LINK_EVENT } from './lib/deepLink';

// Handle deep links when app is already running (warm start)
if (Capacitor.isNativePlatform()) {
  CapApp.addListener('appUrlOpen', ({ url }) => {
    const urlObj = new URL(url);
    const path = urlObj.pathname + urlObj.search;
    const currentFullPath = window.location.pathname + window.location.search;
    if (path && path !== currentFullPath) {
      window.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT, { detail: { path } }));
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
