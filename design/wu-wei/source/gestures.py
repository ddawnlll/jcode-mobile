# ---------------- Android gestures for the Flow prototype ----------------
# exec'd by build3.py; uses its globals (row, link, hero, title, composer, page_*, wrap, doc, OUT, THEMES, SCENES, CSS3, LIVE_CSS)

GESTURE_CSS = r"""
@keyframes t-slide-out{from{transform:none}to{transform:translate3d(100%,0,0)}}
@keyframes t-slide-in{from{transform:translate3d(-22%,0,0);opacity:.55}to{transform:none;opacity:1}}
@keyframes g-ripple{from{transform:scale(.08);opacity:.22}to{transform:scale(1);opacity:0}}
@keyframes g-spin{to{transform:rotate(360deg)}}
.s .enter-slide{z-index:1;animation:t-slide-in .42s var(--ease) both}
.s .leave-slide{z-index:2;animation:t-slide-out .42s cubic-bezier(.4,0,.2,1) both;box-shadow:-12px 0 30px rgba(0,0,0,.12)}
.s .ripple{position:absolute;width:180px;height:180px;margin:-90px 0 0 -90px;border-radius:50%;pointer-events:none;z-index:20;
  background:radial-gradient(circle,var(--ink) 0,var(--ink) 18%,transparent 70%);animation:g-ripple .65s var(--ease) both}
.s .edge{position:absolute;left:0;top:96px;bottom:0;width:22px;z-index:9;touch-action:none}
.s .backchip{position:absolute;left:-8px;width:40px;height:40px;border-radius:50%;background:var(--paper2);display:flex;align-items:center;justify-content:center;z-index:30;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.15)}
.s .scrim{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .38s var(--ease);z-index:24;border:0;padding:0}
.s .scrim.on{opacity:.32;pointer-events:auto}
.s .sheet{position:absolute;left:0;right:0;bottom:0;z-index:25;background:var(--paper);border-radius:20px 20px 0 0;padding:10px 20px 30px;transform:translate3d(0,105%,0);transition:transform .42s var(--ease);box-shadow:0 -8px 30px rgba(0,0,0,.12)}
.s .sheet.on{transform:none}
.s .snack{position:absolute;left:14px;right:14px;bottom:100px;z-index:22;background:var(--ink);color:var(--paper);border-radius:12px;height:52px;display:flex;align-items:center;padding:0 6px 0 16px;gap:10px;transform:translate3d(0,24px,0);opacity:0;pointer-events:none;transition:transform .45s var(--ease),opacity .3s var(--ease)}
.s .snack.on{transform:none;opacity:1;pointer-events:auto}
.s .pull{position:absolute;left:50%;top:-6px;width:28px;height:28px;margin-left:-14px;pointer-events:none}
.s .pull.spin svg{animation:g-spin .8s linear infinite}
.s .action{display:flex;align-items:center;gap:14px;height:52px;width:100%;font-size:18px;color:var(--ink);text-align:left}
"""

ARCHIVE_ICON = ('<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" style="stroke:var(--ink2)" stroke-width="1.7" '
                'stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v3H4zM6 10v8h12v-8M10 14h4"></path></svg>')


def flow_row(rid, sym, ttl, note, state, delay, faded=False, opens=False):
    html = row('flow', sym, ttl, note, state, 'Main' if opens else None, delay, faded, origin='r2' if opens else None)
    if not opens:
        html = html.replace('<a href="#" class="rise"', '<button type="button" class="rise"', 1).replace('</a>', '</button>')
    return (f'<div class="rw" style="display:grid;grid-template-rows:{{{{rows.{rid}.gr}}}};transition:grid-template-rows .45s var(--ease),opacity .3s;opacity:{{{{rows.{rid}.o}}}}">'
            f'<div style="min-height:0;position:relative;overflow:hidden">'
            f'<div aria-hidden="true" style="position:absolute;inset:1px 0;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-right:14px;background:var(--paper2);opacity:{{{{rows.{rid}.uo}}}}">'
            f'{ARCHIVE_ICON}<span class="mono" style="font-size:11px;color:var(--ink2)">archive</span></div>'
            f'<div style="position:relative;background:var(--paper);touch-action:pan-y;transform:translate3d({{{{rows.{rid}.dx}}}}px,0,0) scale({{{{rows.{rid}.sc}}}});'
            f'box-shadow:{{{{rows.{rid}.sh}}}};transition:{{{{rows.{rid}.tr}}}};border-radius:{{{{rows.{rid}.rad}}}}" '
            f'onPointerDown="{{{{rows.{rid}.down}}}}" onPointerMove="{{{{pmove}}}}" onPointerUp="{{{{pup}}}}" onPointerCancel="{{{{pup}}}}">{html}</div></div></div>')


