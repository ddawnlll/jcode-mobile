#!/usr/bin/env python3
"""Phoenix ink edition, v3: fewer Chinese characters (only seals), plus a Flow prototype with page transitions.
Usage: build3.py static | flow
"""
import sys, urllib.parse
exec(open(__file__.replace('build3.py', 'base3.py')).read())


IMG = {'peaks': '/_blob/618de2d01f0e15bdf8b8c33a93f9765c', 'pavilion': '/_blob/3ac07e5d05b81dfa28feb571eb1e0dea',
       'riders': '/_blob/5a9040033f50a7a690c92b69377e5a27', 'butterfly': '/_blob/253579c9087f716f061f43b0a66e9cd6'}
ALT = {'peaks': 'Detail of an old blue-and-green landscape painting: mountain peaks',
       'pavilion': 'Detail of an old blue-and-green landscape painting: a pavilion under pines',
       'riders': 'Detail of an old blue-and-green landscape painting: two riders beneath the pines',
       'butterfly': 'Detail of Zhuang Zhou Dreaming of a Butterfly, attributed to Lu Zhi, Ming dynasty'}
SCENES = ['peaks', 'pavilion', 'riders', 'butterfly']
THEMES['paper'].update(paper='#E5EBE0', paper2='#D6E0D3', ink='#16231D', ink2='#2D3C34', ink3='#56685D', line='#BCCBBE',
                       seal='#2E4374', onseal='#F1F4EC', blue='#3F7484', green='#3B7A5C', mist='#E5EBE0', imgf='saturate(1)',
                       grain_m='0 0 0 0 0.26  0 0 0 0 0.36  0 0 0 0 0.30  0 0 0 0.22 0')
THEMES['night'].update(paper='#0E1613', paper2='#17221D', ink='#DCE8DE', ink2='#BCCFC1', ink3='#86998C', line='#24342C',
                       seal='#93A6D9', onseal='#10140F', blue='#7FAFBD', green='#6FA88A', mist='#0E1613', imgf='brightness(.58) saturate(.85)',
                       grain_m='0 0 0 0 0.7  0 0 0 0 0.9  0 0 0 0 0.8  0 0 0 0.18 0')

def hero(key, t, h=340, progress=None, flow=False):
    dots = ''
    if progress:
        items = ''
        for i, d in enumerate(progress):
            last = i == len(progress) - 1
            red = '<span style="width:9px;height:9px;border-radius:50%;background:var(--seal);box-shadow:0 0 0 3px var(--paper)"></span>'
            ring = '<span style="width:9px;height:9px;border-radius:50%;border:1.4px solid var(--ink2);box-sizing:border-box;background:var(--paper)"></span>'
            if flow and last:
                items += ('<sc-if value="{{done}}" hint-placeholder-val="{{false}}"><span class="stamp" style="display:flex;animation-delay:0s">' + red + '</span></sc-if>'
                          '<sc-if value="{{notDone}}" hint-placeholder-val="{{true}}"><span class="wet" style="display:flex">' + ring + '</span></sc-if>')
            else:
                items += red if d else ring
            if not last:
                items += '<span style="flex:1;height:1px;background:var(--ink2);opacity:.35"></span>'
        dots = f'<div role="img" aria-label="Steps on the way" style="position:absolute;left:22px;right:120px;bottom:58px;display:flex;align-items:center;gap:6px">{items}</div>'
    return (f'<div style="position:absolute;left:0;top:0;width:390px;height:{h}px;overflow:hidden">'
            f'<img class="kb" src="{IMG[key]}" alt="{ALT[key]}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:var(--imgf)">'
            '<div class="drift" aria-hidden="true" style="position:absolute;left:-40px;right:-40px;top:52%;height:46px;background:var(--paper);opacity:.32;filter:blur(16px)"></div>'
            '<div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 55%,var(--paper) 98%)"></div>'
            f'{dots}</div>')

IMG.update({'jade-peaks': '/_blob/3712f6e1d93b1b7f634457d5fe3b67df', 'river-valley': '/_blob/64ac54e9dda1e545e7cfadf7899d51b2',
            'blue-hills': '/_blob/0f0c3f1849968fef38e21cc1bf31ff81', 'misty-peaks': '/_blob/d6b0440cdcd252c9cfd10c0889cd633b',
            'lone-boat': '/_blob/bbac403b3e3406785527455f814ab514', 'sage-under-pine': '/_blob/ea65970e973a805897baba095fa2ddda',
            'green-woods': '/_blob/ed4551942f958007d9500bdc301e0881', 'quiet-river': '/_blob/71a94aa046ae4e1172f7124a8ce6180a'})
for _k, _v in {'jade-peaks': 'jade peaks', 'river-valley': 'a river valley', 'blue-hills': 'blue hills', 'misty-peaks': 'peaks in mist',
               'lone-boat': 'a lone boat', 'sage-under-pine': 'a sage resting under a pine', 'green-woods': 'green woods', 'quiet-river': 'a quiet river'}.items():
    ALT[_k] = 'Detail of an old Chinese landscape painting, Metropolitan Museum of Art open access: ' + _v
IMG['flock'] = '/_blob/93a676a2a3bc0f57ccaacb155aaa7569'
ALT['flock'] = 'Detail of an old ink painting: a flock of birds crossing the sky above a tree'
IMG = {k.replace('-', '_'): v for k, v in IMG.items()}
ALT = {k.replace('-', '_'): v for k, v in ALT.items()}
SCENES = ['peaks', 'jade-peaks', 'pavilion', 'river-valley', 'blue-hills', 'riders', 'misty-peaks', 'lone-boat', 'sage-under-pine', 'green-woods', 'quiet-river', 'butterfly']
SCENES = [k.replace('-', '_') for k in SCENES]

def grain(t):
    cls = 'grain-night' if t.get('paper') == '#0E1613' else 'grain-day'
    return f'<div aria-hidden="true" class="grain {cls}"></div>'

# ---- symbols instead of characters: trigram seals and a send stroke ----
TRIGRAMS = {'fox': '101', 'crane': '111', 'heron': '010', 'owl': '100', 'moth': '011', 'wren': '110', 'lynx': '001', 'send': None}
def seal_sym(kind, size, extra_cls='', label=None):
    al = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    if kind == 'send':
        inner = ('<svg viewBox="0 0 24 24" width="62%" height="62%" aria-hidden="true"><path d="M12 19.5 C 11.6 15, 12.2 10, 12 5.2 M 6.6 10.4 C 8.6 8.6, 10.4 6.8, 12 5 C 13.6 6.8, 15.4 8.6, 17.4 10.4" '
                 'fill="none" style="stroke:var(--onseal)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>')
    else:
        bits = TRIGRAMS[kind]; lines = ''
        for i, b in enumerate(reversed(bits)):  # drawn bottom to top
            y = 17 - i * 5
            lines += (f'<path d="M5 {y} H19"></path>' if b == '1' else f'<path d="M5 {y} H10.4 M13.6 {y} H19"></path>')
        inner = f'<svg viewBox="0 0 24 24" width="70%" height="70%" aria-hidden="true"><g fill="none" style="stroke:var(--onseal)" stroke-width="2.6" stroke-linecap="round">{lines}</g></svg>'
    return f'<span {al} class="seal {extra_cls}" style="width:{size}px;height:{size}px">{inner}</span>'

