import { useCallback, useEffect, useRef } from "react";

export interface UseTimedClipboardOptions {
  timeoutMs?: number;
}

export const useTimedClipboard = (options: UseTimedClipboardOptions = {}) => {
  const { timeoutMs = 30_000 } = options;
  const clipboardTimer = useRef<number | null>(null);

  const clearClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText("");
    } catch {
      // Clipboard access can be unavailable after the window or session closes.
    }
  }, []);

  const copyWithAutoClear = useCallback(
    async (text: string) => {
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
      if (clipboardTimer.current) {
        window.clearTimeout(clipboardTimer.current);
      }
      clipboardTimer.current = window.setTimeout(() => {
        void clearClipboard();
        clipboardTimer.current = null;
      }, timeoutMs);
      return copied;
    },
    [clearClipboard, timeoutMs]
  );

  const cancelAutoClear = useCallback(() => {
    if (clipboardTimer.current) {
      window.clearTimeout(clipboardTimer.current);
      clipboardTimer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (clipboardTimer.current) {
        window.clearTimeout(clipboardTimer.current);
        clipboardTimer.current = null;
        void clearClipboard();
      }
    },
    [clearClipboard]
  );

  return {
    cancelAutoClear,
    clearClipboard,
    copyWithAutoClear,
  };
};