def page_sessions_flow(t):
    rows = (flow_row('r1', 'crane', 'Clean the build cache', 'crane asks to run <span class="mono" style="font-style:normal;font-size:11px">rm -rf target/…</span>', 'ask', .1)
            + flow_row('r2', 'fox', 'Adapter v4 timeline', 'fox · running the tests', 'live', .2, opens=True)
            + flow_row('r3', 'heron', 'Pinned todo card', 'heron, with owl, wren and lynx · 3 of 7', 'live', .3)
            + flow_row('r4', 'owl', 'Socket timeout', 'owl · done, fourteen minutes ago', 'done', .4)
            + flow_row('r5', 'moth', 'Android back stack', 'moth · resting since Saturday', 'rest', .5, faded=True))
    server = link('flow', 'Scenes', '<span aria-hidden="true" style="width:6px;height:6px;border-radius:50%;background:var(--green)"></span>studio-vps',
                  "position:absolute;right:16px;top:54px;height:40px;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ink2);font-family:'JetBrains Mono',monospace;z-index:2",
                  'Server studio-vps · scenes and theme')
    pull = ('<div class="pull {{pullCls}}" aria-hidden="true" style="transform:translate3d(0,{{pullY}}px,0) scale({{pullS}});opacity:{{pullO}};transition:{{pullTr}}">'
            '<svg width="28" height="28" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" style="stroke:var(--ink)" stroke-width="2.4" stroke-linecap="round" '
            'stroke-dasharray="{{pullDash}} 60" transform="rotate(-90 12 12)"></circle></svg></div>')
    nav = ('<nav aria-label="Threads" style="position:absolute;left:22px;right:22px;top:282px;display:flex;flex-direction:column">'
           + pull
           + '<div style="display:flex;flex-direction:column;transform:translate3d(0,{{listY}}px,0);transition:{{pullTr}}" '
             'onPointerDown="{{listDown}}" onPointerMove="{{pmove}}" onPointerUp="{{pup}}" onPointerCancel="{{pup}}">'
           + rows + '</div></nav>')
    return (hero('pavilion', t, h=280) + server + title('Threads', '~/src · {{threadCount}} sessions', None, top=226)
            + nav + composer('flow', 'begin a new thread…', stop=False, meta=False))


FLOW_SCRIPT2 = (ROOT / 'flow2.js').read_text()

OVERLAY = '''
<sc-if value="{{backing}}" hint-placeholder-val="{{false}}"><div class="backchip" aria-hidden="true" style="top:{{backY}}px;transform:translate3d({{chipX}}px,0,0);opacity:{{chipO}}">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="stroke:{{chipArrow}}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5c-3 2.5-5.5 4.6-7 7 1.5 2.4 4 4.5 7 7"></path></svg></div></sc-if>
<sc-for list="{{ripples}}" as="r" hint-placeholder-count="0"><span class="ripple" aria-hidden="true" style="left:{{r.x}}px;top:{{r.y}}px"></span></sc-for>
<div class="snack {{snackCls}}" role="status"><span class="clip" style="flex:1;font-size:16px">Archived “{{snackName}}”</span><button type="button" onClick="{{undo}}" class="mono" style="height:44px;padding:0 12px;font-size:12px;color:var(--paper);text-decoration:underline;text-underline-offset:4px">undo</button></div>
<button type="button" aria-label="Close actions" class="scrim {{sheetCls}}" onClick="{{closeSheet}}"></button>
<div class="sheet {{sheetCls}}" role="dialog" aria-label="Thread actions">
  <div aria-hidden="true" style="width:36px;height:4px;border-radius:2px;background:var(--line);margin:0 auto 14px"></div>
  <div class="clip" style="font-size:21px;color:var(--ink);margin-bottom:6px">{{sheetName}}</div>
  <button type="button" class="action" onClick="{{closeSheet}}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" style="stroke:var(--ink2)" stroke-width="1.7" stroke-linecap="round"><path d="M12 17v4M8 3h8l-1 6 3 4H6l3-4z"></path></svg>Pin to the top</button>
  <button type="button" class="action" onClick="{{closeSheet}}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" style="stroke:var(--ink2)" stroke-width="1.7" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16z"></path></svg>Rename</button>
  <button type="button" class="action" onClick="{{closeSheet}}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" style="stroke:var(--ink2)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M4 9h16"></path></svg>Open in a new window</button>
  <button type="button" class="action" onClick="{{archiveSheet}}">''' + ARCHIVE_ICON + '''Archive</button>
</div>'''


