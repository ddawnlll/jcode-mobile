#!/usr/bin/env python3
"""Wu wei · macOS edition. Builds project/Mac-*.dc.html from the same ink language as the phone.
Usage: mac.py
"""
import re, types, json

b3 = types.ModuleType('b3')
b3.__file__ = '/home/claude/phoenix/build3.py'
exec(open(b3.__file__).read(), b3.__dict__)

OUT = b3.OUT
IMG, ALT = b3.IMG, b3.ALT
seal_sym, defs, grain = b3.seal_sym, b3.defs, b3.grain

WASH = {'riders': '/_blob/1becc3a519122d92da99bbd7f2ba82e6', 'peaks': '/_blob/006801b9b28e7dd60d174ef0cc98282f',
        'jade_peaks': '/_blob/76ffb354b979f55f59e31569bba6c183', 'quiet_river': '/_blob/b859511742d553442c9d16330ace0572',
        'lone_boat': '/_blob/3b1b04aca64870f2f3b5c133f7266075'}
TSCENES = list(WASH)

T = {
    'paper': dict(b3.THEMES['paper'], blue='#34677A', green='#2F6B4E', side='#E0E7DC', panel='#EEF2EA',
                  sel='rgba(22,35,29,.075)', hov='rgba(22,35,29,.045)', shadow='rgba(22,35,29,.16)', scrim='rgba(229,235,224,.55)', wop='.6'),
    'night': dict(b3.THEMES['night'], side='#111A16', panel='#18241E',
                  sel='rgba(220,232,222,.08)', hov='rgba(220,232,222,.045)', shadow='rgba(0,0,0,.5)', scrim='rgba(14,22,19,.62)', wop='.32'),
}
VARS = ['paper', 'paper2', 'ink', 'ink2', 'ink3', 'line', 'seal', 'onseal', 'blue', 'green', 'mist', 'imgf', 'side', 'panel', 'sel', 'hov', 'shadow', 'scrim']

def tvars(t):
    return ';'.join(f'--{k}:{t[k]}' for k in VARS)

SEND_SVG = (lambda s: s[s.index('<svg'):s.rindex('</span>')])(seal_sym('send', 10))

MAC_CSS = r"""
.s kbd{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;line-height:15px;color:var(--ink3);border:1px solid var(--line);border-radius:4px;padding:0 5px;background:transparent}
.s .tl{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.2)}
.s .tl:active{transform:none;opacity:.7}
.s .tb{height:32px;min-width:32px;padding:0 8px;border-radius:7px;display:flex;align-items:center;justify-content:center;gap:7px;color:var(--ink2);transition:background .18s var(--ease),transform .18s var(--ease)}
.s .tb:hover{background:var(--hov)}
.s .tb.on{background:var(--sel)}
.s .srow{width:100%;display:flex;align-items:center;gap:10px;min-height:48px;padding:5px 10px;box-sizing:border-box;border-radius:8px;text-align:left;transition:background .25s var(--ease)}
.s .srow:hover{background:var(--hov)}
.s .srow.on{background:var(--sel)}
.s .grp{font-size:13px;font-style:italic;color:var(--ink3);padding:14px 10px 3px}
.s .drow{display:grid;grid-template-columns:18px 52px minmax(0,1fr) auto;align-items:center;column-gap:10px;min-height:31px;font-size:16px;color:var(--ink2)}
.s .drow .tool{font-size:11.5px;color:var(--ink)}
.s .drow .meta{font-size:11px;color:var(--ink3)}
.s .diff{margin:4px 0 8px 28px;border:1px solid var(--line);border-radius:7px;overflow:hidden;font-size:11.5px;line-height:20px;background:var(--paper2)}
.s .diff .dh{display:flex;justify-content:space-between;padding:5px 12px;color:var(--ink3);border-bottom:1px solid var(--line)}
.s .diff .dl{display:grid;grid-template-columns:34px 1fr;white-space:pre;color:var(--ink2);padding-right:12px}
.s .diff .ln{color:var(--ink3);text-align:right;padding-right:12px;opacity:.8}
.s .diff .del{color:var(--seal);text-decoration:line-through;text-decoration-thickness:1px}
.s .diff .add{color:var(--green)}
.s .side-col,.s .insp-col{overflow:hidden;min-width:0}
.s .scroll{overflow:auto;scrollbar-width:thin;scrollbar-color:var(--line) transparent;overscroll-behavior:contain}
@keyframes m-pop{from{opacity:0;transform:translate3d(0,-6px,0) scale(.98)}to{opacity:1;transform:none}}
@keyframes m-fade{from{opacity:0}to{opacity:1}}
@keyframes m-in{from{opacity:0;transform:translate3d(0,4px,0)}to{opacity:1;transform:none}}
.s .panel{background:var(--panel);border:1px solid var(--line);border-radius:11px;box-shadow:0 18px 48px var(--shadow),0 2px 6px var(--shadow)}
.s .pop{animation:m-pop .2s var(--ease) both;transform-origin:top right}
.s .pal{animation:m-pop .22s var(--ease) both;transform-origin:top center}
.s .scrim{animation:m-fade .22s var(--ease) both}
.s .min{animation:m-in .45s var(--ease) both}
.s .pitem{width:100%;display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;box-sizing:border-box;border-radius:7px;text-align:left;transition:background .12s}
.s .pitem.act{background:var(--sel)}
.s .ist{display:grid;grid-template-columns:14px 44px 1fr;align-items:center;column-gap:8px;font-size:14.5px;line-height:26px;color:var(--ink2);position:relative}
.s .ist .dot{width:9px;height:9px;border-radius:50%;box-sizing:border-box;border:1.4px solid var(--ink3);justify-self:center;background:var(--side);position:relative;z-index:1}
.s .ist.done .dot{background:var(--seal);border-color:var(--seal)}
.s .ist.now .dot{border-color:var(--blue);animation:s-wet 2.2s ease-in-out infinite}
.s .ist.ask .dot{background:var(--seal);border-color:var(--seal);animation:s-wet 1.6s ease-in-out infinite}
.s .ist.todo{color:var(--ink3)}
.s .ilist{position:relative;list-style:none;margin:0;padding:0}
.s .ilist::before{content:'';position:absolute;left:6.5px;top:13px;bottom:13px;width:1px;background:var(--ink3);opacity:.35}
.s .lbl{font-size:13px;font-style:italic;color:var(--ink3);margin:0 0 6px}
.s .seg{display:flex;padding:2px;border-radius:8px;background:var(--paper2);gap:2px}
.s .seg button{height:28px;padding:0 14px;border-radius:6px;font-size:13.5px;color:var(--ink2);transition:background .2s var(--ease),color .2s var(--ease)}
.s .seg button.on{background:var(--panel);color:var(--ink);box-shadow:0 1px 2px var(--shadow)}
.s .tab{width:76px;height:52px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:13px;color:var(--ink2);transition:background .2s var(--ease),color .2s var(--ease)}
.s .tab.on{background:var(--sel);color:var(--ink)}
.s .press:active{transform:scale(.9) rotate(-3deg)}
@keyframes m-stampin{0%{transform:scale(1.5) rotate(-12deg);opacity:0}60%{transform:scale(.95) rotate(-2deg);opacity:1}100%{transform:scale(1) rotate(-3deg);opacity:1}}
.s .stampin{animation:m-stampin .6s cubic-bezier(.2,.8,.2,1) both}
.s .hl{position:absolute;inset:0;pointer-events:none}
@media (max-width:1040px){.s.mac-main{grid-template-columns:260px minmax(0,1fr) 0px!important}}
@media (max-width:720px){.s.mac-main,.s.mac-live{grid-template-columns:0px minmax(0,1fr) 0px!important}}
@media (prefers-reduced-motion:reduce){.s *{animation:none!important;transition:none!important}}
"""

ICON = {
    'sidebar': 'M4 6.5 H20 V17.5 H4 Z M9.5 6.5 V17.5',
    'inspector': 'M4 6.5 H20 V17.5 H4 Z M14.5 6.5 V17.5',
    'search': 'M10.5 16 A5.5 5.5 0 1 1 10.5 5 A5.5 5.5 0 1 1 10.5 16 M14.6 14.6 L19 19',
    'new': 'M13.5 5.5 H6 V18 H18.5 V10.5 M10.5 13.5 L19 5',
    'brush': 'M6 18.5 C 8.5 16, 11.5 11.5, 18 5.5 M6 18.5 C 5.6 16.8, 6.4 15.6, 8 15.4',
    'scene': 'M3.5 18 L9.5 9 L12.5 13 L14.8 10.5 L20.5 18 Z',
    'server': 'M5 6.5 H19 V11 H5 Z M5 13 H19 V17.5 H5 Z',
    'stop': 'M8 8 H16 V16 H8 Z',
}

def icon(name, size=18, stroke='var(--ink2)'):
    return (f'<svg aria-hidden="true" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" style="stroke:{stroke}" '
            f'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="{ICON[name]}"></path></svg>')

def lights(active=True, zoom=True):
    cols = ['#FF5F57', '#FEBC2E', '#28C840'] if active else ['var(--line)'] * 3
    if not zoom:
        cols[2] = 'var(--line)'
    labels = ['Close window', 'Minimise window', 'Zoom window']
    return ('<div style="position:absolute;left:20px;top:19px;display:flex;gap:8px;z-index:6">'
            + ''.join(f'<button type="button" class="tl" aria-label="{l}" style="background:{c}"></button>' for c, l in zip(cols, labels))
            + '</div>')

RING14 = ('<svg role="img" aria-label="done" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.8" fill="none" '
          'style="stroke:var(--seal)" stroke-width="1.6"></circle></svg>')
SPIN = '<span class="mono spin" role="img" aria-label="working" style="font-size:13px;color:var(--blue)"></span>'
ASKDOT = '<span role="img" aria-label="waiting for you" style="width:9px;height:9px;border-radius:50%;background:var(--seal)"></span>'

MARK = {'ask': '<span role="img" aria-label="Waiting for you" style="width:9px;height:9px;border-radius:50%;background:var(--seal)"></span>',
        'live': '<span class="mono spin" role="img" aria-label="Working" style="font-size:14px;color:var(--blue)"></span>',
        'done': '<span class="ring" role="img" aria-label="Finished" style="width:13px;height:13px"></span>',
        'rest': '<span role="img" aria-label="Resting" style="width:6px;height:6px;border-radius:50%;background:var(--ink3);opacity:.6"></span>'}

