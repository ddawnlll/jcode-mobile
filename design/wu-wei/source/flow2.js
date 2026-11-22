class Component extends DCLogic {
  constructor(p) {
    super(p);
    this.state = { screen: 'start', prev: null, kind: 'drop', ox: '50%', oy: '50%', theme: 'day', scene: 'peaks',
      model: 'gpt-5.6-luna', ink: 3, lt: -1, lnow: 0, draft: '', sent: [], stamp: 0,
      ripples: [], back: null, rows: {}, sheet: null, snack: null, pull: 0, pullPhase: 'idle' };
    this.timers = []; this.g = null; this.rid = 0;
  }
  componentWillUnmount() { this.timers.forEach(clearTimeout); clearInterval(this.iv); }
  later(fn, ms) { const id = setTimeout(fn, ms); this.timers.push(id); return id; }
  scale(e) { const r = e.currentTarget.closest('.s').getBoundingClientRect(); return { k: 390 / r.width, r }; }
  buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (x) {} }

  go(screen, kind, ox, oy) {
    if (this.noClick || screen === this.state.screen) return;
    this.setState({ prev: this.state.screen, screen, kind, ox: ox || '50%', oy: oy || '50%', back: null });
    this.later(() => this.setState({ prev: null }), 900);
    if (screen === 'main' && !this.liveStarted) {
      this.liveStarted = true;
      const t0 = Date.now() + 500;
      [500, 600, 4300, 4600, 4700, 5900, 6000, 7000, 7100, 9600, 9700, 12300, 12600].forEach(m => this.later(() => this.setState({ lt: m }), 500 + m));
      this.iv = setInterval(() => { const n = Date.now() - t0; this.setState({ lnow: n }); if (n > 13000) clearInterval(this.iv); }, 1000);
    }
  }
  backTarget() { return { main: 'sessions', model: 'main', scenes: 'sessions' }[this.state.screen]; }

  // ink ripple from every touch point
  ripple(e) {
    const { k, r } = this.scale(e);
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k, id = ++this.rid;
    this.setState({ ripples: this.state.ripples.concat([{ id, x: x.toFixed(0), y: y.toFixed(0) }]) });
    this.later(() => this.setState({ ripples: this.state.ripples.filter(q => q.id !== id) }), 700);
  }

  // predictive back: drag from the left edge
  edgeDown(e) {
    const target = this.backTarget(); if (!target || this.state.prev) return;
    e.stopPropagation();
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    const { k, r } = this.scale(e);
    this.g = { type: 'back', x0: e.clientX, k, top: r.top };
    this.setState({ back: { p: 0, y: (e.clientY - r.top) * k, drag: true, target } });
  }

  // rows: swipe left to archive, long-press for actions
  rowDown(id, e) {
    const { k } = this.scale(e);
    this.g = { type: 'row?', id, x0: e.clientX, y0: e.clientY, k };
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    clearTimeout(this.lp);
    this.lp = this.later(() => {
      if (!this.g || this.g.type !== 'row?') return;
      this.g = null; this.noClick = true; this.buzz(12);
      this.setRow(id, { lift: true });
      this.later(() => this.setState({ sheet: id }), 140);
      this.later(() => { this.noClick = false; }, 600);
    }, 450);
  }
  listDown(e) { if (!this.g) { const { k } = this.scale(e); this.g = { type: 'pull?', y0: e.clientY, x0: e.clientX, k }; } }

  pmove(e) {
    const g = this.g; if (!g) return;
    if (g.type === 'back') {
      const p = Math.max(0, Math.min(1, (e.clientX - g.x0) * g.k / 300));
      this.setState({ back: Object.assign({}, this.state.back, { p, y: (e.clientY - g.top) * g.k }) });
      return;
    }
    const dx = (e.clientX - g.x0) * g.k, dy = (e.clientY - g.y0) * g.k;
    if (g.type === 'row?' || g.type === 'pull?') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      clearTimeout(this.lp);
      if (g.type === 'row?' && Math.abs(dx) > Math.abs(dy) && dx < 0) g.type = 'swipe';
      else if (dy > 0 && Math.abs(dy) > Math.abs(dx)) g.type = 'pull';
      else { this.g = null; return; }
      this.noClick = true;
    }
    if (g.type === 'swipe') this.setRow(g.id, { dx: Math.min(0, dx), drag: true });
    if (g.type === 'pull') this.setState({ pull: Math.max(0, dy), pullPhase: 'drag' });
  }

  pup() {
    const g = this.g; this.g = null; clearTimeout(this.lp);
    this.later(() => { this.noClick = false; }, 60);
    if (!g) return;
    if (g.type === 'back') {
      const b = this.state.back;
      if (b.p > 0.32) {
        this.buzz(8);
        this.setState({ back: Object.assign({}, b, { drag: false, commit: true }) });
        this.later(() => this.setState({ screen: b.target, prev: null, back: null }), 300);
      } else {
        this.setState({ back: Object.assign({}, b, { p: 0, drag: false }) });
        this.later(() => this.setState({ back: null }), 320);
      }
    }
    if (g.type === 'swipe') {
      const dx = (this.state.rows[g.id] || {}).dx || 0;
      if (dx < -110) {
        this.buzz(8);
        this.setRow(g.id, { dx: -420, drag: false });
        this.later(() => this.setRow(g.id, { gone: true }), 260);
        this.later(() => this.setState({ snack: g.id }), 300);
        clearTimeout(this.snackT); this.snackT = this.later(() => this.setState({ snack: null }), 4600);
      } else this.setRow(g.id, { dx: 0, drag: false });
    }
    if (g.type === 'pull') {
      if (this.state.pull > 70) {
        this.buzz(6);
        this.setState({ pull: 56, pullPhase: 'refresh' });
        this.later(() => this.setState({ pull: 0, pullPhase: 'settle' }), 1300);
      } else this.setState({ pull: 0, pullPhase: 'settle' });
    }
  }

  setRow(id, patch) {
    const rows = Object.assign({}, this.state.rows);
    rows[id] = Object.assign({}, rows[id] || {}, patch);
    this.setState({ rows });
  }
  closeSheet(action) {
    const id = this.state.sheet; if (!id) return;
    this.setState({ sheet: null }); this.setRow(id, { lift: false });
    if (action === 'archive') {
      this.later(() => this.setRow(id, { dx: -420 }), 250);
      this.later(() => this.setRow(id, { gone: true }), 520);
      this.later(() => this.setState({ snack: id }), 560);
      clearTimeout(this.snackT); this.snackT = this.later(() => this.setState({ snack: null }), 4800);
    }
  }
  undo() { const id = this.state.snack; if (!id) return; this.setState({ snack: null }); this.setRow(id, { gone: false, dx: 0 }); }

  renderVals() {
    const S = this.state;
    const day = { paper:'#E5EBE0', paper2:'#D6E0D3', ink:'#16231D', ink2:'#2D3C34', ink3:'#56685D', line:'#BCCBBE', seal:'#2E4374', onseal:'#F1F4EC', blue:'#3F7484', green:'#3B7A5C', mist:'#E5EBE0', imgf:'saturate(1)' };
    const night = { paper:'#0E1613', paper2:'#17221D', ink:'#DCE8DE', ink2:'#BCCFC1', ink3:'#86998C', line:'#24342C', seal:'#93A6D9', onseal:'#10140F', blue:'#7FAFBD', green:'#6FA88A', mist:'#0E1613', imgf:'brightness(.58) saturate(.85)' };
    const pal = S.theme === 'day' ? day : night;
    const vars = Object.keys(pal).map(k => '--' + k + ':' + pal[k]).join(';');

    const screens = ['start', 'sessions', 'main', 'model', 'scenes'];
    const vis = {}, cls = {}, tf = {}, rad = {}, trn = {}, sh = {}, op = {}, zi = {};
    const b = S.back;
    const ease = 'transform .32s cubic-bezier(.22,1,.36,1), border-radius .32s, opacity .32s';
    screens.forEach(k => {
      vis[k] = k === S.screen || k === S.prev || !!(b && k === b.target);
      cls[k] = S.prev == null ? '' : (k === S.screen ? 'enter-' + S.kind : (k === S.prev ? 'leave-' + S.kind : ''));
      tf[k] = 'none'; rad[k] = '0px'; trn[k] = 'none'; sh[k] = 'none'; op[k] = '1'; zi[k] = '';
      if (b) {
        if (k === S.screen) {
          const p = b.commit ? 1 : b.p;
          tf[k] = 'translate3d(' + (b.commit ? 420 : b.p * 46).toFixed(1) + 'px,0,0) scale(' + (1 - 0.1 * p).toFixed(3) + ')';
          rad[k] = (p * 30).toFixed(1) + 'px'; trn[k] = b.drag ? 'none' : ease; sh[k] = '0 14px 40px rgba(0,0,0,.22)'; zi[k] = '3';
        } else if (k === b.target) {
          const p = b.commit ? 1 : b.p;
          tf[k] = 'translate3d(' + (-40 * (1 - p)).toFixed(1) + 'px,0,0)'; op[k] = (0.55 + 0.45 * p).toFixed(2); trn[k] = b.drag ? 'none' : ease; zi[k] = '1';
        }
      }
    });

    const go = {
      sessions: () => this.go('sessions', S.screen === 'start' ? 'drop' : 'slide', '86%', '90%'),
      sessions_back: () => this.go('sessions', 'slide'),
      main_r2: () => this.go('main', 'drop', '30%', '402px'),
      main_back: () => this.go('main', 'slide'),
      model: () => this.go('model', 'unroll'),
      scenes: () => this.go('scenes', 'unroll'),
    };

    const rows = {}; let count = 0;
    ['r1', 'r2', 'r3', 'r4', 'r5'].forEach(id => {
      const r = S.rows[id] || {}; if (!r.gone) count++;
      rows[id] = {
        dx: (r.dx || 0).toFixed(1), sc: r.lift ? '1.025' : '1', rad: r.lift ? '10px' : '0px',
        sh: r.lift ? '0 10px 26px rgba(0,0,0,.18)' : 'none',
        tr: r.drag ? 'none' : 'transform .38s cubic-bezier(.22,1,.36,1), box-shadow .3s, border-radius .3s',
        uo: Math.min(1, Math.abs(r.dx || 0) / 90).toFixed(2), gr: r.gone ? '0fr' : '1fr', o: r.gone ? '0' : '1',
        down: (e) => this.rowDown(id, e),
      };
    });
    const names = { r1: 'Clean the build cache', r2: 'Adapter v4 timeline', r3: 'Pinned todo card', r4: 'Socket timeout', r5: 'Android back stack' };
    const pullP = Math.min(1, S.pull / 70);

    const lt = S.lt, lnow = S.lnow, fin = lt >= 12300;
    const row = (a, c) => lt < a ? '' : (lt < a + 100 ? 'run' : (lt < c ? 'run open' : 'done'));
    const el = (a) => '0:0' + Math.min(9, Math.max(0, Math.floor((lnow - a) / 1000)));

    const keys = ['peaks','jade_peaks','pavilion','river_valley','blue_hills','riders','misty_peaks','lone_boat','sage_under_pine','green_woods','quiet_river','butterfly'];
    const sel = {}, ring = {}, pick = {}, show = {}, heroIs = {};
    keys.forEach(k => { const on = S.scene === k; sel[k] = on; show[k] = on; heroIs[k] = on; ring[k] = on ? 'var(--seal)' : 'transparent'; pick[k] = () => this.setState({ scene: k }); });
    const list = [['gpt-5.6-luna','openai · responses'],['claude-opus-5-5','anthropic · your subscription'],['deepseek-v4-flash','command-code · quick and light'],['gpt-5.2','openai · not in your plan',true]];
    const models = list.map(([name, note, off]) => ({ name, note, off: !!off, on: name === S.model, op: off ? 0.45 : 1, pick: () => { if (!off) this.setState({ model: name }); } }));
    const en = ['minimal','low','medium','high','xhigh','max'];
    const inks = en.map((e, i) => ({ en: e, ink: (0.12 + i * 0.17).toFixed(2), on: i === S.ink, ring: i === S.ink ? 'var(--seal)' : 'transparent', pick: () => this.setState({ ink: i }) }));
    const on = 'background:var(--ink);color:var(--paper)', off = 'color:var(--ink2)';

    return {
      vars, vis, cls, tf, rad, trn, sh, op, zi, go, rows, models, inks, sel, ring, pick, show, heroIs,
      rodModel: cls.model === 'enter-unroll', rodScenes: cls.scenes === 'enter-unroll',
      ox: S.ox, oy: S.oy, grainCls: S.theme === 'day' ? 'grain-day' : 'grain-night',
      ripple: (e) => this.ripple(e), ripples: S.ripples,
      edgeDown: (e) => this.edgeDown(e), pmove: (e) => this.pmove(e), pup: (e) => this.pup(e), listDown: (e) => this.listDown(e),
      backing: !!(b && !b.commit), backY: b ? (b.y - 20).toFixed(0) : '0', chipX: b ? (b.p * 44).toFixed(1) : '0',
      chipO: b ? Math.min(1, b.p * 4).toFixed(2) : '0', chipArrow: b && b.p > 0.32 ? 'var(--seal)' : 'var(--ink2)',
      sheetCls: S.sheet ? 'on' : '', sheetName: S.sheet ? names[S.sheet] : '',
      closeSheet: () => this.closeSheet(), archiveSheet: () => this.closeSheet('archive'),
      snackCls: S.snack ? 'on' : '', snackName: S.snack ? names[S.snack] : '', undo: () => this.undo(), threadCount: String(count),
      listY: (S.pullPhase === 'drag' ? S.pull * 0.45 : (S.pullPhase === 'refresh' ? 26 : 0)).toFixed(1),
      pullY: (S.pullPhase === 'drag' ? Math.min(S.pull * 0.45, 40) : (S.pullPhase === 'refresh' ? 22 : 0)).toFixed(1),
      pullS: (S.pullPhase === 'refresh' ? 1 : 0.4 + 0.6 * pullP).toFixed(2), pullO: (S.pullPhase === 'refresh' ? 1 : pullP).toFixed(2),
      pullDash: (S.pullPhase === 'refresh' ? 36 : pullP * 50).toFixed(1), pullCls: S.pullPhase === 'refresh' ? 'spin' : '',
      pullTr: S.pullPhase === 'drag' ? 'none' : 'transform .45s cubic-bezier(.22,1,.36,1), opacity .3s',
      sT: lt >= 500, cT: lt < 600 ? '' : (lt < 4300 ? 'open' : 'done'),
      s1: lt >= 4600, c1: row(4600, 5900), e1: el(4600), s2: lt >= 5900, c2: row(5900, 7000), e2: el(5900),
      s3: lt >= 7000, c3: row(7000, 9600), e3: el(7000), s4: lt >= 9600, c4: row(9600, 12300), e4: el(9600),
      sA: lt >= 12600, mainCls: '', sub: fin ? 'finished · 12s' : (lt >= 4300 ? 'working' : 'thinking'),
      sent: S.sent.map((t, i) => ({ text: t, n: i + 2, tag: fin ? 'sent' : 'queued' })),
      dayStyle: S.theme === 'day' ? on : off, nightStyle: S.theme === 'day' ? off : on,
      setDay: () => this.setState({ theme: 'day' }), setNight: () => this.setState({ theme: 'night' }),
      draft: S.draft, onDraft: (e) => this.setState({ draft: e.target.value }), stampCls: S.stamp % 2 ? 'stamp' : '',
      send: () => { const text = (S.draft || '').trim() || 'Also log each backoff attempt, once.'; this.setState({ sent: S.sent.concat([text]), draft: '', stamp: S.stamp + 1 }); },
    };
  }
}
