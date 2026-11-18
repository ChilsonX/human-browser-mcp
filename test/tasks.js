import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { open, ref } from './client.js';
import { csv } from './fixture.js';

export async function compactExport(c, site) {
  const tab = await open(c,site.url + '/reports');
  const view = await c.call('observe',{tab,query:'销售明细'});
  const done = await c.call('act',{tab,steps:[
    {op:'select',ref:ref(view,'日期范围','combobox'),value:'上月'},
    {op:'wait',value:'已应用上月'}, {op:'download',ref:ref(view,'导出','link')}
  ]});
  const saved = done.match(/saved (f\d+) sales-last\.csv \(\d+ bytes\) (.+)/);
  assert.ok(saved,done);
  assert.equal(await readFile(saved[2], 'utf8'),csv);
  assert.equal(site.state.downloads.at(-1),'sales-last.csv');
  return saved[1];
}
export async function compactForm(c, site) {
  const tab = await open(c,site.url + '/form');
  const view = await c.call('observe',{tab,query:'配送地址'});
  await c.call('act',{tab,steps:[
    {op:'select',ref:ref(view,'省份','combobox'),value:'浙江'}, {op:'wait',value:'城市已加载'},
    {op:'select',ref:ref(view,'城市','combobox'),value:'杭州'},
    {op:'fill',ref:ref(view,'收件人','textbox'),value:'林青'},
    {op:'click',ref:ref(view,'保存地址','button')}, {op:'wait',value:'地址已保存'}
  ]});
  assert.deepEqual(site.state.addresses.at(-1),['浙江','杭州','林青']);
}
export async function compactUpload(c, site, file) {
  const tab = await open(c,site.url + '/import');
  const view = await c.call('observe',{tab,query:'上传报表'});
  await c.call('act',{tab,steps:[
    {op:'upload',ref:ref(view,'报表文件','button'),value:file},
    {op:'click',ref:ref(view,'提交文件','button')}, {op:'wait',value:'文件已接收'}
  ]});
  assert.deepEqual(site.state.uploads.at(-1),['sales-last.csv',csv]);
}
