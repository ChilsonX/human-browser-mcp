import { createHash } from 'node:crypto';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const viewport = (page) => page.evaluate(() => ({
  width: innerWidth, height: innerHeight, scrollX, scrollY,
  scale: visualViewport?.scale ?? 1
}));

export async function visual(session, {tab, op, clip, shot, x, y}) {
  const t = session.tab(tab);
  return session.interruptible(t, async signal => {
    const prior = t.shot;
    const epoch = t.epoch;
    if (op === 'click' && (!prior || prior.id !== shot)) {
      throw Error('Stale or wrong-tab screenshot. Take a new visual view.');
    }
    t.shot = undefined;
    const state = await viewport(t.page);
    if (state.scale !== 1) throw Error('Use desktop viewport scale for visual mode.');
    const rect = op === 'click' ? prior.rect : clip ?? {
      x:0, y:0, width:Math.min(state.width, 1600), height:Math.min(state.height, 1000)
    };
    if (rect.x + rect.width > state.width || rect.y + rect.height > state.height) {
      throw Error('Image region is outside the current viewport.');
    }
    if (op === 'click' && (x >= rect.width || y >= rect.height || prior.state !== JSON.stringify(state))) {
      throw Error('Coordinates outside the image or viewport changed. Capture again.');
    }
    const image = await t.page.screenshot({type:'png', scale:'css', clip:rect, timeout:6000, signal});
    if (t.epoch !== epoch || JSON.stringify(await viewport(t.page)) !== JSON.stringify(state)) {
      throw Error('Page moved during capture. Capture again.');
    }
    const hash = digest(image);
    if (op === 'click') {
      if (hash !== prior.hash) throw Error('Image changed since capture. Capture again.');
      const point = {x:rect.x + x, y:rect.y + y};
      const allowed = await t.page.evaluate(({x, y}) => {
        const modals = document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
        const modal = [...modals].filter(el => el.checkVisibility()).at(-1);
        return !modal || modal.contains(document.elementFromPoint(x, y));
      }, point);
      if (!allowed) throw Error('A modal is open. Choose a point inside it.');
      signal.throwIfAborted();
      await t.page.mouse.click(point.x, point.y);
      return 'Clicked. Observe the outcome before continuing.';
    }
    const id = tab + '-v' + (++t.shotNumber);
    t.shot = {id, hash, rect, state:JSON.stringify(state)};
    return {content:[
      {type:'text', text:`shot ${id} | ${rect.width}x${rect.height} at (${rect.x},${rect.y}) | click relative to image`},
      {type:'image', mimeType:'image/png', data:image.toString('base64')}
    ]};
  });
}