CSS3 = CSS + r"""
@keyframes kb{from{transform:scale(1.03) translate(0,0)}to{transform:scale(1.1) translate(-12px,-6px)}}
.s .kb{animation:kb 34s ease-in-out infinite alternate;transform-origin:60% 40%}
.s .screen{position:absolute;inset:0;background:var(--paper);overflow:hidden}
@keyframes t-drop{from{clip-path:circle(0px at var(--ox,50%) var(--oy,50%));filter:blur(2px)}to{clip-path:circle(160% at var(--ox,50%) var(--oy,50%));filter:blur(0)}}
@keyframes t-dim{from{opacity:1;transform:scale(1)}to{opacity:.35;transform:scale(.985)}}
@keyframes t-mist-out{from{opacity:1;filter:blur(0);transform:translateY(0)}to{opacity:0;filter:blur(10px);transform:translateY(-14px)}}
@keyframes t-mist-in{from{opacity:.3;transform:scale(.985)}to{opacity:1;transform:none}}
@keyframes t-unroll{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes t-roll{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 100% 0)}}
@keyframes t-fade{from{opacity:1}to{opacity:.5}}
@keyframes t-edge{from{top:0}to{top:100%}}
@keyframes t-ring{from{stroke-dashoffset:44}to{stroke-dashoffset:0}}
.s .enter-drop{z-index:2;animation:t-drop .85s cubic-bezier(.4,0,.2,1) both}
.s .leave-drop{z-index:1;animation:t-dim .85s ease both}
.s .enter-mist{z-index:1;animation:t-mist-in .8s ease both}
.s .leave-mist{z-index:2;animation:t-mist-out .8s ease both;pointer-events:none}
.s .enter-unroll{z-index:2;animation:t-unroll .75s cubic-bezier(.3,0,.2,1) both}
.s .leave-unroll{z-index:1;animation:t-fade .75s ease both}
.s .leave-roll{z-index:2;animation:t-roll .7s cubic-bezier(.5,0,.6,1) both;pointer-events:none}
.s .enter-roll{z-index:1;animation:t-mist-in .7s ease both}
.s .rod{position:absolute;left:-6px;right:-6px;height:6px;border-radius:3px;background:var(--ink);opacity:.75;animation:t-edge .75s cubic-bezier(.3,0,.2,1) both;z-index:3}
.s .ringdraw circle{stroke-dasharray:44;animation:t-ring .9s ease-out both}
.s .press:active{transform:scale(.92) rotate(-3deg)}
@media (prefers-reduced-motion:reduce){.s .screen{animation-duration:.01ms!important}}

/* ---- smoothness pass: only opacity and transform animate; one easing ---- */
.s{--ease:cubic-bezier(.22,1,.36,1)}
.s .grain{position:absolute;inset:0;pointer-events:none;background-size:256px 256px;z-index:5}
.s .grain-day{background-image:url(/_blob/92fde2ef96f449fc6f2f046feb89b0dc)}
.s .grain-night{background-image:url(/_blob/3b67d37b5f31d48481ea3e99e595a085)}
@keyframes s-rise{from{opacity:0;transform:translate3d(0,6px,0)}to{opacity:1;transform:none}}
@keyframes s-bleed{from{opacity:0}to{opacity:1}}
@keyframes t-drop{from{clip-path:circle(0px at var(--ox,50%) var(--oy,50%))}to{clip-path:circle(160% at var(--ox,50%) var(--oy,50%))}}
@keyframes t-mist-out{from{opacity:1;transform:none}to{opacity:0;transform:translate3d(0,-10px,0) scale(1.01)}}
.s .rise{animation:s-rise .9s var(--ease) both}
.s .bleedin{animation:s-bleed 1.2s var(--ease) both}
.s .kb{will-change:transform;animation-timing-function:ease-in-out}
.s .drift{will-change:transform}
.s .screen{will-change:transform,opacity,clip-path;backface-visibility:hidden}
.s .enter-drop{animation:t-drop .9s var(--ease) both}
.s .leave-drop{animation:t-dim .9s var(--ease) both}
.s .enter-mist{animation:t-mist-in .9s var(--ease) both}
.s .leave-mist{animation:t-mist-out .7s var(--ease) both}
.s .enter-unroll{animation:t-unroll .8s var(--ease) both}
.s .rod{animation:t-edge .8s var(--ease) both}
.s button,.s a{transition:transform .18s var(--ease),opacity .18s var(--ease);-webkit-tap-highlight-color:transparent}
.s button:active,.s a:active{transform:scale(.97);opacity:.85}
.s .seal:active{transform:scale(.9) rotate(-3deg)}
"""

SEAL_SIZES = {}

def link(mode, target, inner, style='', label=None, cls='', origin=None):
    al = f' aria-label="{label}"' if label else ''
    if mode == 'flow':
        key = target.lower() + (('_' + origin) if origin else '')
        return f'<button type="button" class="{cls}"{al} onClick="{{{{go.{key}}}}}" style="{style}">{inner}</button>'
    return f'<a href="{target}%%N%%.dc.html" class="{cls}"{al} style="{style}">{inner}</a>'

MENU = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" style="stroke:var(--ink)" stroke-width="1.7" stroke-linecap="round"><path d="M4 7.5h15M4 12h10M4 16.5h13"></path></svg>'
BACK = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" style="stroke:var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5c-3 2.5-5.5 4.6-7 7 1.5 2.4 4 4.5 7 7"></path></svg>'

PLAN_ICON = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" style="stroke:var(--ink)" stroke-width="1.7" stroke-linecap="round"><circle cx="6" cy="6" r="1.6"></circle><circle cx="6" cy="12" r="1.6"></circle><circle cx="6" cy="18" r="1.6"></circle><path d="M11 6h8M11 12h6M11 18h7"></path></svg>'

def corner(mode, target, icon, label):
    return link(mode, target, icon, 'position:absolute;left:8px;top:50px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;z-index:2', label)

def title(text, sub, seal=None, top=292):
    sl = seal_sym(seal, 28, 'stamp') if seal else ''
    return (f'<div style="position:absolute;left:22px;right:22px;top:{top}px;display:flex;align-items:flex-end;gap:12px">'
            f'<div style="flex:1;min-width:0"><h1 class="bleedin clip" style="margin:0;font-size:28px;line-height:34px;font-weight:500;color:var(--ink)">{text}</h1>'
            f'<div class="mono clip rise" style="font-size:11px;color:var(--ink3);margin-top:2px">{sub}</div></div>{sl}</div>')

