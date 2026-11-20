#!/usr/bin/env python3
"""Phoenix · ink edition. Builds paper (light) and night (dark) artboards.
Usage: build2.py <Page> [...]   pages: Start Sessions Main Model Scenes
"""
import sys, pathlib, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent
DONUT = (ROOT / 'donut.txt').read_text()
OUT = ROOT / 'project'

THEMES = {
    'paper': dict(paper='#EEE4CC', paper2='#E4D8BB', ink='#1E1A16', ink2='#3A332B', ink3='#6B6152', line='#CDBF9F',
                  seal='#B3322A', onseal='#F6EBDD', blue='#6F92B0', green='#5F8A72', mist='#EEE4CC',
                  grain_blend='multiply', grain_op='.6', grain_m='0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.26  0 0 0 0.28 0',
                  donut='/_blob/8eb27ee090a1f96dc698dbdb297337fc'),
    'night': dict(paper='#15120E', paper2='#211C16', ink='#E9DFC8', ink2='#CFC4AB', ink3='#968C78', line='#3A3229',
                  seal='#CC4A3C', onseal='#1A0F0B', blue='#7E9DB8', green='#6E957F', mist='#15120E',
                  grain_blend='screen', grain_op='.28', grain_m='0 0 0 0 0.9  0 0 0 0 0.85  0 0 0 0 0.72  0 0 0 0.22 0',
                  donut='/_blob/97efa2fa9f99045e960656b9c408abaa'),
}

CSS = r"""
body{margin:0;background:var(--paper,#EEE4CC)}
a{color:inherit;text-decoration:none}
.s button{font-family:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.s input{font-family:inherit}
.s input::placeholder{color:var(--ink3);font-style:italic}
.s .zh{font-family:'Ma Shan Zheng','STKaiti','KaiTi',serif;font-weight:400}
.s .mono{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace}
.s .clip{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s .seal{background:var(--seal);color:var(--onseal);display:flex;align-items:center;justify-content:center;border-radius:2px;filter:url(#rough);flex:none}
.s .ring{width:13px;height:13px;border:1.6px solid var(--seal);border-radius:50%;display:inline-block;box-sizing:border-box;flex:none}
.s .step{display:grid;grid-template-columns:24px 1fr auto;align-items:baseline;column-gap:6px;font-size:16px;line-height:25px;color:var(--ink2)}
.s .step .no{font-family:'Ma Shan Zheng','KaiTi',serif;font-size:17px;color:var(--ink)}
.s .step .t{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11.5px;color:var(--ink3);margin-right:4px}
.s .spin::after{content:'⠋';font-family:'JetBrains Mono',ui-monospace,monospace;animation:s-braille .9s steps(1) infinite}
@keyframes s-braille{0%{content:'⠋'}10%{content:'⠙'}20%{content:'⠹'}30%{content:'⠸'}40%{content:'⠼'}50%{content:'⠴'}60%{content:'⠦'}70%{content:'⠧'}80%{content:'⠇'}90%{content:'⠏'}}
@keyframes s-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}
@keyframes s-wet{0%,100%{opacity:.4}50%{opacity:1}}
@keyframes s-wake{0%{transform:scaleX(.6);opacity:.5}100%{transform:scaleX(1.5);opacity:0}}
@keyframes s-drift{0%{transform:translateX(-26px)}100%{transform:translateX(26px)}}
@keyframes s-sway{0%,100%{transform:rotate(-1.2deg)}50%{transform:rotate(1.4deg)}}
@keyframes s-turn{to{transform:rotate(360deg)}}
@keyframes s-shimmer{0%,100%{opacity:.25}50%{opacity:.7}}
@keyframes s-fly{0%{transform:translate(0,0)}25%{transform:translate(14px,-10px)}50%{transform:translate(30px,2px)}75%{transform:translate(12px,10px)}100%{transform:translate(0,0)}}
@keyframes s-flap{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.35)}}
@keyframes s-stamp{0%{transform:scale(1.7) rotate(-14deg);opacity:0}60%{transform:scale(.94) rotate(-2deg);opacity:1}100%{transform:scale(1) rotate(-3deg);opacity:1}}
@keyframes s-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes s-ink{from{stroke-dashoffset:700}to{stroke-dashoffset:0}}
@keyframes s-bleed{from{opacity:0;filter:blur(6px)}to{opacity:1;filter:blur(0)}}
.s .bob{animation:s-bob 4.5s ease-in-out infinite}
.s .wet{animation:s-wet 2.6s ease-in-out infinite}
.s .wake{animation:s-wake 3.2s ease-out infinite;transform-origin:center;transform-box:fill-box}
.s .drift{animation:s-drift 16s ease-in-out infinite alternate}
.s .sway{animation:s-sway 6s ease-in-out infinite;transform-origin:top center;transform-box:fill-box}
.s .sway2{animation:s-sway 7.5s ease-in-out -2s infinite;transform-origin:bottom center;transform-box:fill-box}
.s .turn{animation:s-turn 60s linear infinite;transform-origin:center;transform-box:fill-box}
.s .shimmer{animation:s-shimmer 3.4s ease-in-out infinite}
.s .fly{animation:s-fly 9s ease-in-out infinite}
.s .flap{animation:s-flap .5s ease-in-out infinite;transform-origin:center;transform-box:fill-box}
.s .stamp{animation:s-stamp .7s cubic-bezier(.2,.8,.2,1) .5s both}
.s .rise{animation:s-rise .7s ease-out both}
.s .inkdraw{stroke-dasharray:700;animation:s-ink 2.4s ease-out both}
.s .bleedin{animation:s-bleed 1.4s ease-out both}
@media (prefers-reduced-motion:reduce){.s *{animation:none!important}}
"""

