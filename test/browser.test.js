import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, open, ref } from './client.js';
import { compactExport, compactForm, compactUpload } from './tasks.js';
import { startFixture } from './fixture.js';

test('real Chrome via MCP stdio', async t => {
  const site = await startFixture();
  t.after(site.close);
  const c = await connect();
  t.after(c.close);
  const {tools} = await c.client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(),['act','observe','tabs','visual']);
  let file;
  await t.test('export only the filtered sales report', async () => {file = await compactExport(c,site);});
  await t.test('complete a dependent form', async () => compactForm(c,site));
  await t.test('upload the saved bytes in another tab', async () => compactUpload(c,site,file));
  await t.test('stop on detached, wrong-tab and expired references', async () => {
    const tab = await open(c,site.url + '/edge');
    const view = await c.call('observe',{tab});
    const target = ref(view,'目标','button');
    const replacement = ref(view,'替换控件','button');
    const stale = await c.request('act',{tab,steps:[{op:'click',ref:replacement},{op:'click',ref:target},{op:'click',ref:replacement}]});
    assert.ok(stale.error); assert.match(stale.text,/Stopped at step 2/);
    const other = await open(c,site.url + '/edge');
    assert.ok((await c.request('act',{tab:other,steps:[{op:'click',ref:target}]})).error);
    await c.call('tabs',{op:'open',tab,url:site.url + '/edge'});
    assert.ok((await c.request('act',{tab,steps:[{op:'click',ref:target}]})).error);
    assert.equal(site.state.touched,0);
  });
  await t.test('native dialog stops batch until explicit decision', async () => {
    const tab = await open(c,site.url + '/edge');
    const view = await c.call('observe',{tab});
    const blocked = await c.request('act',{tab,steps:[{op:'click',ref:ref(view,'询问','button')},{op:'click',ref:ref(view,'目标','button')}]});
    assert.ok(blocked.error); assert.match(blocked.text,/Native dialog/);
    assert.match(await c.call('tabs',{op:'list'}),/是否继续/);
    await c.call('tabs',{op:'dismiss',tab});
    assert.equal(site.state.touched,0);
  });
  await t.test('web modal blocks background actions and can be closed by ref', async () => {
    const tab = await open(c,site.url + '/edge');
    const view = await c.call('observe',{tab});
    const blocked = await c.request('act',{tab,steps:[{op:'click',ref:ref(view,'显示对话框','button')},{op:'click',ref:ref(view,'目标','button')}]});
    assert.ok(blocked.error);
    const modal = await c.call('observe',{tab,query:'操作提示'});
    await c.call('act',{tab,steps:[{op:'click',ref:ref(modal,'关闭提示','button')}]});
    assert.equal(site.state.touched,0);
  });
  await t.test('bounded views, pagination and unchanged delta', async () => {
    const tab = await open(c,site.url + '/reports');
    const args = {tab,query:'历史归档',limit:3};
    assert.match(await c.call('observe',args),/next offset=3/);
    assert.match(await c.call('observe',{...args,diff:true}),/diff [^\n]+$/);
    const next = await c.call('observe',{...args,offset:3});
    assert.match(next,/next offset=6/);
  });
  await t.test('history, reload, focus, hover and repeatable checkbox actions', async () => {
    const tab = await open(c,site.url + '/form');
    await c.call('tabs',{tab,op:'open',url:site.url + '/visual'});
    assert.match(await c.call('tabs',{tab,op:'back'}),/\/form$/);
    assert.match(await c.call('tabs',{tab,op:'forward'}),/\/visual$/);
    await c.call('tabs',{tab,op:'reload'});
    await c.call('tabs',{tab,op:'focus'});
    const view = await c.call('observe',{tab});
    const checkbox = ref(view,'显示标签','checkbox');
    const checked = await c.call('act',{tab,steps:[{op:'check',ref:checkbox},{op:'check',ref:checkbox}]});
    assert.match(checked,/checkbox 显示标签 checked/);
    const current = await c.call('observe',{tab});
    const after = await c.call('act',{tab,steps:[
      {op:'uncheck',ref:ref(current,'显示标签','checkbox')},
      {op:'hover',ref:ref(current,'预览','button')}, {op:'wait',value:'已打开预览'}
    ]});
    assert.match(after,/unchecked/);
  });
  await t.test('visual clicks are crop-relative, tab-bound, single-use and image-checked', async () => {
    const tab = await open(c,site.url + '/visual');
    const other = await open(c,site.url + '/visual');
    const capture = async () => {
      const result = await c.client.callTool({name:'visual',arguments:{tab,op:'view',clip:{x:100,y:20,width:100,height:80}}});
      assert.equal(result.content[1]?.mimeType,'image/png');
      const png = Buffer.from(result.content[1].data,'base64');
      assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)], [100,80]);
      return result.content[0].text.match(/shot (\S+)/)[1];
    };
    const shot = await capture();
    const click = {op:'click',shot,x:40,y:40};
    assert.ok((await c.request('visual',{...click,tab:other})).error);
    await c.call('visual',{...click,tab});
    assert.ok((await c.request('visual',{...click,tab})).error);
    assert.match(await c.call('observe',{tab,query:'已选蓝色'}),/1 matched/);
    const next = await capture();
    const controls = await c.call('observe',{tab:other});
    await c.call('act',{tab:other,steps:[{op:'click',ref:ref(controls,'改变画布颜色','button')}]});
    const stale = await c.request('visual',{...click,tab,shot:next});
    assert.ok(stale.error); assert.match(stale.text,/changed/);
    const outside = await c.request('visual',{...click,tab,shot:await capture(),x:100});
    assert.ok(outside.error);
  });
});