SEND_SVG = None
def composer(mode, ph, stop=True, meta=True):
    global SEND_SVG
    SEND_SVG = seal_sym('send', 10)[seal_sym('send', 10).index('<svg'):seal_sym('send', 10).rindex('</span>')]
    stop_btn = ('<button type="button" class="mono" style="height:38px;padding:0 4px;font-size:11.5px;color:var(--ink3);text-decoration:underline;text-underline-offset:4px;text-decoration-color:var(--line);flex:none">stop</button>' if stop else '')
    if mode == 'flow':
        inp = '<input placeholder="' + ph + '" value="{{draft}}" onChange="{{onDraft}}" style="flex:1;min-width:0;background:none;border:0;outline:none;font-family:\'EB Garamond\',Georgia,serif;font-size:17px;color:var(--ink);padding:0">'
        send = '<button type="button" aria-label="Send" onClick="{{send}}" class="seal {{stampCls}}" style="width:48px;height:48px">' + SEND_SVG + '</button>'
    else:
        inp = f'<input placeholder="{ph}" style="flex:1;min-width:0;background:none;border:0;outline:none;font-family:\'EB Garamond\',Georgia,serif;font-size:17px;color:var(--ink);padding:0">'
        send = '<button type="button" aria-label="Send" class="seal stamp" style="width:48px;height:48px">' + SEND_SVG + '</button>'
    meta_row = ''
    if meta:
        meta_row = ('<div class="mono" style="display:flex;gap:2px;font-size:11px;color:var(--ink3)">'
                    + link(mode, 'Scenes', 'studio-vps', 'padding:6px 4px;font-size:11px;color:var(--ink3)')
                    + '<span aria-hidden="true" style="padding:6px 0">·</span>'
                    + link(mode, 'Model', 'gpt-5.6-luna · high', 'padding:6px 4px;font-size:11px;color:var(--ink3);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line)')
                    + '</div>')
    return f'''
  <div style="position:absolute;left:20px;right:16px;bottom:22px;display:flex;flex-direction:column;gap:2px">
    <div style="display:flex;align-items:center;gap:10px">
      <label style="flex:1;min-width:0;position:relative;display:flex;align-items:center;height:50px">
        <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Message</span>
        {inp}
        <svg aria-hidden="true" viewBox="0 0 200 8" preserveAspectRatio="none" style="position:absolute;left:0;right:0;bottom:7px;width:100%;height:6px"><path class="inkdraw" d="M2 5 C 40 2, 90 6, 140 3 S 190 4, 198 3" style="stroke:var(--ink)" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".55" filter="url(#bleed)"></path></svg>
      </label>
      {stop_btn}
      {send}
    </div>
    {meta_row}
  </div>'''

RING = '<span class="ring" role="img" aria-label="done"></span>'

def step(no, tool, text, right, delay, cls=''):
    return (f'<li class="step rise {cls}" style="animation-delay:{delay}s"><span class="mono" style="font-size:11px;color:var(--ink3)">{no}</span>'
            f'<span class="clip"><span class="t">{tool}</span>{text}</span>{right}</li>')

def page_session(t, mode, scene_key='peaks'):
    if mode == 'flow':
        heroes = ''
        for k in SCENES:
            heroes += f'<sc-if value="{{{{heroIs.{k}}}}}" hint-placeholder-val="{{{{{str(k == "peaks").lower()}}}}}">' + hero(k, t, progress=[True, True, True, False], flow=True) + '</sc-if>'
        step4 = ('<sc-if value="{{notDone}}" hint-placeholder-val="{{true}}">'
                 + step('04', 'bash', '<span class="wet" style="font-style:italic">running reconnect tests</span>', '<span class="mono" style="font-size:11px;color:var(--ink3)"><span class="spin" aria-hidden="true"></span> 1:12</span>', .6)
                 + '</sc-if><sc-if value="{{done}}" hint-placeholder-val="{{false}}">'
                 + '<li class="step"><span class="mono" style="font-size:11px;color:var(--ink3)">04</span><span class="clip"><span class="t">bash</span>ran reconnect tests</span>'
                 + '<svg class="ringdraw" role="img" aria-label="done" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.8" fill="none" style="stroke:var(--seal)" stroke-width="1.6" transform="rotate(-90 7 7)"></circle></svg></li></sc-if>')
        reply = ('<sc-if value="{{done}}" hint-placeholder-val="{{false}}"><p class="rise" style="margin:2px 0 0;font-size:16.5px;line-height:24px;color:var(--ink2);font-style:italic;animation-delay:.3s">'
                 'Doze held the pongs past five seconds, so the socket was judged dead. Now it waits fifteen, and tries thrice before letting go. All six tests pass.</p></sc-if>')
        queued = ('<sc-for list="{{sent}}" as="q" hint-placeholder-count="0"><p class="rise" style="margin:0;display:flex;gap:8px;font-size:16px;line-height:24px;color:var(--ink)">'
                  '<span class="mono" style="font-size:12px;color:var(--seal);flex:none;padding-top:1px">{{q.n}}›</span><span style="flex:1">{{q.text}}</span>'
                  '<span class="mono" style="font-size:10.5px;color:var(--blue);flex:none;padding-top:3px">{{q.tag}}</span></p></sc-for>')
        sub = 'fox · {{sessionSub}}'
    else:
        heroes = hero(scene_key, t, progress=[True, True, True, False])
        step4 = step('04', 'bash', '<span class="wet" style="font-style:italic">running reconnect tests</span>', '<span class="mono" style="font-size:11px;color:var(--ink3)"><span class="spin" aria-hidden="true"></span> 1:12</span>', .6)
        reply = ('<p class="rise" style="margin:2px 0 0;font-size:16.5px;line-height:24px;color:var(--ink2);font-style:italic;animation-delay:.8s">'
                 'The backoff holds. Checking that missed frames come back in order before I call it done.</p>')
        queued = ''
        sub = 'fox · working · step 4 of 4'
    return (heroes
            + corner(mode, 'Sessions', MENU, 'Threads')
            + ('' if mode == 'flow' else link(mode, 'Plan', PLAN_ICON, 'position:absolute;right:8px;top:50px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;z-index:2', 'The plan'))
            + title('Adapter v4 timeline', sub, 'fox')
            + f'''
  <main style="position:absolute;left:22px;right:22px;top:356px;display:flex;flex-direction:column;gap:12px">
    <p class="rise" style="margin:0;display:flex;gap:8px;font-size:16px;line-height:24px;color:var(--ink)">
      <span class="mono" style="font-size:12px;color:var(--seal);flex:none;padding-top:1px">1›</span>
      <span>Make reconnect survive Android doze. Keep the wire protocol as it is.</span>
    </p>
    <ol aria-label="Steps" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column">
      {step('01', 'grep', 'find where the socket dies', RING, .15)}
      {step('02', 'edit', 'lengthen the pong wait', '<span class="mono" style="font-size:11px;color:var(--ink3)">+12 −3</span>', .3)}
      {step('03', 'edit', 'replay from the journal', '<span class="mono" style="font-size:11px;color:var(--ink3)">+30 −5</span>', .45)}
      {step4}
    </ol>
    {reply}
    {queued}
  </main>'''
            + composer(mode, 'write to fox…'))

