/* ============================================================
   Interfaz de la página: figuras, calculadora, laboratorio, comparación.
   Todo el texto dinámico lo generamos nosotros a partir del motor numérico;
   lo que escribe el usuario se escapa (esc) o se muestra con textContent.
   ============================================================ */
(function () {
  'use strict';

  const E = Engine.init(math);
  const fmt = E.fmt;

  /* ----------------------------- helpers ----------------------------- */
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  const cssVar = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  const mcolor = function (id) { return cssVar('--m-' + id); };
  const fmtErr = function (v) { return (v == null || !isFinite(v)) ? '—' : (v === 0 ? '0' : v.toExponential(2)); };
  const STYLE = { taylor: 'circle', heun: 'rect', rk2: 'triangle', euler: 'rectRot' };
  const NAME = { taylor: 'Taylor (orden 2)', heun: 'Euler mejorado', rk2: 'RK2 (punto medio)', euler: 'Euler' };
  const SHORT = { taylor: 'Taylor', heun: 'E. mejorado', rk2: 'RK2', euler: 'Euler' };

  function typeset(root) {
    if (typeof renderMathInElement !== 'function') return;
    renderMathInElement(root || document.body, {
      delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
      throwOnError: false, strict: 'ignore',
    });
  }
  function texTo(el, tex, display) { katex.render(tex, el, { displayMode: !!display, throwOnError: false, strict: 'ignore' }); }
  function texHTML(tex, display) { return katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: 'ignore' }); }

  const state = { last: null, chartsDirty: false, conv: null };

  /* ----------------------------- tema / navegación ----------------------------- */
  function setupTheme() {
    const root = document.documentElement;
    let saved = null;
    try { saved = localStorage.getItem('edo-theme'); } catch (e) { /* sin storage */ }
    if (saved) root.setAttribute('data-theme', saved);
    $('#themeToggle').addEventListener('click', function () {
      const cur = root.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('edo-theme', next); } catch (e) { /* sin storage */ }
      rethemeCharts();
    });
  }

  function setupNav() {
    const menu = $('#navlinks'), btn = $('#menuBtn');
    btn.addEventListener('click', function () {
      const open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }); });
    const links = {};
    $$('a', menu).forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && links[en.target.id]) {
          Object.keys(links).forEach(function (k) { links[k].classList.toggle('active', k === en.target.id); });
        }
      });
    }, { rootMargin: '-35% 0px -55% 0px' });
    Object.keys(links).forEach(function (id) { const el = document.getElementById(id); if (el) io.observe(el); });
  }

  function setupReveal() {
    const els = $$('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('is-visible'); }); return; }
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); } });
    }, { threshold: 0.01, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (e) { io.observe(e); });
    setTimeout(function () { els.forEach(function (e) { e.classList.add('is-visible'); }); }, 1800);
  }

  /* ----------------------------- gráficos (Chart.js) ----------------------------- */
  const charts = {};
  function mountChart(key, build) {
    if (charts[key] && charts[key].inst) charts[key].inst.destroy();
    charts[key] = { build: build, inst: build() };
  }
  function rethemeCharts() {
    Object.keys(charts).forEach(function (k) {
      const c = charts[k];
      if (c.inst) { const cv = c.inst.canvas; c.inst.destroy(); if (cv && !cv.isConnected) { c.inst = null; return; } }
      c.inst = c.build();
    });
  }
  function axisStyle(extra) {
    const base = {
      grid: { color: cssVar('--grid-line') },
      ticks: { color: cssVar('--text-secondary'), font: { family: cssVar('--font-mono'), size: 10 } },
      title: { display: false, color: cssVar('--text-secondary'), font: { family: cssVar('--font-sans'), size: 11 } },
      border: { color: cssVar('--border-default') },
    };
    return Object.assign(base, extra || {});
  }
  const axTitle = function (t) { return { display: true, text: t, color: cssVar('--text-secondary'), font: { family: cssVar('--font-sans'), size: 11 } }; };
  function legendStyle() { return { labels: { color: cssVar('--text-secondary'), font: { family: cssVar('--font-sans'), size: 11 }, usePointStyle: true, boxWidth: 8 } }; }
  function tooltipStyle() { return { titleFont: { family: cssVar('--font-mono') }, bodyFont: { family: cssVar('--font-mono') } }; }

  /* ----------------------------- SVG: utilidades ----------------------------- */
  const p1 = function (v) { return v.toFixed(1); };
  function niceTicks(lo, hi, count) {
    const span = hi - lo;
    if (!(span > 0)) return [lo];
    const raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 * span; v += step) out.push(Number(v.toPrecision(12)));
    return out;
  }
  function makeAxes(W, H, m, xr, yr, o) {
    const sx = function (v) { return m.l + (v - xr[0]) / (xr[1] - xr[0]) * (W - m.l - m.r); };
    const sy = function (v) { return H - m.b - (v - yr[0]) / (yr[1] - yr[0]) * (H - m.t - m.b); };
    let s = '';
    niceTicks(yr[0], yr[1], o.yTicks || 5).forEach(function (v) {
      s += '<line class="gridl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + p1(sy(v)) + '" y2="' + p1(sy(v)) + '"/><text x="' + (m.l - 6) + '" y="' + p1(sy(v) + 3.5) + '" text-anchor="end">' + fmt(v, 4) + '</text>';
    });
    niceTicks(xr[0], xr[1], o.xTicks || 5).forEach(function (v) {
      s += '<line class="gridl" x1="' + p1(sx(v)) + '" x2="' + p1(sx(v)) + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/><text x="' + p1(sx(v)) + '" y="' + (H - m.b + 16) + '" text-anchor="middle">' + fmt(v, 4) + '</text>';
    });
    s += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (H - m.b) + '" y2="' + (H - m.b) + '"/><line class="axis" x1="' + m.l + '" x2="' + m.l + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/>';
    if (o.xLabel) s += '<text x="' + p1((m.l + W - m.r) / 2) + '" y="' + (H - 4) + '" text-anchor="middle">' + o.xLabel + '</text>';
    return { sx: sx, sy: sy, svg: s };
  }
  function pathOf(pts) { return pts.map(function (q, i) { return (i ? 'L' : 'M') + p1(q[0]) + ',' + p1(q[1]); }).join(' '); }
  function marker(kind, x, y, color, r) {
    r = r || 5;
    if (kind === 'rect') return '<rect x="' + p1(x - r) + '" y="' + p1(y - r) + '" width="' + (2 * r) + '" height="' + (2 * r) + '" rx="1.5" style="fill:' + color + '"/>';
    if (kind === 'triangle') return '<path d="M' + p1(x) + ',' + p1(y - r - 1) + ' L' + p1(x + r + 1) + ',' + p1(y + r) + ' L' + p1(x - r - 1) + ',' + p1(y + r) + ' Z" style="fill:' + color + '"/>';
    if (kind === 'rectRot') return '<path d="M' + p1(x) + ',' + p1(y - r - 1) + ' L' + p1(x + r + 1) + ',' + p1(y) + ' L' + p1(x) + ',' + p1(y + r + 1) + ' L' + p1(x - r - 1) + ',' + p1(y) + ' Z" style="fill:' + color + '"/>';
    return '<circle cx="' + p1(x) + '" cy="' + p1(y) + '" r="' + r + '" style="fill:' + color + '"/>';
  }
  const MCOL = function (id) { return 'var(--m-' + id + ')'; };

  /* ----------------------------- figura del hero (varios pasos) ----------------------------- */
  function renderHeroFigure() {
    const el = $('#heroFigure');
    const Pb = E.buildProblem('y^2', 'x');
    const x0 = 0, y0 = 1, h = 0.2, n = 3, xf = 0.6;
    const ids = ['euler', 'taylor', 'heun', 'rk2'];
    const runs = {};
    ids.forEach(function (id) { runs[id] = E.run(id, Pb, x0, y0, h, n, null); });
    const exact = function (x) { return 1 / (1 - x); };
    const W = 520, H = 330, m = { l: 44, r: 16, t: 14, b: 36 };
    const xr = [-0.02, xf + 0.03], yr = [0.9, exact(xf) + 0.15];
    const A = makeAxes(W, H, m, xr, yr, { xTicks: 6, yTicks: 5, xLabel: 'x' });
    let s = A.svg;
    const ex = [];
    for (let i = 0; i <= 80; i++) { const x = x0 + (xf - x0) * i / 80; ex.push([A.sx(x), A.sy(exact(x))]); }
    s += '<path class="exact" d="' + pathOf(ex) + '"/>';
    s += '<circle cx="' + p1(A.sx(xf)) + '" cy="' + p1(A.sy(exact(xf))) + '" r="6" fill="none" style="stroke:var(--text-primary)" stroke-width="1.8"/>';
    ['euler', 'rk2', 'heun', 'taylor'].forEach(function (id) {
      const pts = runs[id].rows.map(function (r) { return [A.sx(r.x), A.sy(r.y)]; });
      s += '<path d="' + pathOf(pts) + '" fill="none" style="stroke:' + MCOL(id) + '" stroke-width="2"' + (id === 'euler' ? ' stroke-dasharray="5 4"' : '') + '/>';
      pts.forEach(function (q) { s += marker(STYLE[id], q[0], q[1], MCOL(id), 4); });
    });
    s += '<circle cx="' + p1(A.sx(x0)) + '" cy="' + p1(A.sy(y0)) + '" r="5.5" fill="none" style="stroke:var(--text-primary)" stroke-width="2"/>';
    el.innerHTML = '<svg class="fig" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Aproximaciones de y prima igual a y al cuadrado con los cuatro métodos">' + s + '</svg>' +
      '<div class="fig-legend" style="margin-top:8px;">' +
      ['euler', 'taylor', 'heun', 'rk2'].map(function (id) { return '<div class="it"><span class="nm"><span class="mbadge mb-' + id + '">' + NAME[id] + '</span></span><span class="vl">y(0.6) ≈ ' + fmt(runs[id].yEnd, 4) + '</span></div>'; }).join('') +
      '<div class="it"><span class="nm"><span class="mbadge mb-ref">Exacta</span></span><span class="vl">y(0.6) = ' + fmt(exact(xf), 4) + '</span></div></div>';
  }

  /* ----------------------------- figura geométrica de un paso ----------------------------- */
  const HOW = {
    euler: 'Tangente en el punto inicial',
    taylor: 'Parábola con la curvatura y″ (usa derivadas parciales)',
    heun: 'Promedio de la pendiente inicial y la del final estimado',
    rk2: 'Pendiente medida en el punto medio',
  };

  function renderStepFigure(container, o) {
    const Pb = o.Pb, x0 = o.x0, y0 = o.y0, h = o.h;
    const ids = o.only || ['euler', 'taylor', 'heun', 'rk2'];
    const st = E.oneStep(Pb, x0, y0, h);
    const f = Pb.fns.f;
    if (!isFinite(st.exact.y1) || ids.some(function (id) { return !isFinite(st[id].y); })) {
      container.innerHTML = '<div class="alert warn">Con ese paso la solución se vuelve infinita. Probá con un h más chico.</div>';
      return null;
    }
    const W = o.W || 640, H = o.H || 360, m = o.small ? { l: 40, r: 70, t: 12, b: 30 } : { l: 48, r: 96, t: 16, b: 34 };
    const x1 = x0 + h;
    const ys = [y0, st.exact.y1].concat(st.exact.ys);
    ids.forEach(function (id) { ys.push(st[id].y); });
    if (ids.indexOf('heun') >= 0) ys.push(st.heun.parts.yp);
    if (ids.indexOf('rk2') >= 0) ys.push(st.rk2.parts.ym);
    let ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    const pad = (ymax - ymin) * 0.16 || 1;
    ymin -= pad; ymax += pad;
    const xr = [x0 - h * 0.06, x1 + h * 0.04], yr = [ymin, ymax];
    const A = makeAxes(W, H, m, xr, yr, { xTicks: 5, yTicks: 5, xLabel: 'x' });
    const sx = A.sx, sy = A.sy;
    let s = A.svg;

    if (o.showField) {
      const GX = o.small ? 10 : 15, GY = o.small ? 7 : 9;
      const pxX = (W - m.l - m.r) / (xr[1] - xr[0]), pxY = (H - m.t - m.b) / (yr[1] - yr[0]);
      for (let i = 0; i < GX; i++) {
        for (let j = 0; j < GY; j++) {
          const x = xr[0] + (i + 0.5) / GX * (xr[1] - xr[0]), y = yr[0] + (j + 0.5) / GY * (yr[1] - yr[0]);
          const sl = f(x, y);
          if (!isFinite(sl)) continue;
          const dx = pxX, dy = -sl * pxY, nn = Math.sqrt(dx * dx + dy * dy) || 1, L = o.small ? 7 : 9;
          const ux = dx / nn * L, uy = dy / nn * L, cx = sx(x), cy = sy(y);
          s += '<line class="field" x1="' + p1(cx - ux) + '" y1="' + p1(cy - uy) + '" x2="' + p1(cx + ux) + '" y2="' + p1(cy + uy) + '"/>';
        }
      }
    }
    s += '<path class="exact" d="' + pathOf(st.exact.xs.map(function (x, i) { return [sx(x), sy(st.exact.ys[i])]; })) + '"/>';
    s += '<line class="tick" x1="' + p1(sx(x1)) + '" x2="' + p1(sx(x1)) + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke-dasharray="3 4"/>';

    const ends = [];
    const seg = function (xa, ya, xb, yb, col, w, dash) {
      return '<line x1="' + p1(sx(xa)) + '" y1="' + p1(sy(ya)) + '" x2="' + p1(sx(xb)) + '" y2="' + p1(sy(yb)) + '" style="stroke:' + col + '" stroke-width="' + w + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + ' stroke-linecap="round"/>';
    };
    ids.forEach(function (id) {
      const col = MCOL(id);
      if (id === 'euler') {
        s += seg(x0, y0, x1, st.euler.y, col, 2.4);
      } else if (id === 'taylor') {
        const d1 = st.taylor.parts.d1, d2 = st.taylor.parts.d2, pts = [];
        for (let i = 0; i <= 30; i++) { const t = h * i / 30; pts.push([sx(x0 + t), sy(y0 + d1 * t + d2 / 2 * t * t)]); }
        s += '<path d="' + pathOf(pts) + '" fill="none" style="stroke:' + col + '" stroke-width="2.4"/>';
      } else if (id === 'heun') {
        const pa = st.heun.parts;
        s += seg(x0, y0, x1, pa.yp, col, 1.4, '4 4');
        s += seg(x0, y0, x0 + 0.3 * h, y0 + 0.3 * h * pa.d1, col, 4);
        s += seg(x1 - 0.3 * h, pa.yp - 0.3 * h * pa.d1p, x1, pa.yp, col, 4);
        s += '<circle cx="' + p1(sx(x1)) + '" cy="' + p1(sy(pa.yp)) + '" r="4" style="fill:var(--surface);stroke:' + col + '" stroke-width="1.6"/>';
        s += seg(x0, y0, x1, st.heun.y, col, 2.4);
      } else if (id === 'rk2') {
        const pa = st.rk2.parts;
        s += seg(x0, pa.ym - pa.s * h / 2, x1, pa.ym + pa.s * h / 2, col, 1.4, '4 4');
        s += '<circle cx="' + p1(sx(pa.xm)) + '" cy="' + p1(sy(pa.ym)) + '" r="4.5" style="fill:var(--surface);stroke:' + col + '" stroke-width="1.8"/>';
        s += seg(x0, y0, pa.xm, pa.ym, col, 1.4, '2 3');
        s += seg(x0, y0, x1, st.rk2.y, col, 2.4);
      }
      ends.push({ y: sy(st[id].y), id: id, txt: o.small ? '' : (id === 'euler' ? 'Euler' : id === 'taylor' ? 'Taylor' : id === 'heun' ? 'E. mejorado' : 'RK2') });
    });
    ends.forEach(function (e) { s += marker(STYLE[e.id], sx(x1), e.y, MCOL(e.id), 5); });
    s += '<circle cx="' + p1(sx(x1)) + '" cy="' + p1(sy(st.exact.y1)) + '" r="6.5" fill="none" style="stroke:var(--text-primary)" stroke-width="1.8"/>';
    s += '<circle cx="' + p1(sx(x0)) + '" cy="' + p1(sy(y0)) + '" r="5" style="fill:var(--text-primary)"/>';
    s += '<text x="' + p1(sx(x0) + 8) + '" y="' + p1(sy(y0) + 15) + '" class="lbl" style="fill:var(--text-primary)">(x₀, y₀)</text>';

    if (!o.small) {
      const labs = ends.map(function (e) { return { y: e.y, txt: e.txt, col: MCOL(e.id) }; });
      labs.push({ y: sy(st.exact.y1), txt: 'exacta', col: 'var(--text-primary)' });
      labs.sort(function (a, b) { return a.y - b.y; });
      for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 13) labs[i].y = labs[i - 1].y + 13;
      labs.forEach(function (l) { s += '<text x="' + p1(sx(x1) + 12) + '" y="' + p1(l.y + 4) + '" class="lbl" style="fill:' + l.col + '">' + l.txt + '</text>'; });
    }
    container.innerHTML = '<svg class="fig" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Un paso de cada método comparado con la solución exacta">' + s + '</svg>';
    return st;
  }

  const DIDACTIC = E.buildProblem('y^2', 'x');

  function renderMethodFigures() {
    ['euler', 'taylor', 'heun', 'rk2'].forEach(function (id) {
      const box = $('#fig-' + id);
      if (!box) return;
      const holder = document.createElement('div');
      box.appendChild(holder);
      const st = renderStepFigure(holder, { Pb: DIDACTIC, x0: 0, y0: 1, h: 0.5, only: [id], showField: true, small: true, W: 420, H: 300 });
      const cap = document.createElement('div');
      cap.className = 'fig-cap';
      if (st) {
        cap.innerHTML = '<strong style="color:var(--text-primary)">' + HOW[id] + '.</strong><br>y₁ ≈ <span class="mono">' + fmt(st[id].y, 4) + '</span> · exacta <span class="mono">' + fmt(st.exact.y1, 4) + '</span> · error <span class="mono">' + fmtErr(Math.abs(st.exact.y1 - st[id].y)) + '</span>';
      }
      box.appendChild(cap);
    });
  }

  /* ----------------------------- calculadora ----------------------------- */
  function currentVar() { return $('#vSelect').value; }

  function updateLabels() {
    const v = currentVar();
    $('#x0Label').textContent = v + '₀';
    $('#xfLabel').textContent = 'Hallar y( ' + v + ' ) en ' + v + ' =';
  }

  function updateParsed() {
    const out = $('#fParsed');
    const s = $('#fInput').value.trim();
    out.classList.remove('err');
    if (!s) { out.textContent = ''; return; }
    try {
      const node = E.parse(s);
      const syms = E.symbolsOf(node);
      if (syms.has('t') && !syms.has('x') && currentVar() !== 't') { $('#vSelect').value = 't'; updateLabels(); }
      else if (syms.has('x') && !syms.has('t') && currentVar() !== 'x') { $('#vSelect').value = 'x'; updateLabels(); }
      const Pb = E.buildProblem(s, currentVar());
      texTo(out, "y' = f(" + currentVar() + ", y) = " + Pb.texF, false);
    } catch (e) { out.classList.add('err'); out.textContent = e.message; }
  }

  function updateDerived() {
    const box = $('#derivedInfo'), v = currentVar();
    const allEmpty = ['#x0Input', '#y0Input', '#hInput', '#xfInput'].every(function (id) { return !$(id).value.trim(); });
    if (allEmpty) { box.innerHTML = '<span class="muted">Completá la ecuación, la condición inicial y el paso; acá vas a ver cómo se interpreta el problema y cuántas iteraciones salen.</span>'; return; }
    try {
      const x0 = E.parseNumber($('#x0Input').value, v + '₀'), y0 = E.parseNumber($('#y0Input').value, 'y₀');
      const h = E.parseNumber($('#hInput').value, 'h'), xf = E.parseNumber($('#xfInput').value, 'el punto final');
      if (!(h > 0)) throw new E.UserError('El paso h tiene que ser positivo.');
      if (!(xf > x0)) throw new E.UserError('El punto final tiene que ser mayor que ' + v + '₀.');
      const ns = E.nSteps(x0, xf, h);
      let html = 'Condición inicial: <b>y(' + fmt(x0, 6) + ') = ' + fmt(y0, 6) + '</b> &nbsp;→&nbsp; ' + v + '₀ = ' + fmt(x0, 6) + ', y₀ = ' + fmt(y0, 6) +
        '<br>Dominio: <b>' + fmt(x0, 6) + ' ≤ ' + v + ' ≤ ' + fmt(xf, 6) + '</b> &nbsp;·&nbsp; paso h = ' + fmt(h, 6) +
        '<br>Iteraciones: n = (' + fmt(xf, 6) + ' − ' + fmt(x0, 6) + ') / ' + fmt(h, 6) + ' = <b>' + fmt(ns.raw, 4) + '</b>';
      if (!ns.ok) html += ' <span style="color:var(--warning)">— no es entero: revisá h o el punto final.</span>';
      box.innerHTML = html;
    } catch (e) { box.innerHTML = '<span class="muted">' + esc(e.message) + '</span>'; }
  }

  function setMethods(list) {
    $$('input[name="method"]').forEach(function (c) { c.checked = list.indexOf(c.value) >= 0; });
  }
  function getMethods() {
    return ['taylor', 'heun', 'rk2', 'euler'].filter(function (id) { const c = $('input[name="method"][value="' + id + '"]'); return c && c.checked; });
  }

  function readInputs() {
    const v = currentVar();
    const methods = getMethods();
    if (!methods.length) throw new E.UserError('Elegí al menos un método.');
    const d = $('#digitsSelect').value;
    return {
      fStr: $('#fInput').value, indep: v,
      x0: E.parseNumber($('#x0Input').value, v + '₀'), y0: E.parseNumber($('#y0Input').value, 'y₀'),
      h: E.parseNumber($('#hInput').value, 'h'), xf: E.parseNumber($('#xfInput').value, 'el punto final'),
      methods: methods, digits: d === 'full' ? null : parseInt(d, 10), exactStr: $('#exactInput').value,
    };
  }

  function showError(msg) { const a = $('#calcError'); a.textContent = msg; a.hidden = false; }
  function clearError() { $('#calcError').hidden = true; }

  function calculate() {
    clearError();
    try {
      const input = readInputs();
      const res = E.solve(input);
      state.last = { res: res, input: input };
      renderResults(res);
      onNewResult(res);
    } catch (e) {
      if (e instanceof E.UserError) showError(e.message);
      else { console.error(e); showError('Ocurrió un error inesperado al calcular. Revisá los datos (' + (e && e.message ? e.message : e) + ').'); }
    }
  }

  function refDescription(res) {
    if (!res.ref || !res.ref.ys) return 'No se pudo calcular una referencia (la solución se vuelve infinita).';
    const end = fmt(res.ref.ys[res.n], 8);
    if (res.ref.kind === 'exact') return 'Referencia: solución exacta ingresada · y(' + fmt(res.xf, 6) + ') = ' + end;
    return 'Referencia: solución numérica de alta precisión (RK4 con paso muy fino) · y(' + fmt(res.xf, 6) + ') ≈ ' + end;
  }

  function renderResults(res) {
    $('#calcResults').hidden = false;
    $('#resTitle').textContent = 'Resultados · y′ = ' + res.problem.fStr.replace(/\*/g, '·');
    $('#resRef').textContent = refDescription(res);
    renderSummary(res);
    renderTables(res);
    renderSteps(res);
    state.chartsDirty = true;
    if ($('#tab-graficos').classList.contains('active')) mountResultCharts(res);
    fillCheckSelect(res);
    $('#chkOut').innerHTML = '';
  }

  function dispDigits(res) { return res.digits != null ? res.digits : 6; }

  function renderSummary(res) {
    const P = res.problem, v = P.indep, dd = dispDigits(res);
    let html = '';
    const nodes = [];
    const cap = 16;
    for (let i = 0; i <= res.n; i++) {
      if (res.n > cap && i === cap - 2) { nodes.push('<span class="chip">…</span>'); i = res.n - 2; continue; }
      nodes.push('<span class="chip' + (i === 0 ? ' first' : (i === res.n ? ' last' : '')) + '">' + v + '<sub>' + i + '</sub> = ' + fmt(res.xs[i], 6) + '</span>');
    }
    html += '<div class="grid-2"><div class="card"><h3>Datos identificados</h3><dl class="kv">' +
      '<dt>Ecuación</dt><dd>' + texHTML("y' = f(" + v + ", y) = " + P.texF) + '</dd>' +
      '<dt>Condición inicial</dt><dd>y(' + fmt(res.x0, 6) + ') = ' + fmt(res.y0, 6) + ' → ' + v + '₀ = ' + fmt(res.x0, 6) + ', y₀ = ' + fmt(res.y0, 6) + '</dd>' +
      '<dt>Dominio</dt><dd>' + fmt(res.x0, 6) + ' ≤ ' + v + ' ≤ ' + fmt(res.xf, 6) + '</dd>' +
      '<dt>Paso</dt><dd>h = ' + fmt(res.h, 6) + '</dd>' +
      '<dt>Iteraciones</dt><dd>n = (' + fmt(res.xf, 6) + ' − ' + fmt(res.x0, 6) + ')/' + fmt(res.h, 6) + ' = <b>' + res.n + '</b></dd>' +
      '</dl></div><div class="card"><h3>Los nodos que se recorren</h3><div class="chip-list">' + nodes.join('') + '</div>' +
      '<p style="margin-top:12px;">Se parte de ' + v + '₀ y en cada iteración se suma h: ' + v + '<sub>n+1</sub> = ' + v + '<sub>n</sub> + h.</p></div></div>';

    if (res.digits != null) html += '<div class="alert info">Se redondeó a ' + res.digits + ' decimales en cada iteración (como al resolver a mano).</div>';
    res.ids.forEach(function (id) { if (res.runs[id].diverged) html += '<div class="alert">' + NAME[id] + ': el valor se vuelve infinito o indefinido en la iteración n = ' + res.runs[id].diverged.n + ' (' + v + ' = ' + fmt(res.runs[id].diverged.x, 6) + '). Probá con un h más chico.</div>'; });
    if (P.derivKind === 'numerical' && res.ids.indexOf('taylor') >= 0) html += '<div class="alert warn">No se pudieron derivar simbólicamente las derivadas parciales de esa f: Taylor las aproxima numéricamente.</div>';

    html += '<div class="res-head"><h3>Ordenada genérica de cada método</h3><div class="muted" style="font-size:0.85rem;">se arma una vez; después sólo se reemplazan los números</div></div>';
    res.ids.forEach(function (id) {
      html += '<div class="gen-block"><span class="mbadge mb-' + id + '">' + NAME[id] + '</span><div class="eqn">' + E.genericOrdinate(id, P).map(function (l) { return texHTML(l, true); }).join('') + '</div></div>';
    });

    html += '<div class="res-head"><h3>Resultado en ' + v + ' = ' + fmt(res.xf, 6) + '</h3><div class="muted" style="font-size:0.85rem;">error = |referencia − y<sub>n</sub>|</div></div>';
    const endErr = {};
    let best = null;
    res.ids.forEach(function (id) { endErr[id] = res.errors[id] ? res.errors[id].end : null; });
    const cand = res.ids.filter(function (id) { return endErr[id] != null && isFinite(endErr[id]); });
    if (cand.length > 1) {
      const mn = Math.min.apply(null, cand.map(function (id) { return endErr[id]; }));
      const mx = Math.max.apply(null, cand.map(function (id) { return endErr[id]; }));
      if (mx - mn > 1e-12 + 1e-9 * mx) best = cand.filter(function (id) { return endErr[id] === mn; })[0];
    }
    html += '<div class="grid-3">';
    res.ids.forEach(function (id) {
      const run = res.runs[id], er = res.errors[id];
      const yv = run.diverged ? '—' : fmt(run.yEnd, Math.max(dd, 6));
      html += '<div class="result-card r-' + id + '">' + (best === id ? '<span class="badge ok crown">más preciso</span>' : '') +
        '<div class="nm"><span class="mbadge mb-' + id + '">' + NAME[id] + '</span></div>' +
        '<div class="val">' + yv + '</div>' +
        '<div class="sub">y<sub>' + res.n + '</sub> ≈ y(' + fmt(res.xf, 6) + ')' +
        (er ? '<br>error absoluto: ' + fmtErr(er.end) + (er.rel != null && isFinite(er.rel) ? '<br>error relativo: ' + (er.rel * 100).toPrecision(3) + ' %' : '') : '') +
        '<br>evaluaciones de f: ' + run.evals + '</div></div>';
    });
    html += '</div>';
    if (!best && cand.length > 1) html += '<div class="callout tip" style="margin-top:16px;"><span class="ttl">Empatan</span>Con esta ecuación los métodos dan el mismo resultado (es lo que pasa cuando <b>f es lineal en x e y</b>).</div>';
    $('#tab-resumen').innerHTML = html;
  }

  /* ----- tablas ----- */
  function thMath(tex, cls) { return '<th class="num ' + (cls || '') + '">' + texHTML(tex) + '</th>'; }

  function renderTables(res) {
    const v = res.problem.indep, dd = dispDigits(res), ids = res.ids;
    let html = '';
    html += '<h3 style="margin:0 0 12px;">Valores calculados ' + texHTML('y_n') + ' por método</h3>';
    html += '<div class="table-wrap"><table class="data-table"><thead><tr>' + thMath('n') + thMath(v + '_n') +
      ids.map(function (id) { return '<th class="num th-' + id + '">' + NAME[id] + '</th>'; }).join('') + (res.ref.ys ? '<th class="num">Referencia</th>' : '') + '</tr></thead><tbody>';
    for (let i = 0; i <= res.n; i++) {
      html += '<tr><td class="num">' + i + '</td><td class="num">' + fmt(res.xs[i], 6) + '</td>' +
        ids.map(function (id) { const r = res.runs[id].rows[i]; return '<td class="num">' + (r ? fmt(r.y, dd) : '—') + '</td>'; }).join('') +
        (res.ref.ys ? '<td class="num">' + fmt(res.ref.ys[i], Math.max(dd, 6)) + '</td>' : '') + '</tr>';
    }
    html += '</tbody></table></div>';

    if (res.ref.ys) {
      html += '<h3 style="margin:32px 0 12px;">Error en cada iteración</h3><div class="table-wrap"><table class="data-table"><thead><tr>' + thMath('n') + thMath(v + '_n') +
        ids.map(function (id) { return '<th class="num th-' + id + '">' + NAME[id] + '</th>'; }).join('') + '</tr></thead><tbody>';
      for (let i = 0; i <= res.n; i++) {
        const vals = ids.map(function (id) { const er = res.errors[id]; return er && i < er.abs.length ? er.abs[i] : NaN; });
        const fin = vals.filter(function (x) { return isFinite(x); });
        const mn = fin.length > 1 && i > 0 ? Math.min.apply(null, fin) : null;
        const mx = fin.length > 1 && i > 0 ? Math.max.apply(null, fin) : null;
        html += '<tr><td class="num">' + i + '</td><td class="num">' + fmt(res.xs[i], 6) + '</td>' +
          vals.map(function (x) { const isBest = mn != null && x === mn && (mx - mn) > 1e-12 + 1e-9 * mx; return '<td class="num' + (isBest ? ' best' : '') + '">' + fmtErr(x) + '</td>'; }).join('') + '</tr>';
      }
      html += '</tbody></table></div>';
    }

    html += '<h3 style="margin:32px 0 12px;">Detalle de cada método (como en el apunte)</h3>';
    ids.forEach(function (id, k) { html += methodDetailTable(res, id, k === 0); });
    $('#tab-tablas').innerHTML = html;
  }

  function methodDetailTable(res, id, open) {
    const v = res.problem.indep, dd = dispDigits(res);
    const rows = res.runs[id].rows;
    const cols = {
      euler: ['n', v + '_n', 'y_n', "y'_n = f(" + v + '_n, y_n)', 'y_{n+1}'],
      taylor: ['n', v + '_n', 'y_n', "y'_n", '\\tfrac{\\partial f}{\\partial x}', '\\tfrac{\\partial f}{\\partial y}', "y''_n", 'y_{n+1}'],
      heun: ['n', v + '_n', 'y_n', "y'_n", '\\tilde y_{n+1}', 'f(' + v + '_{n+1}, \\tilde y_{n+1})', 'y_{n+1}'],
      rk2: ['n', v + '_n', 'y_n', 'k_1', v + '_n + h/2', 'y_n + k_1/2', 'f(\\cdot)', 'y_{n+1}'],
    }[id];
    let html = '<details class="step-method"' + (open ? ' open' : '') + '><summary><span class="mbadge mb-' + id + '">' + NAME[id] + '</span></summary><div class="body"><div class="table-wrap"><table class="data-table compact"><thead><tr>' +
      cols.map(function (c) { return thMath(c); }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r, i) {
      const p = r.parts, nx = rows[i + 1];
      const yn1 = nx ? fmt(nx.y, dd) : '—';
      let cells;
      if (id === 'euler') cells = [i, fmt(r.x, 6), fmt(r.y, dd), p ? fmt(p.d1, dd) : '—', yn1];
      else if (id === 'taylor') cells = [i, fmt(r.x, 6), fmt(r.y, dd), p ? fmt(p.d1, dd) : '—', p ? fmt(p.fxv, dd) : '—', p ? fmt(p.fyv, dd) : '—', p ? fmt(p.d2, dd) : '—', yn1];
      else if (id === 'heun') cells = [i, fmt(r.x, 6), fmt(r.y, dd), p ? fmt(p.d1, dd) : '—', p ? fmt(p.yp, dd) : '—', p ? fmt(p.d1p, dd) : '—', yn1];
      else cells = [i, fmt(r.x, 6), fmt(r.y, dd), p ? fmt(p.k1, dd) : '—', p ? fmt(p.xm, dd) : '—', p ? fmt(p.ym, dd) : '—', p ? fmt(p.s, dd) : '—', yn1];
      html += '<tr>' + cells.map(function (c) { return '<td class="num">' + c + '</td>'; }).join('') + '</tr>';
    });
    html += '</tbody></table></div></div></details>';
    return html;
  }

  /* ----- paso a paso ----- */
  function renderSteps(res) {
    const dd = dispDigits(res), P = res.problem;
    let html = '<p style="color:var(--text-secondary); margin-top:0;">Cada iteración con los números reemplazados, igual que en los ejemplos resueltos del apunte. Hacé clic en una iteración para abrirla.</p>';
    res.ids.forEach(function (id, k) {
      const run = res.runs[id];
      html += '<details class="step-method"' + (k === 0 ? ' open' : '') + '><summary><span class="mbadge mb-' + id + '">' + NAME[id] + '</span></summary><div class="body">';
      run.rows.forEach(function (r, i) {
        if (i >= run.rows.length - 1) return;
        const nx = run.rows[i + 1];
        html += '<details class="iter" data-m="' + id + '" data-i="' + i + '"' + (i === 0 ? ' open' : '') + '><summary><span>Iteración n = ' + i + ' &nbsp;<span class="muted">(' + P.indep + '<sub>' + i + '</sub> = ' + fmt(r.x, 6) + ')</span></span><span class="res">y<sub>' + (i + 1) + '</sub> = ' + fmt(nx.y, dd) + ' = y(' + fmt(nx.x, 6) + ')</span></summary><div class="lines"></div></details>';
      });
      html += '</div></details>';
    });
    const box = $('#tab-pasos');
    const fresh = box.cloneNode(false);          // quita listeners viejos
    box.parentNode.replaceChild(fresh, box);
    fresh.innerHTML = html;
    const fill = function (det) {
      const lines = $('.lines', det);
      if (!lines || lines.dataset.done) return;
      lines.dataset.done = '1';
      const id = det.dataset.m, i = parseInt(det.dataset.i, 10);
      const ds = E.derivation(id, P, res, i, dd);
      lines.innerHTML = ds.map(function () { return '<div class="line"><div class="cap"></div><div class="tex"></div></div>'; }).join('');
      $$('.line', lines).forEach(function (ln, j) { $('.cap', ln).textContent = ds[j].label; texTo($('.tex', ln), ds[j].tex, true); });
    };
    fresh.addEventListener('toggle', function (e) { const t = e.target; if (t.classList && t.classList.contains('iter') && t.open) fill(t); }, true);
    $$('.iter[open]', fresh).forEach(fill);
  }

  /* ----- gráficos del resultado ----- */
  function mountResultCharts(res) {
    state.chartsDirty = false;
    const refName = res.ref.kind === 'exact' ? 'Solución exacta' : 'Referencia (RK4 fino)';
    mountChart('sol', function () {
      const ds = [];
      if (res.ref.fine) ds.push({ label: refName, data: res.ref.fine.x.map(function (x, i) { return { x: x, y: res.ref.fine.y[i] }; }), borderColor: cssVar('--m-ref'), backgroundColor: cssVar('--m-ref'), borderWidth: 2, pointRadius: 0, showLine: true, tension: 0, order: 10 });
      res.ids.forEach(function (id) {
        ds.push({ label: NAME[id], data: res.runs[id].rows.map(function (r) { return { x: r.x, y: r.y }; }), borderColor: mcolor(id), backgroundColor: mcolor(id), pointRadius: res.n > 40 ? 0 : 4.5, pointStyle: STYLE[id], showLine: true, borderWidth: 2, tension: 0, borderDash: id === 'euler' ? [5, 4] : [] });
      });
      return new Chart($('#chartSol'), {
        type: 'scatter', data: { datasets: ds },
        options: { maintainAspectRatio: false, animation: { duration: 350 }, interaction: { mode: 'nearest', intersect: false },
          plugins: { legend: legendStyle(), tooltip: tooltipStyle() },
          scales: { x: axisStyle({ title: axTitle(res.problem.indep) }), y: axisStyle({ title: axTitle('y') }) } },
      });
    });
    mountChart('err', function () {
      const ds = [];
      res.ids.forEach(function (id) {
        const er = res.errors[id];
        if (!er) return;
        const pts = [];
        er.abs.forEach(function (e, i) { if (i > 0 && e > 0) pts.push({ x: res.xs[i], y: e }); });
        ds.push({ label: NAME[id], data: pts, borderColor: mcolor(id), backgroundColor: mcolor(id), pointRadius: res.n > 40 ? 0 : 4, pointStyle: STYLE[id], showLine: true, borderWidth: 2, tension: 0, borderDash: id === 'euler' ? [5, 4] : [] });
      });
      return new Chart($('#chartErr'), {
        type: 'scatter', data: { datasets: ds },
        options: { maintainAspectRatio: false, animation: { duration: 350 }, interaction: { mode: 'nearest', intersect: false },
          plugins: { legend: legendStyle(), tooltip: tooltipStyle() },
          scales: { x: axisStyle({ title: axTitle(res.problem.indep) }), y: axisStyle({ type: 'logarithmic', title: axTitle('error absoluto') }) } },
      });
    });
    $('#chartSolSub').textContent = res.ref.kind === 'exact' ? 'La línea continua sin marcadores es la solución exacta' : 'La línea continua sin marcadores es la solución de referencia (RK4 con paso fino)';
  }

  /* ----- chequear mi resolución ----- */
  function fillCheckSelect(res) {
    $('#chkMethod').innerHTML = res.ids.map(function (id) { return '<option value="' + id + '">' + esc(NAME[id]) + '</option>'; }).join('');
  }

  function runCheck() {
    const out = $('#chkOut');
    const cur = state.last;
    if (!cur) { out.innerHTML = '<div class="alert">Primero calculá un ejercicio.</div>'; return; }
    const res = cur.res, id = $('#chkMethod').value;
    const raw = $('#chkValues').value.trim();
    if (!raw) { out.innerHTML = '<div class="alert warn">Pegá tus valores y₁, y₂, … para compararlos.</div>'; return; }
    const toks = raw.split(/[\s;]+/).map(function (t) { return t.replace(/,+$/, '').replace(',', '.'); }).filter(Boolean);
    const mine = toks.map(Number);
    if (mine.some(function (x) { return !isFinite(x); })) { out.innerHTML = '<div class="alert">Hay valores que no son números. Separalos con espacios o punto y coma (usá punto o coma para los decimales).</div>'; return; }
    const full = E.run(id, res.problem, res.x0, res.y0, res.h, res.n, null);
    const r4 = E.run(id, res.problem, res.x0, res.y0, res.h, res.n, 4);
    let firstBad = -1;
    let html = '<div class="table-wrap"><table class="data-table compact"><thead><tr><th class="num">n</th><th class="num">Tu valor</th><th class="num">Calculadora</th><th class="num">Diferencia</th><th>Estado</th></tr></thead><tbody>';
    mine.forEach(function (val, k) {
      const i = k + 1;
      const c = full.rows[i], c4 = r4.rows[i];
      if (!c) { html += '<tr><td class="num">' + i + '</td><td class="num">' + fmt(val, 6) + '</td><td class="num">—</td><td class="num">—</td><td><span class="badge warn">de más</span></td></tr>'; return; }
      const d = Math.min(Math.abs(val - c.y), c4 ? Math.abs(val - c4.y) : Infinity);
      const status = d <= 2e-4 ? 'ok' : (d <= 2e-3 ? 'warn' : 'bad');
      if (status !== 'ok' && firstBad < 0) firstBad = i;
      html += '<tr><td class="num">' + i + '</td><td class="num">' + fmt(val, 6) + '</td><td class="num">' + fmt(c.y, 6) + '</td><td class="num">' + fmtErr(d) + '</td><td><span class="badge ' + status + '">' + (status === 'ok' ? 'coincide' : status === 'warn' ? 'casi (¿redondeo?)' : 'no coincide') + '</span></td></tr>';
    });
    html += '</tbody></table></div>';
    let verdict;
    if (mine.length > res.n) verdict = '<div class="alert warn verdict">Ingresaste ' + mine.length + ' valores pero el ejercicio tiene ' + res.n + ' iteraciones.</div>';
    else if (firstBad < 0) verdict = '<div class="alert info verdict" style="border-color:var(--success); background:var(--success-soft); color:var(--success);">✅ Todos tus valores coinciden con la calculadora' + (mine.length < res.n ? ' (te faltan ' + (res.n - mine.length) + ' iteraciones)' : '') + '.</div>';
    else verdict = '<div class="alert verdict">Tu primera diferencia aparece en la <b>iteración n = ' + firstBad + '</b> (y<sub>' + firstBad + '</sub>). Abrí la pestaña «Paso a paso», mirá la iteración ' + (firstBad - 1) + ' y compará cada línea con la tuya.</div>';
    out.innerHTML = verdict + html;
  }

  /* ----- tabs ----- */
  function setupTabs() {
    $$('#resTabs .tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#resTabs .tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        $$('#calcResults .tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab); });
        if (btn.dataset.tab === 'graficos' && state.last && (state.chartsDirty || !charts.sol)) mountResultCharts(state.last.res);
      });
    });
  }

  /* ----------------------------- laboratorio ----------------------------- */
  function updateStepLab() {
    const src = $('#stepSource').value, slider = $('#stepH');
    let Pb, x0, y0;
    if (src === 'calc' && !state.last) {
      $('#stepFigure').innerHTML = '<div class="alert info">Primero calculá un ejercicio en la calculadora (sección 4) y acá vas a ver un paso de <em>tu</em> problema.</div>';
      $('#stepTable').innerHTML = '';
      return;
    }
    if (src === 'calc' && state.last) { Pb = state.last.res.problem; x0 = state.last.res.x0; y0 = state.last.res.y0; }
    else { Pb = DIDACTIC; x0 = 0; y0 = 1; }
    const h = parseFloat(slider.value);
    $('#stepHVal').textContent = 'h = ' + fmt(h, 4);
    const st = renderStepFigure($('#stepFigure'), { Pb: Pb, x0: x0, y0: y0, h: h, showField: $('#stepField').checked });
    const tbl = $('#stepTable');
    if (!st) { tbl.innerHTML = ''; return; }
    let html = '<thead><tr><th>Método</th><th class="wrap">Cómo elige la pendiente</th><th class="num">y₁</th><th class="num">|y(x₁) − y₁|</th></tr></thead><tbody>';
    ['euler', 'taylor', 'heun', 'rk2'].forEach(function (id) {
      html += '<tr><td><span class="mbadge mb-' + id + '">' + NAME[id] + '</span></td><td class="wrap">' + HOW[id] + '</td><td class="num">' + fmt(st[id].y, 6) + '</td><td class="num">' + fmtErr(Math.abs(st.exact.y1 - st[id].y)) + '</td></tr>';
    });
    html += '<tr><td><span class="mbadge mb-ref">Solución exacta</span></td><td class="wrap muted">referencia</td><td class="num">' + fmt(st.exact.y1, 6) + '</td><td class="num">—</td></tr></tbody>';
    tbl.innerHTML = html;
  }

  function setStepSliderForSource() {
    const slider = $('#stepH');
    if ($('#stepSource').value === 'calc' && state.last) {
      const b = state.last.res.h;
      slider.min = b * 0.5; slider.max = b * 8; slider.step = b * 0.25; slider.value = b;
    } else {
      slider.min = 0.1; slider.max = 0.8; slider.step = 0.05; slider.value = 0.5;
    }
  }

  let defaultConv = null;
  function defaultConvResult() {
    if (!defaultConv) defaultConv = E.solve({ fStr: 'y^2', indep: 'x', x0: 0, y0: 1, h: 0.1, xf: 0.5, methods: ['rk2'], exactStr: '1/(1-x)' });
    return defaultConv;
  }

  function updateConvLab(res) {
    const isDefault = res === defaultConv;
    const sub = $('#convSub'), tbl = $('#convTable'), note = $('#convNote');
    if (!res.ref || !res.ref.ys) { sub.textContent = 'No hay referencia para este problema.'; tbl.innerHTML = ''; note.textContent = ''; return; }
    const cv = E.convergence(res.problem, res.x0, res.y0, res.h, res.n, res.ref.ys[res.n]);
    state.conv = cv;
    sub.textContent = (isDefault ? 'Ejemplo didáctico (calculá un ejercicio arriba para usar el tuyo): ' : 'Tu problema: ') + 'y′ = ' + res.problem.fStr.replace(/\*/g, '·') + ' · h inicial = ' + fmt(res.h, 6) + ' (' + res.n + ' pasos) · ' + cv.levels.length + ' niveles de h';
    const ids = ['euler', 'taylor', 'heun', 'rk2'];
    let html = '<thead><tr><th class="num">h</th><th class="num">n</th>' + ids.map(function (id) { return '<th class="num th-' + id + '">' + SHORT[id] + '</th>'; }).join('') + '</tr></thead><tbody>';
    cv.levels.forEach(function (lv, k) {
      html += '<tr><td class="num">' + fmt(lv.h, 6) + '</td><td class="num">' + lv.n + '</td>' + ids.map(function (id) { return '<td class="num">' + fmtErr(cv.series[id][k]) + '</td>'; }).join('') + '</tr>';
    });
    const lastOrder = {};
    ids.forEach(function (id) {
      const o = cv.orders[id].filter(function (x) { return x != null; });
      lastOrder[id] = o.length ? o.slice(-3).reduce(function (a, b) { return a + b; }, 0) / Math.min(3, o.length) : null;
    });
    html += '<tr><td colspan="2"><b>orden observado</b></td>' + ids.map(function (id) { return '<td class="num"><b>' + (lastOrder[id] != null ? lastOrder[id].toFixed(2) : '—') + '</b></td>'; }).join('') + '</tr></tbody>';
    tbl.innerHTML = html;
    note.innerHTML = '<span class="ttl">Cómo leerlo</span>Cada vez que \\(h\\) se divide por 2, el error de Euler se divide por ≈ 2 (orden 1) y el de Taylor, Euler mejorado y RK2 por ≈ 4 (orden 2). Por eso los tres son «de orden 2»: su curva en el log-log es paralela a la recta de pendiente 2, y la de Euler a la de pendiente 1.';
    typeset(note);
    mountChart('conv', function () {
      const ds = ids.map(function (id) {
        return { label: NAME[id], data: cv.levels.map(function (lv, k) { return { x: lv.h, y: cv.series[id][k] }; }).filter(function (p) { return p.y > 0 && isFinite(p.y); }), borderColor: mcolor(id), backgroundColor: mcolor(id), pointStyle: STYLE[id], pointRadius: 5, showLine: true, borderWidth: 2, tension: 0, borderDash: id === 'euler' ? [5, 4] : [] };
      });
      const h0 = cv.levels[0].h, hN = cv.levels[cv.levels.length - 1].h;
      const guide = function (label, e0, p) {
        if (!(e0 > 0)) return null;
        return { label: label, data: [{ x: hN, y: e0 * Math.pow(hN / h0, p) }, { x: h0, y: e0 }], borderColor: cssVar('--text-tertiary'), borderDash: [2, 4], borderWidth: 1.2, pointRadius: 0, showLine: true, tension: 0 };
      };
      const g1 = guide('pendiente 1 (∝ h)', cv.series.euler[0], 1), g2 = guide('pendiente 2 (∝ h²)', cv.series.heun[0], 2);
      if (g1) ds.push(g1);
      if (g2) ds.push(g2);
      return new Chart($('#chartConv'), {
        type: 'scatter', data: { datasets: ds },
        options: { maintainAspectRatio: false, animation: { duration: 350 }, interaction: { mode: 'nearest', intersect: false },
          plugins: { legend: legendStyle(), tooltip: tooltipStyle() },
          scales: { x: axisStyle({ type: 'logarithmic', title: axTitle('paso h') }), y: axisStyle({ type: 'logarithmic', title: axTitle('error en el punto final') }) } },
      });
    });
  }

  function onNewResult(res) {
    if ($('#stepSource').value === 'calc') { setStepSliderForSource(); updateStepLab(); }
    updateConvLab(res);
  }

  function setupLabs() {
    $('#stepSource').addEventListener('change', function () { setStepSliderForSource(); updateStepLab(); });
    $('#stepH').addEventListener('input', updateStepLab);
    $('#stepField').addEventListener('change', updateStepLab);
    updateStepLab();
    updateConvLab(defaultConvResult());
  }

  /* ----------------------------- calculadora: eventos ----------------------------- */
  function setupCalculator() {
    $('#calcForm').addEventListener('submit', function (e) { e.preventDefault(); calculate(); });
    $('#btnClear').addEventListener('click', function () {
      ['#fInput', '#x0Input', '#y0Input', '#hInput', '#xfInput', '#exactInput'].forEach(function (s) { $(s).value = ''; });
      $('#vSelect').value = 'x'; $('#digitsSelect').value = 'full';
      setMethods([]);
      updateLabels(); updateParsed(); updateDerived(); clearError();
      $('#calcResults').hidden = true; state.last = null;
      updateStepLab(); updateConvLab(defaultConvResult());
    });
    $('#btnPickThree').addEventListener('click', function () { setMethods(['taylor', 'heun', 'rk2']); });
    $('#btnPickNone').addEventListener('click', function () { setMethods([]); });
    let timer = null;
    $('#fInput').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(updateParsed, 180); $('#exactInput').value = ''; });
    $('#vSelect').addEventListener('change', function () { updateLabels(); updateParsed(); updateDerived(); });
    ['#x0Input', '#y0Input', '#hInput', '#xfInput'].forEach(function (s) { $(s).addEventListener('input', updateDerived); });
    $('#btnCheck').addEventListener('click', runCheck);
    setupTabs();
    updateLabels(); updateParsed(); updateDerived();
  }

  /* ----------------------------- init ----------------------------- */
  function init() {
    typeset(document.body);
    setupTheme();
    setupNav();
    setupReveal();
    renderHeroFigure();
    renderMethodFigures();
    setupCalculator();
    setupLabs();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
