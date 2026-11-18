import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function connect(kind = 'compact') {
  const dir = await mkdtemp(join(tmpdir(), 'human-browser-'));
  const baseArgs = ['--headless','--sandbox','--isolated','--browser','chrome','--output-dir',dir,'--codegen','none'];
  if (process.env.BROWSER_EXECUTABLE) baseArgs.push('--executable-path',process.env.BROWSER_EXECUTABLE);
  const args = kind === 'compact' ? [join(root,'src/server.js')] : [join(root,'node_modules/@playwright/mcp/cli.js'), ...baseArgs];
  const client = new Client({name:'browser-probe',version:'0.1.0'});
  const transport = new StdioClientTransport({command:process.execPath, args, cwd:dir,
    env:{BROWSER_HEADLESS:'1', BROWSER_DOWNLOAD_DIR:dir, ...(process.env.BROWSER_EXECUTABLE && {BROWSER_EXECUTABLE:process.env.BROWSER_EXECUTABLE})}});
  await client.connect(transport);
  const traces = [];
  async function request(name, args) {
    const result = await client.callTool({name, arguments:args});
    const text = result.content.map(x => x.text).join('\n');
    traces.push({name,args,text});
    if (process.env.TRACE_BROWSER) console.error(name, args, text);
    return {error:result.isError, text};
  }
  async function call(name,args) {
    const {error,text} = await request(name,args);
    assert.ok(!error && !/^### Error/m.test(text), text);
    return text;
  }
  return {client, dir, call, request, traces, close:() => client.close()};
}
export function ref(text, label, role) {
  const line = text.split('\n').find(l => l.includes(' ' + role + ' ' + label) && /t\d+\.\d+\.(?:f\d+)?e\d+/.test(l));
  assert.ok(line, 'Missing ' + role + ' ' + label + ' in:\n' + text);
  return line.match(/t\d+\.\d+\.(?:f\d+)?e\d+/)[0];
}
export async function open(c, url) {
  return (await c.call('tabs',{op:'open',url})).split(' ')[0];
}
