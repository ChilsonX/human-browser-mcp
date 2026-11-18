import { chromium } from 'playwright-core';
import { EventEmitter } from 'node:events';
import { mkdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactRows, selectRows, compareLines, formatLines } from './view.js';

const defaultDownloads = fileURLToPath(new URL('../.browser-data/downloads/', import.meta.url));
const short = (text, len = 180) => String(text).replace(/\s+/g, ' ').trim().slice(0, len);
const deadline = 6000;
const dialogInfo = d => d.type() + ' ' + short(d.message());
const modalSelector = 'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';

export class BrowserSession {
  tabs = new Map();
  files = new Map();
  nextTab = 1;

  async start() {
    if (this.browser?.isConnected()) return;
    const endpoint = process.env.BROWSER_CDP_URL;
    if (endpoint) {
      const u = new URL(endpoint);
      if (!['http:', 'ws:'].includes(u.protocol) || !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw Error('Expected a local Chrome debugging endpoint.');
      this.browser = await chromium.connectOverCDP(endpoint);
      this.context = this.browser.contexts()[0];
    } else {
      this.browser = await chromium.launch({
        channel: process.env.BROWSER_EXECUTABLE ? undefined : 'chrome',
        executablePath: process.env.BROWSER_EXECUTABLE || undefined,
        chromiumSandbox: true, headless: process.env.BROWSER_HEADLESS === '1', timeout:15000
      });
      this.context = await this.browser.newContext({ acceptDownloads: true });
    }
    this.context.on('page', page => this.track(page));
    for (const page of this.context.pages()) this.track(page);
  }

  track(page) {
    if ([...this.tabs.values()].some(t => t.page === page)) return;
    const id = 't' + this.nextTab++;
    const t = {id, page, epoch: 0, shotNumber: 0, issued: new Map(), events: new EventEmitter()};
    this.tabs.set(id, t);
    page.on('close', () => this.tabs.delete(id));
    page.on('framenavigated', () => {
      t.epoch++;
      t.issued.clear();
      t.last = undefined;
      t.shot = undefined;
    });
    page.on('dialog', d => {
      t.dialog = d;
      t.events.emit('dialog', d);
    });
    return t;
  }

  tab(id) {
    const t = this.tabs.get(id);
    if (!t || t.page.isClosed()) throw Error('Unknown or closed tab. List tabs again.');
    return t;
  }

  async navigate({op, tab, url, value}) {
    await this.start();
    if (op === 'list') return [...this.tabs.values()].map(t => t.id + ' ' + short(t.page.url()) + (t.dialog ? ' | ' + dialogInfo(t.dialog) : '')).join('\n') || 'No tabs. Use open.';
    if (op === 'accept' || op === 'dismiss') {
      const t = this.tab(tab);
      if (!t.dialog) throw Error('No native dialog in this tab.');
      const dialog = t.dialog;
      if (op === 'accept') await dialog.accept(value);
      else await dialog.dismiss();
      if (t.dialog === dialog) t.dialog = undefined;
      return tab + ' dialog resolved. Observe before continuing.';
    }
    if (op === 'close') {
      await this.tab(tab).page.close();
      return tab + ' closed';
    }
    if (['back', 'forward', 'reload', 'focus'].includes(op)) {
      const t = this.tab(tab);
      if (op === 'focus') {
        await t.page.bringToFront();
        return tab + ' focused';
      }
      const method = {back:'goBack', forward:'goForward', reload:'reload'}[op];
      await this.interruptible(t, signal => t.page[method]({waitUntil:'domcontentloaded', timeout:15000, signal}));
      return tab + ' ' + short(t.page.url());
    }
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('Use an HTTP(S) URL.');
    let t;
    if (tab) t = this.tab(tab);
    else {
      const page = await this.context.newPage();
      t = [...this.tabs.values()].find(item => item.page === page) || this.track(page);
    }
    try {
      await this.interruptible(t, () => t.page.goto(parsed.href, {waitUntil: 'domcontentloaded', timeout: 15000}));
    } catch (err) {
      throw Error(t.id + ': ' + short(err.message) + '. Observe the tab before retrying.');
    }
    return t.id + ' ' + short(t.page.url());
  }

  async interruptible(t, action) {
    if (t.dialog) throw Error('Native dialog: ' + dialogInfo(t.dialog) + '. Use tabs accept/dismiss.');
    const controller = new AbortController();
    let interrupt;
    const interrupted = new Promise((_, reject) => {
      interrupt = d => {
        const error = Error('Native dialog: ' + dialogInfo(d) + '. Use tabs accept/dismiss.');
        reject(error);
        controller.abort(error);
      };
      t.events.once('dialog', interrupt);
    });
    try { return await Promise.race([action(controller.signal), interrupted]); }
    finally { t.events.off('dialog', interrupt); }
  }

  async observe({tab, query = '', limit = 24, offset = 0, diff = false}) {
    const t = this.tab(tab);
    const epoch = t.epoch;
    const tree = await this.interruptible(t, () => t.page.ariaSnapshotJSON({mode:'ai', timeout:deadline}));
    if (t.epoch !== epoch) throw Error('Page changed during observation. Observe again.');
    const rows = compactRows(tree, tab + '.' + epoch + '.');
    const {slice, lines, total, next} = selectRows(rows, {query, limit, offset});
    // A long-lived SPA can remove thousands of controls without navigating.
    const live = new Set(rows.map(row => row.ref));
    for (const ref of t.issued.keys()) if (!live.has(ref)) t.issued.delete(ref);
    for (const row of slice) if (row.ref) t.issued.set(row.ref, row.raw);
    const key = JSON.stringify([query, limit, offset]);
    const isDiff = diff && t.last?.key === key;
    const output = isDiff ? compareLines(t.last.lines, lines) : lines;
    t.last = {key, lines, query, limit, offset};
    const header = tab + ' ' + (isDiff ? 'diff' : 'view') + ' ' + total + ' matched' + (next === undefined ? '' : ' | next offset=' + next);
    return [header, ...formatLines(output)].join('\n');
  }

  target(t, ref) {
    if (!t.issued.has(ref)) throw Error('Stale, unseen or wrong-tab ref. Observe the target region again.');
    return t.page.getByRef(t.issued.get(ref));
  }

  async perform(t, {op, ref, value}, signal) {
    const opts = {timeout:deadline, signal};
    if (op === 'wait') {
      await t.page.getByText(value, {exact:true}).filter({visible:true}).first().waitFor({state:'visible', ...opts});
      return 'visible ' + short(value);
    }
    const loc = this.target(t, ref);
    if (await loc.count() !== 1) throw Error('Target changed. Observe the target region again.');
    const modal = t.page.locator(modalSelector).filter({visible:true}).last();
    if (await modal.count() && !await loc.evaluate((el, selector) => {
      const active = [...el.ownerDocument.querySelectorAll(selector)].filter(n => n.getClientRects().length).at(-1);
      return active?.contains(el);
    }, modalSelector, opts)) throw Error('A modal is open. Observe its controls before continuing.');
    signal.throwIfAborted();
    switch (op) {
      case 'click': await loc.click(opts); return 'clicked';
      case 'hover': await loc.hover(opts); return 'hovered';
      case 'check':
      case 'uncheck':
        await loc.setChecked(op === 'check', opts);
        return op === 'check' ? 'checked' : 'unchecked';
      case 'fill': await loc.fill(value, opts); return 'filled';
      case 'select': {
        await loc.selectOption({label:value}, opts);
        return 'selected ' + short(value);
      }
      case 'press': await loc.press(value, opts); return 'pressed ' + short(value);
      case 'scroll': await loc.scrollIntoViewIfNeeded(opts); return 'in view';
      case 'download': {
        const [download] = await Promise.all([t.page.waitForEvent('download', opts), loc.click(opts)]);
        signal.throwIfAborted();
        const id = 'f' + (this.files.size + 1);
        const folder = resolve(process.env.BROWSER_DOWNLOAD_DIR || defaultDownloads, randomUUID());
        await mkdir(folder, {recursive:true});
        const name = basename(download.suggestedFilename()).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '') || 'download';
        const path = join(folder, name);
        await download.saveAs(path);
        const {size} = await stat(path);
        this.files.set(id, {path, name, size});
        return 'saved ' + id + ' ' + name + ' (' + size + ' bytes) ' + path;
      }
      case 'upload': {
        const file = this.files.get(value);
        if (!file) throw Error('Unknown download ID. Use a file saved in this MCP session.');
        await loc.setInputFiles(file.path, opts);
        return 'attached ' + file.name + ' (' + file.size + ' bytes); verify any server receipt separately';
      }
    }
  }

