/**
 * Headless Chromium for the browser tests, over the DevTools protocol, on the production build in
 * web/dist. Node has fetch and WebSocket, so this needs no packages. CHROME names the browser when
 * it is not chromium or google-chrome on the PATH.
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before } from 'node:test';

const DIST = new URL('../dist/', import.meta.url);
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serve web/dist on a free port of 127.0.0.1. While `state.down`, a request gets no answer, as on a
 * network that is down.
 */
async function serve() {
  const state = { down: false };
  const server = createServer((req, res) => {
    if (state.down) return void req.socket.destroy();
    const path = new URL(req.url ?? '/', 'http://x').pathname.replace(/\/$/, '/index.html');
    try {
      const body = readFileSync(new URL('.' + path, DIST));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, state, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

const found = (b: string) => spawnSync('which', [b]).status === 0;
const CHROME =
  process.env.CHROME ?? ['chromium', 'google-chrome', 'google-chrome-stable'].find(found);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Point = [x: number, y: number];

/** A tab, its errors (exceptions and console errors), and the input helpers of the tests. */
export interface Page {
  base: string;
  errors: string[];
  send(method: string, params?: object): Promise<any>;
  ev<T = any>(expression: string): Promise<T>;
  /** Wait until `expression` is truthy, up to 5 s. Returns its value. */
  until<T = any>(expression: string, ms?: number): Promise<T>;
  go(hash: string): Promise<void>;
  center(selector: string): Promise<Point>;
  mouse(
    type: 'mousePressed' | 'mouseMoved' | 'mouseReleased',
    p: Point,
    modifiers?: number,
  ): Promise<void>;
  /** Press at `a`, move to `b` in steps, and release. */
  drag(a: Point, b: Point): Promise<void>;
  touchDrag(a: Point, b: Point): Promise<void>;
  key(key: string, modifiers?: number): Promise<void>;
  /** Stop or start the server, as a network that goes down. */
  offline(down: boolean): void;
}

/**
 * Start a browser and a server for the tests of this file, and close them after. `phone` emulates a
 * touch phone of 412×915. Each call to `page` opens a new tab.
 */
export function browser(o: { phone?: boolean } = {}) {
  let chrome: ReturnType<typeof spawn>;
  let srv: Awaited<ReturnType<typeof serve>>;
  let port = 0;
  const dir = mkdtempSync(join(tmpdir(), 'bauplan-e2e-'));

  before(async () => {
    if (!CHROME) throw new Error('no browser: set CHROME to the path of Chrome or Chromium');
    srv = await serve();
    chrome = spawn(
      CHROME,
      [
        '--headless=new',
        '--hide-scrollbars',
        '--remote-debugging-port=0',
        `--user-data-dir=${dir}`,
      ].concat(process.env.CI ? ['--no-sandbox'] : [], 'about:blank'),
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let log = '';
    port = await new Promise<number>((resolve, reject) => {
      chrome.stderr!.on('data', (d) => {
        log += d;
        const m = /DevTools listening on ws:\/\/[^:]+:(\d+)/.exec(log);
        if (m) resolve(+m[1]);
      });
      chrome.on('exit', () => reject(new Error(`the browser stopped: ${log}`)));
    });
  });
  after(async () => {
    // The browser writes to its folder until it exits.
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
      await once(chrome, 'exit');
    }
    srv?.server.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  return async function page(): Promise<Page> {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    const ws = new WebSocket(
      ((await res.json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl,
    );
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0;
    const waiting = new Map<number, (m: any) => void>();
    const errors: string[] = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data));
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
      if (m.method === 'Runtime.exceptionThrown')
        errors.push(
          m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text,
        );
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        errors.push(m.params.args.map((a: any) => a.value ?? a.description).join(' '));
      if (m.method === 'Page.javascriptDialogOpening')
        void send('Page.handleJavaScriptDialog', { accept: true });
    });
    const send = (method: string, params = {}) =>
      new Promise<any>((r) => {
        waiting.set(++id, (m) => r(m.result));
        ws.send(JSON.stringify({ id, method, params }));
      });
    const ev = async (expression: string) => {
      const r = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails)
        throw new Error(`${expression}: ${r.exceptionDetails.exception?.description}`);
      return r.result.value;
    };
    const mouse = async (type: string, [x, y]: Point, modifiers = 0) => {
      const buttons = type === 'mouseReleased' ? 0 : 1;
      await send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons,
        clickCount: 1,
        modifiers,
      });
    };
    const steps = (a: Point, b: Point, n = 8) =>
      Array.from({ length: n }, (_, k): Point => [
        a[0] + ((b[0] - a[0]) * (k + 1)) / n,
        a[1] + ((b[1] - a[1]) * (k + 1)) / n,
      ]);
    const touch = (type: string, p?: Point) =>
      send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p[0], y: p[1] }] : [] });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Browser.grantPermissions', {
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
    if (o.phone) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 412,
        height: 915,
        deviceScaleFactor: 2,
        mobile: true,
        screenOrientation: { type: 'portraitPrimary', angle: 0 },
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
      });

    const p: Page = {
      base: srv.url,
      errors,
      send,
      ev,
      async until(expression, ms = 5000) {
        const end = Date.now() + ms;
        for (;;) {
          const v = await ev(expression);
          if (v) return v;
          if (Date.now() > end) throw new Error(`timed out: ${expression}`);
          await sleep(50);
        }
      },
      async go(hash) {
        await send('Page.navigate', { url: srv.url + hash });
        await p.until(
          `document.readyState === 'complete' && !!document.querySelector('main')?.children.length`,
        );
        await sleep(200);
      },
      center: (selector) =>
        ev(
          `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`,
        ),
      mouse,
      async drag(a, b) {
        await mouse('mousePressed', a);
        for (const q of steps(a, b)) await mouse('mouseMoved', q);
        await mouse('mouseReleased', b);
        await sleep(300);
      },
      async touchDrag(a, b) {
        await touch('touchStart', a);
        for (const q of steps(a, b)) await touch('touchMove', q);
        await touch('touchEnd');
        await sleep(300);
      },
      offline: (down) => void (srv.state.down = down),
      async key(key, modifiers = 0) {
        const one = key.length === 1;
        const vk = { Enter: 13, Escape: 27 }[key] ?? (one ? key.toUpperCase().charCodeAt(0) : 0);
        const code = one ? `Key${key.toUpperCase()}` : key;
        for (const type of ['keyDown', 'keyUp'])
          await send('Input.dispatchKeyEvent', {
            type,
            key,
            code,
            modifiers,
            windowsVirtualKeyCode: vk,
          });
        await sleep(100);
      },
    };
    return p;
  };
}