def row(mode, ch, ttl, note, state, target, delay, faded=False, origin=None):
    mark = {'ask': '<span role="img" aria-label="Waiting for you" style="width:10px;height:10px;border-radius:50%;background:var(--seal)"></span>',
            'live': '<span class="mono spin" role="img" aria-label="Working" style="font-size:15px;color:var(--blue)"></span>',
            'done': '<span class="ring" role="img" aria-label="Finished" style="width:15px;height:15px"></span>',
            'rest': '<span role="img" aria-label="Resting" style="width:6px;height:6px;border-radius:50%;background:var(--ink3);opacity:.6"></span>'}[state]
    op = 'opacity:.6;' if faded else ''
    inner = (seal_sym(ch, 30) +
             f'<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;text-align:left">'
             f'<span class="clip" style="font-size:19px;line-height:25px;color:var(--ink)">{ttl}</span>'
             f'<span class="clip" style="font-size:14.5px;line-height:20px;color:var(--ink3);font-style:italic">{note}</span></span>'
             f'<span style="width:24px;display:flex;justify-content:center">{mark}</span>')
    style = f'width:100%;display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--line);animation-delay:{delay}s;{op}'
    if target:
        return link(mode, target, inner, style, cls='rise', origin=origin)
    return f'<a href="#" class="rise" style="{style}">{inner}</a>'

def page_sessions(t, mode):
    rows = (row(mode, 'crane', 'Clean the build cache', 'crane asks to run <span class="mono" style="font-style:normal;font-size:11px">rm -rf target/…</span>', 'ask', None, .1)
            + row(mode, 'fox', 'Adapter v4 timeline', 'fox · running the tests', 'live', 'Main', .2, origin='r2')
            + row(mode, 'heron', 'Pinned todo card', 'heron, with owl, wren and lynx · 3 of 7', 'live', None, .3)
            + row(mode, 'owl', 'Socket timeout', 'owl · done, fourteen minutes ago', 'done', None, .4)
            + row(mode, 'moth', 'Android back stack', 'moth · resting since Saturday', 'rest', None, .5, faded=True))
    server = link(mode, 'Scenes', '<span aria-hidden="true" style="width:6px;height:6px;border-radius:50%;background:var(--green)"></span>studio-vps',
                  'position:absolute;right:16px;top:54px;height:40px;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ink2);font-family:\'JetBrains Mono\',monospace;z-index:2', 'Server studio-vps · scenes and theme')
    return (hero('pavilion', t, h=280)
            + server
            + title('Threads', '~/src · 5 sessions', None, top=226)
            + f'''
  <nav aria-label="Threads" style="position:absolute;left:22px;right:22px;top:282px;display:flex;flex-direction:column">
    {rows}
  </nav>'''
            + composer(mode, 'begin a new thread…', stop=False, meta=False))

def page_start(t, mode):
    pair = link(mode, 'Sessions', seal_sym('send', 10)[seal_sym('send', 10).index('<svg'):seal_sym('send', 10).rindex('</span>')], 'width:64px;height:64px', 'Pair', cls='seal stamp')
    return (hero('butterfly', t)
            + f'''
  <div style="position:absolute;left:24px;right:24px;top:290px;display:flex;flex-direction:column">
    <span class="mono rise" style="font-size:12px;color:var(--ink3);letter-spacing:.08em">jcode</span>
    <h1 class="rise" style="margin:6px 0 0;font-size:32px;line-height:38px;font-weight:500;color:var(--ink);animation-delay:.1s">Pair with your server</h1>
    <p class="rise" style="margin:8px 0 0;font-size:17.5px;line-height:25px;color:var(--ink3);animation-delay:.2s">Start the adapter where jcode runs. It prints a code that works once, for ten minutes.</p>
    <label class="rise" style="margin-top:22px;display:flex;flex-direction:column;gap:2px;animation-delay:.3s">
      <span class="mono" style="font-size:11px;color:var(--ink3)">server</span>
      <input value="https://studio-vps:7646" style="height:42px;background:none;border:0;border-bottom:1.5px solid var(--line);outline:none;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:14px;color:var(--ink);padding:0">
    </label>
    <label class="rise" style="margin-top:14px;display:flex;flex-direction:column;gap:6px;animation-delay:.4s">
      <span class="mono" style="font-size:11px;color:var(--ink3)">code</span>
      <input value="K7QM-P2XA-" autocomplete="one-time-code" style="height:48px;background:var(--paper2);border:0;border-radius:4px;outline:none;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:20px;letter-spacing:.16em;color:var(--ink);padding:0 14px">
    </label>
  </div>
  <div style="position:absolute;left:24px;right:24px;bottom:30px;display:flex;align-items:center;justify-content:space-between">
    <button class="mono" style="height:44px;font-size:12px;color:var(--ink2);text-decoration:underline;text-underline-offset:4px;text-decoration-color:var(--line)">paste a pairing link</button>
    {pair}
  </div>''')

def page_model(t, mode):
    use = link(mode, 'Main', seal_sym('send', 10)[seal_sym('send', 10).index('<svg'):seal_sym('send', 10).rindex('</span>')], 'width:52px;height:52px;transform:rotate(-3deg)', 'Use this model', cls='seal', origin='back')
    return (hero('riders', t, h=250)
            + corner(mode, 'Main', BACK, 'Back to the thread') .replace('go.main', 'go.main_back')
            + title('Model', 'used from the next turn', None, top=196)
            + '''
  <div style="position:absolute;left:22px;right:22px;top:256px;display:flex;flex-direction:column">
    <div role="radiogroup" aria-label="Model" style="display:flex;flex-direction:column">
      <sc-for list="{{models}}" as="m" hint-placeholder-count="4">
        <button role="radio" aria-checked="{{m.on}}" onClick="{{m.pick}}" disabled="{{m.off}}" style="display:flex;align-items:center;gap:12px;height:54px;border-bottom:1px solid var(--line);text-align:left;opacity:{{m.op}}">
          <span style="flex:1;min-width:0;display:flex;flex-direction:column">
            <span class="mono clip" style="font-size:13.5px;color:var(--ink)">{{m.name}}</span>
            <span class="clip" style="font-size:14px;color:var(--ink3);font-style:italic">{{m.note}}</span>
          </span>
          <sc-if value="{{m.on}}" hint-placeholder-val="{{false}}"><svg class="ringdraw" aria-hidden="true" width="18" height="18" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.8" fill="none" style="stroke:var(--seal)" stroke-width="1.6" transform="rotate(-90 7 7)"></circle></svg></sc-if>
        </button>
      </sc-for>
    </div>
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:22px">
      <span style="font-size:19px;color:var(--ink)">Effort</span><span style="font-size:15px;color:var(--ink3);font-style:italic">how much ink</span>
    </div>
    <div role="radiogroup" aria-label="Reasoning effort" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));margin-top:8px">
      <sc-for list="{{inks}}" as="k" hint-placeholder-count="6">
        <button role="radio" aria-checked="{{k.on}}" aria-label="{{k.en}}" onClick="{{k.pick}}" style="height:70px;display:flex;flex-direction:column;align-items:center;gap:6px">
          <span style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.6px solid {{k.ring}};transition:border-color .3s">
            <span style="width:26px;height:26px;border-radius:50%;background:var(--ink);opacity:{{k.ink}};filter:url(#bleed)"></span>
          </span>
          <span class="mono" style="font-size:10px;color:var(--ink3)">{{k.en}}</span>
        </button>
      </sc-for>
    </div>
  </div>
  <div style="position:absolute;right:22px;bottom:30px;display:flex;align-items:center;gap:12px">
    <span style="font-size:15px;color:var(--ink3);font-style:italic">use this brush</span>
    ''' + use + '''
  </div>''')

