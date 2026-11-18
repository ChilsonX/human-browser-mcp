const contexts = new Set(['region', 'form', 'dialog', 'alertdialog', 'navigation', 'main', 'group', 'table', 'row', 'listitem']);
const controls = new Set(['button','link','textbox','searchbox','combobox','listbox','option','checkbox','radio','switch','slider','spinbutton','tab','menuitem','treeitem']);
const clip = (s, length = 180) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, length);

// Keep text and controls searchable together with the region that gives them meaning.
export function compactRows(tree, prefix) {
  const rows = [];
  function visitSiblings(nodes, ancestors) {
    const headings = [];
    for (const node of nodes) {
      if (node?.role === 'heading') {
        const level = Number(node.level) || 2;
        while (headings.length && headings.at(-1).level >= level) headings.pop();
        visit(node, ancestors);
        const name = clip(node.name || node.text);
        if (name && !ancestors.includes(name)) headings.push({name, level});
      } else {
        visit(node, [...ancestors, ...headings.map(h => h.name)]);
      }
    }
  }
  function visit(node, ancestors) {
    if (typeof node === 'string') node = { role: 'text', text: node };
    const name = clip(node.name || node.text || node.placeholder);
    const role = node.role;
    let group = ancestors;
    if (contexts.has(role) && name) group = [...ancestors, name];
    const clickable = controls.has(role) || node.cursor === 'pointer';
    if (clickable || (name && (['heading','text','status','alert','cell','generic','paragraph'].includes(role) || contexts.has(role)))) {
      const ref = node.ref ? prefix + node.ref : undefined;
      const flags = ['disabled','checked','selected','expanded','invalid','pressed'].filter(k => node[k] !== undefined && node[k] !== false);
      const value = node.name && node.text && node.text !== node.name ? clip(node.text) : '';
      const options = role === 'combobox' || role === 'listbox' ? (node.children || []).filter(n => n.role === 'option') : [];
      const menu = options.slice(0, 12).map(n => clip(n.name || n.text, 70) + (n.selected ? ' ✓' : ''));
      if (options.length > menu.length) menu.push('…');
      const line = [ref, role, name, value && '=' + value, ...flags, menu.length && '(' + menu.join(' | ') + ')'].filter(Boolean).join(' ');
      rows.push({ref, line, path: ancestors.join(' › '), raw: node.ref});
    }
    const children = (node.children || []).filter(child => child.role !== 'option' || !['combobox','listbox'].includes(role) || (node.children || []).length > 12);
    visitSiblings(children, group);
  }
  visitSiblings(Array.isArray(tree) ? tree : [tree], []);
  return rows;
}

export function selectRows(rows, { query = '', offset = 0, limit = 24 }) {
  const term = query.trim().toLowerCase();
  const filtered = rows.filter(row => (row.path + ' ' + row.line).toLowerCase().includes(term));
  const slice = filtered.slice(offset, offset + limit);
  const lines = slice.map(row => row.path + '\t' + row.line);
  return {slice, lines, total: filtered.length, next: offset + limit < filtered.length ? offset + limit : undefined};
}

// Group shared context on the wire, but retain it on every row when computing deltas.
export function formatLines(lines) {
  const output = [];
  let previous;
  for (const line of lines) {
    const fields = /^(\+ |− )?(.*?)\t(.*)$/.exec(line);
    if (!fields) { output.push(line); previous = undefined; continue; }
    const [, sign = '', path, text] = fields;
    if (path !== previous && (path || previous)) output.push(path ? '[' + path + ']' : '[page]');
    output.push(sign + text);
    previous = path;
  }
  return output;
}

export function compareLines(before, after) {
  const old = new Map(), current = new Map();
  const count = (list, counts) => list.forEach(line => counts.set(line, (counts.get(line) || 0) + 1));
  count(before, old);
  count(after, current);
  const changes = [];
  for (const [previous, other, sign] of [[old, current, '− '], [current, old, '+ ']]) {
    for (const [line, n] of previous) {
      for (let i = other.get(line) || 0; i < n; i++) changes.push(sign + line);
    }
  }
  if (!changes.length && before.some((line, index) => line !== after[index])) return ['Order changed', ...after];
  return changes;
}
