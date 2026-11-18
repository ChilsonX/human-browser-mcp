import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const csv = '\uFEFF月份,地区,销售额\r\n上月,上海,1200\r\n';
const noise = Array.from({length:30}, (_,i) => '<a href="#archive-' + i + '">历史归档 ' + (2020 + Math.floor(i/6)) + ' 年第 ' + (i%6+1) + ' 期</a>').join(' ');
const style = 'body{font:16px/1.6 system-ui,sans-serif;max-width:850px;margin:4rem auto;padding:0 1rem;color:#18352f}h1{font-size:2rem}section,form{border-top:1px solid #abc2b5;padding:1rem 0}label,button,select,input{margin:0 .6rem .4rem 0}button,select,input{font:inherit}a{color:#236450}nav{font-size:.85rem;margin-top:3rem}';
function html(title, body, script = '') {
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + title + '</title><style>' + style + '</style><main><h1>' + title + '</h1>' + body + '</main><nav aria-label="历史归档">' + noise + '</nav><script>' + script + '</script></html>';
}
const reports = html('报表中心', `
  <section aria-label="库存明细"><h2>库存明细</h2><a href="/file/inventory.csv" download>导出</a></section>
  <section aria-label="销售明细"><h2>销售明细</h2><label>日期范围 <select id="period"><option>本月</option><option>上月</option></select></label>
  <span id="periodState" role="status">已应用本月</span> <a id="exportLink" href="/file/current.csv" download>导出</a></section>
  <a href="/import" target="_blank">打开导入中心</a>`,
  "period.onchange=()=>{periodState.textContent='正在筛选';setTimeout(()=>{periodState.textContent='已应用'+period.value;exportLink.href=period.value==='上月'?'/file/sales-last.csv':'/file/current.csv'},100)}");
const form = html('配送设置', `
  <form aria-label="配送地址" id="address"><label>省份 <select id="province"><option>请选择</option><option>浙江</option></select></label>
  <label>城市 <select id="city" disabled><option>请选择</option></select></label>
  <label>收件人 <input id="recipient" required></label><button type="submit">保存地址</button>
  <p role="status" id="state">待选择省份</p></form>`,
  "province.onchange=()=>{setTimeout(()=>{city.innerHTML='<option>请选择</option><option>杭州</option>';city.disabled=false;state.textContent='城市已加载'},120)};address.onsubmit=async e=>{e.preventDefault();const r=await fetch('/address',{method:'POST',body:JSON.stringify([province.value,city.value,recipient.value])});state.textContent=r.ok?'地址已保存':'保存失败'}");
const importer = html('导入中心', `
  <form aria-label="上传报表" id="sendFile"><label>报表文件 <input id="attachment" type="file" required></label>
  <button>提交文件</button><p role="status" id="receipt">等待文件</p></form>`,
  "sendFile.onsubmit=async e=>{e.preventDefault();const f=attachment.files[0];const r=await fetch('/upload?name='+encodeURIComponent(f.name),{method:'POST',body:f});receipt.textContent=r.ok?'文件已接收':'文件不匹配'}");
const edge = html('引用测试', `
  <button id="original" onclick="fetch('/touched',{method:'POST'})">目标</button>
  <button onclick="original.replaceWith(original.cloneNode(true))">替换控件</button>
  <button onclick="confirm('是否继续？')">询问</button>
  <button onclick="overlay.showModal()">显示对话框</button>
  <dialog id="overlay" aria-label="操作提示"><button onclick="overlay.close()">关闭提示</button></dialog>`);

const visualPage = html('画布工作台', `
  <canvas id="board" width="180" height="80" style="position:fixed;left:20px;top:20px" aria-label="色板"></canvas>
  <p role="status" id="choice">等待选择颜色</p>
  <label><input type="checkbox" id="labels">显示标签</label>
  <button id="preview">预览</button>
  <button id="repaint">改变画布颜色</button>`, `
  const brush = board.getContext('2d');
  brush.fillStyle = '#236450'; brush.fillRect(0,0,90,80);
  brush.fillStyle = '#3465a4'; brush.fillRect(90,0,90,80);
  board.onclick = e => { choice.textContent = e.offsetX < 90 ? '已选绿色' : '已选蓝色'; };
  preview.onmouseenter = () => { choice.textContent = '已打开预览'; };
  const channel = new BroadcastChannel('palette');
  repaint.onclick = () => channel.postMessage('change');
  channel.onmessage = () => { brush.fillStyle = '#bb4422'; brush.fillRect(0,0,90,80); choice.textContent = '画布已更新'; };
`);

export async function startFixture(port = 0) {
  const state = {downloads:[], uploads:[], addresses:[], touched:0};
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const pages = {'/':reports,'/reports':reports,'/form':form,'/import':importer,'/edge':edge,'/visual':visualPage};
    if (Object.hasOwn(pages, path)) { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(pages[path]); return; }
    if (path.startsWith('/file/')) {
      const name = path.slice(6);
      state.downloads.push(name);
      res.writeHead(200, {'Content-Type':'text/csv', 'Content-Disposition':'attachment; filename="' + name.replace(/[^\w.-]/g,'_') + '"'});
      res.end(name === 'sales-last.csv' ? csv : 'different report');
      return;
    }
    if (req.method === 'POST') {
      if (!['/touched','/upload','/address'].includes(path)) {
        res.writeHead(404); res.end(); return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString();
      if (path === '/touched') state.touched++;
      if (path === '/upload') {
        state.uploads.push([url.searchParams.get('name'), body]);
        if (body !== csv || url.searchParams.get('name') !== 'sales-last.csv') res.statusCode = 422;
      }
      if (path === '/address') {
        try { state.addresses.push(JSON.parse(body)); }
        catch { res.writeHead(400); res.end(); return; }
      }
      res.end(); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok, fail) => {server.once('error',fail); server.listen(port, '127.0.0.1', ok);});
  return {state, url:'http://127.0.0.1:' + server.address().port, close:() => new Promise(ok => server.close(ok))};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const site = await startFixture(4173);
  console.log(site.url + '/reports\n' + site.url + '/form\n' + site.url + '/import');
}
