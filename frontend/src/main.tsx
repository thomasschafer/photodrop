import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { deepLinkPathFromUrl, publishDeepLink } from './lib/deepLink';

if (Capacitor.isNativePlatform()) {
  const currentFullPath = () => window.location.pathname + window.location.search;

  // Warm start: the app is already showing something, so any path other than
  // the one on screen is a real navigation.
  CapApp.addListener('appUrlOpen', ({ url }) => {
    const path = deepLinkPathFromUrl(url);
    if (path && path !== currentFullPath()) {
      publishDeepLink(path);
    }
  });

  // Cold start (app opened via notification or URL). This resolves before React
  // has necessarily mounted; publishDeepLink buffers the path until App
  // subscribes. `/` is where the app opens anyway, so only a deeper path is
  // worth replaying.
  CapApp.getLaunchUrl()
    .then((result) => {
      if (!result?.url) return;
      const path = deepLinkPathFromUrl(result.url);
      if (path && path !== '/' && path !== currentFullPath()) {
        publishDeepLink(path);
      }
    })
    .catch((error) => {
      console.error('Failed to read the launch URL:', error);
    });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
