/**
 * Exact adapter build identity. The phone surfaces this in Server details and
 * compares the advertised capabilities with the ones this build implements, so
 * a stale VPS deployment is diagnosable instead of looking like an app bug.
 */
export const ADAPTER_VERSION = '0.2.2';
export const ADAPTER_NAME = `jcode-mobile-adapter/${ADAPTER_VERSION}`;
