import express from 'express';
import { v4 as uuid } from 'uuid';
import expressWinston from 'express-winston';
import * as path from 'path';
import favicon from 'serve-favicon';
import { promisify } from 'util';
import * as serviceResponse from 'backends/service-response';
import errorHandler from 'middleware/error-handler';
import router from 'routers/router';
import RequestContext from 'models/request-context';
import { Server } from 'http';
import * as ogcCoveragesApi from './frontends/ogc-coverages';
import serviceResponseRouter from './routers/service-response-router';
import logger from './util/log';
import * as exampleBackend from '../example/http-backend';
import DeadLetterQueueMonitor from './workers/dead-letter-queue-monitor';

/**
 * Builds an express server with appropriate logging and default routing and starts the server
 * listening on the provided port.
 *
 * @param {string} name The name of the server, as identified in logs
 * @param {number} port The port the server should listen on
 * @param {Function} setupFn A function that takes an express app and adds non-default behavior
 * @returns {express.Application} The running express application
 */
function buildServer(name, port, setupFn): Server {
  const appLogger = logger.child({ application: name });

  const addRequestId = (req, res, next): void => {
    const id = uuid();
    const context = new RequestContext(id);
    context.logger = appLogger.child({ requestId: id });
    req.context = context;
    next();
  };

  const addRequestLogger = expressWinston.logger({
    winstonInstance: appLogger,
    dynamicMeta(req) { return { requestId: req.context.id }; },
  });

  const app = express();

  app.use(addRequestId);
  app.use(addRequestLogger);

  app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')));

  if (setupFn) {
    setupFn(app);
  }

  app.use(errorHandler);

  return app.listen(port, '0.0.0.0', () => appLogger.info(`Application "${name}" listening on port ${port}`));
}

/**
 * Starts the servers required to serve Harmony
 *
 * @param {object} [config={}] An optional configuration object containing server config.
 *   When running this module using the CLI, the configuration is pulled from the environment.
 *   Config values:
 *     PORT: {number} The port to run the frontend server on
 *     BACKEND_PORT: {number} The port to run the backend server on
 *     CALLBACK_URL_ROOT: {string} The base URL for callbacks to use
 *     EXAMPLE_SERVICES: {bool} True if we should run example services, false otherwise.  Should
 *       be false in production.  Defaults to true until we have real HTTP services.
 *
 * @returns {object} An object with "frontend" and "backend" keys with running http.Server objects
 */
export function start(config: Record<string, string>):
{ frontend: Server; backend: Server; monitor: DeadLetterQueueMonitor } {
  const appPort = config.PORT || 3000;
  const backendPort = config.BACKEND_PORT || 3001;
  const callbackUrlRoot = config.CALLBACK_URL_ROOT || `http://localhost:${backendPort}`;

  // Setup the frontend server to handle client requests
  const frontend = buildServer('frontend', appPort, (app) => {
    if (config.EXAMPLE_SERVICES !== 'false') {
      app.use('/example', exampleBackend.router());
    }
    app.use('/', router(config));
    // Error handlers that format errors outside of their routes / middleware need to be mounted
    // at the top level, not on a child router, or they get skipped.
    ogcCoveragesApi.handleOpenApiErrors(app);
  });

  // Allow requests to take 20 minutes
  frontend.setTimeout(1200000);

  // Setup the backend server to accept callbacks from backend services
  const backend = buildServer('backend', backendPort, (app) => {
    app.use('/service', serviceResponseRouter());
    app.get('/', ((req, res) => res.send('OK')));

    serviceResponse.configure({ baseUrl: `${callbackUrlRoot}/service/` });
  });

  let monitor;
  if (config.SERVICE_DEAD_LETTER_QUEUE_NAME) {
    const queue = config.BASE_QUEUE_URL + config.SERVICE_DEAD_LETTER_QUEUE_NAME;
    monitor = new DeadLetterQueueMonitor(queue);
    monitor.start(+config.RECEIVE_MESSAGE_TIMEOUT || 10);
  } else {
    logger.warn('SERVICE_DEAD_LETTER_QUEUE is not set.  Will not monitor for failed jobs.');
  }

  return { frontend, backend, monitor };
}

/**
 * Stops the express servers created and returned by the start() method
 *
 * @param {object} servers An object containing "frontend" and "backend" keys tied to http.Server
 *   objects, as returned by start()
 * @returns {Promise<void>} A promise that completes when the servers close
 */
export async function stop({ frontend, backend, monitor }): Promise<void> {
  await Promise.all([
    promisify(frontend.close.bind(frontend))(),
    promisify(backend.close.bind(backend))(),
    monitor?.stop(),
  ]);
}

if (require.main === module) {
  start(process.env);
}