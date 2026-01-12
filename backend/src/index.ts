import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import users from './routes/users';
import photos from './routes/photos';
import groups from './routes/groups';
import push from './routes/push';
import type { Bindings } from './types';

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
app.route('/push', push);

export default app;
