// Bộ vẽ mô hình thực thể kết hợp (Merise): dùng chung cho erd-do-thi.html và erd-ca-nhan.html.
// Đầu vào: E (thực thể), A (mối kết hợp). Thuộc tính bắt đầu bằng '*' là khóa chính.
document.fonts.ready.then(() => {
  const svg = document.getElementById('s'), NS = 'http://www.w3.org/2000/svg';
  const mk = (t, a, txt, parent) => {
    const e = document.createElementNS(NS, t);
    for (const k in a) e.setAttribute(k, a[k]);
    if (txt !== undefined) e.textContent = txt;
    (parent || svg).appendChild(e);
    return e;
  };
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = 'italic 12.5px "Be Vietnam Pro", sans-serif';
  const HEAD = 34, ROW = 20;
  const ent = {};
  E.forEach(e => { e.h = HEAD + e.a.length * ROW + 10; e.cx = e.x + e.w / 2; e.cy = e.y + e.h / 2; ent[e.id] = e; });
  A.forEach(a => {
    a.w = Math.max(54, ctx.measureText(a.n).width + 28);
    a.props = a.props || [];
    a.h = a.props.length ? 30 + a.props.length * 18 + 6 : 30;
  });

  // Giao điểm của đoạn thẳng (từ ngoài vào tâm hình chữ nhật) với biên hình chữ nhật.
  const clip = (e, fx, fy) => {
    const dx = e.cx - fx, dy = e.cy - fy;
    const tx = dx ? ((dx > 0 ? e.x : e.x + e.w) - fx) / dx : -Infinity;
    const ty = dy ? ((dy > 0 ? e.y : e.y + e.h) - fy) / dy : -Infinity;
    const t = Math.max(tx, ty);
    return [fx + dx * t, fy + dy * t];
  };

  const labels = [];
  A.forEach(a => {
    a.l.forEach(k => {
      const e = ent[k.e];
      const p = k.p || clip(e, a.x, a.y);
      mk('line', { class: 'l', x1: a.x, y1: a.y, x2: p[0], y2: p[1] });
      // Nhãn bản số: cách biên thực thể 24 px về phía mối kết hợp, lệch ngang 11 px.
      let vx = a.x - p[0], vy = a.y - p[1];
      const len = Math.hypot(vx, vy) || 1;
      vx /= len; vy /= len;
      const off = k.d ? 0 : 1;
      const bx = p[0] + vx * 26 + (-vy) * 12 * off + (k.d ? 12 : 0);
      const by = p[1] + vy * 26 + (vx) * 12 * off + (k.d ? -4 : 0);
      labels.push([bx, by, k.c]);
    });
  });

  E.forEach(e => {
    mk('rect', { class: 'eb', x: e.x, y: e.y, width: e.w, height: e.h });
    mk('rect', { class: 'eh', x: e.x, y: e.y, width: e.w, height: HEAD });
    mk('text', { class: 'et', x: e.cx, y: e.y + 22, 'text-anchor': 'middle' }, e.id);
    e.a.forEach((t, i) => {
      const pk = t[0] === '*';
      mk('text', { class: 'ea' + (pk ? ' pk' : ''), x: e.x + 14, y: e.y + HEAD + 18 + i * ROW }, pk ? t.slice(1) : t);
    });
  });

  A.forEach(a => {
    mk('rect', { class: 'ab', x: a.x - a.w / 2, y: a.y - a.h / 2, width: a.w, height: a.h, rx: a.h > 30 ? 12 : 15 });
    if (a.props.length) {
      mk('text', { class: 'an', x: a.x, y: a.y - a.h / 2 + 20, 'text-anchor': 'middle' }, a.n);
      mk('line', { class: 'l', x1: a.x - a.w / 2, y1: a.y - a.h / 2 + 28, x2: a.x + a.w / 2, y2: a.y - a.h / 2 + 28 });
      a.props.forEach((p, i) => mk('text', { class: 'ea', x: a.x, y: a.y - a.h / 2 + 46 + i * 18, 'text-anchor': 'middle' }, p));
    } else {
      mk('text', { class: 'an', x: a.x, y: a.y + 4.5, 'text-anchor': 'middle' }, a.n);
    }
  });

  labels.forEach(([x, y, c]) => {
    mk('text', { class: 'c', x, y: y + 4, 'text-anchor': 'middle', stroke: '#fff', 'stroke-width': 4, 'paint-order': 'stroke' }, c);
  });
  document.body.setAttribute('data-ready', '1');
});
