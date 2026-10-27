// Bộ vẽ UML (SVG) dùng chung: tuần tự, hoạt động, lớp, use case. Nét đen, nền trắng, in được.
// Mỗi hàm nhận một spec và vẽ vào <svg id="s">. Xong thì đặt data-ready trên <body>.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const ctx = document.createElement('canvas').getContext('2d');
  const measure = (t, font) => { ctx.font = font || '12.5px "Be Vietnam Pro", sans-serif'; return ctx.measureText(t).width; };
  let svg;
  const el = (tag, attrs, parent, txt) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (txt !== undefined) e.textContent = txt;
    (parent || svg).appendChild(e);
    return e;
  };
  const init = (w, h) => {
    svg = document.getElementById('s');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('xmlns', NS);
    return svg;
  };
  // Văn bản nhiều dòng; anchor: start|middle|end; trả về số dòng.
  const text = (x, y, str, cls, anchor, halo, lh, parent) => {
    const lines = String(str).split('\n'), L = lh || 16;
    lines.forEach((s, i) => el('text', { x, y: y + i * L, class: (cls || 't2') + (halo ? ' halo' : ''), 'text-anchor': anchor || 'start' }, parent, s));
    return lines.length;
  };
  const wrap = (str, maxW, font) => {
    const out = [];
    String(str).split('\n').forEach(par => {
      let cur = '';
      par.split(' ').forEach(w => {
        const t = cur ? cur + ' ' + w : w;
        if (cur && measure(t, font) > maxW) { out.push(cur); cur = w; } else cur = t;
      });
      out.push(cur);
    });
    return out;
  };
  const arrowHead = (x, y, ang, open, parent) => {  // đầu mũi tên tại (x,y), hướng ang (rad)
    const a = 10, b = 5.2, c = Math.cos(ang), s = Math.sin(ang);
    const p = [[x, y], [x - a * c + b * s, y - a * s - b * c], [x - a * c - b * s, y - a * s + b * c]];
    if (open) el('polyline', { class: 'k', points: [p[1], p[0], p[2]].map(q => q.join(',')).join(' ') }, parent);
    else el('polygon', { class: 'bk', points: p.map(q => q.join(',')).join(' ') }, parent);
  };
  const poly = (pts, cls, endArrow, open) => {
    el('polyline', { class: cls, points: pts.map(p => p.join(',')).join(' ') });
    if (endArrow) {
      const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
      arrowHead(b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), open);
    }
  };
  const done = () => document.body.setAttribute('data-ready', '1');

  // ===================================================== TUẦN TỰ
  function sequence(spec) {
    const W = spec.w, n = spec.parts.length, mx = spec.mx || 90;
    const x = {};
    spec.parts.forEach((p, i) => { x[p.id] = spec.xs ? spec.xs[i] : mx + i * ((W - 2 * mx) / (n - 1)); });
    const H = 1000;  // sẽ cắt sau
    init(W, H);
    const back = el('g', {}), front = el('g', {});
    let y = 112;
    const tw = t => Math.max(...String(t).split('\n').map(l => measure(l)));
    const ext = steps => {  // khoảng ngang [min,max] mà các bước chiếm, kể cả chiều rộng chữ
      let lo = Infinity, hi = -Infinity;
      const add = (a, b) => { lo = Math.min(lo, a); hi = Math.max(hi, b); };
      steps.forEach(st => {
        if (st.t === 'msg') { const m = (x[st.from] + x[st.to]) / 2; add(Math.min(x[st.from], x[st.to]), Math.max(x[st.from], x[st.to])); add(m - tw(st.text) / 2 - 8, m + tw(st.text) / 2 + 8); }
        else if (st.t === 'self') add(x[st.at], x[st.at] + 56 + tw(st.text));
        else if (st.t === 'note') st.over.forEach(o => add(x[o] - 40, x[o] + 40));
        else if (st.t === 'frag') {
          [{ steps: st.steps }].concat(st.else || []).forEach(op => { const [a, b] = ext(op.steps); add(a, b); });
        }
      });
      return [lo, hi];
    };
    const layout = (steps, depth) => {
      steps.forEach(st => {
        if (st.t === 'msg') {
          const x1 = x[st.from], x2 = x[st.to], dir = x2 > x1 ? 1 : -1;
          const nl = String(st.text).split('\n').length;
          y += 14 + (nl - 1) * 15;
          const cls = st.kind === 'ret' ? 'kd' : 'k';
          el('line', { class: cls, x1, y1: y, x2: x2 - dir * 0, y2: y }, front);
          arrowHead(x2, y, dir > 0 ? 0 : Math.PI, st.kind === 'ret' || st.kind === 'async', front);
          text((x1 + x2) / 2, y - 7 - (nl - 1) * 15, st.text, st.kind === 'ret' ? 'ti' : 't2', 'middle', true, 15, front);
          y += 20;
        } else if (st.t === 'self') {
          const x1 = x[st.at], nl = String(st.text).split('\n').length;
          y += 14;
          el('polyline', { class: 'k', points: `${x1},${y} ${x1 + 42},${y} ${x1 + 42},${y + 22} ${x1},${y + 22}` }, front);
          arrowHead(x1, y + 22, Math.PI, false, front);
          text(x1 + 48, y + 4, st.text, 't2', 'start', true, 15, front);
          y += 22 + Math.max(0, (nl - 1) * 15) + 18;
        } else if (st.t === 'note') {
          const xs = st.over.map(o => x[o]), l = Math.min(...xs) - (xs.length > 1 ? 40 : 60), r = Math.max(...xs) + (xs.length > 1 ? 40 : 60);
          const lines = wrap(st.text, r - l - 16);
          y += 8;
          el('rect', { class: 'nt', x: l, y, width: r - l, height: lines.length * 15 + 12 }, front);
          lines.forEach((s, i) => el('text', { class: 't3', x: l + 8, y: y + 17 + i * 15 }, front, s));
          y += lines.length * 15 + 22;
        } else if (st.t === 'gap') {
          y += st.h;
        } else if (st.t === 'frag') {
          const [e0, e1] = ext([st]);
          const pad = 14 + (3 - Math.min(depth, 3)) * 4;
          const l = Math.max(8, e0 - pad), r = Math.min(W - 8, e1 + pad);
          const y0 = y + 8;
          y += 8;
          const ops = [{ cond: st.cond, steps: st.steps }].concat(st.else || []);
          const dividers = [];
          ops.forEach((op, i) => {
            if (i > 0) { dividers.push([y, op.cond]); y += 4; }
            y += (i === 0 ? 30 : 20);
            layout(op.steps, depth + 1);
            y += 6;
          });
          el('rect', { class: 'fr', x: l, y: y0, width: r - l, height: y - y0 }, front);
          const lw = measure(st.kind, '600 12px "Be Vietnam Pro"') + 20;
          el('polygon', { class: 'fl', points: `${l},${y0} ${l + lw},${y0} ${l + lw},${y0 + 12} ${l + lw - 8},${y0 + 20} ${l},${y0 + 20}` }, front);
          el('text', { class: 'tb', x: l + 8, y: y0 + 14 }, front, st.kind);
          el('text', { class: 't3', x: l + lw + 8, y: y0 + 15 }, front, st.cond ? `[${st.cond}]` : '');
          y += 14;
          dividers.forEach(([dy, c]) => {
            el('line', { class: 'kd', x1: l, y1: dy, x2: r, y2: dy }, front);
            el('text', { class: 't3', x: l + 8, y: dy + 15 }, front, `[${c}]`);
          });
        }
      });
    };
    layout(spec.steps, 0);
    const end = y + 20;
    // Đầu cột + đường sống
    spec.parts.forEach(p => {
      const px = x[p.id], lines = String(p.label).split('\n');
      if (p.actor) {
        el('circle', { class: 'bx', cx: px, cy: 38, r: 9 }, back);
        el('path', { class: 'k', d: `M${px} 47v18M${px - 14} 54h28M${px} 65l-11 14M${px} 65l11 14` }, back);
        text(px, 96, p.label, 't1', 'middle', false, 15, back);
      } else {
        const w = Math.max(...lines.map(s => measure(s, '600 14px "Be Vietnam Pro"'))) + 24, h = 18 + lines.length * 17;
        el('rect', { class: 'hd', x: px - w / 2, y: 20, width: w, height: h }, back);
        text(px, 38, p.label, 't1', 'middle', false, 17, back);
      }
      el('line', { class: 'kl', x1: px, y1: p.actor ? 102 : 20 + 18 + lines.length * 17, x2: px, y2: end }, back);
    });
    svg.setAttribute('height', end); svg.setAttribute('viewBox', `0 0 ${W} ${end}`);
    done();
  }

  // ===================================================== HOẠT ĐỘNG
  function activity(spec) {
    const W = spec.w, H = spec.h, lanes = spec.lanes, LW = (W - 2) / lanes.length, TOP = 44;
    init(W, H);
    lanes.forEach((l, i) => {
      el('rect', { class: 'ln', x: 1 + i * LW, y: 1, width: LW, height: H - 2 }, svg);
      el('rect', { class: 'hd', x: 1 + i * LW, y: 1, width: LW, height: TOP - 4 }, svg);
      text(1 + i * LW + LW / 2, 25, l.label, 't1', 'middle');
    });
    const laneIdx = {}; lanes.forEach((l, i) => laneIdx[l.id] = i);
    const N = {};
    spec.nodes.forEach(nd => {
      const cx = 1 + laneIdx[nd.lane] * LW + LW / 2 + (nd.dx || 0), cy = nd.y;
      let w = 0, h = 0;
      if (nd.type === 'start') { w = h = 20; }
      else if (nd.type === 'end') { w = h = 24; }
      else if (nd.type === 'merge') { w = h = 22; }
      else if (nd.type === 'bar') { w = nd.w || 200; h = 8; }
      else if (nd.type === 'dec') { w = nd.w || 170; h = nd.h || 76; }
      else { w = nd.w || Math.min(LW - 36, 190); const ls = wrap(nd.text, w - 34, '12.5px "Be Vietnam Pro"'); nd.lines = ls; h = ls.length * 16 + 18; }
      N[nd.id] = { ...nd, cx, cy, w, h };
    });
    const port = (n, side) => ({ top: [n.cx, n.cy - n.h / 2], bottom: [n.cx, n.cy + n.h / 2], left: [n.cx - n.w / 2, n.cy], right: [n.cx + n.w / 2, n.cy] })[side];
    spec.nodes.forEach(nd => {
      const n = N[nd.id], { cx, cy, w, h } = n;
      if (n.type === 'start') el('circle', { class: 'bk', cx, cy, r: 10 });
      else if (n.type === 'end') { el('circle', { class: 'bx', cx, cy, r: 12 }); el('circle', { class: 'bk', cx, cy, r: 7 }); }
      else if (n.type === 'merge') el('polygon', { class: 'bx', points: `${cx},${cy - 11} ${cx + 11},${cy} ${cx},${cy + 11} ${cx - 11},${cy}` });
      else if (n.type === 'bar') el('rect', { class: 'bk', x: cx - w / 2, y: cy - 4, width: w, height: 8, rx: 2 });
      else if (n.type === 'dec') {
        el('polygon', { class: 'bx', points: `${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}` });
        const ls = wrap(n.text, w * 0.62, '12px "Be Vietnam Pro"');
        ls.forEach((s, i) => el('text', { class: 't2', x: cx, y: cy + 4 - (ls.length - 1) * 8 + i * 16, 'text-anchor': 'middle' }, undefined, s));
      } else {
        el('rect', { class: 'bx', x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 14 });
        n.lines.forEach((s, i) => el('text', { class: 't2', x: cx, y: cy - h / 2 + 22 + i * 16, 'text-anchor': 'middle' }, undefined, s));
      }
    });
    spec.edges.forEach(e => {
      const a = N[e.from], b = N[e.to], mode = e.mode || 'v';
      let pts = [], lab = null;
      if (mode === 'v') {
        const p1 = port(a, 'bottom'), p2 = port(b, 'top');
        if (Math.abs(p1[0] - p2[0]) < 2) pts = [p1, p2];
        else { const ym = e.ym !== undefined ? e.ym : (p1[1] + p2[1]) / 2; pts = [p1, [p1[0], ym], [p2[0], ym], p2]; }
        lab = [p1[0] + 6, p1[1] + 14, 'start'];
      } else if (mode === 'h') {            // từ cạnh bên của a, ngang tới x của b, rồi xuống đỉnh b
        const side = e.side || (b.cx > a.cx ? 'right' : 'left'), p1 = port(a, side), p2 = port(b, 'top');
        pts = [p1, [p2[0], p1[1]], p2];
        lab = [p1[0] + (side === 'right' ? 6 : -6), p1[1] - 6, side === 'right' ? 'start' : 'end'];
      } else if (mode === 'hh') {            // cạnh bên sang cạnh bên cùng độ cao
        const sa = b.cx > a.cx ? 'right' : 'left', sb = b.cx > a.cx ? 'left' : 'right';
        pts = [port(a, sa), port(b, sb)];
        lab = [(pts[0][0] + pts[1][0]) / 2, pts[0][1] - 6, 'middle'];
      } else if (mode === 'vh') {            // từ đáy a xuống tới độ cao b rồi ngang vào cạnh b
        const p1 = port(a, 'bottom'), sb = b.cx > a.cx ? 'left' : 'right', p2 = port(b, sb);
        pts = [p1, [p1[0], p2[1]], p2];
        lab = [p1[0] + 6, p1[1] + 14, 'start'];
      } else if (mode === 'back') {          // vòng ra ngoài rồi quay lại cạnh bên b
        const side = e.side || 'right', p1 = port(a, side === 'right' ? 'right' : 'left'), p2 = port(b, side === 'right' ? 'right' : 'left');
        const ox = (side === 'right' ? Math.max(p1[0], p2[0]) + (e.out || 40) : Math.min(p1[0], p2[0]) - (e.out || 40));
        pts = [p1, [ox, p1[1]], [ox, p2[1]], p2];
        lab = [p1[0] + (side === 'right' ? 6 : -6), p1[1] - 6, side === 'right' ? 'start' : 'end'];
      } else if (mode === 'bh') {            // đáy a, xuống, ngang, lên đỉnh b (b phía trên: hiếm)
        const p1 = port(a, 'bottom'), p2 = port(b, 'top');
        pts = [p1, [p1[0], e.ym], [p2[0], e.ym], p2];
        lab = [p1[0] + 6, p1[1] + 14, 'start'];
      }
      poly(pts, e.dashed ? 'kd' : 'k', true);
      if (e.label) text(lab[0] + (e.lx || 0), lab[1] + (e.ly || 0), e.label, 't3', lab[2], true);
    });
    done();
  }

  // ===================================================== LỚP
  function classes(spec) {
    init(spec.w, spec.h);
    const C = {};
    const LH = 16;
    spec.classes.forEach(c => {
      const head = (c.stereo ? 1 : 0) + 1;
      c.h = head * 18 + 14 + (c.attrs && c.attrs.length ? c.attrs.length * LH + 10 : 8) + (c.ops && c.ops.length ? c.ops.length * LH + 10 : 0);
      c.cx = c.x + c.w / 2; c.cy = c.y + c.h / 2; C[c.id] = c;
    });
    const clip = (c, fx, fy) => {
      const dx = c.cx - fx, dy = c.cy - fy;
      const tx = dx ? ((dx > 0 ? c.x : c.x + c.w) - fx) / dx : -Infinity, ty = dy ? ((dy > 0 ? c.y : c.y + c.h) - fy) / dy : -Infinity;
      const t = Math.max(tx, ty); return [fx + dx * t, fy + dy * t];
    };
    const deco = (type, P, Q) => {   // trang trí tại P, đường đi từ Q tới P
      const ang = Math.atan2(P[1] - Q[1], P[0] - Q[0]), c = Math.cos(ang), s = Math.sin(ang);
      const pt = (a, b) => [P[0] - a * c + b * s, P[1] - a * s - b * c].map(v => v.toFixed(1)).join(',');
      if (type === 'tri') el('polygon', { class: 'bx', points: `${P[0]},${P[1]} ${pt(14, 8)} ${pt(14, -8)}` });
      if (type === 'dmH') el('polygon', { class: 'bx', points: `${P[0]},${P[1]} ${pt(9, 6)} ${pt(18, 0)} ${pt(9, -6)}` });
      if (type === 'dmF') el('polygon', { class: 'bk', points: `${P[0]},${P[1]} ${pt(9, 6)} ${pt(18, 0)} ${pt(9, -6)}` });
      if (type === 'open') arrowHead(P[0], P[1], ang, true);
      if (type === 'arrow') arrowHead(P[0], P[1], ang, false);
    };
    spec.rels.forEach(r => {
      const a = C[r.from], b = C[r.to], via = r.via || [];
      const first = via.length ? via[0] : [b.cx, b.cy], last = via.length ? via[via.length - 1] : [a.cx, a.cy];
      const p1 = r.fa || clip(a, first[0], first[1]), p2 = r.ta || clip(b, last[0], last[1]);
      const pts = [p1, ...via, p2];
      const dashed = r.type === 'dep' || r.type === 'real' || r.type === 'dash';
      el('polyline', { class: dashed ? 'kd' : 'k', points: pts.map(p => p.join(',')).join(' ') });
      const endT = { inh: 'tri', real: 'tri', dep: 'open', arrow: 'arrow' }[r.type];
      if (endT) deco(endT, p2, pts[pts.length - 2]);
      const startT = { comp: 'dmF', agg: 'dmH' }[r.type];
      if (startT) deco(startT, p1, pts[1]);
      const lab = (P, Q, s, dx, dy) => { if (!s) return; const d = Math.hypot(Q[0] - P[0], Q[1] - P[1]) || 1, ux = (Q[0] - P[0]) / d, uy = (Q[1] - P[1]) / d; text(P[0] + ux * 22 - uy * 11 + (dx || 0), P[1] + uy * 22 + ux * 11 + 3 + (dy || 0), s, 't3', 'middle', true); };
      lab(p1, pts[1], r.m1); lab(p2, pts[pts.length - 2], r.m2);
      if (r.label) { const m = pts[Math.floor(pts.length / 2) - (pts.length % 2 ? 0 : 1)], m2 = pts[Math.floor(pts.length / 2)]; text((m[0] + m2[0]) / 2 + (r.lx || 0), (m[1] + m2[1]) / 2 - 6 + (r.ly || 0), r.label, 'ti', 'middle', true); }
    });
    spec.classes.forEach(c => {
      el('rect', { class: 'bx', x: c.x, y: c.y, width: c.w, height: c.h });
      let y = c.y;
      const head = (c.stereo ? 1 : 0) + 1, hh = head * 18 + 14;
      el('rect', { class: 'hd', x: c.x, y: c.y, width: c.w, height: hh });
      let ty = c.y + 17;
      if (c.stereo) { el('text', { class: 't3', x: c.cx, y: ty, 'text-anchor': 'middle' }, undefined, `«${c.stereo}»`); ty += 17; }
      el('text', { class: 't1', x: c.cx, y: ty, 'text-anchor': 'middle', 'font-style': c.abs ? 'italic' : 'normal' }, undefined, c.name);
      y += hh;
      if (c.attrs && c.attrs.length) {
        c.attrs.forEach((a, i) => el('text', { class: 't3', x: c.x + 8, y: y + 18 + i * LH }, undefined, a));
        y += c.attrs.length * LH + 10;
      } else y += 8;
      if (c.ops && c.ops.length) {
        el('line', { class: 'k', x1: c.x, y1: y, x2: c.x + c.w, y2: y });
        c.ops.forEach((a, i) => el('text', { class: 't3', x: c.x + 8, y: y + 17 + i * LH }, undefined, a));
      }
    });
    (spec.groups || []).forEach(g => {
      el('rect', { class: 'kd', x: g.x, y: g.y, width: g.w, height: g.h, rx: 8 });
      el('text', { class: 't1', x: g.x + 12, y: g.y + 20 }, undefined, g.label);
    });
    done();
  }

  window.UML = { sequence, activity, classes, init, el, text, poly, arrowHead, measure, wrap, done };
})();
