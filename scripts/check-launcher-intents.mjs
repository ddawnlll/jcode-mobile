import assert from 'node:assert/strict';
import { deepLinkIntent } from '../apps/stillness/src/lib/nativeIntents.ts';

assert.deepEqual(deepLinkIntent({ url: 'jcode-mobile://sessions', action: 'sessions', sessionId: null }), { kind: 'sessions' });
assert.deepEqual(deepLinkIntent({ url: 'jcode-mobile://new-session', action: 'new_session', sessionId: null }), { kind: 'new' });
assert.deepEqual(deepLinkIntent({ url: 'jcode-mobile://session/a%252Fb', action: 'open_session', sessionId: 'a%2Fb' }), { kind: 'session', sessionId: 'a%2Fb' });
assert.equal(deepLinkIntent({ url: 'jcode-mobile://unknown', action: 'unknown', sessionId: null }).kind, 'unhandled');
console.log('Launcher deep-link intent tests passed');
