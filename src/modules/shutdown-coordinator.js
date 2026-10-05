class ShutdownCoordinator {
  constructor(options) {
    this.app = options.app;
    this.session = options.session;
    this.deadlineMs = options.deadlineMs ?? 5000;
    this.destroyUi =
      typeof options.destroyUi === "function"
        ? options.destroyUi
        : () => {
            // Optional shutdown callback; the default intentionally does nothing.
          };
    this.beforeExit =
      typeof options.beforeExit === "function"
        ? options.beforeExit
        : async () => {
            /* Optional callback. */
          };
    this.reportError =
      typeof options.reportError === "function"
        ? options.reportError
        : () => {
            /* Optional callback. */
          };
    this.finalExitStarted = false;
    this._shutdownPromise = null;
  }

  handleBeforeQuit(event) {
    if (this.finalExitStarted) {
      return;
    }
    event?.preventDefault?.();
    this.requestQuit();
  }

  requestQuit() {
    if (this._shutdownPromise) {
      return this._shutdownPromise;
    }
    this._shutdownPromise = this._run();
    return this._shutdownPromise;
  }

  async _run() {
    let result;
    try {
      result = await this.session.close({
        deadlineMs: this.deadlineMs,
        reason: "quit",
      });
    } catch (error) {
      this.reportError(error);
      return this._hardExit();
    }

    if (result?.outcome === "drain_timeout" || result?.state === "closing") {
      this.reportError(
        new Error("Vault session did not drain before shutdown deadline")
      );
      return this._hardExit();
    }

    await this._beforeExitSafely();
    this._destroyUiSafely();
    this.finalExitStarted = true;
    this.app.quit();
    return { mode: "quit", result };
  }

  _hardExit() {
    this._destroyUiSafely();
    this.finalExitStarted = true;
    this.app.exit(1);
    return { code: 1, mode: "exit" };
  }

  async _beforeExitSafely() {
    try {
      await this.beforeExit();
    } catch (error) {
      this.reportError(error);
    }
  }

  _destroyUiSafely() {
    try {
      this.destroyUi();
    } catch (error) {
      this.reportError(error);
    }
  }
}

module.exports = ShutdownCoordinator;
