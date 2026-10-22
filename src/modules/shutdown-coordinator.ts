import type { CloseResult } from "./vault-session-types";

interface ShutdownApp {
  exit: (code: number) => void;
  quit: () => void;
}

interface ShutdownSession {
  close: (request: {
    deadlineMs: number;
    reason: "quit";
  }) => Promise<CloseResult | null | undefined>;
}

type ShutdownCallback = () => void | Promise<void>;
type ErrorReporter = (error: Error) => void;

interface ShutdownCoordinatorOptions {
  app: ShutdownApp;
  session: ShutdownSession;
  deadlineMs?: number;
  destroyUi?: ShutdownCallback;
  beforeExit?: ShutdownCallback;
  reportError?: ErrorReporter;
}

interface ShutdownEvent {
  preventDefault?: () => void;
}

type ShutdownOutcome =
  | { mode: "quit"; result: CloseResult | null | undefined }
  | { code: 1; mode: "exit" };

const isCallback = (value: unknown): value is ShutdownCallback =>
  typeof value === "function";

const isErrorReporter = (value: unknown): value is ErrorReporter =>
  typeof value === "function";

const isDrainTimeoutResult = (
  result: CloseResult | null | undefined
): boolean =>
  result?.outcome === "drain_timeout" || result?.state === "closing";

class ShutdownCoordinator {
  private readonly app: ShutdownApp;
  private readonly session: ShutdownSession;
  private readonly deadlineMs: number;
  private readonly destroyUi: ShutdownCallback;
  private readonly beforeExit: ShutdownCallback;
  private readonly reportError: ErrorReporter;
  private finalExitStarted = false;
  private _shutdownPromise: Promise<ShutdownOutcome> | null = null;

  constructor(options: ShutdownCoordinatorOptions) {
    this.app = options.app;
    this.session = options.session;
    this.deadlineMs = options.deadlineMs ?? 5000;
    this.destroyUi = isCallback(options.destroyUi)
      ? options.destroyUi
      : () => {
          // Optional shutdown callback; the default intentionally does nothing.
        };
    this.beforeExit = isCallback(options.beforeExit)
      ? options.beforeExit
      : async () => {
          /* Optional callback. */
        };
    this.reportError = isErrorReporter(options.reportError)
      ? options.reportError
      : () => {
          /* Optional callback. */
        };
  }

  handleBeforeQuit(event?: ShutdownEvent | null): void {
    if (this.finalExitStarted) {
      return;
    }
    event?.preventDefault?.();
    void this.requestQuit();
  }

  requestQuit(): Promise<ShutdownOutcome> {
    if (this._shutdownPromise) {
      return this._shutdownPromise;
    }
    this._shutdownPromise = this._run();
    return this._shutdownPromise;
  }

  private async _run(): Promise<ShutdownOutcome> {
    let result: CloseResult | null | undefined;
    try {
      result = await this.session.close({
        deadlineMs: this.deadlineMs,
        reason: "quit",
      });
    } catch (error) {
      this.reportError(error);
      return this._hardExit();
    }

    if (isDrainTimeoutResult(result)) {
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

  private _hardExit(): ShutdownOutcome {
    this._destroyUiSafely();
    this.finalExitStarted = true;
    this.app.exit(1);
    return { code: 1, mode: "exit" };
  }

  private async _beforeExitSafely(): Promise<void> {
    try {
      await this.beforeExit();
    } catch (error) {
      this.reportError(error);
    }
  }

  private _destroyUiSafely(): void {
    try {
      this.destroyUi();
    } catch (error) {
      this.reportError(error);
    }
  }
}

export = ShutdownCoordinator;
