/* JCode Mobile marketing site scroll choreography.
   GSAP + ScrollTrigger drive scroll-linked motion on the existing static
   markup. Hero motion runs immediately; the Framer Motion scene island loads
   separately through boot.js. Native scroll is never intercepted. */

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const root = document.documentElement;
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

function publish(scrollTriggerCount, heroEntranceMs = 0) {
  window.__jcodeMotion = {
    ready: true,
    gsap: gsap.version,
    scrollTrigger: true,
    framerMotion: Boolean(window.__jcodeMotion && window.__jcodeMotion.framerMotion),
    reduced: reduce.matches,
    scrollTriggerCount,
    heroEntranceMs,
  };
  root.dataset.motionReady = "true";
  window.dispatchEvent(new CustomEvent("jcode:motion", { detail: window.__jcodeMotion }));
}

function initScrollMotion() {
  if (reduce.matches) {
    root.dataset.motion = "reduced";
    publish(0);
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  root.classList.add("motion-gsap");
  root.dataset.motion = "full";
  let heroEntranceMs = 0;

  const media = gsap.matchMedia();
  gsap.context(() => {
    const intro = gsap.timeline({
      defaults: { ease: "power3.out" },
    });
    intro
      .fromTo(".masthead-inner", { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 }, 0)
      .fromTo(".hero-kicker", { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, 0.03)
      .fromTo(".hero-line", { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.65, stagger: 0.07 }, 0.06)
      .fromTo(".hero-lede", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.28)
      .fromTo(".hero-actions > *", { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.05 }, 0.4)
      .fromTo(".hero .caveat", { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, 0.48)
      .fromTo(".hero-facts > div", { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.04 }, 0.52)
      .fromTo(".hero-figure", { opacity: 0, scale: 0.996 }, { opacity: 1, scale: 1, duration: 0.8 }, 0.05);
    heroEntranceMs = Math.round(intro.duration() * 1000);

    /* Hero parallax: the plate drifts against the copy and the real capture
       floats over it, like an object passing under a measuring instrument. */
    gsap.to(".hero-copy", {
      y: -44,
      ease: "none",
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 0.6,
      },
    });
    gsap.to(".hero-lines", {
      y: 28,
      ease: "none",
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 0.5,
      },
    });
    gsap.to(".orbit-plate", {
      y: 64,
      scale: 1.018,
      ease: "none",
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 0.7,
      },
    });
    gsap.to(".device-sheet--hero", {
      y: -32,
      ease: "none",
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 0.6,
      },
    });

    /* Pinned continuity stage. The stage holds while the three written states
       pass underneath it, the way a product page keeps its screen fixed. */
    media.add("(min-width: 921px)", () => {
      const stage = document.querySelector(".narrative-stage");
      const copy = document.querySelector(".narrative-copy");
      if (!stage || !copy) return undefined;

      root.classList.add("motion-pinned");
      const distance = () => Math.max(240, copy.offsetHeight - stage.offsetHeight);

      ScrollTrigger.create({
        trigger: ".narrative-grid",
        start: "top top+=72",
        end: () => `+=${distance()}`,
        pin: stage,
        pinSpacing: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      });

      gsap.fromTo(
        ".stage-panel",
        { scale: 0.968 },
        {
          scale: 1.028,
          ease: "none",
          scrollTrigger: {
            trigger: ".narrative-grid",
            start: "top top+=72",
            end: () => `+=${distance()}`,
            scrub: 0.5,
            invalidateOnRefresh: true,
          },
        },
      );
      gsap.to(".orbit-canvas--stage", {
        y: -26,
        scale: 1.05,
        ease: "none",
        scrollTrigger: {
          trigger: ".narrative-grid",
          start: "top top+=72",
          end: () => `+=${distance()}`,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });
      return () => root.classList.remove("motion-pinned");
    });

    /* Section reveals. Each group resolves once, on its own rhythm. */
    const groups = [
      { targets: ".ledger-row", stagger: 0.07, y: 22 },
      { targets: ".inspect-note", stagger: 0.06, y: 18 },
      { targets: ".specimen", stagger: 0.1, y: 30 },
      { targets: ".palette-row", stagger: 0.032, y: 14 },
      { targets: ".setup-steps > li", stagger: 0.06, y: 20 },
      { targets: ".release-head, .release-foot", stagger: 0, y: 16 },
      { targets: ".welcome-copy", stagger: 0, y: 20 },
      { targets: ".closing-copy, .closing-action", stagger: 0.08, y: 20 },
    ];

    for (const group of groups) {
      const targets = gsap.utils.toArray(group.targets);
      if (!targets.length) continue;
      gsap.set(targets, { y: group.y, opacity: 0 });
      ScrollTrigger.batch(targets, {
        start: "top 90%",
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, {
            y: 0,
            opacity: 1,
            duration: 0.72,
            ease: "power3.out",
            stagger: group.stagger,
            overwrite: true,
          }),
      });
    }

    /* Welcome phone reveal, with a short settle so it reads as an object
       arriving rather than a card fading in. */
    const welcome = document.querySelector(".welcome-device");
    if (welcome) {
      gsap.from(welcome, {
        y: 48,
        scale: 0.945,
        opacity: 0,
        duration: 1.05,
        ease: "power3.out",
        scrollTrigger: { trigger: ".welcome-figure", start: "top 84%", once: true },
      });
    }

    /* A small scene shift on selection keeps the write-up and the capture
       coupled without touching main.js scene state. */
    const sceneShift = {
      send: { x: 0, y: 0, scale: 1, rotate: 0 },
      away: { x: 10, y: -6, scale: 0.965, rotate: 0.35 },
      return: { x: -8, y: 3, scale: 1.028, rotate: -0.3 },
    };
    const applySceneShift = () => {
      const scene = root.dataset.scene in sceneShift ? root.dataset.scene : "send";
      gsap.to(".stage-device", {
        ...sceneShift[scene],
        duration: 0.72,
        ease: "power3.out",
        overwrite: "auto",
      });
    };
    document.addEventListener("jcode:scene", applySceneShift);
    applySceneShift();
    return () => document.removeEventListener("jcode:scene", applySceneShift);
  }, document.body);

  ScrollTrigger.refresh();
  publish(ScrollTrigger.getAll().length, heroEntranceMs);
}

try {
  initScrollMotion();
} catch (error) {
  // Motion is an enhancement. A failed timeline must not hide the page.
  root.classList.remove("motion-gsap", "motion-pinned");
  root.dataset.motion = "unavailable";
  if (window.console && typeof window.console.warn === "function") {
    window.console.warn("motion: scroll choreography unavailable", error);
  }
  if (!window.__jcodeMotion) {
    window.__jcodeMotion = {
      ready: true,
      gsap: gsap.version,
      scrollTrigger: false,
      framerMotion: false,
      reduced: reduce.matches,
      scrollTriggerCount: 0,
      failed: true,
    };
  }
}