def defs():
    return ('<svg aria-hidden="true" width="0" height="0" style="position:absolute"><defs>'
            '<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"></feDisplacementMap></filter>'
            '<filter id="bleed"><feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="2" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"></feDisplacementMap></filter>'
            '<filter id="brush" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.03 0.14" numOctaves="3" seed="13" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="14"></feDisplacementMap><feGaussianBlur stdDeviation="0.6"></feGaussianBlur></filter>'
            '<filter id="wash" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.05" numOctaves="2" seed="21" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="20"></feDisplacementMap><feGaussianBlur stdDeviation="4"></feGaussianBlur></filter>'
            '<linearGradient id="peak" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--ink);stop-opacity:.78"></stop><stop offset=".55" style="stop-color:var(--ink3);stop-opacity:.32"></stop><stop offset="1" style="stop-color:var(--paper);stop-opacity:0"></stop></linearGradient>'
            '<linearGradient id="green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--green);stop-opacity:.55"></stop><stop offset="1" style="stop-color:var(--green);stop-opacity:0"></stop></linearGradient>'
            '<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".6" style="stop-color:var(--paper);stop-opacity:0"></stop><stop offset="1" style="stop-color:var(--paper);stop-opacity:1"></stop></linearGradient>'
            '</defs></svg>')

def grain(t):
    return (f'<svg aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:{t["grain_blend"]};opacity:{t["grain_op"]};pointer-events:none">'
            f'<filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="9"></feTurbulence><feColorMatrix values="{t["grain_m"]}"></feColorMatrix></filter>'
            '<rect width="100%" height="100%" filter="url(#paper)"></rect></svg>')

def boat(x, y, s=1.0):
    return (f'<g transform="translate({x} {y}) scale({s})"><ellipse class="wake" cx="-6" cy="7" rx="16" ry="1.3" style="fill:var(--ink3)"></ellipse>'
            '<g class="bob"><path d="M0 0 C 10 6, 32 6, 42 0 L 37 5 C 27 9, 13 9, 5 5 Z" style="fill:var(--ink)"></path>'
            '<path d="M14 0 C 15 -9, 26 -10, 28 0 Z" style="fill:var(--ink3)" opacity=".9"></path>'
            '<circle cx="35" cy="-6" r="2.2" style="fill:var(--ink)"></circle><path d="M35 -4 l 1 4" style="stroke:var(--ink)" stroke-width="1.6"></path>'
            '<path d="M38 -7 L 54 -20" style="stroke:var(--ink)" stroke-width="1"></path></g></g>')

def water(y0=300, op=.35):
    return (f'<g style="stroke:var(--ink2)" stroke-linecap="round" fill="none" opacity="{op}">'
            f'<path d="M18 {y0} h 70 M 112 {y0+5} h 40 M 214 {y0+2} h 54 M 40 {y0+18} h 48 M 160 {y0+22} h 88 M 300 {y0+14} h 54"></path></g>')

