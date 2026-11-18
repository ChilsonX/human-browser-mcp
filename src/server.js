#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BrowserSession } from './browser.js';
import { visual } from './visual.js';
import metadata from '../package.json' with {type:'json'};

const server = new McpServer({name:'human-browser', version:metadata.version}, {
  instructions:'Open or list tabs, observe the relevant region, then batch predictable steps with act. Use wait for visible page receipts. If a step stops, check its outcome before retrying, since earlier steps may already have changed the page.'
});
const browser = new BrowserSession();
const tabId = z.string().regex(/^t\d+$/);
const reply = (text, isError = false) => ({content:[{type:'text', text}], isError});
let queue = Promise.resolve();
function tool(name, description, inputSchema, handler) {
  server.registerTool(name, {description, inputSchema}, args => {
    const result = queue.then(async () => {
      try {
        const out = await handler(args);
        if (out?.content) return out;
        return typeof out === 'string' ? reply(out) : reply(out.text, out.error);
      } catch (err) { return reply(String(err.message).slice(0, 700), true); }
    });
    queue = result.catch(() => {});
    return result;
  });
}

tool('tabs', 'List tabs, open an HTTP(S) URL (tab optional), or give tab for history, reload, focus, close, or native dialogs.', {
  op:z.enum(['list','open','back','forward','reload','focus','close','accept','dismiss']), tab:tabId.optional(), url:z.string().optional(), value:z.string().optional()
}, args => browser.navigate(args));

tool('observe', 'Read controls and visible text with tab-bound refs. Query matches names and enclosing regions. Page with offset. diff compares the last identical view.', {
  tab:tabId, query:z.string().max(300).optional(), offset:z.number().int().min(0).optional(),
  limit:z.number().int().min(1).max(80).optional(), diff:z.boolean().optional()
}, args => browser.observe(args));

const needsValue = new Set(['fill','select','press','upload','wait']);
const step = z.strictObject({
  op:z.enum(['click','hover','check','uncheck','fill','select','press','scroll','wait','download','upload']),
  ref:z.string().optional(), value:z.string().max(16000).optional()
}).superRefine(({op, ref, value}, ctx) => {
  if ((op !== 'wait') !== Boolean(ref) || needsValue.has(op) !== (value !== undefined) || (op !== 'fill' && value === '')) {
    ctx.addIssue({code:'custom', message:'Invalid fields for ' + op + '. Supply ref except for wait; value for fill/select/press/upload/wait.'});
  }
});
tool('act', 'Ordered batch, stops on failure. Use observed refs. select by label; wait for exact visible text; download clicks and saves a file; upload attaches its file ID to a file input. Returns receipts and a view delta.', {
  tab:tabId, steps:z.array(step).min(1).max(16)
}, args => browser.act(args));

const pixel = z.number().int().nonnegative();
tool('visual', 'On demand for canvas or unlabeled controls. View a screenshot, optionally cropped in viewport CSS pixels. Click using its one-use shot ID and image-relative x,y.', {
  tab:tabId, op:z.enum(['view','click']), shot:z.string().optional(), x:pixel.optional(), y:pixel.optional(),
  clip:z.object({x:pixel,y:pixel,width:z.number().int().min(1).max(1600),height:z.number().int().min(1).max(1000)}).optional()
}, args => {
  if (args.op === 'click' ? (!args.shot || args.x === undefined || args.y === undefined || args.clip) :
      (args.shot !== undefined || args.x !== undefined || args.y !== undefined)) {
    throw Error('view takes an optional clip. click requires shot, x and y.');
  }
  return visual(browser, args);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await browser.close(); } finally { await server.close(); }
}
process.stdin.once('end', shutdown);
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
await server.connect(new StdioServerTransport());