def build_flow2():
    t = THEMES['paper']
    live_heroes = ''.join(f'<sc-if value="{{{{heroIs.{k}}}}}" hint-placeholder-val="{{{{{str(k == "peaks").lower()}}}}}">' + hero(k, t, h=210) + '</sc-if>' for k in SCENES)
    screens = {'start': page_start(t, 'flow'), 'sessions': page_sessions_flow(t), 'main': page_live(t, 'flow', live_heroes),
               'model': page_model(t, 'flow'), 'scenes': page_scenes(t, 'flow', False)}
    inner = ''
    for k, body in screens.items():
        rod = (f'<sc-if value="{{{{rod{k.capitalize()}}}}}" hint-placeholder-val="{{{{false}}}}"><span class="rod" aria-hidden="true"></span></sc-if>'
               if k in ('model', 'scenes') else '')
        edge = ('<div class="edge" aria-hidden="true" onPointerDown="{{edgeDown}}" onPointerMove="{{pmove}}" onPointerUp="{{pup}}" onPointerCancel="{{pup}}"></div>'
                if k in ('main', 'model', 'scenes') else '')
        inner += (f'<sc-if value="{{{{vis.{k}}}}}" hint-placeholder-val="{{{{{str(k == "start").lower()}}}}}">'
                  f'<div class="screen {{{{cls.{k}}}}}" style="--ox:{{{{ox}}}};--oy:{{{{oy}}}};transform:{{{{tf.{k}}}}};border-radius:{{{{rad.{k}}}}};'
                  f'transition:{{{{trn.{k}}}}};box-shadow:{{{{sh.{k}}}}};opacity:{{{{op.{k}}}}};z-index:{{{{zi.{k}}}}}">'
                  f'{rod}{body}{edge}</div></sc-if>\n')
    root = wrap(t, inner + OVERLAY, flow=True).replace('<div class="s" style=', '<div class="s" onPointerDown="{{ripple}}" style=', 1)
    html = doc('jcode · flow prototype', root, FLOW_SCRIPT2)
    html = html.replace('<style>' + CSS3, '<style>' + CSS3 + LIVE_CSS + GESTURE_CSS)
    (OUT / 'Flow.dc.html').write_text(html)
    print('flow built')


MOTIONS = [
    ('Touch', 'An ink ripple spreads from the fingertip and fades.', '650 ms · ease-out', 'Replaces the Material ripple; WebView tap highlight off.'),
    ('Press', 'Controls sink to 97 %, seals to 90 % with a small tilt.', '180 ms', 'Haptic: CONTEXT_CLICK on seals.'),
    ('Open a thread', 'Ink drops from the tapped row and spreads to fill the page.', '900 ms', 'Forward navigation; previous page dims behind.'),
    ('Open a picker', 'Model and scene unroll from the top behind a thin ink rod.', '800 ms', 'Full-screen sheet; back rolls it away.'),
    ('Back (button or system)', 'The page slides right; the one beneath returns from a 22 % parallax.', '420 ms', 'OnBackPressedDispatcher → web layer.'),
    ('Predictive back', 'Drag from the left edge: the page shrinks to 90 %, rounds its corners and follows the finger, showing where back leads. Past a third it commits; short of that it settles back.', 'follows finger · 320 ms settle', 'Android 14+: OnBackAnimationCallback progress bridged from the Tauri activity; enableOnBackInvokedCallback="true".'),
    ('Swipe a thread left', 'An ink wash reveals archive; past 110 px the row leaves, the list closes the gap, and an undo bar rises.', 'follows finger · 450 ms collapse · 4.6 s undo', 'Haptic tick on commit.'),
    ('Long press', 'After 450 ms the row lifts with a soft shadow, a haptic tick, then the action sheet slides up.', '450 ms hold · 420 ms sheet', 'HapticFeedbackConstants.LONG_PRESS.'),
    ('Pull to refresh', 'An ink ring fills as you pull, turns while the list reloads, then settles.', 'follows finger · 450 ms settle', 'Only at the top of the list; native overscroll stretch elsewhere.'),
    ('Sheet', 'Slides up over a dimming scrim; tap the scrim or drag down to dismiss.', '420 ms', 'Back closes the sheet before the page.'),
    ('Keyboard', 'The composer rides the keyboard frame by frame; the newest line stays in view.', 'IME-driven', 'WindowInsetsAnimationCompat progress, no jump at the end.'),
    ('Thinking', 'A thin line grows as words settle into the page; when done it folds to “thought for 4 s”.', '500 ms per word, 65 ms stagger', 'Polite live region; collapse eases height.'),
    ('Tool call', 'Ink drop, then the intent slides in; a hairline of ink flows while it runs; the drop becomes an indigo ring as it finishes.', '550 ms in · 900 ms ring', 'Rows change state in place; nothing jumps.'),
    ('Diff and output', 'Panels unfold under their row and fold away when the step ends.', '750 ms height ease', 'grid-template-rows 0fr → 1fr.'),
    ('Scene and theme', 'Paintings cross-fade and drift slowly; day and night ease their colours.', '1.2 s fade · 34 s drift · 600 ms theme', 'Follows system dark mode unless chosen.'),
    ('Reduced motion', 'Everything above becomes a short fade. Gestures still follow the finger.', '≤ 150 ms', 'ANIMATOR_DURATION_SCALE and prefers-reduced-motion.'),
]


