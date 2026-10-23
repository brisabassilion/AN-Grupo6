/* ============================================================
   Motor numérico — Taylor (orden 2), Euler mejorado, RK2 (punto medio) y Euler
   para problemas de valor inicial  y' = f(x, y),  y(x0) = y0.

   Las fórmulas son las del apunte de la cátedra (Ing. Amiconi):
     Euler          y_{n+1} = y_n + h·y'_n
     Taylor (2)     y_{n+1} = y_n + h·y'_n + h²/2!·y''_n ,  y'' = ∂f/∂x + ∂f/∂y·y'
     Euler mejorado y_{n+1} = y_n + h/2!·[ f(x_n,y_n) + f(x_{n+1}, y_n + h·y'_n) ]
     RK2            y_{n+1} = y_n + h·f(x_n + h/2, y_n + k1/2) ,  k1 = h·f(x_n,y_n)

   Este archivo no toca el DOM: se puede probar desde Node.
   La ecuación que escribe el usuario se interpreta con math.js y se convierte
   en funciones JavaScript mediante closures (no se usa eval).
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let math = null;
  const api = {};

  /** Error "esperado" (algo que el usuario puede corregir): se muestra tal cual. */
  class UserError extends Error {
    constructor(msg) { super(msg); this.name = 'UserError'; }
  }
  api.UserError = UserError;

  api.init = function (m) { math = m; return api; };

  /* ---------------------------------------------------------------
     Metadatos de los métodos
     --------------------------------------------------------------- */
  api.METHODS = {
    euler:  { id: 'euler',  name: 'Euler',                       short: 'Euler',          order: 1, evals: 1, needsDerivs: false },
    taylor: { id: 'taylor', name: 'Taylor (orden 2)',            short: 'Taylor 2',       order: 2, evals: 3, needsDerivs: true  },
    heun:   { id: 'heun',   name: 'Euler mejorado',              short: 'Euler mejorado', order: 2, evals: 2, needsDerivs: false },
    rk2:    { id: 'rk2',    name: 'Runge-Kutta 2 (punto medio)', short: 'RK2',            order: 2, evals: 2, needsDerivs: false },
  };
  api.METHOD_IDS = ['taylor', 'heun', 'rk2', 'euler'];

  /* ---------------------------------------------------------------
     Utilidades numéricas
     --------------------------------------------------------------- */
  function roundTo(v, d) {
    if (d == null || !isFinite(v)) return v;
    const m = Math.pow(10, d);
    return Math.round((v + Math.sign(v) * Number.EPSILON * Math.abs(v)) * m) / m;
  }
  api.roundTo = roundTo;

  function cleanX(v) { return Number(v.toFixed(12)); }
  api.cleanX = cleanX;

  /** Número con hasta `d` decimales, sin ceros de más. */
  function fmt(v, d) {
    if (d == null) d = 6;
    if (v === 0 || Object.is(v, -0)) return '0';
    if (!isFinite(v)) return String(v);
    const a = Math.abs(v);
    if (a >= 1e9 || a < 1e-7) return v.toExponential(Math.min(d, 6)).replace(/\.?0+e/, 'e');
    let s = v.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }
  api.fmt = fmt;

  /** Igual que fmt pero devuelve TeX (notación científica con \cdot 10^). */
  function texNum(v, d) {
    const s = fmt(v, d);
    const m = s.match(/^(-?[\d.]+)e([+-]?\d+)$/);
    if (m) return m[1] + '\\cdot 10^{' + parseInt(m[2], 10) + '}';
    return s;
  }
  api.texNum = texNum;

  /* ---------------------------------------------------------------
     Pre-procesado de lo que escribe el usuario
     --------------------------------------------------------------- */
  const ALIASES = {
    sen: 'sin', tg: 'tan', ln: 'log', raiz: 'sqrt', arcsen: 'asin', arccos: 'acos',
    arctg: 'atan', arctan: 'atan', senh: 'sinh', sh: 'sinh', ch: 'cosh', th: 'tanh', cosec: 'csc',
  };
  const FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log',
    'log10', 'log2', 'sqrt', 'cbrt', 'abs', 'sign', 'sec', 'csc', 'cot', 'coth', 'sech', 'csch']);
  const CONSTS = new Set(['pi', 'e']);

  function preprocess(src) {
    let s = String(src == null ? '' : src);
    s = s.replace(/[−–—]/g, '-').replace(/[×·⋅∙]/g, '*').replace(/÷/g, '/');
    s = s.replace(/²/g, '^2').replace(/³/g, '^3').replace(/⁴/g, '^4');
    s = s.replace(/π/g, ' pi ');
    s = s.replace(/√\s*\(/g, 'sqrt(').replace(/√\s*([A-Za-z0-9_.]+)/g, 'sqrt($1)');
    s = s.replace(/[A-Za-z_][A-Za-z_0-9]*/g, function (tok) {
      const low = tok.toLowerCase();
      if (ALIASES[low]) return ALIASES[low];
      if (FUNCS.has(low) || CONSTS.has(low)) return low;
      if (low.length > 1 && /^[xyt]+$/.test(low)) return low.split('').join('*'); // xy -> x*y
      return low;
    });
    return s;
  }
  api.preprocess = preprocess;

  function fname(n) { return (n.fn && n.fn.name) ? n.fn.name : n.name; }

  /** Recorre el árbol; devuelve el conjunto de símbolos (sin nombres de función). */
  function symbolsOf(node) {
    const out = new Set();
    (function walk(n) {
      if (n.isSymbolNode) { out.add(n.name); return; }
      if (n.isConstantNode) return;
      if (n.isParenthesisNode) { walk(n.content); return; }
      if (n.isOperatorNode || n.isFunctionNode) {
        if (n.isFunctionNode && !FUNCS.has(fname(n))) throw new UserError('No conozco la función «' + fname(n) + '». Probá con sin, cos, tan, exp, log, sqrt, abs…');
        n.args.forEach(walk); return;
      }
      throw new UserError('Hay algo en la ecuación que no puedo interpretar (' + n.type + ').');
    })(node);
    return out;
  }

  function parse(src) {
    const pre = preprocess(src);
    if (!pre.trim()) throw new UserError('Escribí la ecuación f(x, y).');
    let node;
    try { node = math.parse(pre); }
    catch (e) { throw new UserError('No pude interpretar la ecuación («' + String(src).trim() + '»). Revisá los paréntesis y usá * para multiplicar. Detalle: ' + e.message); }
    // e^(algo)  ->  exp(algo)  (queda más lindo al derivar y al mostrar)
    node = node.transform(function (n) {
      if (n.isOperatorNode && n.fn === 'pow' && n.args[0].isSymbolNode && n.args[0].name === 'e') {
        return new math.FunctionNode('exp', [n.args[1]]);
      }
      return n;
    });
    return node;
  }
  api.parse = parse;
  api.symbolsOf = symbolsOf;

  function detectIndep(node) {
    const s = symbolsOf(node);
    if (s.has('t') && !s.has('x')) return 't';
    return 'x';
  }
  api.detectIndep = detectIndep;

  function validate(node, indep, allowY) {
    const s = symbolsOf(node);
    s.forEach(function (name) {
      if (name === indep || name === 'pi' || name === 'e') return;
      if (name === 'y' && allowY) return;
      if (name === 'x' || name === 't') {
        throw new UserError('En la ecuación aparece «' + name + '» pero la variable independiente elegida es «' + indep + '».');
      }
      if (name === 'y' && !allowY) throw new UserError('La solución exacta tiene que depender sólo de ' + indep + ', no de y.');
      throw new UserError('No reconozco «' + name + '». Usá solamente ' + indep + ' e y (y para multiplicar escribí *, por ejemplo 2*x*y).');
    });
  }

  /* ---------------------------------------------------------------
     Compilación a closures (rápido y sin eval)
     --------------------------------------------------------------- */
  const FN1 = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, sqrt: Math.sqrt, cbrt: Math.cbrt,
    abs: Math.abs, sign: Math.sign, log: Math.log, log10: Math.log10, log2: Math.log2,
    sec: function (v) { return 1 / Math.cos(v); },
    csc: function (v) { return 1 / Math.sin(v); },
    cot: function (v) { return 1 / Math.tan(v); },
    coth: function (v) { return 1 / Math.tanh(v); },
    sech: function (v) { return 1 / Math.cosh(v); },
    csch: function (v) { return 1 / Math.sinh(v); },
  };

  function build(n, indep) {
    if (n.isConstantNode) {
      if (typeof n.value !== 'number') throw new UserError('Sólo se admiten números reales.');
      const v = n.value;
      return function () { return v; };
    }
    if (n.isSymbolNode) {
      if (n.name === indep) return function (X) { return X; };
      if (n.name === 'y') return function (X, Y) { return Y; };
      if (n.name === 'pi') return function () { return Math.PI; };
      if (n.name === 'e') return function () { return Math.E; };
      throw new UserError('Símbolo desconocido «' + n.name + '».');
    }
    if (n.isParenthesisNode) return build(n.content, indep);
    if (n.isOperatorNode) {
      const a = n.args.map(function (c) { return build(c, indep); });
      switch (n.fn) {
        case 'add':
          if (a.length === 2) return function (X, Y) { return a[0](X, Y) + a[1](X, Y); };
          return function (X, Y) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i](X, Y); return s; };
        case 'subtract':
          if (a.length === 2) return function (X, Y) { return a[0](X, Y) - a[1](X, Y); };
          return function (X, Y) { let s = a[0](X, Y); for (let i = 1; i < a.length; i++) s -= a[i](X, Y); return s; };
        case 'multiply':
          if (a.length === 2) return function (X, Y) { return a[0](X, Y) * a[1](X, Y); };
          return function (X, Y) { let s = 1; for (let i = 0; i < a.length; i++) s *= a[i](X, Y); return s; };
        case 'divide':
          if (a.length === 2) return function (X, Y) { return a[0](X, Y) / a[1](X, Y); };
          return function (X, Y) { let s = a[0](X, Y); for (let i = 1; i < a.length; i++) s /= a[i](X, Y); return s; };
        case 'pow': return function (X, Y) { return Math.pow(a[0](X, Y), a[1](X, Y)); };
        case 'unaryMinus': return function (X, Y) { return -a[0](X, Y); };
        case 'unaryPlus': return a[0];
        case 'mod': return function (X, Y) { return a[0](X, Y) % a[1](X, Y); };
        default: throw new UserError('Operador no soportado: ' + n.op);
      }
    }
    if (n.isFunctionNode) {
      const name = fname(n);
      const a = n.args.map(function (c) { return build(c, indep); });
      if (name === 'log' && a.length === 2) return function (X, Y) { return Math.log(a[0](X, Y)) / Math.log(a[1](X, Y)); };
      const fn = FN1[name];
      if (!fn) throw new UserError('Función no soportada: ' + name);
      return function (X, Y) { return fn(a[0](X, Y)); };
    }
    throw new UserError('Expresión no soportada (' + n.type + ').');
  }

  function compile(node, indep) { return build(node, indep); }
  api.compile = compile;

  /** Evalúa una expresión numérica sencilla (por ejemplo "0,5", "pi/4", "1/3"). */
  function parseNumber(str, label) {
    const raw = String(str == null ? '' : str).trim();
    if (!raw) throw new UserError('Falta completar ' + label + '.');
    const s = raw.replace(/,/g, '.');
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return parseFloat(s);
    let node;
    try { node = math.parse(preprocess(s)); }
    catch (e) { throw new UserError('No entiendo el valor de ' + label + ': «' + raw + '».'); }
    const syms = symbolsOf(node);
    syms.forEach(function (n) { if (n !== 'pi' && n !== 'e') throw new UserError('El valor de ' + label + ' tiene que ser un número (encontré «' + n + '»).'); });
    const v = compile(node, 'x')(0, 0);
    if (!isFinite(v)) throw new UserError('El valor de ' + label + ' no es un número válido.');
    return v;
  }
  api.parseNumber = parseNumber;

  /* ---------------------------------------------------------------
     Generador de TeX propio (control total de paréntesis y sustituciones)
     --------------------------------------------------------------- */
  const P = { add: 10, mul: 20, neg: 30, pow: 40, atom: 100 };
  const wrap = function (s) { return '\\left(' + s + '\\right)'; };

  function unp(n) { while (n.isParenthesisNode) n = n.content; return n; }
  function isNegConst(n) { return n.isConstantNode && typeof n.value === 'number' && n.value < 0; }
  function isNegLike(n) { return isNegConst(n) || (n.isOperatorNode && n.fn === 'unaryMinus'); }

  function precOf(n) {
    if (n.isParenthesisNode || n.isSymbolNode || n.isFunctionNode) return P.atom;
    if (n.isConstantNode) return isNegConst(n) ? P.neg : P.atom;
    if (n.isOperatorNode) {
      switch (n.fn) {
        case 'add': case 'subtract': return P.add;
        case 'multiply': return P.mul;
        case 'divide': return P.atom; // se dibuja como \frac
        case 'unaryMinus': case 'unaryPlus': return P.neg;
        case 'pow': return P.pow;
        default: return P.atom;
      }
    }
    return P.atom;
  }

  function isLetterish(n, subst) {
    if (n.isSymbolNode) return !(subst && subst.__numeric) && n.name !== 'pi';
    if (n.isFunctionNode) return true;
    if (n.isOperatorNode && n.fn === 'pow') return isLetterish(n.args[0], subst);
    return false;
  }

  /**
   * node  : nodo de math.js
   * subst : { nombreSímbolo: 'tex' }  (opcional). Con subst.__numeric = true se usa siempre \cdot.
   */
  function texNode(node, subst) {
    const numeric = !!(subst && subst.__numeric);
    const T = function (c) { return texNode(c, subst); };
    const W = function (c, min) { return precOf(c) < min ? wrap(T(c)) : T(c); };

    if (node.isParenthesisNode) return wrap(T(node.content));
    if (node.isConstantNode) return texNum(node.value, 10);
    if (node.isSymbolNode) {
      if (subst && Object.prototype.hasOwnProperty.call(subst, node.name)) return subst[node.name];
      if (node.name === 'pi') return '\\pi';
      return node.name;
    }
    if (node.isFunctionNode) {
      const name = fname(node);
      const a = node.args.map(function (c) { return T(unp(c)); });
      switch (name) {
        case 'exp': return 'e^{' + a[0] + '}';
        case 'sqrt': return '\\sqrt{' + a[0] + '}';
        case 'abs': return '\\left|' + a[0] + '\\right|';
        case 'log': return a.length === 1 ? '\\ln\\left(' + a[0] + '\\right)' : '\\log_{' + a[1] + '}\\left(' + a[0] + '\\right)';
        case 'asin': return '\\arcsin\\left(' + a[0] + '\\right)';
        case 'acos': return '\\arccos\\left(' + a[0] + '\\right)';
        case 'atan': return '\\arctan\\left(' + a[0] + '\\right)';
        case 'sin': case 'cos': case 'tan': case 'sinh': case 'cosh': case 'tanh':
          return '\\' + name + '\\left(' + a[0] + '\\right)';
        default: return '\\operatorname{' + name + '}\\left(' + a.join(', ') + '\\right)';
      }
    }
    if (node.isOperatorNode) {
      const a = node.args;
      switch (node.fn) {
        case 'add': {
          let out = W(a[0], P.add);
          for (let i = 1; i < a.length; i++) {
            const c = a[i];
            if (c.isOperatorNode && c.fn === 'unaryMinus') out += ' - ' + (isNegLike(c.args[0]) ? wrap(T(c.args[0])) : W(c.args[0], P.mul));
            else if (isNegConst(c)) out += ' - ' + texNum(-c.value, 10);
            else out += ' + ' + W(c, P.mul);
          }
          return out;
        }
        case 'subtract': {
          let out = W(a[0], P.add);
          for (let i = 1; i < a.length; i++) {
            const c = a[i];
            out += ' - ' + (isNegLike(c) ? wrap(T(c)) : W(c, P.mul));
          }
          return out;
        }
        case 'multiply': {
          let out = W(a[0], P.mul);
          for (let i = 1; i < a.length; i++) {
            const c = a[i];
            const cs = isNegLike(c) ? wrap(T(c)) : W(c, P.mul);
            let joiner = ' \\cdot ';
            if (!numeric) {
              const prev = a[i - 1];
              const prevNum = prev.isConstantNode && !isNegConst(prev);
              if (prevNum && isLetterish(c, subst)) joiner = '';
              else if (isLetterish(prev, subst) && isLetterish(c, subst)) joiner = '\\,';
            }
            out += joiner + cs;
          }
          return out;
        }
        case 'divide': return '\\frac{' + T(unp(a[0])) + '}{' + T(unp(a[1])) + '}';
        case 'pow': return W(a[0], P.atom) + '^{' + T(unp(a[1])) + '}';
        case 'unaryMinus': return '-' + (isNegLike(a[0]) ? wrap(T(a[0])) : W(a[0], P.mul));
        case 'unaryPlus': return T(a[0]);
        default: return '\\operatorname{' + node.fn + '}';
      }
    }
    return '?';
  }
  api.texNode = texNode;

  /* ---------------------------------------------------------------
     Construcción del problema (ecuación + derivadas)
     --------------------------------------------------------------- */
  function buildProblem(fStr, indepOpt) {
    const node = parse(fStr);
    const indep = indepOpt || detectIndep(node);
    validate(node, indep, true);
    const f = compile(node, indep);

    let fxNode = null, fyNode = null, fx, fy, derivKind = 'symbolic';
    try {
      fxNode = math.derivative(node, indep);
      fyNode = math.derivative(node, 'y');
      fx = compile(fxNode, indep);
      fy = compile(fyNode, indep);
    } catch (e) {
      derivKind = 'numerical';
      fxNode = fyNode = null;
      fx = function (x, y) { const d = 1e-5 * Math.max(1, Math.abs(x)); return (f(x + d, y) - f(x - d, y)) / (2 * d); };
      fy = function (x, y) { const d = 1e-5 * Math.max(1, Math.abs(y)); return (f(x, y + d) - f(x, y - d)) / (2 * d); };
    }

    let d2Node = null;
    if (fxNode && fyNode) {
      const raw = new math.OperatorNode('+', 'add', [fxNode, new math.OperatorNode('*', 'multiply', [fyNode, node])]);
      try { d2Node = math.simplify(raw); } catch (e) { d2Node = raw; }
    }

    return {
      fStr: String(fStr).trim(), indep: indep,
      nodes: { f: node, fx: fxNode, fy: fyNode, d2: d2Node },
      fns: { f: f, fx: fx, fy: fy },
      derivKind: derivKind,
      texF: texNode(node, null),
    };
  }
  api.buildProblem = buildProblem;

  function buildExact(exactStr, indep) {
    const s = String(exactStr || '').trim();
    if (!s) return null;
    const node = parse(s);
    validate(node, indep, false);
    return { fn: compile(node, indep), tex: texNode(node, null), str: s };
  }
  api.buildExact = buildExact;

  /* ---------------------------------------------------------------
     Un paso de cada método (fórmulas del apunte)
     --------------------------------------------------------------- */
  function stepOnce(id, Pb, x, y, h) {
    const f = Pb.fns.f;
    switch (id) {
      case 'euler': {
        const d1 = f(x, y);
        return { y: y + h * d1, parts: { d1: d1 } };
      }
      case 'taylor': {
        const d1 = f(x, y), fxv = Pb.fns.fx(x, y), fyv = Pb.fns.fy(x, y);
        const d2 = fxv + fyv * d1;
        return { y: y + h * d1 + (h * h / 2) * d2, parts: { d1: d1, fxv: fxv, fyv: fyv, d2: d2 } };
      }
      case 'heun': {
        const d1 = f(x, y);
        const yp = y + h * d1;
        const xn = x + h;
        const d1p = f(xn, yp);
        return { y: y + (h / 2) * (d1 + d1p), parts: { d1: d1, yp: yp, xn: xn, d1p: d1p } };
      }
      case 'rk2': {
        const d1 = f(x, y);
        const k1 = h * d1;
        const xm = x + h / 2, ym = y + k1 / 2;
        const s = f(xm, ym);
        return { y: y + h * s, parts: { d1: d1, k1: k1, xm: xm, ym: ym, s: s } };
      }
      case 'rk4': {
        const k1 = f(x, y), k2 = f(x + h / 2, y + h * k1 / 2), k3 = f(x + h / 2, y + h * k2 / 2), k4 = f(x + h, y + h * k3);
        return { y: y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4), parts: {} };
      }
      default: throw new Error('Método desconocido: ' + id);
    }
  }
  api.stepOnce = stepOnce;

  /**
   * Recorre el dominio con un método. Devuelve filas n = 0..N.
   * digits: si no es null, se redondea y_n a esa cantidad de decimales en cada iteración.
   */
  function run(id, Pb, x0, y0, h, n, digits) {
    const rows = [{ n: 0, x: x0, y: y0 }];
    let y = y0, diverged = null;
    for (let i = 0; i < n; i++) {
      const x = cleanX(x0 + i * h);
      const st = stepOnce(id, Pb, x, y, h);
      rows[i].parts = st.parts;
      let yn = st.y;
      if (digits != null) yn = roundTo(yn, digits);
      if (!isFinite(yn)) { diverged = { n: i + 1, x: cleanX(x0 + (i + 1) * h) }; break; }
      y = yn;
      rows.push({ n: i + 1, x: cleanX(x0 + (i + 1) * h), y: y });
    }
    const evalsStep = (api.METHODS[id] || { evals: 4 }).evals;
    return { id: id, rows: rows, yEnd: rows[rows.length - 1].y, diverged: diverged, evals: n * evalsStep };
  }
  api.run = run;

  /* ---------------------------------------------------------------
     Solución de referencia (exacta si se la da el usuario, o RK4 con paso muy fino)
     --------------------------------------------------------------- */
  function reference(Pb, x0, y0, h, n, exact) {
    const xs = [];
    for (let i = 0; i <= n; i++) xs.push(cleanX(x0 + i * h));
    const xf = xs[n];
    if (exact) {
      const ys = xs.map(function (x) { return exact.fn(x, 0); });
      if (ys.every(isFinite)) {
        const fineX = [], fineY = [];
        const N = 240;
        for (let i = 0; i <= N; i++) {
          const x = x0 + (xf - x0) * i / N;
          const v = exact.fn(x, 0);
          if (isFinite(v)) { fineX.push(x); fineY.push(v); }
        }
        return { kind: 'exact', ys: ys, fine: { x: fineX, y: fineY } };
      }
    }
    const f = Pb.fns.f;
    const m = Math.max(10, Math.min(400, Math.ceil(20000 / Math.max(1, n))));
    const hh = h / m;
    const ys = [y0];
    const fineX = [x0], fineY = [y0];
    const stride = Math.max(1, Math.ceil(n * m / 300));
    let y = y0, cnt = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const x = x0 + (i * m + j) * hh;
        const k1 = f(x, y), k2 = f(x + hh / 2, y + hh * k1 / 2), k3 = f(x + hh / 2, y + hh * k2 / 2), k4 = f(x + hh, y + hh * k3);
        y = y + (hh / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
        cnt++;
        if (cnt % stride === 0) { fineX.push(x0 + (i * m + j + 1) * hh); fineY.push(y); }
      }
      ys.push(y);
    }
    if (!ys.every(isFinite)) return { kind: 'none', ys: null, fine: null };
    return { kind: 'rk4', ys: ys, fine: { x: fineX, y: fineY } };
  }
  api.reference = reference;

  function errorsOf(runObj, ref) {
    if (!ref || !ref.ys) return null;
    const abs = [], signed = [];
    runObj.rows.forEach(function (r, i) {
      const e = ref.ys[i] - r.y;
      signed.push(e); abs.push(Math.abs(e));
    });
    const last = runObj.rows.length - 1;
    const refEnd = ref.ys[last];
    return { abs: abs, signed: signed, end: abs[last], rel: refEnd !== 0 ? abs[last] / Math.abs(refEnd) : null };
  }
  api.errorsOf = errorsOf;

  function nSteps(x0, xf, h) {
    const raw = (xf - x0) / h;
    const n = Math.round(raw);
    const ok = Math.abs(raw - n) < 1e-9 * Math.max(1, Math.abs(raw));
    return { raw: raw, n: n, ok: ok };
  }
  api.nSteps = nSteps;

  /* ---------------------------------------------------------------
     Convergencia: error en x_f al ir dividiendo h a la mitad
     --------------------------------------------------------------- */
  function convergence(Pb, x0, y0, h, n, refEnd, ids, maxSteps) {
    maxSteps = maxSteps || 4096;
    ids = ids || ['euler', 'taylor', 'heun', 'rk2'];
    const levels = [];
    for (let k = 0; k < 9 && n * Math.pow(2, k) <= maxSteps; k++) levels.push({ k: k, h: h / Math.pow(2, k), n: n * Math.pow(2, k) });
    const series = {};
    ids.forEach(function (id) {
      series[id] = levels.map(function (lv) {
        const r = run(id, Pb, x0, y0, lv.h, lv.n, null);
        return r.diverged ? NaN : Math.abs(r.yEnd - refEnd);
      });
    });
    const orders = {};
    ids.forEach(function (id) {
      orders[id] = series[id].map(function (e, i) {
        if (i === 0) return null;
        const prev = series[id][i - 1];
        if (!(e > 1e-13) || !(prev > 1e-13) || !isFinite(e) || !isFinite(prev)) return null;
        return Math.log(prev / e) / Math.LN2;
      });
    });
    return { levels: levels, series: series, orders: orders };
  }
  api.convergence = convergence;

  /* ---------------------------------------------------------------
     Resolver todo
     --------------------------------------------------------------- */
  api.MAX_STEPS = 5000;

  function solve(inp) {
    const x0 = inp.x0, y0 = inp.y0, h = inp.h, xf = inp.xf;
    if (![x0, y0, h, xf].every(isFinite)) throw new UserError('Revisá los datos numéricos: alguno no es un número válido.');
    if (!(h > 0)) throw new UserError('El paso h tiene que ser un número positivo.');
    if (!(xf > x0)) throw new UserError('El punto donde hay que hallar y tiene que ser mayor que el valor inicial x₀.');
    const ns = nSteps(x0, xf, h);
    if (!ns.ok) {
      throw new UserError('Con x₀ = ' + fmt(x0, 6) + ' y h = ' + fmt(h, 6) + ' no se llega exactamente a x = ' + fmt(xf, 6) + ': (x_f − x₀)/h = ' + fmt(ns.raw, 4) + ' no es un número entero. Revisá h o el punto final.');
    }
    if (ns.n > api.MAX_STEPS) throw new UserError('Son demasiadas iteraciones (' + ns.n + '). El máximo de la calculadora es ' + api.MAX_STEPS + ': usá un h más grande.');

    const Pb = buildProblem(inp.fStr, inp.indep);
    const exact = buildExact(inp.exactStr, Pb.indep);
    const n = ns.n;
    const ids = (inp.methods && inp.methods.length ? inp.methods : ['taylor', 'heun', 'rk2']);
    const digits = inp.digits == null ? null : inp.digits;

    const runs = {};
    ids.forEach(function (id) { runs[id] = run(id, Pb, x0, y0, h, n, digits); });
    const ref = reference(Pb, x0, y0, h, n, exact);
    const errors = {};
    ids.forEach(function (id) { errors[id] = errorsOf(runs[id], ref); });

    const xs = [];
    for (let i = 0; i <= n; i++) xs.push(cleanX(x0 + i * h));
    return { problem: Pb, exact: exact, x0: x0, y0: y0, h: h, xf: xf, n: n, xs: xs, ids: ids, runs: runs, ref: ref, errors: errors, digits: digits };
  }
  api.solve = solve;

  /* ---------------------------------------------------------------
     Texto matemático para explicar (ordenada genérica y paso a paso)
     --------------------------------------------------------------- */
  /** Ordenada genérica con f reemplazada, como en el apunte. Devuelve líneas de TeX. */
  api.genericOrdinate = function (id, Pb) {
    const f = Pb.nodes.f, ind = Pb.indep;
    const sn = {}; sn[ind] = ind + '_n'; sn.y = 'y_n';
    const Fn = texNode(f, sn);
    switch (id) {
      case 'euler':
        return ['y_{n+1} = y_n + h\\cdot\\left[' + Fn + '\\right]'];
      case 'taylor': {
        const lines = ['y_{n+1} = y_n + h\\cdot\\left[' + Fn + '\\right] + \\dfrac{h^{2}}{2!}\\cdot y\'\'_n'];
        if (Pb.nodes.d2) {
          lines.push('y\'\'_n = \\dfrac{\\partial f}{\\partial x} + \\dfrac{\\partial f}{\\partial y}\\cdot y\'_n = ' + texNode(Pb.nodes.d2, sn));
        } else {
          lines.push('y\'\'_n = \\dfrac{\\partial f}{\\partial x} + \\dfrac{\\partial f}{\\partial y}\\cdot y\'_n \\quad\\text{(derivadas parciales calculadas numéricamente)}');
        }
        return lines;
      }
      case 'heun': {
        const s2 = {}; s2[ind] = ind + '_{n+1}'; s2.y = '\\left(y_n + h\\,y\'_n\\right)';
        const Fnext = texNode(f, s2);
        return [
          'y\'_n = ' + Fn,
          'y_{n+1} = y_n + \\dfrac{h}{2!}\\left[\\,y\'_n + ' + Fnext + '\\,\\right]',
        ];
      }
      case 'rk2': {
        const s3 = {}; s3[ind] = '\\left(' + ind + '_n + \\dfrac{h}{2}\\right)'; s3.y = '\\left(y_n + \\dfrac{k_1}{2}\\right)';
        const Fmid = texNode(f, s3);
        return [
          'k_1 = h\\cdot\\left[' + Fn + '\\right]',
          'y_{n+1} = y_n + h\\cdot\\left[' + Fmid + '\\right]',
        ];
      }
      default: return [];
    }
  };

  function dn(v, dd) { return fmt(v, dd); }
  function nt(v, dd) { const s = texNum(v, dd); return v < 0 ? '\\left(' + s + '\\right)' : s; }

  /** Paso a paso numérico de la iteración i (hacia i+1). Devuelve [{label, tex}] */
  api.derivation = function (id, Pb, res, i, dd) {
    const row = res.runs[id].rows[i];
    const h = res.h, ind = Pb.indep, f = Pb.nodes.f;
    const p = row.parts;
    if (!p) return [];
    const x = row.x, y = row.y;
    const yNext = res.runs[id].rows[i + 1] ? res.runs[id].rows[i + 1].y : NaN;
    const S = function (xv, yvTex) { const o = { __numeric: true }; o[ind] = nt(xv, dd); o.y = yvTex; return o; };
    const Sxy = function (xv, yv) { return S(xv, nt(yv, dd)); };
    const hN = nt(h, dd);
    const iv = ind; const sx = iv + '_{' + i + '}', sy = 'y_{' + i + '}', sy1 = 'y_{' + (i + 1) + '}';
    const L = [];
    const FnumXY = function (xv, yv) { return texNode(f, Sxy(xv, yv)); };

    switch (id) {
      case 'euler':
        L.push({ label: 'Pendiente en el punto actual', tex: "y'_{" + i + '} = f(' + sx + ',' + sy + ') = ' + FnumXY(x, y) + ' = ' + dn(p.d1, dd) });
        L.push({ label: 'Paso de Euler', tex: sy1 + ' = ' + sy + ' + h\\cdot y\'_{' + i + '} = ' + nt(y, dd) + ' + ' + hN + '\\cdot ' + nt(p.d1, dd) + ' = ' + dn(yNext, dd) });
        break;
      case 'taylor': {
        const fxT = Pb.nodes.fx ? texNode(Pb.nodes.fx, Sxy(x, y)) : '\\text{(numérica)}';
        const fyT = Pb.nodes.fy ? texNode(Pb.nodes.fy, Sxy(x, y)) : '\\text{(numérica)}';
        L.push({ label: 'Primera derivada: y′ = f(x, y)', tex: "y'_{" + i + '} = f(' + sx + ',' + sy + ') = ' + FnumXY(x, y) + ' = ' + dn(p.d1, dd) });
        L.push({ label: 'Derivada parcial respecto de x', tex: '\\dfrac{\\partial f}{\\partial x}\\Big|_{(' + sx + ',' + sy + ')} = ' + fxT + ' = ' + dn(p.fxv, dd) });
        L.push({ label: 'Derivada parcial respecto de y', tex: '\\dfrac{\\partial f}{\\partial y}\\Big|_{(' + sx + ',' + sy + ')} = ' + fyT + ' = ' + dn(p.fyv, dd) });
        L.push({ label: 'Segunda derivada: y″ = ∂f/∂x + ∂f/∂y · y′', tex: "y''_{" + i + '} = ' + nt(p.fxv, dd) + ' + ' + nt(p.fyv, dd) + '\\cdot ' + nt(p.d1, dd) + ' = ' + dn(p.d2, dd) });
        L.push({ label: 'Polinomio de Taylor de grado 2', tex: sy1 + ' = ' + sy + " + h\\cdot y'_{" + i + "} + \\dfrac{h^{2}}{2!}\\cdot y''_{" + i + '} = ' + nt(y, dd) + ' + ' + hN + '\\cdot ' + nt(p.d1, dd) + ' + \\dfrac{' + hN + '^{2}}{2}\\cdot ' + nt(p.d2, dd) + ' = ' + dn(yNext, dd) });
        break;
      }
      case 'heun':
        L.push({ label: 'Pendiente al inicio del intervalo', tex: "y'_{" + i + '} = f(' + sx + ',' + sy + ') = ' + FnumXY(x, y) + ' = ' + dn(p.d1, dd) });
        L.push({ label: 'Predictor (un paso de Euler)', tex: '\\tilde{y}_{' + (i + 1) + '} = ' + sy + ' + h\\cdot y\'_{' + i + '} = ' + nt(y, dd) + ' + ' + hN + '\\cdot ' + nt(p.d1, dd) + ' = ' + dn(p.yp, dd) });
        L.push({ label: 'Pendiente estimada al final del intervalo', tex: 'f(' + iv + '_{' + (i + 1) + '},\\tilde{y}_{' + (i + 1) + '}) = ' + FnumXY(p.xn, p.yp) + ' = ' + dn(p.d1p, dd) });
        L.push({ label: 'Corrector (promedio de las dos pendientes)', tex: sy1 + ' = ' + sy + ' + \\dfrac{h}{2!}\\left[\\,y\'_{' + i + '} + f(' + iv + '_{' + (i + 1) + '},\\tilde{y}_{' + (i + 1) + '})\\,\\right] = ' + nt(y, dd) + ' + \\dfrac{' + hN + '}{2}\\left[' + nt(p.d1, dd) + ' + ' + nt(p.d1p, dd) + '\\right] = ' + dn(yNext, dd) });
        break;
      case 'rk2': {
        const ymT = nt(p.ym, dd);
        L.push({ label: 'k₁ = h · f(xₙ, yₙ)', tex: 'k_1 = h\\cdot f(' + sx + ',' + sy + ') = ' + hN + '\\cdot\\left[' + FnumXY(x, y) + '\\right] = ' + dn(p.k1, dd) });
        L.push({ label: 'Punto medio del intervalo', tex: iv + '_{' + i + '} + \\dfrac{h}{2} = ' + nt(x, dd) + ' + \\dfrac{' + hN + '}{2} = ' + dn(p.xm, dd) + '\\qquad y_{' + i + '} + \\dfrac{k_1}{2} = ' + nt(y, dd) + ' + \\dfrac{' + nt(p.k1, dd) + '}{2} = ' + dn(p.ym, dd) });
        L.push({ label: 'Pendiente en el punto medio', tex: 'f\\left(' + iv + '_{' + i + '}+\\tfrac{h}{2},\\,y_{' + i + '}+\\tfrac{k_1}{2}\\right) = ' + texNode(f, S(p.xm, ymT)) + ' = ' + dn(p.s, dd) });
        L.push({ label: 'Paso de RK2', tex: sy1 + ' = ' + sy + ' + h\\cdot f\\left(' + iv + '_{' + i + '}+\\tfrac{h}{2},\\,y_{' + i + '}+\\tfrac{k_1}{2}\\right) = ' + nt(y, dd) + ' + ' + hN + '\\cdot ' + nt(p.s, dd) + ' = ' + dn(yNext, dd) });
        break;
      }
      default: break;
    }
    return L;
  };

  /* ---------------------------------------------------------------
     Paso único (para la figura geométrica): extremos de cada método
     --------------------------------------------------------------- */
  api.oneStep = function (Pb, x0, y0, h) {
    const out = {};
    ['euler', 'taylor', 'heun', 'rk2'].forEach(function (id) { out[id] = stepOnce(id, Pb, x0, y0, h); });
    // curva "exacta" local por RK4 muy fino
    const N = 120, xs = [x0], ys = [y0];
    let y = y0;
    for (let i = 0; i < N; i++) {
      const st = stepOnce('rk4', Pb, x0 + i * h / N, y, h / N);
      y = st.y; xs.push(x0 + (i + 1) * h / N); ys.push(y);
    }
    out.exact = { xs: xs, ys: ys, y1: y };
    return out;
  };

  return api;
});
