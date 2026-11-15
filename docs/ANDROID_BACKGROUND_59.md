# Android background companion, issue #59

The current companion is a global, opt-in WorkManager health probe, not an
authenticated session reconciler. It does not receive session updates or emit
notifications. The adapter and agent continue independently of the phone.

Periodic and one-shot work require a connected network and battery-not-low.
Disabling requests cancellation of both kinds of work and clears the queued
indicator. An already-running HTTP probe may finish while cancellation takes
effect. Use `backgroundSyncSet`, not the generic settings setter, to change
these settings. WorkManager may defer work during Doze or battery restrictions,
and Android force-stop requires the user to open the app again.

Still missing: a worker-accessible native token vault, authenticated adapter
reconciliation, per-profile/server subscriptions, cursors and scoped cache
writes, optional Wi-Fi-only scheduling, push integration, and realistic
background, reboot, force-stop, network and battery validation. These changes
do not satisfy the issue's eventual reconciliation acceptance criterion.

The instrumentation tests in `BackgroundSyncInstrumentedTest` modify sync
settings and should be run only on an isolated test installation.