def page_scenes(t, mode, night):
    thumbs = ''
    for key in SCENES:
        thumbs += f'''
      <button role="radio" aria-checked="{{{{sel.{key}}}}}" onClick="{{{{pick.{key}}}}}" style="display:flex;flex-direction:column;gap:5px;text-align:left;min-width:0">
        <span style="position:relative;display:block;height:78px;border-radius:4px;overflow:hidden;background:var(--paper2);outline:1.6px solid {{{{ring.{key}}}}};outline-offset:3px;transition:outline-color .3s">
          <img src="{IMG[key]}" alt="" style="width:100%;height:100%;object-fit:cover;filter:var(--imgf)">
        </span>
        <span class="clip" style="font-size:13.5px;line-height:16px;color:var(--ink)">{key.replace('butterfly', 'butterfly dream').replace('_', ' ')}</span>
      </button>'''
    heroes = ''.join(f'<sc-if value="{{{{show.{k}}}}}" hint-placeholder-val="{{{{{str(k == "peaks").lower()}}}}}"><div class="bleedin">{hero(k, t, h=230)}</div></sc-if>' for k in SCENES)
    if mode == 'flow':
        day = '<button type="button" aria-label="Day" onClick="{{setDay}}" class="mono" style="height:34px;padding:0 14px;border-radius:18px;font-size:12px;{{dayStyle}}">day</button>'
        nite = '<button type="button" aria-label="Night" onClick="{{setNight}}" class="mono" style="height:34px;padding:0 14px;border-radius:18px;font-size:12px;{{nightStyle}}">night</button>'
    else:
        on, off = 'background:var(--ink);color:var(--paper)', 'color:var(--ink2)'
        day = f'<a href="Scenes.dc.html" aria-label="Day" class="mono" style="height:34px;padding:0 14px;border-radius:18px;font-size:12px;display:flex;align-items:center;{off if night else on}">day</a>'
        nite = f'<a href="Scenes-Night.dc.html" aria-label="Night" class="mono" style="height:34px;padding:0 14px;border-radius:18px;font-size:12px;display:flex;align-items:center;{on if night else off}">night</a>'
    return (heroes
            + corner(mode, 'Sessions', BACK, 'Back to threads').replace('go.sessions', 'go.sessions_back')
            + title('Scene', 'behind every thread', None, top=180)
            + f'''
  <div style="position:absolute;left:22px;right:22px;top:232px;display:flex;flex-direction:column;gap:12px">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:17px;color:var(--ink)">Ink</span>
      <div role="group" aria-label="Theme" style="display:flex;gap:4px;padding:3px;border-radius:22px;border:1px solid var(--line)">{day}{nite}</div>
    </div>
    <div role="radiogroup" aria-label="Scene" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 12px">{thumbs}
    </div>
    <p style="margin:0;font-size:15px;line-height:21px;color:var(--ink3);font-style:italic">Details from old paintings. Left alone, the scene changes with the hour.</p>
  </div>''')

SCRIPT_MODEL = r'''
    const list = [['gpt-5.6-luna','openai · responses'],['claude-opus-5-5','anthropic · your subscription'],['deepseek-v4-flash','command-code · quick and light'],['gpt-5.2','openai · not in your plan',true]];
    const models = list.map(([name, note, off]) => ({ name, note, off: !!off, on: name === this.state.model, op: off ? 0.45 : 1, pick: () => { if (!off) this.setState({ model: name }); } }));
    const en = ['minimal','low','medium','high','xhigh','max'];
    const inks = en.map((e, i) => ({ en: e, ink: (0.12 + i * 0.17).toFixed(2), on: i === this.state.ink, ring: i === this.state.ink ? 'var(--seal)' : 'transparent', pick: () => this.setState({ ink: i }) }));
'''
SCRIPT_SCENES = r'''
    const keys = ['peaks','jade_peaks','pavilion','river_valley','blue_hills','riders','misty_peaks','lone_boat','sage_under_pine','green_woods','quiet_river','butterfly'];
    const sel = {}, ring = {}, pick = {}, show = {};
    keys.forEach(k => { const on = this.state.scene === k; sel[k] = on; show[k] = on; ring[k] = on ? 'var(--seal)' : 'transparent'; pick[k] = () => this.setState({ scene: k }); });
'''

def wrap(t, inner, flow=False):
    keys = ['paper', 'paper2', 'ink', 'ink2', 'ink3', 'line', 'seal', 'onseal', 'blue', 'green', 'mist', 'imgf']
    if flow:
        style = "width:390px;height:844px;position:relative;overflow:hidden;background:var(--paper);color:var(--ink);font-family:'EB Garamond',Georgia,serif;transition:background .6s;{{vars}}"
        g = '<div aria-hidden="true" class="grain {{grainCls}}"></div>'
    else:
        style = (f"width:390px;height:844px;position:relative;overflow:hidden;background:var(--paper);color:var(--ink);font-family:'EB Garamond',Georgia,serif;"
                 + ';'.join(f'--{k}:{t[k]}' for k in keys))
        g = grain(t)
    return f'<div class="s" style="{style}">\n{defs()}\n{inner}\n{g}\n</div>'