  async act({tab, steps}) {
    const t = this.tab(tab);
    t.shot = undefined;
    const done = [];
    const knownTabs = new Set(this.tabs.keys());
    const prior = t.last;
    for (let i = 0; i < steps.length; i++) {
      try {
        const receipt = await this.interruptible(t, signal => this.perform(t, steps[i], signal));
        done.push((i+1) + ' ' + receipt);
        const opened = [...this.tabs.keys()].filter(id => !knownTabs.has(id));
        if (opened.length) {
          done.push('Opened ' + opened.join(', ') + '. Stopped batch; observe intended tab.');
          if (i + 1 < steps.length) return {error:true, text:done.join('\n')};
          break;
        }
      } catch (err) {
        return {error:true, text: [...done, 'Stopped at step ' + (i+1) + ' (' + steps[i].op + '): ' + short(err.message, 320), 'Later steps skipped. Inspect before retrying this step.'].join('\n')};
      }
    }
    if (prior && prior === t.last) {
      try { done.push(await this.observe({tab, query:prior.query, limit:prior.limit, offset:prior.offset, diff:true})); }
      catch (err) { done.push('View unavailable: ' + short(err.message)); }
    } else done.push('Observe ' + tab + ' for its current view.');
    return {text:done.join('\n')};
  }

  async close() {
    // Playwright disconnects a connectOverCDP client; only a locally launched browser is terminated.
    await this.browser?.close();
  }
}
