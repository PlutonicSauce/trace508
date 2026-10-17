import { chromium } from 'playwright';
// This service has no database, AI keys, artifact volume or application environment.
const server = await chromium.launchServer({
  headless: true,
  host: '0.0.0.0',
  port: 3333,
  wsPath: '/scanner',
  chromiumSandbox: process.env.BROWSER_SANDBOX !== 'false',
  proxy: { server: 'http://egress:3128', bypass: '<-loopback>' },
  args: ['--disable-quic', '--disable-background-networking'],
});
console.log('Isolated browser service ready');
for (const s of ['SIGTERM', 'SIGINT'] as const) process.on(s, () => void server.close());