def build_motion():
    t = THEMES['paper']
    syms = ''
    for kind, name in [('fox', 'fox'), ('crane', 'crane'), ('heron', 'heron'), ('owl', 'owl'), ('moth', 'moth'), ('send', 'send')]:
        syms += (f'<div style="display:flex;flex-direction:column;align-items:center;gap:6px">{seal_sym(kind, 34)}'
                 f'<span class="mono" style="font-size:10.5px;color:var(--ink3)">{name}</span></div>')
    marks = (
        '<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:var(--seal)"></span><span style="font-size:15px">waiting for you</span></div>'
        '<div style="display:flex;align-items:center;gap:8px"><span class="mono spin" style="color:var(--blue);font-size:14px"></span><span style="font-size:15px">working</span></div>'
        '<div style="display:flex;align-items:center;gap:8px"><span class="ring" style="width:14px;height:14px"></span><span style="font-size:15px">finished</span></div>'
        '<div style="display:flex;align-items:center;gap:8px"><span style="width:6px;height:6px;border-radius:50%;background:var(--ink3)"></span><span style="font-size:15px">resting</span></div>')
    rows = ''
    for i, (name, what, timing, hook) in enumerate(MOTIONS):
        rows += (f'<div class="rise" style="display:flex;flex-direction:column;gap:3px;padding:14px 0;border-top:1px solid var(--line);animation-delay:{min(i * .04, .6):.2f}s">'
                 f'<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><span style="font-size:19px;color:var(--ink)">{name}</span>'
                 f'<span class="mono" style="font-size:10.5px;color:var(--ink3);text-align:right">{timing}</span></div>'
                 f'<span style="font-size:15.5px;line-height:22px;color:var(--ink2)">{what}</span>'
                 f'<span class="mono" style="font-size:10.5px;line-height:16px;color:var(--ink3)">{hook}</span></div>')
    H = 2380
    inner = f'''
  <div style="position:absolute;left:0;right:0;top:0;height:220px;overflow:hidden">{hero('sage_under_pine', t, h=220)}</div>
  <div style="position:absolute;left:24px;right:24px;top:196px;display:flex;flex-direction:column">
    <h1 class="bleedin" style="margin:0;font-size:34px;line-height:40px;font-weight:500;color:var(--ink)">Motion</h1>
    <p style="margin:6px 0 0;font-size:17px;line-height:25px;color:var(--ink3);font-style:italic">Ink settling on paper. One soft ease-out curve, cubic-bezier(.22, 1, .36, 1). Only opacity and movement animate. Nothing bounces but the seal.</p>
    <h2 style="margin:26px 0 12px;font-size:21px;font-weight:500;color:var(--ink)">Symbols</h2>
    <p style="margin:0 0 14px;font-size:15.5px;line-height:22px;color:var(--ink2)">Each agent wears a trigram, three lines whole or broken, in an indigo seal. The send seal is a single rising stroke.</p>
    <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px">{syms}</div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;margin-top:18px;color:var(--ink2)">{marks}</div>
    <h2 style="margin:28px 0 4px;font-size:21px;font-weight:500;color:var(--ink)">Movements</h2>
    {rows}
  </div>'''
    root = wrap(t, inner).replace('height:844px', f'height:{H}px', 1)
    html = doc('jcode · motion', root, 'class Component extends DCLogic {\n  renderVals() { return {}; }\n}')
    html = html.replace('"height":844', f'"height":{H}')
    (OUT / 'Motion.dc.html').write_text(html)
    print('motion built')