def doc(title_txt, body, script):
    chars = sorted({c for c in body if '一' <= c <= '鿿'})
    text = urllib.parse.quote(''.join(chars))
    fonts = ('<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">\n'
             + (f'<link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&text={text}&display=swap" rel="stylesheet">' if text else ''))
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
<style>{CSS3}</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":390,"height":844}}}}'>
{script}
</script>
</body>
</html>
'''

def static_script(name):
    if name == 'Model':
        return "class Component extends DCLogic {\n  constructor(p){ super(p); this.state = { model: 'gpt-5.6-luna', ink: 3 }; }\n  renderVals(){" + SCRIPT_MODEL + "    return { models, inks };\n  }\n}"
    if name == 'Scenes':
        return "class Component extends DCLogic {\n  constructor(p){ super(p); this.state = { scene: 'peaks' }; }\n  renderVals(){" + SCRIPT_SCENES + "    return { sel, ring, pick, show };\n  }\n}"
    return 'class Component extends DCLogic {\n  renderVals() { return {}; }\n}'

def build_static():
    names = {'Start': 'get started', 'Sessions': 'threads', 'Main': 'thread', 'Model': 'model', 'Scenes': 'scene'}
    for theme in ['paper', 'night']:
        t = THEMES[theme]; night = theme == 'night'; N = '-Night' if night else ''
        for name in names:
            inner = {'Start': lambda: page_start(t, 'static'), 'Sessions': lambda: page_sessions(t, 'static'),
                     'Main': lambda: page_session(t, 'static'), 'Model': lambda: page_model(t, 'static'),
                     'Scenes': lambda: page_scenes(t, 'static', night)}[name]()
            inner = inner.replace('%%N%%', N)
            (OUT / f'{name}{N}.dc.html').write_text(doc(f'jcode · {names[name]} · {"night" if night else "day"}', wrap(t, inner), static_script(name)))
    print('static built')

FLOW_SCRIPT = r'''
class Component extends DCLogic {
  constructor(p) {
    super(p);
    this.state = { screen: 'start', prev: null, kind: 'drop', ox: '50%', oy: '50%', theme: 'day', scene: 'peaks',
                   model: 'gpt-5.6-luna', ink: 3, lt: -1, lnow: 0, draft: '', sent: [], stamp: 0 };
    this.timers = [];
  }
  componentWillUnmount() { this.timers.forEach(clearTimeout); clearInterval(this.iv); }
  later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }
  go(screen, kind, ox, oy) {
    if (screen === this.state.screen) return;
    this.setState({ prev: this.state.screen, screen, kind, ox: ox || '50%', oy: oy || '50%' });
    this.later(() => this.setState({ prev: null }), 900);
    if (screen === 'main' && !this.liveStarted) {
      this.liveStarted = true;
      const t0 = Date.now() + 500;
      [500, 600, 4300, 4600, 4700, 5900, 6000, 7000, 7100, 9600, 9700, 12300, 12600].forEach(m => this.later(() => this.setState({ lt: m }), 500 + m));
      this.iv = setInterval(() => { const n = Date.now() - t0; this.setState({ lnow: n }); if (n > 13000) clearInterval(this.iv); }, 1000);
    }
  }
  renderVals() {
    const S = this.state;
    const day = { paper:'#E5EBE0', paper2:'#D6E0D3', ink:'#16231D', ink2:'#2D3C34', ink3:'#56685D', line:'#BCCBBE', seal:'#2E4374', onseal:'#F1F4EC', blue:'#3F7484', green:'#3B7A5C', mist:'#E5EBE0', imgf:'saturate(1)' };
    const night = { paper:'#0E1613', paper2:'#17221D', ink:'#DCE8DE', ink2:'#BCCFC1', ink3:'#86998C', line:'#24342C', seal:'#93A6D9', onseal:'#10140F', blue:'#7FAFBD', green:'#6FA88A', mist:'#0E1613', imgf:'brightness(.58) saturate(.85)' };
    const pal = S.theme === 'day' ? day : night;
    const vars = Object.keys(pal).map(k => '--' + k + ':' + pal[k]).join(';');
    const screens = ['start','sessions','main','model','scenes'];
    const vis = {}, cls = {};
    screens.forEach(k => {
      vis[k] = k === S.screen || k === S.prev;
      cls[k] = S.prev == null ? '' : (k === S.screen ? 'enter-' + S.kind : (k === S.prev ? 'leave-' + S.kind : ''));
    });
    const go = {
      sessions: () => this.go('sessions', 'drop', '86%', '90%'),
      sessions_back: () => this.go('sessions', 'roll'),
      main: () => this.go('main', S.screen === 'sessions' ? 'drop' : 'mist', '30%', '390px'),
      main_r2: () => this.go('main', 'drop', '30%', '402px'),
      main_back: () => this.go('main', 'roll'),
      model: () => this.go('model', 'unroll'),
      scenes: () => this.go('scenes', 'unroll'),
    };
    // from the thread, the menu goes back with mist
    if (S.screen === 'main') go.sessions = () => this.go('sessions', 'mist');
    ''' + SCRIPT_MODEL + SCRIPT_SCENES.replace('this.state.scene', 'S.scene') + r'''
    const heroIs = {}; keys.forEach(k => heroIs[k] = S.scene === k);
    const lt = S.lt, lnow = S.lnow, fin = lt >= 12300;
    const row = (a, b) => lt < a ? '' : (lt < a + 100 ? 'run' : (lt < b ? 'run open' : 'done'));
    const el = (a) => '0:0' + Math.min(9, Math.max(0, Math.floor((lnow - a) / 1000)));
    const live = {
      sT: lt >= 500, cT: lt < 600 ? '' : (lt < 4300 ? 'open' : 'done'),
      s1: lt >= 4600, c1: row(4600, 5900), e1: el(4600), s2: lt >= 5900, c2: row(5900, 7000), e2: el(5900),
      s3: lt >= 7000, c3: row(7000, 9600), e3: el(7000), s4: lt >= 9600, c4: row(9600, 12300), e4: el(9600),
      sA: lt >= 12600, mainCls: '', sub: fin ? 'finished · 12s' : (lt >= 4300 ? 'working' : 'thinking'),
    };
    const sent = S.sent.map((t, i) => ({ text: t, n: i + 2, tag: fin ? 'sent' : 'queued' }));
    const on = 'background:var(--ink);color:var(--paper)', off = 'color:var(--ink2)';
    return {
      ...live, vars, vis, cls, go, models, inks, sel, ring, pick, show, heroIs, sent,
      ox: S.ox, oy: S.oy,
      isDay: S.theme === 'day', isNight: S.theme !== 'day', grainCls: S.theme === 'day' ? 'grain-day' : 'grain-night',
      dayStyle: S.theme === 'day' ? on : off, nightStyle: S.theme === 'day' ? off : on,
      setDay: () => this.setState({ theme: 'day' }), setNight: () => this.setState({ theme: 'night' }),
      draft: S.draft, onDraft: (e) => this.setState({ draft: e.target.value }),
      stampCls: S.stamp % 2 ? 'stamp' : '',
      send: () => {
        const text = (S.draft || '').trim() || 'Also log each backoff attempt, once.';
        this.setState({ sent: S.sent.concat([text]), draft: '', stamp: S.stamp + 1 });
      },
    };
  }
}
'''

def build_flow():
    t = THEMES['paper']
    live_heroes = ''.join(f'<sc-if value="{{{{heroIs.{k}}}}}" hint-placeholder-val="{{{{{str(k == "peaks").lower()}}}}}">' + hero(k, t, h=210) + '</sc-if>' for k in SCENES)
    screens = {'start': page_start(t, 'flow'), 'sessions': page_sessions(t, 'flow'), 'main': page_live(t, 'flow', live_heroes),
               'model': page_model(t, 'flow'), 'scenes': page_scenes(t, 'flow', False)}
    inner = ''
    for k, body in screens.items():
        inner += (f'<sc-if value="{{{{vis.{k}}}}}" hint-placeholder-val="{{{{{str(k == "start").lower()}}}}}">'
                  f'<div class="screen {{{{cls.{k}}}}}" style="--ox:{{{{ox}}}};--oy:{{{{oy}}}}">{body}'
                  '</div></sc-if>\n')
    # the unroll edge: a thin ink rod that travels down with the unrolling sheet
    inner = inner.replace('<div class="screen {{cls.model}}" style="--ox:{{ox}};--oy:{{oy}}">', '<div class="screen {{cls.model}}" style="--ox:{{ox}};--oy:{{oy}}"><sc-if value="{{rodModel}}" hint-placeholder-val="{{false}}"><span class="rod" aria-hidden="true"></span></sc-if>')
    inner = inner.replace('<div class="screen {{cls.scenes}}" style="--ox:{{ox}};--oy:{{oy}}">', '<div class="screen {{cls.scenes}}" style="--ox:{{ox}};--oy:{{oy}}"><sc-if value="{{rodScenes}}" hint-placeholder-val="{{false}}"><span class="rod" aria-hidden="true"></span></sc-if>')
    script = FLOW_SCRIPT.replace('vars, vis, cls,', "vars, vis, cls, rodModel: cls.model === 'enter-unroll', rodScenes: cls.scenes === 'enter-unroll',")
    html = doc('jcode · flow prototype', wrap(t, inner, flow=True), script)
    html = html.replace('<style>' + CSS3, '<style>' + CSS3 + LIVE_CSS)
    (OUT / 'Flow.dc.html').write_text(html)
    print('flow built')



# ---------------- Live: tool calls and reasoning (smooth edition) ----------------
LIVE_CSS = r"""
@keyframes l-word{from{opacity:0;transform:translate3d(0,3px,0)}to{opacity:1;transform:none}}
@keyframes l-in{from{opacity:0;transform:translate3d(-6px,0,0)}to{opacity:1;transform:none}}
@keyframes l-drop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.35);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes l-flow{from{transform:translate3d(-60%,0,0)}to{transform:translate3d(160%,0,0)}}
@keyframes l-grind{to{transform:rotate(360deg)}}
@keyframes l-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.s .w{display:inline-block;white-space:pre;animation:l-word .5s var(--ease) both}
.s .slidein{animation:l-in .6s var(--ease) both}
.s .inkdot{width:8px;height:8px;border-radius:50%;background:var(--ink);animation:l-drop .55s var(--ease) both}
.s .flow{position:relative;height:1.5px;margin:0 0 2px 26px;overflow:hidden}
.s .flow::after{content:'';position:absolute;top:0;bottom:0;left:0;width:45%;background:linear-gradient(90deg,transparent,var(--blue),transparent);animation:l-flow 1.6s ease-in-out infinite;will-change:transform}
.s .grind{animation:l-grind 2.4s linear infinite;transform-origin:center;transform-box:fill-box}
.s .stack{display:grid}.s .stack>*{grid-area:1/1}
.s .trow .done-only,.s .think .done-only{opacity:0;transition:opacity .5s var(--ease)}
.s .trow .run-only,.s .think .run-only{opacity:1;transition:opacity .4s var(--ease)}
.s .trow.done .done-only,.s .think.done .done-only{opacity:1}
.s .trow.done .run-only,.s .think.done .run-only{opacity:0}
.s .ring2 circle{stroke-dasharray:37;stroke-dashoffset:37;transition:stroke-dashoffset .9s var(--ease) .1s}
.s .trow.done .ring2 circle{stroke-dashoffset:0}
.s .fold{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .75s var(--ease),opacity .5s var(--ease)}
.s .open>.fold,.s .open .fold{grid-template-rows:1fr;opacity:1}
.s .fold>div{overflow:hidden;min-height:0}
.s .think .bar{position:absolute;left:0;top:6px;bottom:6px;width:2px;background:var(--ink3);opacity:.5;transform-origin:top;animation:l-grow 3.4s var(--ease) both}
.s .live-main{transition:opacity .8s var(--ease)}
.s .live-main.fadeall{opacity:0}
"""

def words(text, start=0.0, step=0.06):
    return ''.join(f'<span class="w" style="animation-delay:{start + i * step:.2f}s">{w} </span>' for i, w in enumerate(text.split(' ')))

def trow(n, tool, intent, meta_done, extra=''):
    fold = f'<div class="fold"><div>{extra}</div></div>' if extra else ''
    return (f'<sc-if value="{{{{s{n}}}}}" hint-placeholder-val="{{{{false}}}}"><li class="trow {{{{c{n}}}}}" style="display:flex;flex-direction:column">'
            f'<div style="display:flex;align-items:center;gap:10px;min-height:30px">'
            f'<span class="stack" style="width:16px;height:16px;place-items:center;flex:none"><span class="run-only" style="display:flex"><span class="inkdot"></span></span>'
            f'<svg class="done-only ring2" role="img" aria-label="done" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.8" fill="none" style="stroke:var(--seal)" stroke-width="1.6" transform="rotate(-90 7 7)"></circle></svg></span>'
            f'<span class="mono slidein" style="font-size:11.5px;color:var(--ink);flex:none;animation-delay:.05s">{tool}</span>'
            f'<span class="clip slidein" style="flex:1;min-width:0;font-size:16px;color:var(--ink2);animation-delay:.12s">{intent}</span>'
            f'<span class="stack mono" style="font-size:11px;flex:none;justify-items:end">'
            f'<span class="run-only" style="color:var(--blue)"><span class="spin" aria-hidden="true"></span> {{{{e{n}}}}}</span>'
            f'<span class="done-only" style="color:var(--ink3)">{meta_done}</span></span></div>'
            f'<div class="flow run-only" aria-hidden="true"></div>{fold}</li></sc-if>')

def page_live(t, mode='static', heroes=None):
    diff = ('<div class="mono" style="margin:4px 0 6px 26px;padding:8px 10px;background:var(--paper2);border-radius:4px;font-size:11.5px;line-height:20px">'
            '<div style="color:var(--ink3)">src/lib/adapter.ts</div>'
            '<div style="color:var(--ink3)">  const beat = setInterval(ping, 10_000);</div>'
            '<div style="color:var(--seal);opacity:.8;text-decoration:line-through;text-decoration-thickness:1.5px">- const timeout = 5_000;</div>'
            '<div class="rise" style="color:var(--green);animation-delay:.7s">+ const timeout = 15_000;</div>'
            '<div class="rise" style="color:var(--green);animation-delay:1s">+ const retries = 3;</div></div>')
    out = ('<div class="mono" style="margin:2px 0 6px 26px;font-size:11.5px;line-height:19px;color:var(--ink3)">'
           '<div class="rise" style="animation-delay:.3s"><span style="color:var(--green)">✓</span> backs off 1s, 2s, 4s</div>'
           '<div class="rise" style="animation-delay:1s"><span style="color:var(--green)">✓</span> keeps the journal cursor</div>'
           '<div class="rise" style="animation-delay:1.7s"><span style="color:var(--green)">✓</span> resumes after 30s doze</div></div>')
    thinking = ('<sc-if value="{{sT}}" hint-placeholder-val="{{true}}"><div class="think rise {{cT}}" style="position:relative;padding-left:14px">'
                '<span class="bar run-only" aria-hidden="true"></span>'
                '<div class="stack" style="font-size:14px;color:var(--ink3);font-style:italic">'
                '<span class="run-only" style="display:flex;align-items:center;gap:8px;height:28px"><svg class="grind" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" style="stroke:var(--ink3)" stroke-width="2.6" stroke-dasharray="34 20" stroke-linecap="round"></circle></svg>thinking</span>'
                '<button type="button" class="done-only" aria-expanded="false" style="display:flex;align-items:center;gap:8px;height:28px;font-style:italic;color:var(--ink3)">'
                '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" style="stroke:var(--ink3)" stroke-width="2.4" stroke-dasharray="46 8" transform="rotate(-70 12 12)"></circle></svg>thought for 4s <span style="font-style:normal">›</span></button></div>'
                '<div class="fold"><div><p style="margin:2px 0 4px;font-size:15.5px;line-height:23px;color:var(--ink3);font-style:italic">'
                + words('Doze defers network wakeups, so pongs arrive late. If the adapter waits only five seconds it calls a healthy socket dead. Find the timeout, then check what happens to frames sent while it was gone.', .35, .065)
                + '</p></div></div></div></sc-if>')
    tools = (trow(1, 'grep', 'find where the socket dies', '4 hits')
             + trow(2, 'read', 'adapter.ts', '212 lines')
             + trow(3, 'edit', 'lengthen the pong wait', '<span style="color:var(--green)">+12</span> <span style="color:var(--seal)">−3</span>', diff)
             + trow(4, 'bash', 'run reconnect tests', '6 passed', out))
    queued = ('' if mode != 'flow' else '<sc-for list="{{sent}}" as="q" hint-placeholder-count="0"><p class="rise" style="margin:0;display:flex;gap:8px;font-size:16px;line-height:24px;color:var(--ink)">'
              '<span class="mono" style="font-size:12px;color:var(--seal);flex:none;padding-top:1px">{{q.n}}›</span><span style="flex:1">{{q.text}}</span>'
              '<span class="mono" style="font-size:10.5px;color:var(--blue);flex:none;padding-top:3px">{{q.tag}}</span></p></sc-for>')
    answer = ('<sc-if value="{{sA}}" hint-placeholder-val="{{false}}"><p style="margin:6px 0 0;font-size:16.5px;line-height:24px;color:var(--ink2);font-style:italic">'
              + words('Doze held the pongs past five seconds, so the socket was judged dead. Now it waits fifteen, and tries thrice before letting go.', 0, .055)
              + '</p></sc-if>')
    return ((heroes if heroes is not None else hero('misty_peaks', t, h=210))
            + corner(mode, 'Sessions', MENU, 'Threads')
            + title('Adapter v4 timeline', 'fox · {{sub}}', 'fox', top=170)
            + f'''
  <main class="live-main {{{{mainCls}}}}" style="position:absolute;left:22px;right:22px;top:236px;display:flex;flex-direction:column;gap:10px">
    <p style="margin:0;display:flex;gap:8px;font-size:16px;line-height:24px;color:var(--ink)">
      <span class="mono" style="font-size:12px;color:var(--seal);flex:none;padding-top:1px">1›</span>
      <span>Why does the socket drop when my phone sleeps? Fix it, keep the protocol.</span>
    </p>
    {thinking}
    <ol aria-label="Tool calls" aria-live="polite" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column">{tools}</ol>
    {answer}
    {queued}
  </main>'''
            + composer(mode, 'write to fox…'))

LIVE_SCRIPT = r'''
class Component extends DCLogic {
  constructor(p) { super(p); this.state = { t: 0, now: 0 }; this.timers = []; }
  componentDidMount() { this.loop(); this.iv = setInterval(() => this.setState({ now: Date.now() - this.t0 }), 1000); }
  componentWillUnmount() { this.timers.forEach(clearTimeout); clearInterval(this.iv); }
  loop() {
    this.t0 = Date.now();
    this.setState({ t: 0, now: 0 });
    const marks = [500, 600, 4300, 4600, 4700, 5900, 6000, 7000, 7100, 9600, 9700, 12300, 12600, 18000];
    marks.forEach(m => this.timers.push(setTimeout(() => this.setState({ t: m }), m)));
    this.timers.push(setTimeout(() => { this.timers = []; this.loop(); }, 19000));
  }
  renderVals() {
    const t = this.state.t, now = this.state.now;
    const row = (a, b) => t < a ? '' : (t < a + 100 ? 'run' : (t < b ? 'run open' : 'done'));
    const el = (a) => '0:0' + Math.min(9, Math.max(0, Math.floor((now - a) / 1000)));
    return {
      sT: t >= 500, cT: t < 600 ? '' : (t < 4300 ? 'open' : 'done'),
      s1: t >= 4600, c1: row(4600, 5900), e1: el(4600),
      s2: t >= 5900, c2: row(5900, 7000), e2: el(5900),
      s3: t >= 7000, c3: row(7000, 9600), e3: el(7000),
      s4: t >= 9600, c4: row(9600, 12300), e4: el(9600),
      sA: t >= 12600, mainCls: t >= 18000 ? 'fadeall' : '',
      sub: t >= 12300 ? 'finished · 12s' : (t >= 4300 ? 'working' : 'thinking'),
    };
  }
}
'''

def build_live():
    for theme in ['paper', 'night']:
        t = THEMES[theme]; night = theme == 'night'; N = '-Night' if night else ''
        inner = page_live(t).replace('%%N%%', N)
        html = doc(f'jcode · live work · {"night" if night else "day"}', wrap(t, inner), LIVE_SCRIPT)
        html = html.replace('<style>' + CSS3, '<style>' + CSS3 + LIVE_CSS)
        (OUT / f'Live{N}.dc.html').write_text(html)
    print('live built')



if __name__ == '__main__':
    exec(open(__file__.replace('build3.py', 'gestures.py')).read())
    for a in sys.argv[1:]:
        {'static': build_static, 'flow': build_flow2, 'live': build_live, 'motion': build_motion}[a]()
