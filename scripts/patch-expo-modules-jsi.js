#!/usr/bin/env bun
/**
 * Xcode 26.1 / Swift 6.2 rejects expo-modules-jsi 58.0.22 in one place:
 * `JavaScriptObject.swift` sends a task-isolated pointer into a
 * JavaScriptActor-isolated closure. The pointer is only used synchronously
 * inside `assumeIsolated`; wrapping it in the package's own `UncheckedSendable`
 * states that intent to the compiler without changing runtime behavior.
 *
 * Idempotent. Fails loudly when the expected source line is missing so a future
 * Expo release cannot be silently mis-patched.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi');
if (!fs.existsSync(root)) {
  console.log('[patch-expo-modules-jsi] package not installed; nothing to do');
  process.exit(0);
}

const manifest = path.join(root, 'apple', 'Package.swift');
if (fs.existsSync(manifest)) {
  const source = fs.readFileSync(manifest, 'utf8');
  if (source.includes('swiftLanguageModes: [.v5]')) {
    fs.writeFileSync(manifest, source.replace('swiftLanguageModes: [.v5]', 'swiftLanguageModes: [.v6]'));
    console.log('[patch-expo-modules-jsi] restored Swift 6 language mode');
  }
}

const target = path.join(
  root,
  'apple',
  'Sources',
  'ExpoModulesJSI',
  'Runtime',
  'Values',
  'JavaScriptObject.swift',
);
const source = fs.readFileSync(target, 'utf8');
if (source.includes('javascriptObjectSlotBox')) {
  console.log('[patch-expo-modules-jsi] already patched');
  process.exit(0);
}
const before = `    nonisolated(unsafe) let slot = buffer.baseAddress!
    expo.emplaceUndefined(slot)
    defer {
      expo.destroyValues(slot, 1)
    }`;
const after = `    nonisolated(unsafe) let slot = buffer.baseAddress!
    // Xcode 26.1 / Swift 6.2: the pointer crosses into JavaScriptActor-isolated
    // code but is used synchronously there; UncheckedSendable records that.
    let javascriptObjectSlotBox = UncheckedSendable(slot)
    expo.emplaceUndefined(slot)
    defer {
      expo.destroyValues(slot, 1)
    }`;
if (!source.includes(before)) {
  console.error(
    '[patch-expo-modules-jsi] expected allocation block not found. ' +
      'Inspect JavaScriptObject.swift before upgrading; the Xcode 26.1 workaround may no longer be needed.',
  );
  process.exit(1);
}
let patched = source.replace(before, after);
patched = patched.replace(
  'try encode(JavaScriptValue.Slot(slot), runtime)',
  'try encode(JavaScriptValue.Slot(javascriptObjectSlotBox.value), runtime)',
);
if (patched === source) {
  console.error('[patch-expo-modules-jsi] sendability call site not found');
  process.exit(1);
}
fs.writeFileSync(target, patched);
console.log('[patch-expo-modules-jsi] applied Xcode 26.1 sendability annotation');
