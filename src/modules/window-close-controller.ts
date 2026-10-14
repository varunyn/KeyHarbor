export type CloseBehavior = "ask" | "background" | "quit";
export interface CloseChoice {
  action: "background" | "quit" | "cancel";
  remember: boolean;
}

export const normalizeCloseBehavior = (value: unknown): CloseBehavior =>
  value === "background" || value === "quit" ? value : "ask";

/** Closing a window and quitting the application are separate user decisions. */
interface WindowCloseOptions {
  getBehavior: () => CloseBehavior;
  choose: () => Promise<CloseChoice>;
  isQuitting: () => boolean;
  remember: (behavior: "background" | "quit") => void;
  background: () => void;
  quit: () => void;
  reportError: (error: unknown) => void;
}

export class WindowCloseController {
  private pending = false;
  private readonly options: WindowCloseOptions;
  constructor(options: WindowCloseOptions) {
    this.options = options;
  }

  async requestClose(): Promise<void> {
    if (this.pending || this.options.isQuitting()) {
      return;
    }
    this.pending = true;
    try {
      const behavior = this.options.getBehavior();
      const choice: CloseChoice =
        behavior === "ask"
          ? await this.options.choose()
          : { action: behavior, remember: false };
      if (this.options.isQuitting() || choice.action === "cancel") {
        return;
      }
      if (choice.remember) {
        this.options.remember(choice.action);
      }
      if (choice.action === "background") {
        this.options.background();
      } else {
        this.options.quit();
      }
    } catch (error) {
      this.options.reportError(error);
    } finally {
      this.pending = false;
    }
  }
}