THREADS = [
    dict(id='crane', title='Clean the build cache', note='asks to run <span class="mono" style="font-style:normal;font-size:10.5px">rm -rf target/…</span>',
         state='ask', group='waiting for you', scene='riders', sub='crane · waiting for you'),
    dict(id='fox', title='Adapter v4 timeline', note='running the tests', state='live', group='working', scene='peaks',
         sub='fox · working · step 4 of 4'),
    dict(id='heron', title='Pinned todo card', note='with owl, wren and lynx · 3 of 7', state='live', group='working', scene='jade_peaks',
         sub='heron · with owl, wren and lynx · 3 of 7'),
    dict(id='owl', title='Socket timeout', note='fourteen minutes ago', state='done', group='finished', scene='quiet_river',
         sub='owl · finished fourteen minutes ago'),
    dict(id='moth', title='Android back stack', note='resting since Saturday', state='rest', group='resting', scene='lone_boat',
         sub='moth · resting since Saturday'),
]
TH = {t['id']: t for t in THREADS}

# ---------------- sidebar ----------------
def sidebar(mode, sel='fox'):
    flow = mode == 'flow'
    if flow:
        imgs = ''.join(f'<img src="{IMG[k]}" alt="{ALT[k] if k == "peaks" else ""}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;'
                       f'filter:var(--imgf);opacity:{{{{artOp.{k}}}}};transition:opacity .9s var(--ease)">' for k in TSCENES)
    else:
        k = TH[sel]['scene']
        imgs = f'<img src="{IMG[k]}" alt="{ALT[k]}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:var(--imgf)">'
    art = ('<div style="position:relative;height:178px;overflow:hidden;flex:none">'
           f'<div class="kb" style="position:absolute;inset:0">{imgs}</div>'
           '<div aria-hidden="true" class="drift" style="position:absolute;left:-40px;right:-40px;top:50%;height:40px;background:var(--side);opacity:.3;filter:blur(14px)"></div>'
           '<div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 45%,var(--side) 97%)"></div></div>')
    groups = []
    for t in THREADS:
        if not groups or groups[-1][0] != t['group']:
            groups.append((t['group'], []))
        groups[-1][1].append(t)
    nav = ''
    for gi, (g, ts) in enumerate(groups):
        nav += f'<div class="grp">{g}</div>'
        for t in ts:
            k = t['id']
            if flow and k == 'crane':
                mark = ('<sc-if value="{{crane.ask}}" hint-placeholder-val="{{true}}">' + MARK['ask'] + '</sc-if>'
                        '<sc-if value="{{crane.run}}" hint-placeholder-val="{{false}}">' + MARK['live'] + '</sc-if>'
                        '<sc-if value="{{crane.done}}" hint-placeholder-val="{{false}}">' + MARK['done'] + '</sc-if>'
                        '<sc-if value="{{crane.no}}" hint-placeholder-val="{{false}}">' + MARK['rest'] + '</sc-if>')
            else:
                mark = MARK[t['state']]
            op = 'opacity:.62;' if t['state'] == 'rest' else ''
            inner = (seal_sym(k, 22)
                     + '<span style="flex:1;min-width:0;display:flex;flex-direction:column">'
                     f'<span class="clip" style="font-size:15.5px;line-height:20px;color:var(--ink)">{t["title"]}</span>'
                     f'<span class="clip" style="font-size:13px;line-height:17px;color:var(--ink3);font-style:italic">{t["note"]}</span></span>'
                     f'<span style="width:18px;display:flex;justify-content:center;flex:none">{mark}</span>')
            if flow:
                nav += (f'<button type="button" class="srow {{{{rowCls.{k}}}}}" aria-pressed="{{{{on.{k}}}}}" onClick="{{{{pick.{k}}}}}" '
                        f'title="{t["title"]}" style="{op}">{inner}</button>')
            else:
                nav += f'<button type="button" class="srow {"on" if k == sel else ""}" aria-pressed="{"true" if k == sel else "false"}" style="{op}">{inner}</button>'
    new_btn = ('<button type="button" class="tb" title="New thread ⌘N" ' + ('onClick="{{newThread}}" ' if flow else '')
               + 'style="justify-content:flex-start;padding:0 10px;flex:1;font-size:15px;color:var(--ink2)">'
               + icon('new', 16) + '<span style="flex:1;text-align:left">new thread</span><kbd>⌘N</kbd></button>')
    gear = '<a href="Mac-Settings%%N%%.dc.html" class="tb" aria-label="Settings" title="Settings ⌘," style="width:32px">' + icon('scene', 17) + '</a>'
    return (f'<aside class="side-col" aria-label="Threads" style="position:relative;background:var(--side);border-right:1px solid var(--line)">'
            '<div style="width:260px;height:800px;display:flex;flex-direction:column">'
            + art
            + '<div class="mono" style="display:flex;align-items:center;gap:8px;padding:0 20px;margin-top:-14px;position:relative;font-size:11.5px;color:var(--ink2)">'
              '<span aria-hidden="true" style="width:6px;height:6px;border-radius:50%;background:var(--green)"></span>studio-vps'
              '<span style="margin-left:auto;color:var(--ink3)">~/src</span></div>'
            + f'<nav class="scroll" aria-label="Threads" style="flex:1;min-height:0;padding:2px 10px 10px;display:flex;flex-direction:column;gap:1px">{nav}</nav>'
            + f'<div style="display:flex;gap:4px;padding:8px 10px 12px;border-top:1px solid var(--line)">{new_btn}{gear}</div>'
            '</div></aside>')

# ---------------- thread content ----------------
def up(n, text, d=0.0):
    return (f'<p class="rise" style="margin:0 0 4px;display:flex;gap:10px;font-size:17px;line-height:26px;color:var(--ink);animation-delay:{d}s">'
            f'<span class="mono" style="font-size:12px;color:var(--seal);flex:none;padding-top:2px">{n}›</span><span>{text}</span></p>')

def drow(tool, intent, right, d, state='done', extra=''):
    mark = {'done': RING14, 'live': SPIN, 'ask': ASKDOT}[state]
    return (f'<li class="rise" style="animation-delay:{d}s"><div class="drow"><span style="display:flex;justify-content:center">{mark}</span>'
            f'<span class="mono tool">{tool}</span><span class="clip">{intent}</span><span class="mono meta">{right}</span></div>{extra}</li>')

def reply(text, d=0.0, extra=''):
    return (f'<p class="rise" style="margin:6px 0 0;font-size:17px;line-height:26px;color:var(--ink2);font-style:italic;animation-delay:{d}s;{extra}">{text}</p>')

def steps(items):
    return f'<ol aria-label="Steps" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column">{items}</ol>'

def btn_seal(label, onclick='', kbd=''):
    oc = f' onClick="{onclick}"' if onclick else ''
    k = f'<kbd style="color:var(--onseal);border-color:rgba(255,255,255,.35)">{kbd}</kbd>' if kbd else ''
    return (f'<button type="button"{oc} style="height:32px;padding:0 12px;border-radius:7px;background:var(--seal);color:var(--onseal);display:flex;align-items:center;gap:8px;font-size:14.5px">{label}{k}</button>')

def btn_line(label, onclick='', kbd=''):
    oc = f' onClick="{onclick}"' if onclick else ''
    k = f'<kbd>{kbd}</kbd>' if kbd else ''
    return (f'<button type="button"{oc} style="height:32px;padding:0 12px;border-radius:7px;border:1px solid var(--line);display:flex;align-items:center;gap:8px;font-size:14.5px;color:var(--ink2)">{label}{k}</button>')

DIFF = ('<div class="diff mono">'
        '<div class="dh"><span>src/lib/adapter.ts</span><span><span style="color:var(--green)">+12</span> <span style="color:var(--seal)">−3</span></span></div>'
        '<div class="dl"><span class="ln">41</span><span>  const beat = setInterval(ping, 10_000);</span></div>'
        '<div class="dl del"><span class="ln">42</span><span>- const timeout = 5_000;</span></div>'
        '<div class="dl add"><span class="ln">42</span><span>+ const timeout = 15_000;</span></div>'
        '<div class="dl add"><span class="ln">43</span><span>+ const retries = 3;</span></div>'
        '<div class="dl"><span class="ln">44</span><span>  socket.on(\'pong\', () =&gt; clearTimeout(dead));</span></div></div>')

THINK = ('<div class="{{thinkCls}} rise" style="animation-delay:.08s">'
         '<button type="button" aria-expanded="{{thinkOpen}}" onClick="{{toggleThink}}" style="display:flex;align-items:center;gap:8px;height:28px;font-size:14.5px;font-style:italic;color:var(--ink3)">'
         '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" style="stroke:var(--ink3)" stroke-width="2.4" stroke-dasharray="46 8" transform="rotate(-70 12 12)"></circle></svg>'
         'thought for 4s <span style="font-style:normal;display:inline-block;transition:transform .35s var(--ease);transform:rotate({{thinkRot}}deg)">›</span></button>'
         '<div class="fold"><div><p style="margin:2px 0 8px 22px;font-size:15.5px;line-height:24px;color:var(--ink3);font-style:italic;max-width:600px">'
         'Doze defers network wakeups, so pongs arrive late. If the adapter waits only five seconds it calls a healthy socket dead. '
         'Find the timeout, then check what happens to frames sent while it was gone.</p></div></div></div>')

def content_fox():
    return (up(1, 'Make reconnect survive Android doze. Keep the wire protocol as it is.')
            + THINK
            + steps(drow('grep', 'find where the socket dies', '4 hits', .15)
                    + drow('read', 'adapter.ts', '212 lines', .25)
                    + drow('edit', 'lengthen the pong wait', '<span style="color:var(--green)">+12</span> <span style="color:var(--seal)">−3</span>', .35, extra=DIFF)
                    + drow('edit', 'replay from the journal', '<span style="color:var(--green)">+30</span> <span style="color:var(--seal)">−5</span>', .45)
                    + drow('bash', '<span class="wet" style="font-style:italic">running reconnect tests</span>', '<span style="color:var(--blue)">{{foxEl}}</span>', .55, 'live',
                           '<div class="flow" aria-hidden="true" style="margin-left:28px"></div>'))
            + reply('The backoff holds. Checking that missed frames come back in order before I call it done.', .7))

