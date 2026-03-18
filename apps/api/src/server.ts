import { buildApp } from './app.js';
import { loadConfig } from '@dreamapi/config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`DreamAPI listening on port ${config.PORT}`);
    app.log.info(`Swagger docs: http://localhost:${config.PORT}/docs`);
  } catch (error) {
    app.log.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

main();
