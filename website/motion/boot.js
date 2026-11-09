/* Immediate GSAP scroll choreography, then the Framer Motion island on idle.
   Both bundles are local. There is no CDN, no remote font, and no runtime
   network request. */

import "./scroll.js";

let requested = false;

function loadIsland() {
  if (requested) return;
  requested = true;
  import("./island.jsx")
    .then((module) => module.mountMotionUI())
    .catch((error) => {
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("motion: Framer Motion island unavailable", error);
      }
    });
}

// The scene panel is below the hero; give the immediate hero timeline the first
// frames, then fill in the animated panel.
if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadIsland, { timeout: 900 });
} else {
  window.setTimeout(loadIsland, 60);
}
