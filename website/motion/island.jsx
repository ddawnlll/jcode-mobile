/* JCode Mobile marketing site Framer Motion island.
   Loaded on idle by boot.js. It enhances the static scene panel with
   AnimatePresence crossfades, caption transitions, a scene progress rail, and
   a reading rail. main.js remains the scene state authority. */

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
} from "framer-motion";

const EASE_OUT = [0.22, 1, 0.36, 1];
const EASE_MOVE = [0.4, 0, 0.2, 1];

function sceneOrder() {
  const tabs = Array.from(document.querySelectorAll("#scene-tabs [role='tab']"));
  const order = tabs.map((tab) => tab.dataset.scene).filter(Boolean);
  return order.length ? order : ["send", "away", "return"];
}

function staticCopies() {
  return {
    label: document.getElementById("stage-scene")?.textContent?.trim() ?? "",
    caption: document.getElementById("stage-caption-text")?.textContent?.trim() ?? "",
    provenance: document.getElementById("stage-provenance")?.textContent?.trim() ?? "",
  };
}

function staticImages() {
  return new Map(
    Array.from(document.querySelectorAll(".scene-image")).map((image) => [
      image.dataset.sceneImage,
      {
        src: image.getAttribute("src") ?? "",
        alt: image.getAttribute("alt") ?? "",
        width: image.getAttribute("width") ?? undefined,
        height: image.getAttribute("height") ?? undefined,
      },
    ]),
  );
}

function initialScene(order) {
  const published = window.__jcodeScene;
  if (published && published.scene) return published;
  const current =
    document.querySelector(".scene-image.is-active")?.dataset.sceneImage ??
    document.querySelector("#scene-tabs [aria-selected='true']")?.dataset.scene ??
    order[0];
  const index = Math.max(0, order.indexOf(current));
  return {
    scene: current,
    index,
    total: order.length,
    copy: staticCopies(),
  };
}

function SceneStack({ detail, images, order }) {
  const reduced = useReducedMotion();
  const image = images.get(detail.scene);
  const duration = reduced ? 0 : 0.62;

  return (
    <span className="motion-scene-frame" data-framer-motion="scene-stack">
      <AnimatePresence initial={false} mode="sync">
        {image ? (
          <motion.img
            key={detail.scene}
            className="motion-scene-image"
            data-scene-image={detail.scene}
            src={image.src}
            alt=""
            width={image.width}
            height={image.height}
            draggable={false}
            decoding="async"
            initial={{ opacity: 0, scale: reduced ? 1 : 1.012 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.995 }}
            transition={{ duration, ease: EASE_OUT }}
          />
        ) : null}
      </AnimatePresence>
      <span className="motion-scene-index mono" aria-hidden="true">
        {String(detail.index + 1).padStart(2, "0")} / {String(order.length).padStart(2, "0")}
      </span>
    </span>
  );
}

function SceneCaption({ detail }) {
  const reduced = useReducedMotion();
  const copy = detail.copy ?? staticCopies();
  const duration = reduced ? 0 : 0.34;

  return (
    <div className="motion-caption-stack" data-framer-motion="scene-caption">
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={detail.scene}
          className="motion-caption-frame"
          initial={{ opacity: 0, y: reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -6 }}
          transition={{ duration, ease: EASE_MOVE }}
        >
          <span className="mono stage-scene">{copy.label}</span>
          <span className="motion-caption-text">{copy.caption}</span>
          <span className="mono stage-provenance">{copy.provenance}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SceneProgress({ detail, order }) {
  const reduced = useReducedMotion();
  return (
    <ol className="scene-progress-track" data-framer-motion="scene-progress">
      {order.map((scene, index) => (
        <li key={scene} className="scene-progress-item">
          <motion.span
            className="scene-progress-fill"
            initial={false}
            animate={{ scaleX: index <= detail.index ? 1 : 0 }}
            transition={
              reduced
                ? { duration: 0 }
                : { duration: 0.55, ease: EASE_OUT, delay: index === detail.index ? 0.04 : 0 }
            }
          />
          <span className="mono scene-progress-label">{String(index + 1).padStart(2, "0")}</span>
        </li>
      ))}
    </ol>
  );
}

function PageProgress() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, {
    stiffness: reduced ? 1000 : 140,
    damping: reduced ? 100 : 28,
    restDelta: 0.001,
  });
  return (
    <div className="motion-progress" aria-hidden="true" data-framer-motion="page-progress">
      <motion.div className="motion-progress-bar" style={{ scaleX: smooth }} />
    </div>
  );
}

function MotionUI({ initial, images, order, onReady }) {
  const [detail, setDetail] = useState(initial);

  useEffect(() => {
    const onScene = (event) => {
      const next = event.detail;
      if (!next || !next.scene) return;
      setDetail((current) =>
        current.scene === next.scene
          ? current
          : {
              scene: next.scene,
              index: next.index ?? 0,
              total: next.total ?? order.length,
              copy: next.copy ?? staticCopies(),
            },
      );
    };
    document.addEventListener("jcode:scene", onScene);
    // main.js may have published state between module evaluation and mount.
    setDetail((current) => {
      const published = window.__jcodeScene;
      if (!published || !published.scene || published.scene === current.scene) return current;
      return {
        scene: published.scene,
        index: published.index ?? 0,
        total: published.total ?? order.length,
        copy: published.copy ?? staticCopies(),
      };
    });
    onReady();
    return () => document.removeEventListener("jcode:scene", onScene);
    // Mount once. Scene updates arrive through the event listener above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const imageTarget = document.getElementById("motion-scene-images");
  const captionTarget = document.getElementById("motion-caption");
  const progressTarget = document.getElementById("scene-progress");

  return (
    <>
      <PageProgress />
      {imageTarget
        ? createPortal(<SceneStack detail={detail} images={images} order={order} />, imageTarget)
        : null}
      {captionTarget
        ? createPortal(<SceneCaption detail={detail} />, captionTarget)
        : null}
      {progressTarget
        ? createPortal(<SceneProgress detail={detail} order={order} />, progressTarget)
        : null}
    </>
  );
}

export function mountMotionUI() {
  const root = document.documentElement;
  const ui = document.getElementById("motion-ui");
  if (!ui) return;

  const order = sceneOrder();
  const images = staticImages();
  const initial = initialScene(order);
  let enhanced = false;

  const markEnhanced = () => {
    if (enhanced) return;
    enhanced = true;
    root.classList.add("motion-enhanced");
    const motionState = window.__jcodeMotion || {};
    window.__jcodeMotion = {
      ...motionState,
      ready: true,
      gsap: motionState.gsap ?? null,
      scrollTrigger: Boolean(motionState.scrollTrigger),
      framerMotion: true,
      uiReady: true,
      reduced: Boolean(motionState.reduced),
      scrollTriggerCount: motionState.scrollTriggerCount ?? 0,
    };
    window.dispatchEvent(new CustomEvent("jcode:motion", { detail: window.__jcodeMotion }));
  };

  const renderer = createRoot(ui);
  renderer.render(
    <MotionUI initial={initial} images={images} order={order} onReady={markEnhanced} />,
  );
}
