import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import users from './routes/users';
import photos from './routes/photos';
import groups from './routes/groups';

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
    origin: (origin, c) => {
      if (!origin) return '';
      // Allow localhost for development
      const devOrigins = ['http://localhost:5173', 'http://localhost:8787'];
      if (devOrigins.includes(origin)) return origin;
      // Allow configured frontend URL in production
      const frontendUrl = c.env.FRONTEND_URL;
      if (frontendUrl && origin === frontendUrl) return origin;
      return '';
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

app.route('/auth', auth);
app.route('/users', users);
app.route('/photos', photos);
app.route('/groups', groups);

export default app;