def content_crane():
    ask = ('<sc-if value="{{crane.ask}}" hint-placeholder-val="{{true}}"><div class="rise" style="animation-delay:.3s;margin:8px 0 0 28px;padding:14px 16px;border:1px solid var(--line);border-radius:9px;background:var(--paper2);display:flex;flex-direction:column;gap:10px">'
           '<div style="display:flex;align-items:center;gap:10px">' + seal_sym('crane', 20) + '<span style="font-size:15.5px;font-style:italic;color:var(--ink2)">crane wants to run</span></div>'
           '<code class="mono" style="font-size:12.5px;line-height:20px;color:var(--ink);white-space:pre-wrap">rm -rf target/debug/incremental target/release/.fingerprint</code>'
           '<span style="font-size:14.5px;color:var(--ink3)">Removes cached build state. The next build is slower; no source is touched.</span>'
           '<div style="display:flex;gap:8px;align-items:center">'
           + btn_seal('Allow once', '{{allow}}', '↩') + btn_line('Always in this thread', '{{allow}}')
           + '<button type="button" onClick="{{deny}}" style="height:32px;padding:0 10px;font-size:14.5px;color:var(--ink3);display:flex;align-items:center;gap:8px;margin-left:auto">Deny <kbd>esc</kbd></button>'
           '</div></div></sc-if>')
    ran = ('<sc-if value="{{crane.run}}" hint-placeholder-val="{{false}}">'
           + steps(drow('bash', 'rm -rf target/debug/incremental …', '<span style="color:var(--blue)">allowed</span>', 0, 'live', '<div class="flow" aria-hidden="true" style="margin-left:28px"></div>'))
           + '</sc-if><sc-if value="{{crane.done}}" hint-placeholder-val="{{false}}">'
           + steps(drow('bash', 'rm -rf target/debug/incremental …', 'allowed · done', 0))
           + reply('Cleared the incremental caches. Your next build will take a little longer; nothing else changed.', .2)
           + '</sc-if><sc-if value="{{crane.no}}" hint-placeholder-val="{{false}}">'
           + reply('Left it as it is. I can list what is largest instead, if that helps.', 0)
           + '</sc-if>')
    return (up(1, 'The build folder is huge again. Clear what we can rebuild.')
            + steps(drow('bash', 'du -sh target/*', '3 folders', .15) + drow('read', 'Cargo.toml', '64 lines', .25))
            + ask + ran)

def content_heron():
    todo = [('owl', 'card follows its thread id', 'done'), ('owl', 'unpin when the thread is archived', 'done'), ('wren', 'store pins per server', 'done'),
            ('wren', 'migrate old pins', 'live'), ('lynx', 'drag to reorder', 'live'), ('heron', 'card in the thread header', 'wait'), ('heron', 'tests', 'wait')]
    li = ''
    for i, (who, txt, st) in enumerate(todo):
        m = {'done': RING14, 'live': SPIN, 'wait': '<span aria-label="not started" role="img" style="width:9px;height:9px;border-radius:50%;border:1.3px solid var(--ink3);box-sizing:border-box"></span>'}[st]
        col = 'var(--ink3)' if st == 'wait' else 'var(--ink2)'
        li += (f'<li class="rise drow" style="animation-delay:{.15 + i * .06:.2f}s;color:{col}"><span style="display:flex;justify-content:center">{m}</span>'
               f'<span class="mono tool">{who}</span><span class="clip">{txt}</span><span class="mono meta">{"" if st != "live" else "working"}</span></li>')
    return (up(1, 'Make the pinned todo card follow the thread it belongs to.')
            + '<p class="rise" style="margin:2px 0 4px;font-size:15px;font-style:italic;color:var(--ink3);animation-delay:.1s">heron split this into seven and asked owl, wren and lynx to help.</p>'
            + f'<ol aria-label="Shared todo" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column">{li}</ol>')

def content_owl():
    return (up(1, 'Why does the socket time out on hotel wifi?')
            + steps(drow('grep', 'find the upgrade request', '2 hits', .15) + drow('edit', 'probe plain http first', '<span style="color:var(--green)">+21</span> <span style="color:var(--seal)">−4</span>', .25)
                    + drow('edit', 'say so in the status line', '<span style="color:var(--green)">+6</span>', .35) + drow('bash', 'run the adapter tests', '9 passed', .45))
            + reply('Captive portals swallow the upgrade request. The adapter now probes plain http first, and the status line says when a portal is in the way.', .6)
            + '<p class="mono rise" style="margin:6px 0 0;font-size:11px;color:var(--ink3);animation-delay:.75s">finished in 14 min · 2 files</p>')

def content_moth():
    return ('<div style="opacity:.75;display:flex;flex-direction:column;gap:12px">'
            + up(1, 'Fix the Android back stack after the share sheet closes.')
            + steps(drow('read', 'ShareActivity.kt', '140 lines', .15) + drow('read', 'NavGraph.kt', '88 lines', .25))
            + reply('Paused here. Should the share sheet return to the thread, or to the list of threads?', .4)
            + '</div>'
            + '<div class="rise" style="display:flex;gap:8px;margin-top:6px;animation-delay:.55s">'
            + btn_line('to the thread', '{{answerThread}}') + btn_line('to the list', '{{answerList}}') + '</div>')

def content_new():
    return ('<div class="rise" style="margin-top:40px;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--ink3);font-style:italic;font-size:16px">'
            + seal_sym('fox', 30, 'stampin')
            + '<span>fox is free. Say what needs doing.</span></div>')

CONTENT = {'crane': content_crane, 'fox': content_fox, 'heron': content_heron, 'owl': content_owl, 'moth': content_moth}

def header(title, sub, sym):
    sl = seal_sym(sym, 26, 'stampin') if sym else ''
    return ('<div style="display:flex;align-items:flex-end;gap:14px">'
            f'<div style="flex:1;min-width:0"><h1 class="bleedin clip" style="margin:0;font-size:28px;line-height:34px;font-weight:500;color:var(--ink)">{title}</h1>'
            f'<div class="mono clip rise" style="font-size:11.5px;color:var(--ink3);margin-top:3px">{sub}</div></div>{sl}</div>')

COL = 'max-width:760px;margin:0 auto;padding:0 48px;box-sizing:border-box'

def composer(flow, ph='write to fox…'):
    if flow:
        inp = ('<input data-composer="1" placeholder="{{ph}}" value="{{draft}}" onChange="{{onDraft}}" onKeyDown="{{onDraftKey}}" '
               'style="flex:1;min-width:0;background:none;border:0;outline:none;font-family:\'EB Garamond\',Georgia,serif;font-size:17.5px;color:var(--ink);padding:0">')
        stop = ('<sc-if value="{{canStop}}" hint-placeholder-val="{{true}}"><button type="button" class="tb mono" title="Stop ⌘." '
                'style="font-size:11.5px;color:var(--ink3)">stop <kbd>⌘.</kbd></button></sc-if>')
        send = f'<button type="button" aria-label="Send" title="Send ↩" onClick="{{{{send}}}}" class="seal press {{{{stampCls}}}}" style="width:42px;height:42px">{SEND_SVG}</button>'
    else:
        inp = (f'<input placeholder="{ph}" style="flex:1;min-width:0;background:none;border:0;outline:none;font-family:\'EB Garamond\',Georgia,serif;font-size:17.5px;color:var(--ink);padding:0">')
        stop = '<button type="button" class="tb mono" title="Stop ⌘." style="font-size:11.5px;color:var(--ink3)">stop <kbd>⌘.</kbd></button>'
        send = f'<button type="button" aria-label="Send" class="seal press" style="width:42px;height:42px">{SEND_SVG}</button>'
    return (f'<div style="position:absolute;left:0;right:0;bottom:16px;z-index:3"><div style="{COL}">'
            '<div style="display:flex;align-items:center;gap:12px">'
            '<label style="flex:1;min-width:0;position:relative;display:flex;align-items:center;height:48px">'
            '<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Message</span>'
            + inp +
            '<svg aria-hidden="true" viewBox="0 0 200 8" preserveAspectRatio="none" style="position:absolute;left:0;right:0;bottom:6px;width:100%;height:6px">'
            '<path class="inkdraw" d="M2 5 C 40 2, 90 6, 140 3 S 190 4, 198 3" style="stroke:var(--ink)" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".5" filter="url(#bleed)"></path></svg>'
            '</label>' + stop + send + '</div>'
            '<div class="mono" style="display:flex;gap:14px;font-size:11px;color:var(--ink3);margin-top:2px">'
            '<span>studio-vps · ~/src</span><span style="margin-left:auto">↩ send · messages wait their turn while it works</span></div>'
            '</div></div>')

def toolbar(flow):
    if flow:
        side = '<button type="button" class="tb {{sideCls}}" aria-label="Show or hide the sidebar" title="Sidebar ⌃⌘S" onClick="{{toggleSide}}">' + icon('sidebar') + '</button>'
        new = '<button type="button" class="tb" aria-label="New thread" title="New thread ⌘N" onClick="{{newThread}}">' + icon('new') + '</button>'
        chip = ('<button type="button" class="tb mono {{popCls}}" title="Model and effort ⇧⌘M" onClick="{{togglePop}}" style="font-size:11.5px;padding:0 10px">'
                '<span aria-hidden="true" style="width:9px;height:9px;border-radius:50%;background:var(--ink);opacity:{{inkOp}}"></span>{{model}} · {{effort}}</button>')
        pal = '<button type="button" class="tb" aria-label="Go to a thread or command" title="Go to ⌘K" onClick="{{openPal}}">' + icon('search') + '</button>'
        insp = '<button type="button" class="tb {{inspCls}}" aria-label="Show or hide the inspector" title="Inspector ⌥⌘0" onClick="{{toggleInsp}}">' + icon('inspector') + '</button>'
        pad = '{{tbPad}}'
    else:
        side = '<button type="button" class="tb on" aria-label="Show or hide the sidebar">' + icon('sidebar') + '</button>'
        new = '<button type="button" class="tb" aria-label="New thread">' + icon('new') + '</button>'
        chip = ('<button type="button" class="tb mono" style="font-size:11.5px;padding:0 10px"><span aria-hidden="true" style="width:9px;height:9px;border-radius:50%;background:var(--ink);opacity:.63"></span>gpt-5.6-luna · high</button>')
        pal = '<button type="button" class="tb" aria-label="Go to a thread or command">' + icon('search') + '</button>'
        insp = '<button type="button" class="tb" aria-label="Show or hide the inspector">' + icon('inspector') + '</button>'
        pad = '14'
    return (f'<div style="position:absolute;left:0;right:0;top:0;height:52px;display:flex;align-items:center;gap:4px;padding:0 12px 0 {pad}px;z-index:4;transition:padding .45s var(--ease)">'
            + side + new + '<span style="flex:1"></span>' + chip + pal + insp + '</div>')