def scene(name, t, progress=None):
    """390x340 scene. progress: list of booleans for step dots along the river (mountain scene only)."""
    if name == 'mountain':
        dots = ''
        if progress:
            xs = [54, 128, 202, 350]
            for i, done in enumerate(progress):
                dots += (f'<circle cx="{xs[i]}" cy="321" r="3.1" style="fill:var(--seal)"></circle>' if done else
                         f'<circle cx="{xs[i]}" cy="321" r="3.3" fill="none" style="stroke:var(--ink3)" stroke-width="1.2"></circle>')
        return ('<path d="M200 160 C 220 122, 235 77, 256 53 C 270 40, 280 64, 288 83 C 299 61, 315 40, 331 59 C 350 83, 360 128, 382 158 Z" style="fill:var(--blue)" opacity=".55" filter="url(#wash)"></path>'
                '<path class="bleedin" d="M10 262 C 40 227, 70 187, 93 141 C 112 104, 128 59, 150 35 C 160 24, 171 40, 179 61 C 190 93, 200 120, 224 150 C 248 179, 278 200, 315 227 C 334 240, 350 254, 360 264 Z" style="fill:url(#peak)" filter="url(#brush)"></path>'
                '<path class="inkdraw" d="M150 40 C 139 77, 125 112, 107 147 M 166 53 C 158 93, 155 128, 139 168 M 187 85 C 187 117, 182 147, 168 187" style="stroke:var(--ink)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".5" filter="url(#brush)"></path>'
                '<path d="M-6 286 C 40 262, 80 248, 128 256 C 171 264, 200 243, 248 248 C 286 254, 320 267, 396 262 L 396 296 L -6 296 Z" style="fill:url(#green)" filter="url(#brush)"></path>'
                '<g style="fill:var(--ink)" opacity=".75" filter="url(#bleed)"><ellipse cx="131" cy="53" rx="3.4" ry="1.5"></ellipse><ellipse cx="117" cy="83" rx="3.6" ry="1.6"></ellipse><ellipse cx="168" cy="77" rx="3" ry="1.4"></ellipse><ellipse cx="99" cy="123" rx="3.6" ry="1.5"></ellipse><ellipse cx="200" cy="128" rx="3.2" ry="1.4"></ellipse><ellipse cx="80" cy="163" rx="3.6" ry="1.6"></ellipse><ellipse cx="230" cy="166" rx="3" ry="1.4"></ellipse><ellipse cx="53" cy="214" rx="3.4" ry="1.5"></ellipse><ellipse cx="278" cy="200" rx="3.2" ry="1.4"></ellipse></g>'
                '<rect class="drift" x="-40" y="196" width="470" height="30" style="fill:var(--mist)" opacity=".55" filter="url(#wash)"></rect>'
                + water(306) + dots + boat(240, 315))
    if name == 'willow':
        strands = ''
        for i, (x, ln) in enumerate([(70, 190), (96, 230), (122, 170), (148, 250), (176, 200), (204, 150), (232, 210), (262, 120)]):
            strands += (f'<path d="M{x} -4 C {x-4} {ln*0.35}, {x+8} {ln*0.7}, {x+4} {ln}" style="stroke:var(--ink)" stroke-width="1.3" fill="none" '
                        f'stroke-dasharray="7 5" stroke-linecap="round" opacity=".6"></path>')
        return ('<path d="M-10 70 C 30 40, 60 18, 100 0 L 140 -10" style="stroke:var(--ink)" stroke-width="9" fill="none" stroke-linecap="round" opacity=".8" filter="url(#brush)"></path>'
                '<path d="M60 40 C 120 26, 190 10, 290 -6" style="stroke:var(--ink)" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6" filter="url(#brush)"></path>'
                f'<g class="sway">{strands}</g>'
                '<path d="M180 250 C 230 220, 290 206, 396 214 L 396 300 L 180 300 Z" style="fill:url(#green)" filter="url(#brush)"></path>'
                '<path d="M240 196 C 270 170, 300 150, 340 156 C 370 160, 384 176, 396 190 L 396 240 L 240 240 Z" style="fill:var(--blue)" opacity=".4" filter="url(#wash)"></path>'
                '<g class="fly"><g transform="translate(286 110)"><g class="flap"><path d="M0 0 C -8 -9, -12 -2, -4 2 M0 0 C 8 -9, 12 -2, 4 2" style="fill:var(--ink)"></path></g></g></g>'
                '<g class="fly" style="animation-delay:-3s;animation-duration:11s"><g transform="translate(312 132) scale(.8)"><g class="flap" style="animation-delay:-.2s"><path d="M0 0 C -8 -9, -12 -2, -4 2 M0 0 C 8 -9, 12 -2, 4 2" style="fill:var(--seal)" opacity=".85"></path></g></g></g>'
                + water(304))
    if name == 'moon':
        return ('<g transform="translate(206 34)"><g class="turn" style="fill:var(--ink)" opacity=".8">' + DONUT + '</g></g>'
                '<path d="M-6 250 C 40 226, 90 212, 140 222 C 180 230, 210 214, 250 220 C 300 228, 340 240, 396 236 L 396 270 L -6 270 Z" style="fill:var(--blue)" opacity=".45" filter="url(#wash)"></path>'
                '<path d="M-6 268 C 60 252, 120 248, 170 256 C 220 264, 300 250, 396 258 L 396 280 L -6 280 Z" style="fill:var(--ink)" opacity=".42" filter="url(#brush)"></path>'
                '<g style="stroke:var(--ink2)" stroke-linecap="round" opacity=".6">'
                '<path class="shimmer" d="M248 292 h 46" stroke-width="2"></path><path class="shimmer" style="animation-delay:-1s" d="M256 302 h 30" stroke-width="2"></path>'
                '<path class="shimmer" style="animation-delay:-2s" d="M262 312 h 18" stroke-width="2"></path></g>'
                + water(300, .22) + boat(70, 300, .8))
    if name == 'bamboo':
        stalk = lambda x, h, w: (f'<path d="M{x} 300 C {x+2} {300-h*0.5}, {x-2} {300-h*0.8}, {x+3} {300-h}" style="stroke:var(--ink)" stroke-width="{w}" fill="none" '
                                 f'stroke-dasharray="44 3" opacity=".75" filter="url(#bleed)"></path>')
        leaf = lambda x, y, r, o=.75: (f'<path transform="translate({x} {y}) rotate({r})" d="M0 0 C 10 -4, 26 -3, 38 0 C 26 3, 10 4, 0 0 Z" style="fill:var(--ink)" opacity="{o}"></path>')
        return ('<path d="M-6 180 C 40 150, 80 130, 120 140 C 160 150, 190 170, 230 166 L 230 300 L -6 300 Z" style="fill:var(--blue)" opacity=".38" filter="url(#wash)"></path>'
                f'<g class="sway2">{stalk(300, 330, 6)}{leaf(300, 60, -150)}{leaf(302, 66, -120)}{leaf(304, 90, 20)}{leaf(306, 96, 50)}{leaf(300, 140, -160, .6)}</g>'
                f'<g class="sway2" style="animation-delay:-3s">{stalk(338, 300, 5)}{leaf(340, 40, -30)}{leaf(338, 48, 10)}{leaf(340, 120, -170, .55)}{leaf(342, 128, -140, .55)}</g>'
                f'<g class="sway2" style="animation-delay:-5s">{stalk(268, 230, 4)}{leaf(268, 96, -140, .5)}{leaf(270, 104, -110, .5)}</g>'
                '<path d="M20 296 C 30 270, 60 258, 92 264 C 120 270, 132 286, 136 300 Z" style="fill:var(--ink)" opacity=".55" filter="url(#brush)"></path>'
                '<rect class="drift" x="-40" y="200" width="470" height="26" style="fill:var(--mist)" opacity=".5" filter="url(#wash)"></rect>')
    raise ValueError(name)

def hero(name, t, h=340, progress=None):
    return (f'<svg role="img" aria-label="{name} scene" viewBox="0 0 390 340" width="390" height="{h}" preserveAspectRatio="xMidYMax slice" '
            f'style="position:absolute;left:0;top:0">{scene(name, t, progress)}<rect y="230" width="390" height="110" style="fill:url(#fade)"></rect></svg>')

