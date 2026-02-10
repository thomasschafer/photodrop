import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import auth from './routes/auth';
import users from './routes/users';
import photos from './routes/photos';
import groups from './routes/groups';
import push from './routes/push';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// Security headers middleware
app.use('/*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  // Default: no caching for API responses (individual routes can override)
  if (!c.res.headers.has('Cache-Control')) {
    c.res.headers.set('Cache-Control', 'no-store');
  }
});

app.use(
  '/*',
  cors({
    origin: (origin, c) => {
      if (!origin) return '';
      // Allow localhost for development
      const devOrigins = ['http://localhost:5173', 'http://localhost:8787'];
      if (devOrigins.includes(origin)) return origin;
      // Allow Capacitor mobile app origins
      // Android WebView uses http://localhost (no port)
      // iOS WebView uses capacitor://localhost
      if (origin === 'http://localhost' || origin === 'capacitor://localhost') return origin;
      // Allow configured frontend URL in production
      const frontendUrl = c.env.FRONTEND_URL;
      if (frontendUrl && origin === frontendUrl) return origin;
      return '';
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// CSRF protection: require X-Requested-With header on state-changing requests
// This prevents cross-site form submissions since custom headers can't be set by forms
// Skip for /auth/* routes (public endpoints that don't use cookie-based auth)
app.use('/*', async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    await next();
    return;
  }
  // Auth endpoints don't use cookies for authentication — they issue tokens
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/auth/')) {
    await next();
    return;
  }
  const xRequestedWith = c.req.header('X-Requested-With');
  if (!xRequestedWith) {
    return c.json({ error: 'Missing X-Requested-With header' }, 403);
  }
  await next();
});

app.get('/', (c) => {
  return c.json({ message: 'photodrop API' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

app.route('/auth', auth);
app.route('/users', users);
app.route('/photos', photos);
app.route('/groups', groups);
app.route('/push', push);

// Global error handler
app.onError((err, c) => {
  if (err instanceof ZodError) {
    const messages = err.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
    return c.json({ error: 'Validation error', details: messages }, 400);
  }

  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
