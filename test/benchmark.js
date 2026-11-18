import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { connect } from './client.js';
import { startFixture, csv } from './fixture.js';
import { compactExport, compactForm, compactUpload } from './tasks.js';

function target(view, role, name, region) {
  const source = region ? view.slice(view.indexOf('region "' + region + '"')) : view;
  const line = source.split('\n').find(l => l.includes(role + ' "' + name + '"') && l.includes('[ref='));
  assert.ok(line, 'Missing ' + name + ' in ' + view.slice(0,2800));
  return line.match(/\[ref=([^\]]+)\]/)[1];
}
async function standardExport(c, site) {
  await c.call('browser_tabs',{action:'new',url:site.url + '/reports'});
  const view = await c.call('browser_find',{regex:'日期范围|导出'});
  const changed = await c.call('browser_select_option',{target:target(view,'combobox','日期范围'),values:['上月']});
  if (!changed.includes('已应用上月')) await c.call('browser_wait_for',{text:'已应用上月'});
  const receipt = await c.call('browser_click',{target:target(view,'link','导出','销售明细')});
  let saved;
  for (let i = 0; i < 60 && !saved; i++) {
    const files = await readdir(c.dir,{recursive:true});
    saved = files.find(f => f.endsWith('sales-last.csv'));
    if (!saved) await delay(50);
  }
  assert.ok(saved,'Missing downloaded file: ' + receipt.slice(0,1400));
  const path = join(c.dir,saved);
  assert.equal(await readFile(path,'utf8'),csv);
  assert.equal(site.state.downloads.at(-1),'sales-last.csv');
  return path;
}
async function standardForm(c, site) {
  await c.call('browser_tabs',{action:'new',url:site.url + '/form'});
  const view = await c.call('browser_find',{regex:'省份|城市|收件人|保存地址'});
  await c.call('browser_fill_form',{fields:[['combobox','省份','浙江'],['combobox','城市','杭州'],['textbox','收件人','林青']].map(([type,name,value])=>({type,name,value,target:target(view,type,name)}))});
  const receipt = await c.call('browser_click',{target:target(view,'button','保存地址')});
  if (!receipt.includes('地址已保存')) await c.call('browser_wait_for',{text:'地址已保存'});
  assert.deepEqual(site.state.addresses.at(-1),['浙江','杭州','林青']);
}
async function standardUpload(c, site, path) {
  let view = await c.call('browser_tabs',{action:'new',url:site.url + '/import'});
  if (!view.includes('报表文件')) view = await c.call('browser_find',{regex:'报表文件|提交文件'});
  await c.call('browser_click',{target:target(view,'button','报表文件')});
  await c.call('browser_file_upload',{paths:[path]});
  const receipt = await c.call('browser_click',{target:target(view,'button','提交文件')});
  if (!receipt.includes('文件已接收')) await c.call('browser_wait_for',{text:'文件已接收'});
  assert.deepEqual(site.state.uploads.at(-1),['sales-last.csv',csv]);
}

async function run(kind) {
  const site = await startFixture();
  const c = await connect(kind);
  try {
    // Warm both products before timing. Use a fresh fixture and browser for each run.
    if (kind === 'compact') await c.call('tabs',{op:'open',url:site.url + '/'});
    else await c.call('browser_navigate',{url:site.url + '/'});
    c.traces.length = 0;
    const {tools} = await c.client.listTools();
    const schemaTokens = encode(JSON.stringify(tools)).length;
    const start = performance.now();
    if (kind === 'compact') {
      const file = await compactExport(c,site);
      await compactForm(c,site);
      await compactUpload(c,site,file);
    } else {
      const file = await standardExport(c,site);
      await standardForm(c,site);
      await standardUpload(c,site,file);
    }
    const ms = Math.round(performance.now() - start);
    let requestTokens = 0, replyTokens = 0;
    for (const {name,args,text} of c.traces) {
      requestTokens += encode(JSON.stringify({name,arguments:args})).length;
      replyTokens += encode(text).length;
    }
    return {kind,calls:c.traces.length,requestTokens,replyTokens,ioTokens:requestTokens+replyTokens,ms,schemaTokens};
  } finally { await c.close(); await site.close(); }
}
const runs = Number(process.env.BENCH_RUNS || 3);
assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 20);
for (let i = 0; i < runs; i++) {
  for (const kind of i % 2 ? ['playwright','compact'] : ['compact','playwright']) {
    console.log(JSON.stringify({run:i+1,...await run(kind)}));
  }
}