def washes(flow, key='peaks', t=None):
    if flow:
        imgs = ''.join(f'<img src="{WASH[k]}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:{{{{washOp.{k}}}}};transition:opacity .9s var(--ease)">' for k in TSCENES)
    else:
        imgs = f'<img src="{WASH[key]}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:{t["wop"]}">'
    return ('<div aria-hidden="true" style="position:absolute;left:0;right:0;top:0;height:240px;overflow:hidden;pointer-events:none">'
            + imgs + '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 20%,var(--paper) 96%)"></div></div>')

# ---------------- overlays ----------------
PALETTE = ('<sc-if value="{{pal}}" hint-placeholder-val="{{false}}">'
           '<div class="scrim" onClick="{{closePal}}" style="position:absolute;inset:0;background:var(--scrim);z-index:20"></div>'
           '<div class="pal panel" role="dialog" aria-label="Go to a thread or command" style="position:absolute;left:50%;top:92px;width:560px;margin-left:-280px;z-index:21;overflow:hidden">'
           '<div style="display:flex;align-items:center;gap:10px;height:52px;padding:0 16px;border-bottom:1px solid var(--line)">' + icon('search', 18, 'var(--ink3)')
           + '<label style="flex:1;display:flex"><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Search</span>'
             '<input data-pal-input="1" placeholder="Go to a thread, or run a command" value="{{q}}" onChange="{{onQ}}" onKeyDown="{{onQKey}}" '
             'style="flex:1;background:none;border:0;outline:none;font-family:\'EB Garamond\',Georgia,serif;font-size:18px;color:var(--ink);padding:0"></label>'
             '<kbd>esc</kbd></div>'
           '<div class="scroll" style="padding:6px;display:flex;flex-direction:column;max-height:392px">'
           '<sc-for list="{{palItems}}" as="it" hint-placeholder-count="8">'
           '<sc-if value="{{it.head}}" hint-placeholder-val="{{false}}"><div style="font-size:12.5px;font-style:italic;color:var(--ink3);padding:8px 12px 2px">{{it.headText}}</div></sc-if>'
           '<button type="button" class="pitem {{it.cls}}" onClick="{{it.run}}" onMouseEnter="{{it.hover}}">'
           '<sc-if value="{{it.thread}}" hint-placeholder-val="{{true}}"><span class="seal" style="width:22px;height:22px"><svg viewBox="0 0 24 24" width="70%" height="70%" aria-hidden="true">'
           '<path d="{{it.d}}" fill="none" style="stroke:var(--onseal)" stroke-width="2.6" stroke-linecap="round"></path></svg></span></sc-if>'
           '<sc-if value="{{it.cmd}}" hint-placeholder-val="{{false}}"><span style="width:22px;height:22px;border:1px solid var(--line);border-radius:6px;display:flex;align-items:center;justify-content:center;box-sizing:border-box">'
           '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="{{it.d}}" fill="none" style="stroke:var(--ink2)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></span></sc-if>'
           '<span style="flex:1;min-width:0;display:flex;align-items:baseline;gap:10px"><span class="clip" style="font-size:16px;color:var(--ink)">{{it.title}}</span>'
           '<span class="clip" style="font-size:13.5px;color:var(--ink3);font-style:italic">{{it.sub}}</span></span>'
           '<kbd>{{it.kbd}}</kbd></button>'
           '</sc-for>'
           '<sc-if value="{{palEmpty}}" hint-placeholder-val="{{false}}"><div style="padding:18px 12px;font-size:15px;font-style:italic;color:var(--ink3)">Nothing by that name.</div></sc-if>'
           '</div>'
           '<div class="mono" style="display:flex;gap:16px;padding:8px 16px;border-top:1px solid var(--line);font-size:10.5px;color:var(--ink3)"><span>↑↓ move</span><span>↩ open</span><span>esc close</span></div>'
           '</div></sc-if>')

POPOVER = ('<sc-if value="{{pop}}" hint-placeholder-val="{{false}}">'
           '<div onClick="{{closePop}}" style="position:absolute;inset:0;z-index:18"></div>'
           '<div class="pop panel" role="dialog" aria-label="Model and effort" style="position:absolute;top:48px;right:86px;width:312px;z-index:19;padding:10px 12px 12px">'
           '<div class="lbl" style="padding:2px 2px 0">model · used from the next turn</div>'
           '<div role="radiogroup" aria-label="Model" style="display:flex;flex-direction:column">'
           '<sc-for list="{{models}}" as="m" hint-placeholder-count="4">'
           '<button type="button" role="radio" aria-checked="{{m.on}}" onClick="{{m.pick}}" disabled="{{m.off}}" class="pitem" style="height:46px;opacity:{{m.op}};background:{{m.bg}}">'
           '<span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="mono clip" style="font-size:12.5px;color:var(--ink)">{{m.name}}</span>'
           '<span class="clip" style="font-size:13.5px;color:var(--ink3);font-style:italic">{{m.note}}</span></span>'
           '<sc-if value="{{m.on}}" hint-placeholder-val="{{false}}"><svg class="ringdraw" aria-hidden="true" width="16" height="16" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.8" fill="none" style="stroke:var(--seal)" stroke-width="1.6" transform="rotate(-90 7 7)"></circle></svg></sc-if>'
           '</button></sc-for></div>'
           '<div style="display:flex;justify-content:space-between;align-items:baseline;margin:12px 2px 4px"><span style="font-size:15.5px;color:var(--ink)">Effort</span>'
           '<span class="mono" style="font-size:11px;color:var(--ink3)">{{effort}}</span></div>'
           '<div role="radiogroup" aria-label="Reasoning effort" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr))">'
           '<sc-for list="{{inks}}" as="k" hint-placeholder-count="6">'
           '<button type="button" role="radio" aria-checked="{{k.on}}" aria-label="{{k.en}}" title="{{k.en}}" onClick="{{k.pick}}" style="height:44px;display:flex;align-items:center;justify-content:center">'
           '<span style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.6px solid {{k.ring}};box-sizing:border-box;transition:border-color .3s">'
           '<span style="width:21px;height:21px;border-radius:50%;background:var(--ink);opacity:{{k.ink}};filter:url(#bleed)"></span></span></button>'
           '</sc-for></div></div></sc-if>')

INSPECTOR = ('<aside class="insp-col" aria-label="Inspector" style="position:relative;background:var(--side);border-left:1px solid var(--line)">'
             '<div class="scroll" style="width:272px;height:800px;box-sizing:border-box;padding:62px 20px 20px;display:flex;flex-direction:column;gap:24px">'
             '<section><div style="display:flex;justify-content:space-between;align-items:baseline"><h2 class="lbl">steps</h2><a href="Mac-Plan%%N%%.dc.html" style="font-size:13px;font-style:italic;color:var(--ink3);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line)">the whole plan</a></div><ol class="ilist">'
             '<sc-for list="{{isteps}}" as="st" hint-placeholder-count="4"><li class="ist {{st.cls}}"><span class="dot"></span>'
             '<span class="mono" style="font-size:11px;color:var(--ink3)">{{st.tool}}</span><span class="clip">{{st.label}}</span></li></sc-for></ol></section>'
             '<section><h2 class="lbl">files touched</h2>'
             '<sc-for list="{{files}}" as="f" hint-placeholder-count="2"><div class="mono" style="display:flex;gap:8px;font-size:11.5px;line-height:24px;color:var(--ink2)">'
             '<span class="clip" style="flex:1">{{f.name}}</span><span style="color:var(--green)">{{f.add}}</span><span style="color:var(--seal)">{{f.del}}</span></div></sc-for>'
             '<sc-if value="{{noFiles}}" hint-placeholder-val="{{false}}"><p style="margin:0;font-size:14.5px;font-style:italic;color:var(--ink3)">nothing written yet</p></sc-if></section>'
             '<section><h2 class="lbl">brush</h2>'
             '<button type="button" onClick="{{togglePop}}" style="display:flex;flex-direction:column;gap:6px;text-align:left;width:100%">'
             '<span class="mono" style="font-size:12px;color:var(--ink)">{{model}}</span>'
             '<span style="display:flex;gap:5px" aria-label="Effort {{effort}}"><sc-for list="{{inks}}" as="k" hint-placeholder-count="6">'
             '<span style="width:14px;height:14px;border-radius:50%;background:var(--ink);opacity:{{k.dim}};filter:url(#bleed)"></span></sc-for></span></button></section>'
             '<section><h2 class="lbl">scene</h2>'
             '<div style="position:relative;height:120px;border-radius:7px;overflow:hidden;background:var(--paper2)">'
             + ''.join(f'<img src="{IMG[k]}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:var(--imgf);opacity:{{{{artOp.{k}}}}};transition:opacity .9s var(--ease)">' for k in TSCENES)
             + '</div><div style="display:flex;justify-content:space-between;margin-top:6px;font-size:14.5px"><span style="color:var(--ink2)">{{sceneName}}</span>'
               '<a href="Mac-Settings%%N%%.dc.html" style="color:var(--ink3);font-style:italic;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line)">change</a></div></section>'
             '</div></aside>')

