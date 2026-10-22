import { useCallback, useEffect, useRef, useState } from "react";

import type { TouchIdStatus } from "../project/bridge";

export interface UseTouchIdOptions {
  autoFetch?: boolean;
}

export const useTouchId = (options: UseTouchIdOptions = {}) => {
  const { autoFetch = true } = options;
  const [touchStatus, setTouchStatus] = useState<TouchIdStatus>({
    available: false,
    enabled: false,
  });
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(true);
  const busyRef = useRef(false);

  const refreshStatus = useCallback(async (): Promise<TouchIdStatus> => {
    try {
      const status = await window.keyharbor.touchId.getStatus();
      if (aliveRef.current) {
        setTouchStatus(status);
      }
      return status;
    } catch {
      const fallback: TouchIdStatus = { available: false, enabled: false };
      if (aliveRef.current) {
        setTouchStatus(fallback);
      }
      return fallback;
    }
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (busyRef.current) {
      return { error: "Operation in progress", success: false };
    }
    busyRef.current = true;
    setBusy(true);
    let result: {
      error?: string;
      status?: TouchIdStatus;
      success: boolean;
    };
    try {
      result = await window.keyharbor.touchId.setEnabled(enabled);
      const status =
        "status" in result ? (result.status as TouchIdStatus) : undefined;
      if (aliveRef.current) {
        if (status) {
          setTouchStatus(status);
        } else if (result.success) {
          setTouchStatus((prev) => ({ ...prev, enabled }));
        }
      }
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : "Touch ID failed",
        success: false,
      };
    }
    busyRef.current = false;
    if (aliveRef.current) {
      setBusy(false);
    }
    return result;
  }, []);

  const unlock = useCallback(async () => {
    if (busyRef.current) {
      return { error: "Operation in progress", success: false };
    }
    busyRef.current = true;
    setBusy(true);
    let result: {
      error?: string;
      status?: TouchIdStatus;
      success: boolean;
    };
    try {
      result = await window.keyharbor.touchId.unlock();
      const status =
        "status" in result ? (result.status as TouchIdStatus) : undefined;
      if (aliveRef.current && status) {
        setTouchStatus(status);
      }
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : "Touch ID failed",
        success: false,
      };
    }
    busyRef.current = false;
    if (aliveRef.current) {
      setBusy(false);
    }
    return result;
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    let live = true;
    const retire = () => {
      aliveRef.current = false;
    };
    if (autoFetch) {
      void (async () => {
        try {
          const status = await window.keyharbor.touchId.getStatus();
          if (live && aliveRef.current) {
            setTouchStatus(status);
          }
        } catch {
          if (live && aliveRef.current) {
            setTouchStatus({ available: false, enabled: false });
          }
        }
      })();
    }
    window.addEventListener("pagehide", retire);
    return () => {
      live = false;
      aliveRef.current = false;
      window.removeEventListener("pagehide", retire);
    };
  }, [autoFetch]);

  return {
    busy,
    refreshStatus,
    setEnabled,
    setTouchStatus,
    touchStatus,
    unlock,
  };
};
