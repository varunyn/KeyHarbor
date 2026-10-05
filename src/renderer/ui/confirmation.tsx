import { useCallback, useEffect, useRef, useState } from "react";

import type { VaultSessionSnapshot } from "../../project/bridge";
import { i18n } from "../i18n";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./dialog";

interface ConfirmationOptions {
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "default" | "destructive";
}

/** Replaces blocking browser confirmations while retiring requests with their Vault session. */
export const useConfirmation = () => {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const mounted = useRef(true);
  const returnFocus = useRef<HTMLElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const session = useRef<VaultSessionSnapshot | null>(null);
  const finish = useCallback((confirmed: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    if (mounted.current) {
      setOptions(null);
    }
    resolve?.(confirmed);
  }, []);
  const cancelConfirmation = useCallback(() => finish(false), [finish]);

  useEffect(() => {
    mounted.current = true;
    let live = true;
    const updateSession = (next: VaultSessionSnapshot) => {
      const prior = session.current;
      if (prior && next.transitionId < prior.transitionId) {
        return;
      }
      session.current = next;
      if (
        next.state !== "active" ||
        (prior && prior.activeVaultId !== next.activeVaultId)
      ) {
        cancelConfirmation();
      }
    };
    const offSession =
      window.keyharbor.vault.onSessionStateChanged(updateSession);
    const offReconciliation =
      window.keyharbor.vault.onReconciliationRequired(cancelConfirmation);
    const readSession = async () => {
      try {
        const snapshot = await window.keyharbor.vault.sessionSnapshot();
        if (live) {
          updateSession(snapshot);
        }
      } catch {
        if (live) {
          cancelConfirmation();
        }
      }
    };
    readSession();
    window.addEventListener("pagehide", cancelConfirmation);
    return () => {
      live = false;
      mounted.current = false;
      offSession();
      offReconciliation();
      window.removeEventListener("pagehide", cancelConfirmation);
      cancelConfirmation();
    };
  }, [cancelConfirmation]);

  const confirm = useCallback((next: ConfirmationOptions): Promise<boolean> => {
    if (
      !mounted.current ||
      pending.current ||
      (session.current && session.current.state !== "active")
    ) {
      return Promise.resolve(false);
    }
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const menu = focused?.closest('[role="menu"]');
    const openerId = menu?.getAttribute("aria-labelledby");
    returnFocus.current = openerId
      ? document.querySelector<HTMLElement>(`#${CSS.escape(openerId)}`)
      : focused;
    // The promise bridges a future user decision to the existing asynchronous action handlers.
    // eslint-disable-next-line promise/avoid-new
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setOptions(next);
    });
  }, []);

  const confirmationDialog = options ? (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          cancelConfirmation();
        }
      }}
    >
      <DialogContent
        className="lk-ui-theme text-foreground z-[100002] max-h-[calc(100vh-48px)] w-[calc(100%-32px)] overflow-y-auto"
        overlayClassName="z-[100002]"
        closeLabel={i18n.t("common.close")}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelButton.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocus.current;
          const reconciliation = document.querySelector<HTMLElement>(
            ".lk-vault-merge-dialog"
          );
          if (
            session.current?.state === "active" &&
            reconciliation &&
            (!target ||
              !reconciliation.contains(target) ||
              target.hasAttribute("disabled"))
          ) {
            reconciliation.focus();
            return;
          }
          if (
            session.current?.state === "active" &&
            target?.isConnected &&
            target.getClientRects().length > 0 &&
            !target.hasAttribute("disabled")
          ) {
            target.focus();
          }
        }}
      >
        <DialogTitle>{options.title}</DialogTitle>
        <DialogDescription className="m-0 leading-relaxed whitespace-pre-wrap">
          {options.description}
        </DialogDescription>
        <DialogFooter className="gap-2">
          <Button
            ref={cancelButton}
            variant="secondary"
            onClick={cancelConfirmation}
          >
            {i18n.t("common.cancel")}
          </Button>
          <Button
            variant={options.variant ?? "default"}
            onClick={() => finish(true)}
          >
            {options.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { cancelConfirmation, confirm, confirmationDialog };
};