MAIN_SCRIPT = r'''
class Component extends DCLogic {
  constructor(p) {
    super(p);
    this.state = { sel: 'fox', side: true, insp: true, pal: false, q: '', act: 0, pop: false, model: 'gpt-5.6-luna', ink: 3,
      think: false, crane: 'ask', draft: '', sent: { crane: [], fox: [], heron: [], owl: [], moth: [], fresh: [] }, stamp: 0, now: 72, made: false };
    this.timers = [];
  }
  componentDidMount() { this.iv = setInterval(() => this.setState({ now: this.state.now + 1 }), 1000); }
  componentWillUnmount() { clearInterval(this.iv); this.timers.forEach(clearTimeout); }
  componentDidUpdate(pp, ps) {
    const focus = (sel) => setTimeout(() => { const el = document.querySelector(sel); if (el) el.focus(); }, 40);
    if (this.state.pal && !ps.pal) focus('[data-pal-input]');
    if (this.state.sel === 'fresh' && ps.sel !== 'fresh') focus('[data-composer]');
  }
  renderVals() {
    const S = this.state, WOP = __WOP__;
    const TH = ['crane', 'fox', 'heron', 'owl', 'moth', 'fresh'];
    const META = {
      crane: { title: 'Clean the build cache', sub: 'waiting for you', scene: 'riders', live: false, kbd: '⌘1' },
      fox: { title: 'Adapter v4 timeline', sub: 'running the tests', scene: 'peaks', live: true, kbd: '⌘2' },
      heron: { title: 'Pinned todo card', sub: '3 of 7, with owl, wren and lynx', scene: 'jade_peaks', live: true, kbd: '⌘3' },
      owl: { title: 'Socket timeout', sub: 'finished', scene: 'quiet_river', live: false, kbd: '⌘4' },
      moth: { title: 'Android back stack', sub: 'resting', scene: 'lone_boat', live: false, kbd: '⌘5' },
      fresh: { title: 'New thread', sub: '', scene: 'peaks', live: false },
    };
    const SCN = { riders: 'two riders', peaks: 'peaks', jade_peaks: 'jade peaks', quiet_river: 'a quiet river', lone_boat: 'a lone boat' };
    const close = { pal: false, q: '', act: 0, pop: false };
    const go = (k) => this.setState(Object.assign({ sel: k, think: false }, close));
    const is = {}, on = {}, rowCls = {}, pick = {};
    TH.forEach(k => { is[k] = S.sel === k; on[k] = S.sel === k ? 'true' : 'false'; rowCls[k] = S.sel === k ? 'on' : ''; pick[k] = () => go(k); });
    const cur = META[S.sel].scene, artOp = {}, washOp = {};
    ['riders', 'peaks', 'jade_peaks', 'quiet_river', 'lone_boat'].forEach(s => { artOp[s] = s === cur ? 1 : 0; washOp[s] = s === cur ? WOP : 0; });

    const list = [['gpt-5.6-luna', 'openai · responses'], ['claude-opus-5-5', 'anthropic · your subscription'], ['deepseek-v4-flash', 'command-code · quick and light'], ['gpt-5.2', 'openai · not in your plan', true]];
    const models = list.map(([name, note, off]) => ({ name, note, off: !!off, on: name === S.model, op: off ? 0.45 : 1, bg: name === S.model ? 'var(--sel)' : 'transparent', pick: () => { if (!off) this.setState({ model: name }); } }));
    const en = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    const inks = en.map((e, i) => ({ en: e, ink: (0.12 + i * 0.17).toFixed(2), dim: i <= S.ink ? (0.12 + i * 0.17).toFixed(2) : '0.08', on: i === S.ink, ring: i === S.ink ? 'var(--seal)' : 'transparent', pick: () => this.setState({ ink: i }) }));

    const tri = { crane: '111', fox: '101', heron: '010', owl: '100', moth: '011' };
    const triD = (b) => b.split('').map((x, i) => { const y = 7 + i * 5; return x === '1' ? 'M5 ' + y + ' H19' : 'M5 ' + y + ' H10.4 M13.6 ' + y + ' H19'; }).join(' ');
    const D = { new: 'M13.5 5.5 H6 V18 H18.5 V10.5 M10.5 13.5 L19 5', brush: 'M6 18.5 C 8.5 16, 11.5 11.5, 18 5.5 M6 18.5 C 5.6 16.8, 6.4 15.6, 8 15.4',
      side: 'M4 6.5 H20 V17.5 H4 Z M9.5 6.5 V17.5', insp: 'M4 6.5 H20 V17.5 H4 Z M14.5 6.5 V17.5' };
    let items = ['crane', 'fox', 'heron', 'owl', 'moth'].map(k => ({ thread: true, cmd: false, d: triD(tri[k]), title: META[k].title, sub: k + ' · ' + META[k].sub, kbd: META[k].kbd, run: () => go(k) }));
    items = items.concat([
      { thread: false, cmd: true, d: D.new, title: 'New thread', sub: '', kbd: '⌘N', run: () => go('fresh') },
      { thread: false, cmd: true, d: D.brush, title: 'Change model or effort', sub: '', kbd: '⇧⌘M', run: () => this.setState(Object.assign({}, close, { pop: true })) },
      { thread: false, cmd: true, d: D.side, title: 'Show or hide the sidebar', sub: '', kbd: '⌃⌘S', run: () => this.setState(Object.assign({}, close, { side: !S.side })) },
      { thread: false, cmd: true, d: D.insp, title: 'Show or hide the inspector', sub: '', kbd: '⌥⌘0', run: () => this.setState(Object.assign({}, close, { insp: !S.insp })) },
    ]);
    const q = S.q.trim().toLowerCase();
    if (q) items = items.filter(it => (it.title + ' ' + it.sub).toLowerCase().indexOf(q) >= 0);
    const act = Math.min(S.act, Math.max(0, items.length - 1));
    let lastKind = null;
    const palItems = items.map((it, i) => {
      const kind = it.thread ? 'threads' : 'commands';
      const head = kind !== lastKind; lastKind = kind;
      return Object.assign({}, it, { head, headText: kind, cls: i === act ? 'act' : '', hover: () => { if (this.state.act !== i) this.setState({ act: i }); } });
    });
    const onQKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.setState({ act: Math.min(act + 1, items.length - 1) }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.setState({ act: Math.max(act - 1, 0) }); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[act]) items[act].run(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.setState(close); }
    };

    const later = (ms, fn) => this.timers.push(setTimeout(fn, ms));
    const crane = { ask: S.crane === 'ask', run: S.crane === 'run', done: S.crane === 'done', no: S.crane === 'no' };
    const allow = () => { this.setState({ crane: 'run' }); later(2600, () => this.setState({ crane: 'done' })); };
    const deny = () => this.setState({ crane: 'no' });

    const ISTEPS = {
      crane: [['bash', 'measure target/', 'done'], ['read', 'Cargo.toml', 'done'], ['bash', 'clear the caches', S.crane === 'ask' ? 'ask' : (S.crane === 'run' ? 'now' : (S.crane === 'done' ? 'done' : 'todo'))]],
      fox: [['grep', 'find where it dies', 'done'], ['edit', 'lengthen the pong wait', 'done'], ['edit', 'replay the journal', 'done'], ['bash', 'reconnect tests', 'now']],
      heron: [['owl', 'follow the thread', 'done'], ['wren', 'pins per server', 'done'], ['wren', 'migrate old pins', 'now'], ['lynx', 'drag to reorder', 'now'], ['heron', 'header card, tests', 'todo']],
      owl: [['grep', 'find the upgrade', 'done'], ['edit', 'probe http first', 'done'], ['edit', 'status line', 'done'], ['bash', 'adapter tests', 'done']],
      moth: [['read', 'ShareActivity.kt', 'done'], ['read', 'NavGraph.kt', 'done'], ['ask', 'where back should land', 'ask']],
      fresh: [],
    };
    const FILES = {
      crane: [], fox: [['src/lib/adapter.ts', '+12', '−3'], ['src/lib/journal.ts', '+30', '−5']],
      heron: [['src/ui/TodoCard.tsx', '+48', '−12'], ['src/state/pins.ts', '+9', '']], owl: [['src/lib/adapter.ts', '+21', '−4'], ['src/ui/status.ts', '+6', '']],
      moth: [], fresh: [],
    };
    const files = FILES[S.sel].map(([name, add, del]) => ({ name, add, del }));
    const isteps = ISTEPS[S.sel].map(([tool, label, cls]) => ({ tool, label, cls }));

    const send = () => {
      const text = (S.draft || '').trim() || 'Also log each backoff attempt, once.';
      const sent = Object.assign({}, S.sent); sent[S.sel] = (sent[S.sel] || []).concat([text]);
      this.setState({ sent, draft: '', stamp: S.stamp + 1 });
    };
    const mine = (S.sent[S.sel] || []);
    const base = S.sel === 'fresh' ? 1 : 2;
    const sentList = mine.map((t, i) => ({ text: t, n: i + base, tag: META[S.sel].live ? 'queued' : (S.sel === 'fresh' ? 'sent' : 'sent') }));
    const m = Math.floor(S.now / 60), s = S.now % 60;
    const cols = (S.side ? '260px' : '0px') + ' minmax(0,1fr) ' + (S.insp ? '272px' : '0px');
    return {
      is, on, rowCls, pick, artOp, washOp, cols, crane, allow, deny,
      sideCls: S.side ? 'on' : '', inspCls: S.insp ? 'on' : '', popCls: S.pop ? 'on' : '', tbPad: S.side ? 14 : 92,
      toggleSide: () => this.setState({ side: !S.side }), toggleInsp: () => this.setState({ insp: !S.insp }),
      togglePop: () => this.setState({ pop: !S.pop }), closePop: () => this.setState({ pop: false }),
      openPal: () => this.setState({ pal: true, q: '', act: 0, pop: false }), closePal: () => this.setState(close),
      newThread: () => go('fresh'),
      pal: S.pal, q: S.q, onQ: (e) => this.setState({ q: e.target.value, act: 0 }), onQKey, palItems, palEmpty: palItems.length === 0,
      pop: S.pop, models, inks, model: S.model, effort: en[S.ink], inkOp: (0.12 + S.ink * 0.17).toFixed(2),
      thinkCls: S.think ? 'open' : '', thinkOpen: S.think ? 'true' : 'false', thinkRot: S.think ? 90 : 0, toggleThink: () => this.setState({ think: !S.think }),
      foxEl: m + ':' + (s < 10 ? '0' : '') + s,
      isteps, files, noFiles: files.length === 0, sceneName: SCN[cur],
      ph: S.sel === 'fresh' ? 'begin a new thread…' : 'write to ' + S.sel + '…', canStop: META[S.sel].live,
      draft: S.draft, onDraft: (e) => this.setState({ draft: e.target.value }),
      onDraftKey: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } },
      send, stampCls: S.stamp % 2 ? 'stampin' : '', sent: sentList,
      answerThread: () => this.setState({ draft: 'Back to the thread it was shared from.' }),
      answerList: () => this.setState({ draft: 'Back to the list of threads.' }),
    };
  }
}
'''

