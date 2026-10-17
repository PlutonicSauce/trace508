import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import { lookup } from 'node:dns/promises';
import { isPublicIp } from '../packages/core/src/security';
let active = 0;
const server = createServer((_req, res) => {
  res.writeHead(405);
  res.end();
});
server.on('connect', async (req, client, head) => {
  if (++active > 32) {
    active--;
    client.destroy();
    return;
  }
  client.once('close', () => active--);
  client.on('error', () => {});
  (client as Socket).setTimeout(120000, () => client.destroy());
  try {
    const u = new URL('https://' + req.url);
    if (
      u.port ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      !/^[a-z0-9.-]+$/i.test(u.hostname)
    )
      throw Error('Destination denied');
    const addresses = await lookup(u.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => !isPublicIp(a.address)))
      throw Error('Private destination denied');
    const address = addresses.find((a) => a.family === 4);
    if (!address) throw Error('Public IPv4 required');
    const remote = connect({ host: address.address, port: 443, timeout: 10000 });
    remote.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote);
      remote.pipe(client);
    });
    remote.on('timeout', () => remote.destroy());
    remote.on('error', () => client.destroy());
    client.once('close', () => remote.destroy());
    remote.once('close', () => client.destroy());
  } catch {
    client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  }
});
server.maxConnections = 40;
server.listen(3128, '0.0.0.0', () => console.log('Public HTTPS-only pinned egress ready'));
for (const s of ['SIGTERM', 'SIGINT'] as const) process.on(s, () => server.close());
