const { spawnSync } = require('node:child_process');
const url = process.env.TEACHEM_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.includes('test')) {
  console.error('Set TEACHEM_TEST_DATABASE_URL to an isolated test database.');
  process.exit(1);
}
const result = spawnSync('go', ['-C', 'apps/api-go', 'test', '-count=1', '-p', '1', '-v', './...'], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
