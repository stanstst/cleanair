const { createApp } = require('./app');
const { CityRepository } = require('./db/CityRepository');

async function start(env = process.env) {
  const repository = await CityRepository.connect({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  });
  const port = Number(env.PORT ?? 8080);
  const server = createApp({ repository }).listen(port, () => console.info(`API listening on :${port}`));

  const shutdown = () => server.close(() => repository.close().finally(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
