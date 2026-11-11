import { useState } from 'react';
import { controller, defaultServerAddress, type AppState } from '../lib/controller';
import { IconArrow, IconCheck, IconShield } from '../components/Icons';
import { Torus } from '../components/Torus';

export function WelcomeScreen({ state }: { state: AppState }) {
  return (
    <div className="onboarding" data-testid="welcome-screen">
      <header className="onboard-bar">
        <div className="onboard-wordmark">
          <Torus size={28} animated />
          <strong>jcode</strong>
        </div>
        <span className="onboard-header-mark">STILLNESS / 12</span>
      </header>
      <main className="body-scroll">
        <div className="welcome-page">
          <div className="welcome-mark">
            <Torus size={168} animated label="JCode halftone donut" />
          </div>
          <div className="welcome-copy">
            <p className="onboard-overline">REMOTE CODING, QUIETLY</p>
            <h1 className="onboard-page-title">
              Your server.
              <br />
              Your phone.
            </h1>
            <p className="onboard-lede">
              A single pairing. The same sessions, tools and context, from wherever you are.
            </p>
          </div>
          <div className="onboard-actions">
            <button className="onboard-primary" onClick={() => controller.go('pair')} data-testid="start-pairing">
              Pair a device <IconArrow className="i-sm" />
            </button>
            <button
              className="onboard-secondary"
              onClick={() => controller.go('pair')}
            >
              Enter server details
            </button>
            <p className="onboard-footnote">
              Provider API keys and shell credentials stay on the server. This phone receives a
              device token only.
            </p>
          </div>
          <div className="trust-list">
            <div>
              <IconShield className="i-sm" />
              <span>Device-scoped access</span>
            </div>
            <div>
              <IconCheck className="i-sm" />
              <span>No navigation-triggered cancellation</span>
            </div>
            <div>
              <Torus size={16} animated={false} />
              <span>Leaving the screen never stops a turn</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function PairScreen({ state }: { state: AppState }) {
  const [server, setServer] = useState(defaultServerAddress());
  const [code, setCode] = useState('');
  const [device, setDevice] = useState('JCode Mobile');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await controller.pair(server, code, device);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="onboarding" data-testid="pair-screen">
      <header className="onboard-bar">
        <button className="icon-btn" aria-label="Back to welcome" onClick={() => controller.go('welcome')}>
          <IconArrow style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="onboard-header-mark">PAIR / DETAILS</div>
      </header>
      <main className="body-scroll">
        <div className="pair-page">
          <p className="onboard-overline">CONNECT THIS PHONE</p>
          <h1 className="onboard-page-title">
            One pairing.
            <br />
            One device.
          </h1>
          <p className="onboard-lede">
            Start the adapter on your server. Its terminal prints a one-time pairing code.
          </p>
          <form onSubmit={submit} noValidate>
            <label className="onboard-field">
              Server address
              <input
                id="pair-server"
                name="server"
                data-testid="pair-server"
                value={server}
                onChange={(event) => setServer(event.target.value)}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://server.example.com"
                required
              />
              <span className="field-hint">Loopback adapters may use http. Remote servers must use a trusted TLS endpoint.</span>
            </label>
            <label className="onboard-field">
              Pairing code
              <input
                id="pair-code"
                name="code"
                data-testid="pair-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                spellCheck={false}
                placeholder="ABCD-EFGH-JKLM"
                required
              />
              <span className="field-hint">From the adapter terminal · single use · expires in ten minutes.</span>
            </label>
            <label className="onboard-field">
              Device name
              <input
                id="pair-device"
                name="device"
                data-testid="pair-device"
                value={device}
                onChange={(event) => setDevice(event.target.value)}
                maxLength={48}
                autoComplete="off"
                required
              />
            </label>
            {state.pairingError ? (
              <p className="pair-error" role="alert" data-testid="pair-error">
                {state.pairingError}
              </p>
            ) : null}
            <button className="onboard-primary" type="submit" disabled={submitting} data-testid="pair-submit">
              {submitting ? 'Pairing…' : 'Pair this device'} <IconArrow className="i-sm" />
            </button>
            <button type="button" className="onboard-secondary" onClick={() => controller.go('welcome')}>
              Back
            </button>
            <p className="onboard-footnote">
              Device pairing is not a Command Code login. Never enter a provider API key here.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}

export function PairingScreen({ state }: { state: AppState }) {
  const failed = state.pairingStage === 'error';
  return (
    <div className="onboarding" data-testid="pairing-screen">
      <header className="onboard-bar">
        <div className="onboard-wordmark">
          <Torus size={28} animated />
          <strong>jcode</strong>
        </div>
        <span className="onboard-header-mark">PAIR / IN PROGRESS</span>
      </header>
      <main className="body-scroll">
        <div className="loading-page">
          <div className="loading-donut">
            <Torus size={132} animated={!failed} />
          </div>
          <div className="loading-copy" role="status" aria-live="polite">
            <p className="onboard-overline">{failed ? 'PAIRING FAILED' : 'AUTHENTICATING'}</p>
            <h1 className="onboard-title-compact">
              {failed ? 'The connection did not complete.' : state.pairingStage === 'connecting' ? 'Opening the channel.' : 'Pairing this device.'}
            </h1>
            <p className="onboard-lede">{state.pairingError ?? state.pairingMessage}</p>
            {failed ? (
              <button className="onboard-primary" onClick={() => controller.go('pair')}>
                Back to details <IconArrow className="i-sm" />
              </button>
            ) : (
              <p className="onboard-footnote">No provider credential is sent to this phone.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export function ReadyScreen({ state }: { state: AppState }) {
  return (
    <div className="onboarding" data-testid="ready-screen">
      <header className="onboard-bar">
        <div className="onboard-wordmark">
          <Torus size={28} animated />
          <strong>jcode</strong>
        </div>
        <span className="onboard-header-mark">PAIR / VERIFIED</span>
      </header>
      <main className="body-scroll">
        <div className="ready-page">
          <div className="ready-glyph">
            <IconCheck />
          </div>
          <p className="onboard-overline">DEVICE TOKEN ACCEPTED</p>
          <h1 className="onboard-page-title">Back to work.</h1>
          <p className="onboard-lede">
            This screen appears only after the adapter verified the pairing and the authenticated
            mobile channel completed its hello.
          </p>
          <div className="ready-server">
            <div>
              <strong>{state.server?.name ?? 'JCode server'}</strong>
              <small>{state.credential?.baseUrl ?? ''}</small>
            </div>
            <div className="ready-meta">
              <span>Adapter {state.server?.adapter_version ?? 'unknown'}</span>
              <span>Harness {state.server?.jcode_version ?? 'unknown'}</span>
              <span>API {state.server?.jcode_protocol_version ?? 'unknown'}</span>
            </div>
            <div className={`inline-status ${state.server?.healthy ? 'ok' : 'warn'}`}>
              <span className="status-mark" />
              {state.server?.healthy ? 'JCode harness connected' : 'Adapter paired · JCode harness unavailable'}
            </div>
          </div>
          <button className="onboard-primary" onClick={() => controller.enterApp()} data-testid="enter-app">
            Enter JCode <IconArrow className="i-sm" />
          </button>
          <button className="onboard-secondary" onClick={() => controller.unpair()}>
            Forget this device
          </button>
        </div>
      </main>
    </div>
  );
}
