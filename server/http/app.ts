/**
 * Assembles the HTTP application: security guard, error mapping, one router per module under
 * /api, and finally the built web app. To add a feature, give it a module with a `routes.ts`
 * and mount it here.
 */
import { Hono } from 'hono';
import { HttpError } from '../core/errors.ts';
import { agentsRoutes } from '../modules/agents/routes.ts';
import { defectsRoutes } from '../modules/defects/routes.ts';
import { documentsRoutes } from '../modules/documents/routes.ts';
import { learningRoutes } from '../modules/learning/routes.ts';
import { runsRoutes } from '../modules/runs/routes.ts';
import { secretsRoutes } from '../modules/secrets/routes.ts';
import { sessionsRoutes } from '../modules/sessions/routes.ts';
import { servicesRoutes } from '../modules/services/routes.ts';
import { systemRoutes } from '../modules/system/routes.ts';
import { guard } from './guard.ts';
import { serveWebApp } from './static.ts';

export function buildApp(): Hono {
  const app = new Hono();
  app.use('*', guard);

  // Services throw HttpError for anything the caller can fix; everything else is a bug.
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  app.route('/api', systemRoutes);
  app.route('/api', agentsRoutes);
  app.route('/api', servicesRoutes);
  app.route('/api', secretsRoutes);
  app.route('/api', documentsRoutes);
  app.route('/api', learningRoutes);
  app.route('/api', sessionsRoutes);
  app.route('/api', runsRoutes);
  app.route('/api', defectsRoutes);

  app.get('*', serveWebApp);
  return app;
}
