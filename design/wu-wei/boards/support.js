/* dc-lite: a small standalone runtime for the Wu wei .dc.html boards.
 * It renders <x-dc> templates ({{holes}}, <sc-if>, <sc-for>, on* events) with a
 * DCLogic class (state, setState, lifecycle), and patches the DOM in place so
 * CSS animations keep running between updates. No dependencies.
 */
(function () {
  'use strict';
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}';
  document.head.appendChild(hide);

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch, cb) {
    var next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    if (next == null) return;
    if (!this.__prev) this.__prev = this.state;
    this.state = Object.assign({}, this.state, next);
    schedule(this, cb);
  };
  DCLogic.prototype.forceUpdate = function (cb) { schedule(this, cb); };
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^(['"]).*\1$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function interp(text, scope) {
    return text.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); });
  }
  function child(scope, name, value, index) {
    var s = Object.create(scope);
    s[name] = value; s.$index = index;
    return s;
  }

  /* ---------- template -> virtual nodes ---------- */
  function renderList(nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) renderNode(nodes[i], scope, out);
    return out;
  }
  function renderNode(n, scope, out) {
    if (n.nodeType === 3) { out.push({ t: 3, v: interp(n.nodeValue, scope) }); return; }
    if (n.nodeType !== 1) return;
    var tag = n.localName;
    if (tag === 'helmet' || tag === 'script') return;
    if (tag === 'sc-if') {
      var cond = attrValue(n.getAttribute('value') || '', scope);
      if (cond && cond !== 'false') renderList(n.childNodes, scope, out);
      else out.push({ t: 8 });
      return;
    }
    if (tag === 'sc-for') {
      var list = attrValue(n.getAttribute('list') || '', scope) || [];
      var as = n.getAttribute('as') || 'item';
      if (!list.length) { out.push({ t: 8 }); return; }
      for (var j = 0; j < list.length; j++) renderList(n.childNodes, child(scope, as, list[j], j), out);
      return;
    }
    var v = { t: 1, tag: tag, ns: n.namespaceURI, attrs: {}, events: {}, kids: [] };
    for (var a = 0; a < n.attributes.length; a++) {
      var at = n.attributes[a], name = at.name;
      if (name.indexOf('hint-') === 0) continue;
      var val = attrValue(at.value, scope);
      if (/^on[a-z]+$/i.test(name) && (typeof val === 'function' || WHOLE.test(at.value))) {
        var ev = name.slice(2).toLowerCase();
        if (ev === 'change' && (tag === 'input' || tag === 'textarea')) ev = 'input';
        if (ev === 'doubleclick') ev = 'dblclick';
        v.events[ev] = typeof val === 'function' ? val : null;
        continue;
      }
      v.attrs[name] = val;
    }
    renderList(n.childNodes, scope, v.kids);
    out.push(v);
  }
  function attrValue(raw, scope) {
    var m = WHOLE.exec(raw);
    if (m) return lookup(m[1], scope);
    return raw.indexOf('{{') >= 0 ? interp(raw, scope) : raw;
  }

  /* ---------- patch the real DOM ---------- */
  function same(dom, v) {
    if (!dom) return false;
    if (v.t === 3) return dom.nodeType === 3;
    if (v.t === 8) return dom.nodeType === 8;
    return dom.nodeType === 1 && dom.localName === v.tag && dom.namespaceURI === v.ns;
  }
  function create(v) {
    if (v.t === 3) return document.createTextNode(v.v);
    if (v.t === 8) return document.createComment('');
    var el = v.ns ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
    el.__a = {}; el.__e = {};
    update(el, v);
    return el;
  }
  function setAttr(el, name, val) {
    var low = name.toLowerCase();
    if ((low === 'value' || low === 'checked') && (el.localName === 'input' || el.localName === 'textarea' || el.localName === 'select')) {
      if (low === 'value') { var s = val == null ? '' : String(val); if (el.value !== s) el.value = s; }
      else el.checked = !!val;
      return;
    }
    if (val === false || val == null) {
      if (low.indexOf('aria-') === 0 && val === false) el.setAttribute(name, 'false');
      else el.removeAttribute(name);
      return;
    }
    if (val === true) { el.setAttribute(name, low.indexOf('aria-') === 0 || low.indexOf('data-') === 0 ? 'true' : ''); return; }
    var str = String(val);
    if (el.getAttribute(name) !== str) el.setAttribute(name, str);
  }
  function update(el, v) {
    var old = el.__a || {}, k;
    for (k in v.attrs) if (old[k] !== v.attrs[k] || k === 'value') setAttr(el, k, v.attrs[k]);
    for (k in old) if (!(k in v.attrs)) el.removeAttribute(k);
    el.__a = v.attrs;
    var evs = el.__e || (el.__e = {});
    for (k in v.events) {
      if (!(k in evs)) el.addEventListener(k, dispatcher(el, k));
      evs[k] = v.events[k];
    }
    for (k in evs) if (!(k in v.events)) evs[k] = null;
    patch(el, v.kids);
  }
  function dispatcher(el, type) {
    return function (e) { var f = el.__e[type]; if (f) f(e); };
  }
  function patch(parent, vkids) {
    var nodes = parent.childNodes;
    for (var i = 0; i < vkids.length; i++) {
      var v = vkids[i], d = nodes[i];
      if (!d) parent.appendChild(create(v));
      else if (!same(d, v)) parent.replaceChild(create(v), d);
      else if (v.t === 3) { if (d.nodeValue !== v.v) d.nodeValue = v.v; }
      else if (v.t === 1) update(d, v);
    }
    while (nodes.length > vkids.length) parent.removeChild(parent.lastChild);
  }

  /* ---------- component lifecycle ---------- */
  var queue = [], queued = false;
  function schedule(inst, cb) {
    if (!inst.__mounted) return;
    if (cb) (inst.__cbs || (inst.__cbs = [])).push(cb);
    if (queue.indexOf(inst) < 0) queue.push(inst);
    if (!queued) { queued = true; Promise.resolve().then(flush); }
  }
  function flush() {
    queued = false;
    var q = queue; queue = [];
    q.forEach(function (inst) {
      var prev = inst.__prev || inst.state; inst.__prev = null;
      draw(inst);
      if (inst.componentDidUpdate) inst.componentDidUpdate(inst.props, prev);
      var cbs = inst.__cbs; inst.__cbs = null;
      if (cbs) cbs.forEach(function (f) { f(); });
    });
  }
  function draw(inst) {
    var vals = inst.renderVals ? inst.renderVals() : {};
    patch(inst.__root, renderList(inst.__tpl, vals || {}, []));
  }

  function boot() {
    var host = document.querySelector('x-dc');
    if (!host) return;
    var helmet = host.querySelector('helmet');
    if (helmet) Array.prototype.slice.call(helmet.children).forEach(function (n) {
      document.head.appendChild(n.cloneNode(true));
    });
    var script = document.querySelector('script[data-dc-script]');
    var Component = DCLogic, props = {};
    if (script) {
      try {
        var spec = JSON.parse(script.getAttribute('data-props') || '{}');
        Object.keys(spec).forEach(function (k) { if (k[0] !== '$' && spec[k] && 'default' in spec[k]) props[k] = spec[k].default; });
      } catch (e) { /* tweaks are optional */ }
      Component = new Function('DCLogic', script.textContent + '\n;return typeof Component === "function" ? Component : DCLogic;')(DCLogic);
    }
    var root = document.createElement('div');
    root.style.display = 'contents';
    host.parentNode.insertBefore(root, host);
    var tpl = Array.prototype.slice.call(host.childNodes).filter(function (n) { return !(n.nodeType === 1 && n.localName === 'helmet'); });
    host.parentNode.removeChild(host);
    var inst = new Component(props);
    if (!inst.state) inst.state = {};
    inst.__root = root; inst.__tpl = tpl; inst.__mounted = true;
    draw(inst);
    if (inst.componentDidMount) inst.componentDidMount();
    window.addEventListener('pagehide', function () { if (inst.componentWillUnmount) inst.componentWillUnmount(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
