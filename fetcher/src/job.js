const { Registry, Gauge, Pushgateway } = require('prom-client');

const PUSHGATEWAY_URL = process.env.PUSHGATEWAY_URL || 'http://pushgateway:9091';
const JOB_NAME = 'cleanair_job';

const registry = new Registry();

const durationGauge = new Gauge({
  name: 'cleanair_job_duration_seconds',
  help: 'Duration of the last job run in seconds',
  registers: [registry],
});

const lastRunGauge = new Gauge({
  name: 'cleanair_job_last_run_timestamp_seconds',
  help: 'Unix timestamp of the last job run completion',
  registers: [registry],
});

const lastSuccessGauge = new Gauge({
  name: 'cleanair_job_last_success',
  help: 'Whether the last job run succeeded (1) or failed (0)',
  registers: [registry],
});

// Placeholder for the real work: sleeps for 1, 2 or 3 seconds.
async function dummyTask() {
  const seconds = Math.floor(Math.random() * 3) + 1;
  console.log(`Dummy task sleeping for ${seconds}s`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function main() {
  const start = process.hrtime.bigint();
  let success = true;

  try {
    await dummyTask();
  } catch (err) {
    success = false;
    console.error('Job failed:', err);
  }

  const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
  durationGauge.set(durationSeconds);
  lastRunGauge.set(Date.now() / 1000);
  lastSuccessGauge.set(success ? 1 : 0);

  console.log(`Job finished in ${durationSeconds.toFixed(3)}s (success=${success})`);

  const gateway = new Pushgateway(PUSHGATEWAY_URL, {}, registry);
  await gateway.pushAdd({ jobName: JOB_NAME });
  console.log(`Metrics pushed to ${PUSHGATEWAY_URL}`);

  if (!success) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Failed to push metrics:', err);
  process.exit(1);
});