def doc(title_txt, body, script, w, h, extra_css=''):
    fonts = '<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">'
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title_txt}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{fonts}
<style>{b3.CSS3}{b3.LIVE_CSS}{MAC_CSS}{extra_css}</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
{script}
</script>
</body>
</html>
'''

def root(t, cls, inner, h=800, grid=None, extra=''):
    g = f'display:grid;grid-template-columns:{grid};transition:grid-template-columns .45s var(--ease);' if grid else ''
    return (f'<div class="s mac {cls}" style="width:100%;height:{h}px;position:relative;overflow:hidden;{g}background:var(--paper);color:var(--ink);'
            f"font-family:'EB Garamond',Georgia,serif;{tvars(t)};{extra}\">\n{defs()}\n{inner}\n{grain(t)}\n</div>")

QUEUED = ('<sc-for list="{{sent}}" as="q" hint-placeholder-count="0"><p class="rise" style="margin:6px 0 0;display:flex;gap:10px;font-size:17px;line-height:26px;color:var(--ink)">'
          '<span class="mono" style="font-size:12px;color:var(--seal);flex:none;padding-top:2px">{{q.n}}›</span><span style="flex:1">{{q.text}}</span>'
          '<span class="mono" style="font-size:10.5px;color:var(--blue);flex:none;padding-top:4px">{{q.tag}}</span></p></sc-for>')

def build_main():
    for theme in ['paper', 'night']:
        t = T[theme]; night = theme == 'night'; N = '-Night' if night else ''
        heads = ''.join(f'<sc-if value="{{{{is.{k}}}}}" hint-placeholder-val="{{{{{str(k == "fox").lower()}}}}}">{header(TH[k]["title"], TH[k]["sub"], k)}</sc-if>' for k in TH)
        heads += f'<sc-if value="{{{{is.fresh}}}}" hint-placeholder-val="{{{{false}}}}">{header("New thread", "fox · free · studio-vps", None)}</sc-if>'
        bodies = ''.join(f'<sc-if value="{{{{is.{k}}}}}" hint-placeholder-val="{{{{{str(k == "fox").lower()}}}}}"><div style="display:flex;flex-direction:column;gap:12px">{CONTENT[k]()}</div></sc-if>' for k in TH)
        bodies += f'<sc-if value="{{{{is.fresh}}}}" hint-placeholder-val="{{{{false}}}}">{content_new()}</sc-if>'
        content = ('<section aria-label="Thread" style="position:relative;min-width:0;height:800px;overflow:hidden">'
                   + washes(True) + toolbar(True)
                   + f'<header style="position:absolute;left:0;right:0;top:72px;z-index:2"><div style="{COL}">{heads}</div></header>'
                   + f'<main class="scroll" style="position:absolute;left:0;right:0;top:150px;bottom:96px;z-index:2"><div style="{COL};padding-top:10px;padding-bottom:28px;display:flex;flex-direction:column;gap:12px">{bodies}{QUEUED}</div></main>'
                   + composer(True) + POPOVER + '</section>')
        inner = (sidebar('flow') + content + INSPECTOR + lights() + PALETTE).replace('%%N%%', N)
        body = root(t, 'mac-main', inner, grid='{{cols}}')
        script = MAIN_SCRIPT.replace('__WOP__', t['wop'])
        (OUT / f'Mac-Main{N}.dc.html').write_text(doc(f'jcode for Mac · thread · {"night" if night else "day"}', body, script, 1280, 800))

def build_live():
    for theme in ['paper', 'night']:
        t = T[theme]; night = theme == 'night'; N = '-Night' if night else ''
        ph = b3.page_live(b3.THEMES[theme])
        main = re.search(r'<main class="live-main.*?</main>', ph, re.S).group(0)
        main = main.replace('position:absolute;left:22px;right:22px;top:236px;', 'position:relative;')
        main = main.replace('font-size:16px;line-height:24px;color:var(--ink)">\n      <span class="mono" style="font-size:12px;color:var(--seal);flex:none;padding-top:1px">1›',
                            'font-size:17px;line-height:26px;color:var(--ink)">\n      <span class="mono" style="font-size:12px;color:var(--seal);flex:none;padding-top:2px">1›')
        content = ('<section aria-label="Thread" style="position:relative;min-width:0;height:800px;overflow:hidden">'
                   + washes(False, 'peaks', t) + toolbar(False)
                   + f'<header style="position:absolute;left:0;right:0;top:72px;z-index:2"><div style="{COL}">{header("Adapter v4 timeline", "fox · {{sub}}", "fox")}</div></header>'
                   + f'<div class="scroll" style="position:absolute;left:0;right:0;top:150px;bottom:96px;z-index:2"><div style="{COL};padding-top:10px">{main}</div></div>'
                   + composer(False) + '</section>')
        inner = (sidebar('static', 'fox') + content + lights()).replace('%%N%%', N)
        body = root(t, 'mac-live', inner, grid='260px minmax(0,1fr)')
        (OUT / f'Mac-Live{N}.dc.html').write_text(doc(f'jcode for Mac · live work · {"night" if night else "day"}', body, b3.LIVE_SCRIPT, 1280, 800))

# ---------------- get started window ----------------
def build_start():
    for theme in ['paper', 'night']:
        t = T[theme]; night = theme == 'night'; N = '-Night' if night else ''
        art = ('<div style="position:relative;overflow:hidden">'
               f'<img class="kb" src="{IMG["butterfly"]}" alt="{ALT["butterfly"]}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:var(--imgf)">'
               '<div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,0) 55%,var(--paper) 99%)"></div></div>')
        local = (f'<a href="Mac-Main{N}.dc.html" class="rise" style="animation-delay:.3s;display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:9px;background:var(--paper2)">'
                 '<span aria-hidden="true" style="width:8px;height:8px;border-radius:50%;background:var(--green);flex:none"></span>'
                 '<span style="flex:1;display:flex;flex-direction:column"><span style="font-size:16px;color:var(--ink)">jcode is running on this Mac</span>'
                 '<span class="mono" style="font-size:11px;color:var(--ink3)">localhost:7646 · no code needed</span></span>'
                 '<span class="mono" style="font-size:12px;color:var(--ink);text-decoration:underline;text-underline-offset:4px;text-decoration-color:var(--line)">use it ↩</span></a>')
        form = ('<div style="position:relative;padding:54px 40px 28px 30px;display:flex;flex-direction:column">'
                '<span class="mono rise" style="font-size:12px;color:var(--ink3);letter-spacing:.08em">jcode</span>'
                '<h1 class="rise" style="margin:6px 0 0;font-size:30px;line-height:36px;font-weight:500;animation-delay:.1s">Pair with your server</h1>'
                '<p class="rise" style="margin:6px 0 18px;font-size:16.5px;line-height:24px;color:var(--ink3);animation-delay:.2s">Start the adapter where jcode runs. It prints a code that works once, for ten minutes.</p>'
                + local +
                '<div class="rise" style="display:flex;align-items:center;gap:10px;margin:18px 0 6px;font-size:13.5px;font-style:italic;color:var(--ink3);animation-delay:.35s">'
                '<span style="flex:1;height:1px;background:var(--line)"></span>or a server elsewhere<span style="flex:1;height:1px;background:var(--line)"></span></div>'
                '<label class="rise" style="display:flex;flex-direction:column;gap:2px;animation-delay:.4s"><span class="mono" style="font-size:11px;color:var(--ink3)">server</span>'
                '<input value="https://studio-vps:7646" style="height:36px;background:none;border:0;border-bottom:1.5px solid var(--line);outline:none;font-family:\'JetBrains Mono\',monospace;font-size:13.5px;color:var(--ink);padding:0"></label>'
                '<label class="rise" style="display:flex;flex-direction:column;gap:6px;margin-top:12px;animation-delay:.45s"><span class="mono" style="font-size:11px;color:var(--ink3)">code</span>'
                '<input value="K7QM-P2XA-" autocomplete="one-time-code" style="height:42px;background:var(--paper2);border:0;border-radius:6px;outline:none;font-family:\'JetBrains Mono\',monospace;font-size:18px;letter-spacing:.16em;color:var(--ink);padding:0 12px"></label>'
                '<div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between">'
                '<button type="button" class="mono" style="height:36px;font-size:12px;color:var(--ink2);text-decoration:underline;text-underline-offset:4px;text-decoration-color:var(--line)">paste a pairing link</button>'
                f'<a href="Mac-Main{N}.dc.html" aria-label="Pair" title="Pair ↩" class="seal stamp" style="width:52px;height:52px">{SEND_SVG}</a></div></div>')
        inner = art + form + lights(zoom=False)
        body = root(t, 'mac-start', inner, h=540, grid='300px minmax(0,1fr)')
        (OUT / f'Mac-Start{N}.dc.html').write_text(doc(f'jcode for Mac · get started · {"night" if night else "day"}', body,
                                                       'class Component extends DCLogic {\n  renderVals() { return {}; }\n}', 760, 540))

# ---------------- settings window ----------------
SETTINGS_SCRIPT = r'''
class Component extends DCLogic {
  constructor(p) { super(p); this.state = { tab: 'scene', scene: 'peaks', look: '__LOOK__', model: 'gpt-5.6-luna', ink: 3 }; }
  renderVals() {
    const S = this.state;
''' + b3.SCRIPT_SCENES + b3.SCRIPT_MODEL.replace('this.state.', 'S.') + r'''
    const T = [['scene', 'Scene'], ['model', 'Brush'], ['servers', 'Servers']];
    const tabIs = {}, tabCls = {}, tabPick = {}, tabOn = {};
    T.forEach(([k]) => { tabIs[k] = S.tab === k; tabOn[k] = S.tab === k ? 'true' : 'false'; tabCls[k] = S.tab === k ? 'on' : ''; tabPick[k] = () => this.setState({ tab: k }); });
    const lookCls = {}, lookPick = {};
    ['day', 'night', 'mac'].forEach(k => { lookCls[k] = S.look === k ? 'on' : ''; lookPick[k] = () => this.setState({ look: k }); });
    return { sel, ring, pick, show, models, inks, tabIs, tabCls, tabPick, tabOn, lookCls, lookPick, tabTitle: T.find(x => x[0] === S.tab)[1], effort: ['minimal','low','medium','high','xhigh','max'][S.ink] };
  }
}
'''

def build_settings():
    for theme in ['paper', 'night']:
        t = T[theme]; night = theme == 'night'; N = '-Night' if night else ''
        tabs = ''.join(f'<button type="button" role="tab" aria-selected="{{{{tabOn.{k}}}}}" class="tab {{{{tabCls.{k}}}}}" onClick="{{{{tabPick.{k}}}}}">{icon(ic, 20)}<span>{lab}</span></button>'
                       for k, ic, lab in [('scene', 'scene', 'Scene'), ('model', 'brush', 'Brush'), ('servers', 'server', 'Servers')])
        thumbs = ''
        for key in b3.SCENES:
            thumbs += (f'<button type="button" role="radio" aria-checked="{{{{sel.{key}}}}}" onClick="{{{{pick.{key}}}}}" style="display:flex;flex-direction:column;gap:5px;text-align:left;min-width:0">'
                       f'<span style="position:relative;display:block;height:74px;border-radius:6px;overflow:hidden;background:var(--paper2);outline:1.6px solid {{{{ring.{key}}}}};outline-offset:3px;transition:outline-color .3s">'
                       f'<img src="{IMG[key]}" alt="" style="width:100%;height:100%;object-fit:cover;filter:var(--imgf)"></span>'
                       f'<span class="clip" style="font-size:13.5px;line-height:16px;color:var(--ink2)">{key.replace("butterfly", "butterfly dream").replace("_", " ")}</span></button>')
        scene_tab = ('<sc-if value="{{tabIs.scene}}" hint-placeholder-val="{{true}}"><div class="min" style="display:flex;flex-direction:column;gap:18px">'
                     '<div style="display:flex;align-items:center;justify-content:space-between"><span style="font-size:16px">Appearance</span>'
                     '<div class="seg" role="radiogroup" aria-label="Appearance">'
                     '<button type="button" class="{{lookCls.day}}" onClick="{{lookPick.day}}">Day</button>'
                     '<button type="button" class="{{lookCls.night}}" onClick="{{lookPick.night}}">Night</button>'
                     '<button type="button" class="{{lookCls.mac}}" onClick="{{lookPick.mac}}">Follow the Mac</button></div></div>'
                     f'<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px"><span style="font-size:16px">Scene for new threads</span>'
                     '<span style="font-size:13.5px;font-style:italic;color:var(--ink3)">a thread keeps the scene it began with</span></div>'
                     f'<div role="radiogroup" aria-label="Scene" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:16px 12px">{thumbs}</div></div>'
                     '</div></sc-if>')
        model_tab = ('<sc-if value="{{tabIs.model}}" hint-placeholder-val="{{false}}"><div class="min" style="display:flex;flex-direction:column;gap:6px;max-width:460px;margin:0 auto;width:100%">'
                     '<span style="font-size:16px">Default model</span>'
                     '<div role="radiogroup" aria-label="Model" style="display:flex;flex-direction:column">'
                     '<sc-for list="{{models}}" as="m" hint-placeholder-count="4"><button type="button" role="radio" aria-checked="{{m.on}}" onClick="{{m.pick}}" disabled="{{m.off}}" '
                     'style="display:flex;align-items:center;gap:12px;height:48px;border-bottom:1px solid var(--line);text-align:left;opacity:{{m.op}}">'
                     '<span style="flex:1;display:flex;flex-direction:column"><span class="mono" style="font-size:12.5px;color:var(--ink)">{{m.name}}</span>'
                     '<span style="font-size:13.5px;font-style:italic;color:var(--ink3)">{{m.note}}</span></span>'
                     '<sc-if value="{{m.on}}" hint-placeholder-val="{{false}}"><svg class="ringdraw" aria-hidden="true" width="16" height="16" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.8" fill="none" style="stroke:var(--seal)" stroke-width="1.6" transform="rotate(-90 7 7)"></circle></svg></sc-if>'
                     '</button></sc-for></div>'
                     '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:18px"><span style="font-size:16px">Effort</span><span class="mono" style="font-size:11px;color:var(--ink3)">{{effort}}</span></div>'
                     '<div role="radiogroup" aria-label="Reasoning effort" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr))">'
                     '<sc-for list="{{inks}}" as="k" hint-placeholder-count="6"><button type="button" role="radio" aria-checked="{{k.on}}" aria-label="{{k.en}}" onClick="{{k.pick}}" style="height:64px;display:flex;flex-direction:column;align-items:center;gap:5px">'
                     '<span style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.6px solid {{k.ring}};box-sizing:border-box;transition:border-color .3s">'
                     '<span style="width:22px;height:22px;border-radius:50%;background:var(--ink);opacity:{{k.ink}};filter:url(#bleed)"></span></span>'
                     '<span class="mono" style="font-size:10px;color:var(--ink3)">{{k.en}}</span></button></sc-for></div>'
                     '</div></sc-if>')
        srv = lambda name, addr, note: ('<div style="display:flex;align-items:center;gap:12px;height:56px;border-bottom:1px solid var(--line)">'
                                        '<span aria-hidden="true" style="width:7px;height:7px;border-radius:50%;background:var(--green)"></span>'
                                        f'<span style="flex:1;display:flex;flex-direction:column"><span style="font-size:16px">{name}</span><span class="mono" style="font-size:11px;color:var(--ink3)">{addr}</span></span>'
                                        f'<span style="font-size:13.5px;font-style:italic;color:var(--ink3)">{note}</span></div>')
        servers_tab = ('<sc-if value="{{tabIs.servers}}" hint-placeholder-val="{{false}}"><div class="min" style="max-width:520px;margin:0 auto;width:100%;display:flex;flex-direction:column">'
                       + srv('studio-vps', 'https://studio-vps:7646', 'paired · 5 threads') + srv('this Mac', 'localhost:7646', 'found on this Mac')
                       + f'<a href="Mac-Start{N}.dc.html" class="mono" style="margin-top:16px;align-self:flex-start;font-size:12px;color:var(--ink2);text-decoration:underline;text-underline-offset:4px;text-decoration-color:var(--line)">pair another server…</a>'
                       '</div></sc-if>')
        inner = ('<div style="position:relative;height:118px;border-bottom:1px solid var(--line);background:var(--side)">'
                 '<div style="position:absolute;left:0;right:0;top:12px;text-align:center;font-size:15px;color:var(--ink2)">{{tabTitle}}</div>'
                 f'<div role="tablist" aria-label="Settings" style="position:absolute;left:0;right:0;top:44px;display:flex;justify-content:center;gap:6px">{tabs}</div></div>'
                 f'<div style="padding:24px 34px">{scene_tab}{model_tab}{servers_tab}</div>' + lights(zoom=False))
        body = root(t, 'mac-settings', inner, h=600)
        script = SETTINGS_SCRIPT.replace('__LOOK__', 'night' if night else 'day')
        (OUT / f'Mac-Settings{N}.dc.html').write_text(doc(f'jcode for Mac · settings · {"night" if night else "day"}', body, script, 780, 600))

# ---------------- menu bar extra ----------------
MENU_SCRIPT = r'''
class Component extends DCLogic {
  constructor(p) { super(p); this.state = { open: true, crane: 'ask', now: 72 }; this.timers = []; }
  componentDidMount() { this.iv = setInterval(() => this.setState({ now: this.state.now + 1 }), 1000); }
  componentWillUnmount() { clearInterval(this.iv); this.timers.forEach(clearTimeout); }
  renderVals() {
    const S = this.state, m = Math.floor(S.now / 60), s = S.now % 60;
    return {
      open: S.open, iconCls: S.open ? 'on' : '', toggle: () => this.setState({ open: !S.open }),
      ask: S.crane === 'ask', allowed: S.crane === 'yes', denied: S.crane === 'no',
      allow: () => this.setState({ crane: 'yes' }), deny: () => this.setState({ crane: 'no' }),
      el: m + ':' + (s < 10 ? '0' : '') + s,
    };
  }
}
'''

def build_menubar():
    for theme in ['paper', 'night']:
        t = T[theme]; night = theme == 'night'; N = '-Night' if night else ''
        mini = ('<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24"><g fill="none" style="stroke:var(--ink)" stroke-width="2.4" stroke-linecap="round">'
                '<path d="M4 6 H20"></path><path d="M4 12 H10 M14 12 H20"></path><path d="M4 18 H20"></path></g></svg>')
        bar = ('<div style="position:absolute;left:0;right:0;top:0;height:28px;background:var(--side);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:flex-end;padding:0 14px;z-index:3">'
               '<button type="button" class="tb {{iconCls}}" aria-label="jcode" aria-expanded="{{open}}" onClick="{{toggle}}" style="height:22px;min-width:28px;border-radius:5px">' + mini + '</button></div>')
        row = lambda sym, ttl, sub, right, extra='': (
            f'<div style="display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px">'
            f'<div style="display:flex;align-items:center;gap:10px">{seal_sym(sym, 20)}<span style="flex:1;min-width:0;display:flex;flex-direction:column">'
            f'<span class="clip" style="font-size:15px;color:var(--ink)">{ttl}</span><span class="clip" style="font-size:12.5px;font-style:italic;color:var(--ink3)">{sub}</span></span>{right}</div>{extra}</div>')
        crane_extra = ('<sc-if value="{{ask}}" hint-placeholder-val="{{true}}"><div style="margin-left:30px;display:flex;flex-direction:column;gap:8px">'
                       '<code class="mono" style="font-size:11.5px;color:var(--ink2)">rm -rf target/debug/incremental …</code>'
                       '<div style="display:flex;gap:6px">' + btn_seal('Allow', '{{allow}}') + btn_line('Deny', '{{deny}}') + '</div></div></sc-if>'
                       '<sc-if value="{{allowed}}" hint-placeholder-val="{{false}}"><div class="min mono" style="margin-left:30px;font-size:11.5px;color:var(--ink3);display:flex;align-items:center;gap:6px">' + SPIN + ' allowed · running</div></sc-if>'
                       '<sc-if value="{{denied}}" hint-placeholder-val="{{false}}"><div class="min mono" style="margin-left:30px;font-size:11.5px;color:var(--ink3)">denied · crane will ask another way</div></sc-if>')
        heron_bar = ('<div role="img" aria-label="3 of 7 done" style="margin-left:30px;height:3px;border-radius:2px;background:var(--line);overflow:hidden">'
                     '<div style="width:43%;height:100%;background:var(--ink);opacity:.55"></div></div>')
        panel = ('<sc-if value="{{open}}" hint-placeholder-val="{{true}}"><div class="pop panel" role="dialog" aria-label="jcode" style="position:absolute;top:34px;right:10px;width:356px;padding:8px;z-index:4;transform-origin:top right">'
                 '<div class="mono" style="display:flex;align-items:center;gap:8px;padding:6px 10px 8px;font-size:11.5px;color:var(--ink2)">'
                 '<span aria-hidden="true" style="width:6px;height:6px;border-radius:50%;background:var(--green)"></span>studio-vps'
                 '<span style="margin-left:auto;font-family:\'EB Garamond\',Georgia,serif;font-style:italic;font-size:13px;color:var(--ink3)">two at work, one waiting</span></div>'
                 '<div class="grp" style="padding-top:4px">waiting for you</div>'
                 + row('crane', 'Clean the build cache', 'asks to run a command', MARK['ask'], crane_extra)
                 + '<div class="grp">working</div>'
                 + row('fox', 'Adapter v4 timeline', 'running the tests · step 4 of 4', '<span class="mono" style="font-size:11px;color:var(--blue)">{{el}}</span>', '<div class="flow" aria-hidden="true" style="margin-left:30px"></div>')
                 + row('heron', 'Pinned todo card', 'with owl, wren and lynx · 3 of 7', MARK['live'], heron_bar)
                 + '<div class="grp">finished</div>'
                 + row('owl', 'Socket timeout', 'fourteen minutes ago', MARK['done'])
                 + '<div style="height:1px;background:var(--line);margin:6px 4px"></div>'
                 + f'<a href="Mac-Main{N}.dc.html" class="pitem" style="height:34px;font-size:15px;color:var(--ink2)"><span style="flex:1">Open jcode</span><kbd>⌘O</kbd></a>'
                 + f'<a href="Mac-Main{N}.dc.html" class="pitem" style="height:34px;font-size:15px;color:var(--ink2)"><span style="flex:1">New thread</span><kbd>⌘N</kbd></a>'
                 + '<button type="button" class="pitem" style="height:34px;font-size:15px;color:var(--ink2)"><span style="flex:1">Quit jcode</span><kbd>⌘Q</kbd></button>'
                 '</div></sc-if>')
        # a quiet desktop under the menu: the scene, blurred
        desk = (f'<img src="{WASH["quiet_river"]}" alt="" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:{t["wop"]}">')
        body = root(t, 'mac-menu', desk + bar + panel, h=640)
        (OUT / f'Mac-MenuBar{N}.dc.html').write_text(doc(f'jcode for Mac · menu bar · {"night" if night else "day"}', body, MENU_SCRIPT, 400, 640))

# ---------------- native notes ----------------
NATIVE = [
    ('Window and structure', [
        ('Window with sidebar, thread and inspector', 'WindowGroup · NavigationSplitView(columnVisibility:) · .inspector(isPresented:)', 'macOS 14. The inspector folds with ⌥⌘0; the sidebar with ⌃⌘S (the system toggle).'),
        ('Painting under the toolbar', '.windowToolbarStyle(.unified(showsTitle: false)) · .toolbarBackground(.hidden, for: .windowToolbar) · .ignoresSafeArea(edges: .top)', 'The title lives in the page, not the title bar.'),
        ('Drag the window by the painting', '.windowBackgroundDragBehavior(.enabled)', 'macOS 15. On 14, NSWindow.isMovableByWindowBackground in an NSViewRepresentable.'),
        ('Paper, not glass', 'Opaque Color("paper") from an asset catalog with Any and Dark · tiled grain Image(resizingMode: .tile), .blendMode(.multiply)', 'No NSVisualEffectView. The only material is paper.'),
        ('Thread list', 'List(selection:) .listStyle(.sidebar) with Section per state', 'Selection is the system one, tinted with the ink accent.'),
        ('Trigram seals', 'A Shape that draws three strokes; .fill(seal) with a small displacement via .distortionEffect', 'Shader is optional; a plain rounded rect reads fine.'),
    ]),
    ('Motion', [
        ('Painting breathes slowly', 'TimelineView(.animation) driving scaleEffect and offset, 34 s', 'Pause when controlActiveState == .inactive or accessibilityReduceMotion.'),
        ('Scenes cross-fade when a thread changes', 'ZStack of Images, .opacity(selected ? 1 : 0), .animation(.smooth(duration: 0.9))', 'Keep all five decoded; never re-decode on switch.'),
        ('Thread content rises in', '.id(thread.id) + .transition(.opacity.combined(with: .offset(y: 6))); stagger with .animation(.smooth.delay(i * 0.06))', ''),
        ('Tool call appears, then settles', '.transition(.move(edge: .leading).combined(with: .opacity)) · Circle().trim(from:to:) for the done ring', 'Elapsed time: Text(timerInterval:) with .contentTransition(.numericText()).'),
        ('Thinking and diffs fold', 'DisclosureGroup with a custom style; height animates in withAnimation(.smooth)', ''),
        ('Words arrive one by one', 'TextRenderer (macOS 15) fading each run by its index', 'On 14, append runs with .contentTransition(.opacity).'),
        ('Send stamps', '.keyframeAnimator: scale 1.5 → 0.95 → 1, rotation −12° → −3°', 'With NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now).'),
    ]),
    ('Keyboard and pointer', [
        ('Go to (⌘K)', 'In-window overlay · .keyboardShortcut("k") · @FocusState · .onKeyPress(.upArrow / .downArrow / .return / .escape)', 'macOS 14 for onKeyPress.'),
        ('Model and effort', '.popover(isPresented:, arrowEdge: .bottom) from the toolbar chip · ⇧⌘M', ''),
        ('Threads by number', '⌘1 … ⌘5 via .keyboardShortcut on hidden Buttons, or CommandMenu("Threads")', 'Also listed in the menu bar, so they can be found.'),
        ('Stop', '⌘. — the Mac’s own cancel', ''),
        ('Swipe between threads', 'NSEvent.trackSwipeEvent in an NSView with wantsScrollEventsForSwipeTracking', 'Two-finger swipe, same as back and forward in Finder.'),
        ('Approvals', '↩ allows once, esc denies; .keyboardShortcut(.defaultAction) and (.cancelAction)', ''),
    ]),
    ('Living beside the Mac', [
        ('Menu bar companion', 'MenuBarExtra { … }.menuBarExtraStyle(.window)', 'Approve from here without opening the window.'),
        ('Ask from a notification', 'UNNotificationCategory with Allow and Deny UNNotificationAction', 'Only when the window is not frontmost.'),
        ('Settings', 'Settings { TabView { … } } — Scene, Brush, Servers', 'The tab toolbar and ⌘, come with the scene.'),
        ('Server on this Mac', 'Probe localhost:7646 at launch; NWBrowser if the adapter advertises over Bonjour', 'Pairing skips the code for a local server.'),
        ('Day and night', '.preferredColorScheme(nil / .light / .dark) from the Appearance setting', 'Follow the Mac by default.'),
        ('Fonts', 'EB Garamond and JetBrains Mono bundled; ATSApplicationFontsPath in Info.plist; .font(.custom(_:size:relativeTo:))', 'relativeTo keeps Dynamic Type sizes honest.'),
    ]),
]

def build_native():
    t = T['paper']
    secs = ''
    for title, rows in NATIVE:
        trs = ''.join(f'<tr><td style="padding:10px 14px 10px 0;vertical-align:top;font-size:16px;color:var(--ink);width:30%">{a}</td>'
                      f'<td class="mono" style="padding:10px 14px 10px 0;vertical-align:top;font-size:11.5px;line-height:18px;color:var(--ink2);width:42%">{b}</td>'
                      f'<td style="padding:10px 0;vertical-align:top;font-size:14.5px;line-height:21px;font-style:italic;color:var(--ink3)">{c}</td></tr>' for a, b, c in rows)
        secs += (f'<h2 style="margin:34px 0 6px;font-size:22px;font-weight:500">{title}</h2>'
                 '<table style="width:100%;border-collapse:collapse"><thead><tr>'
                 '<th class="mono" style="text-align:left;font-weight:400;font-size:10.5px;color:var(--ink3);padding:6px 0;border-bottom:1px solid var(--ink3)">what you see</th>'
                 '<th class="mono" style="text-align:left;font-weight:400;font-size:10.5px;color:var(--ink3);padding:6px 0;border-bottom:1px solid var(--ink3)">swiftui · appkit</th>'
                 '<th class="mono" style="text-align:left;font-weight:400;font-size:10.5px;color:var(--ink3);padding:6px 0;border-bottom:1px solid var(--ink3)">note</th></tr></thead>'
                 f'<tbody style="border-collapse:collapse">{trs}</tbody></table>')
    secs = secs.replace('<tr><td', '<tr style="border-bottom:1px solid var(--line)"><td')
    inner = ('<div style="position:relative;padding:56px 60px 60px">'
             '<span class="mono" style="font-size:12px;color:var(--ink3);letter-spacing:.08em">jcode for Mac · Wu wei</span>'
             '<h1 style="margin:6px 0 0;font-size:34px;line-height:40px;font-weight:500">SwiftUI first, AppKit where SwiftUI stops</h1>'
             '<p style="margin:10px 0 0;font-size:17px;line-height:26px;color:var(--ink2);max-width:660px">Same paper, same seals, same slow paintings as the phone. '
             'The Mac gets what a desk gives: three columns, the keyboard, a menu bar companion, and a server that may be running on the same machine. Target macOS 14; two touches need 15.</p>'
             + secs + '</div>')
    body = root(t, 'mac-native', inner, h=2300, extra='height:auto;min-height:2300px')
    (OUT / 'Mac-Native.dc.html').write_text(doc('jcode for Mac · native notes', body, 'class Component extends DCLogic {\n  renderVals() { return {}; }\n}', 900, 2300))

if __name__ == '__main__':
    build_main(); build_live(); build_start(); build_settings(); build_menubar(); build_native()
    print('mac built')
