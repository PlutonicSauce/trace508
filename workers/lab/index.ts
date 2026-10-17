import 'dotenv/config';
import { createServer } from 'node:http';
import { db } from '../../packages/core/src/db';
import { labConfig } from '../../packages/core/src/lab';
import { labOrigin } from '../../packages/core/src/security';
if (process.env.ENABLE_LAB !== 'true')
  throw new Error('Set ENABLE_LAB=true to run the isolated controlled fixture server.');
const origin = new URL(labOrigin());
if (origin.hostname !== '127.0.0.1') throw new Error('Native lab server binds only to loopback.');
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url ?? '/', origin),
      match = /^\/site\/([a-zA-Z0-9-]+)(\/form|\/success)?\/?$/.exec(u.pathname);
    if (!match || req.method !== 'GET') {
      res.writeHead(404);
      res.end('Fixture route not found');
      return;
    }
    const site = await db.labSite.findUnique({
      where: { id: match[1] },
      include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!site) {
      res.writeHead(404);
      res.end('Unknown fixture');
      return;
    }
    if (u.searchParams.has('redirect')) {
      res.writeHead(302, { Location: u.searchParams.get('redirect')! });
      res.end();
      return;
    }
    const delay = Math.min(10000, Math.max(0, Number(u.searchParams.get('delay')) || 0));
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const repeated = Math.min(500, Math.max(0, Number(u.searchParams.get('repeat')) || 0));
    const c = labConfig.parse(site.revisions[0].config),
      base = `/site/${site.id}`,
      form = match[2] === '/form';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${form ? 'Request a service' : 'Civic services'} · Controlled Trace508 fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:18px/1.6 Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 24px;color:#183c42;background:#fff}a{color:#086351}button{padding:12px 18px;color:white;background:#125c4c;border:0;border-radius:4px;font:inherit}input{display:block;padding:10px;font:inherit;margin:8px 0 20px;border:1px solid #49656b}*:focus-visible{outline:3px solid #0868ac;outline-offset:3px}.notice{padding:12px;background:#edf4f4}footer{margin-top:40px}.message{color:${c.contrast ? '#304c55' : '#c7ced1'}}</style></head><body><a href="#main">Skip to main content</a><header><p class="notice">CONTROLLED TEST FIXTURE · revision ${site.revision} · intentional defects may be present</p><nav aria-label="Main"><a href="${base}">Home</a> <a id="request-link" href="${base}/form">Request a service</a></nav></header><main id="main"><h1>${form ? 'Request a service' : 'Civic services'}</h1>${form ? `<form id="service-form" novalidate>${c.formLabels ? '<label for="email">Email address</label>' : ''}<input id="email" type="email" autocomplete="email" ${c.formLabels ? 'aria-describedby="email-help"' : ''}><p id="email-help">We use your email to send a receipt. This fixture never sends email.</p><button id="submit-request" type="submit">Submit request</button><p id="error-message" role="alert"></p></form><script>document.getElementById('service-form').addEventListener('submit',e=>{e.preventDefault();const value=document.getElementById('email').value;if(!/^[^@ ]+@[^@ ]+\\.[^@ ]+$/.test(value)){document.getElementById('email').setAttribute('aria-invalid','true');document.getElementById('error-message').textContent='Enter a valid email address.';}else{document.getElementById('email').removeAttribute('aria-invalid');document.getElementById('error-message').textContent='Request received. No data was transmitted.';}})</script>` : `<img id="service-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='100'%3E%3Crect width='260' height='100' fill='%23125c4c'/%3E%3Ctext x='20' y='60' fill='white' font-size='24'%3ECivic services%3C/text%3E%3C/svg%3E" ${c.imageAlt ? 'alt="Civic services"' : ''}><p class="message">Check eligibility and request help with a public service.</p><a href="${base}/form">Start a service request</a>`}${Array.from({ length: repeated }, (_, i) => `<img id="repeat-${i}" width="2" height="2" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='2'%3E%3C/svg%3E" ${c.imageAlt ? 'alt=""' : ''}>`).join('')}</main><footer><p>Trace508 controlled laboratory. This is a test website, not a government service.</p></footer></body></html>`;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Trace508-Build': `${site.id}@${site.revision}`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
  } catch {
    res.writeHead(500);
    res.end('Controlled fixture unavailable');
  }
});
server.listen(Number(origin.port), '127.0.0.1', () =>
  console.log(`Controlled fixture lab ready at ${origin.origin}`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => server.close(() => void db.$disconnect()));
