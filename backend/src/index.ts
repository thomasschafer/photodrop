import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import users from './routes/users';
import photos from './routes/photos';

type Bindings = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  FRONTEND_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  '/*',
  cors({
    origin: (origin) => {
      if (!origin) return '';
      const allowedOrigins = ['http://localhost:5173', 'http://localhost:8787'];
      return allowedOrigins.includes(origin) ? origin : '';
    },
    credentials: true,
  })
);

app.get('/', (c) => {
  return c.json({ message: 'photodrop API' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/photos', photos);

export default app;
