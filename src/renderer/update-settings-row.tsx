import React, { useEffect, useRef, useState } from "react";

import type { UpdateCheckResult } from "../project/updates-bridge";
import { useRendererTranslation } from "./providers";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

type CheckStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; version: string }
  | { kind: "newer"; version: string }
  | { kind: "failed" };

const statusText = (
  status: CheckStatus,
  t: (key: string, params?: Record<string, string>) => string
): string => {
  if (status.kind === "checking") {
    return t("settings.updateChecking");
  }
  if (status.kind === "current") {
    return t("settings.updateUpToDate", { version: status.version });
  }
  if (status.kind === "newer") {
    return t("settings.updateFound", { version: status.version });
  }
  if (status.kind === "failed") {
    return t("settings.updateCheckFailed");
  }
  return "";
};

export const UpdateSettingsRow = ({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: (value: boolean) => void;
}) => {
  const { t } = useRendererTranslation();
  const [status, setStatus] = useState<CheckStatus>({ kind: "idle" });
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  const checkNow = async () => {
    setStatus({ kind: "checking" });
    try {
      const result: UpdateCheckResult =
        await window.keyharbor.updates.checkNow();
      if (!alive.current) {
        return;
      }
      if (result.success && result.newVersion) {
        setStatus({ kind: "newer", version: result.newVersion });
      } else if (result.success) {
        setStatus({ kind: "current", version: result.currentVersion });
      } else {
        setStatus({ kind: "failed" });
      }
    } catch {
      if (alive.current) {
        setStatus({ kind: "failed" });
      }
    }
  };

  const text = statusText(status, t);
  return (
    <div
      className="border-border flex items-center justify-between border-b px-4 py-3.5 last:border-b-0"
      id="check-updates-item"
    >
      <div className="flex flex-col gap-0.5">
        <span
          className="text-foreground text-[14px] font-medium"
          id="label-check-updates"
        >
          {t("settings.checkForUpdates")}
        </span>
        <span
          className="text-muted-foreground text-[12px]"
          id="desc-check-updates"
        >
          {t("settings.checkForUpdatesDesc")}
        </span>
        {text && (
          <span
            aria-live="polite"
            className="text-muted-foreground text-[12px]"
            id="check-updates-status"
          >
            {text}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="check-updates-toggle"
          aria-label={t("settings.checkForUpdates")}
          checked={checked}
          disabled={false}
          onCheckedChange={onToggle}
        />
        <Button
          id="check-updates-now-btn"
          onClick={() => {
            void checkNow();
          }}
          disabled={status.kind === "checking"}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("settings.updateCheckNow")}
        </Button>
      </div>
    </div>
  );
};
