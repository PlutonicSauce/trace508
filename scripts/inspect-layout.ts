import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('http://127.0.0.1:3000');
await p.waitForSelector('.feature-title');
console.log(
  await p.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('*')]
      .filter((e) => e.getBoundingClientRect().right > innerWidth)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        width: e.getBoundingClientRect().width,
        right: e.getBoundingClientRect().right,
      }))
      .slice(0, 30),
  })),
);
await p.setViewportSize({ width: 1440, height: 1000 });
await p.screenshot({ path: '.local/overview.png', fullPage: true });
await b.close();
