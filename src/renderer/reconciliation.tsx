import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type {
  ReconciliationPlan,
  ReconciliationResponse,
  VaultSessionSnapshot,
} from "../project/bridge";
import { requireSuccessfulResponse, runWithCleanup } from "./async-operation";
import { i18n } from "./i18n";
import { notificationManager } from "./notifications";
import { Button } from "./ui/button";
import { useConfirmation } from "./ui/confirmation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type Plan = ReconciliationPlan & {
  reconciliationId: string;
  allowedDecisions?: ("use_disk" | "keep_session")[];
};

const planFrom = (value: unknown): Plan | null => {
  const row = value as { result?: ReconciliationPlan } | null;
  const result = row?.result || (value as ReconciliationPlan);
  return result?.status === "needs_resolution" &&
    typeof result.reconciliationId === "string"
    ? (result as Plan)
    : null;
};

export const ReconciliationLayer = ({ children }: { children: ReactNode }) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolutionError, setResolutionError] = useState("");
  const shown = useRef(new Set<string>());
  const pending = useRef<unknown[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  const currentPlan = useRef<Plan | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const transitionId = useRef(-1);
  const session = useRef<VaultSessionSnapshot | null>(null);
  const resolving = useRef(false);
  const { confirm, confirmationDialog, cancelConfirmation } = useConfirmation();

  const updatePlan = useCallback((next: Plan | null) => {
    currentPlan.current = next;
    setPlan(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const announce = (value: unknown) => {
      const next = planFrom(value);
      if (!next) {
        return;
      }
      if (!session.current) {
        pending.current.push(value);
        return;
      }
      if (
        session.current.state !== "active" ||
        shown.current.has(next.reconciliationId)
      ) {
        return;
      }
      shown.current.add(next.reconciliationId);
      setResolutionError("");
      updatePlan(next);
    };

    const offRequired =
      window.keyharbor.vault.onReconciliationRequired(announce);
    const offState = window.keyharbor.vault.onSessionStateChanged(
      (snapshot) => {
        if (snapshot.transitionId < transitionId.current) {
          return;
        }
        transitionId.current = snapshot.transitionId;
        const previous = session.current;
        session.current = snapshot;
        if (
          snapshot.state !== "active" ||
          (previous?.activeVaultId &&
            snapshot.activeVaultId !== previous.activeVaultId)
        ) {
          epoch.current += 1;
          shown.current.clear();
          pending.current = [];
          resolving.current = false;
          updatePlan(null);
          setBusy(false);
          setResolutionError("");
          cancelConfirmation();
        }
        if (snapshot.state === "active") {
          const queued = pending.current.splice(0);
          for (const item of queued) {
            announce(item);
          }
        }
      }
    );

    let live = true;
    (async () => {
      try {
        const snapshot = await window.keyharbor.vault.sessionSnapshot();
        if (!live || snapshot.transitionId < transitionId.current) {
          return;
        }
        transitionId.current = snapshot.transitionId;
        session.current = snapshot;
        if (snapshot.state === "active") {
          const queued = pending.current.splice(0);
          for (const item of queued) {
            announce(item);
          }
        } else {
          pending.current = [];
        }
      } catch {
        pending.current = [];
      }
    })();

    const offFocus = window.keyharbor.onWindowFocusChanged((focused) => {
      const { current } = session;
      if (!focused || current?.state !== "active") {
        return;
      }
      const token = epoch.current;
      const { activeVaultId: vaultId } = current;
      (async () => {
        try {
          const result =
            await window.keyharbor.vault.reconcileExternalChange("focus");
          const latest = session.current;
          if (
            mounted.current &&
            token === epoch.current &&
            latest?.state === "active" &&
            latest.activeVaultId === vaultId
          ) {
            announce(result);
          }
        } catch (error: unknown) {
          const latest = session.current;
          if (
            mounted.current &&
            token === epoch.current &&
            latest?.state === "active" &&
            latest.activeVaultId === vaultId
          ) {
            notificationManager.error(
              error instanceof Error
                ? error.message
                : i18n.t("vault.reconciliation.failed")
            );
          }
        }
      })();
    });

    const onHide = () => {
      epoch.current += 1;
      session.current = null;
      pending.current = [];
      shown.current.clear();
      resolving.current = false;
      currentPlan.current = null;
      cancelConfirmation();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      live = false;
      mounted.current = false;
      epoch.current += 1;
      session.current = null;
      pending.current = [];
      resolving.current = false;
      currentPlan.current = null;
      offRequired();
      offState();
      offFocus();
      window.removeEventListener("pagehide", onHide);
      cancelConfirmation();
    };
  }, [cancelConfirmation, updatePlan]);

  const t = i18n.t.bind(i18n);

  const summarize = (keys: string[] | null | undefined) => {
    if (keys === null || keys === undefined) {
      return t("vault.merge.notConfigured");
    }
    if (!keys.length) {
      return t("vault.merge.noRequiredKeys");
    }
    const names = keys.slice(0, 8).join(", ");
    const remainder = keys.length - 8;
    const more =
      remainder > 0
        ? `, ${t("vault.merge.requiredKeysMore", { count: remainder })}`
        : "";
    return t("vault.merge.requiredKeysValue", {
      count: keys.length,
      keys: `${names}${more}`,
    });
  };

  const resolve = async (decision: "use_disk" | "keep_session") => {
    const activePlan = currentPlan.current;
    if (
      !activePlan?.allowedDecisions?.includes(decision) ||
      resolving.current
    ) {
      return;
    }

    resolving.current = true;
    const token = epoch.current;
    const planId = activePlan.reconciliationId;
    const vaultId = session.current?.activeVaultId;
    setBusy(true);
    setResolutionError("");

    const isSessionCurrent = () => {
      const latest = session.current;
      return (
        mounted.current &&
        token === epoch.current &&
        latest?.state === "active" &&
        latest.activeVaultId === vaultId
      );
    };
    const isCurrent = () =>
      isSessionCurrent() && currentPlan.current?.reconciliationId === planId;

    const finishResolution = () => {
      if (token !== epoch.current) {
        return;
      }
      resolving.current = false;
      if (mounted.current && token === epoch.current) {
        setBusy(false);
      }
    };

    const actionKeys =
      decision === "use_disk"
        ? {
            confirm: "vault.merge.confirmUseDisk",
            label: "vault.merge.useDisk",
          }
        : {
            confirm: "vault.merge.confirmKeepSession",
            label: "vault.merge.keepSession",
          };
    const accepted = await confirm({
      confirmLabel: t(actionKeys.label),
      description: t(actionKeys.confirm),
      title: t(actionKeys.label),
      variant: decision === "use_disk" ? "destructive" : "default",
    });

    // Session, vault, or plan changes while the confirmation is open invalidate this choice.
    if (!isCurrent() || !accepted) {
      finishResolution();
      return;
    }

    await runWithCleanup(
      async () => {
        try {
          const response: ReconciliationResponse =
            await window.keyharbor.vault.resolveReconciliation(
              planId,
              decision
            );
          if (!isCurrent()) {
            return;
          }
          requireSuccessfulResponse(
            response,
            i18n.t("vault.merge.mergeFailed", { error: "" })
          );

          const result = response.result || response;
          if (result.status === "superseded") {
            notificationManager.warning(i18n.t("vault.merge.superseded"));
            updatePlan(null);
            shown.current.delete(planId);
            (async () => {
              try {
                const fresh =
                  await window.keyharbor.vault.reconcileExternalChange("focus");
                const next = planFrom(fresh);
                if (
                  isSessionCurrent() &&
                  next &&
                  !shown.current.has(next.reconciliationId)
                ) {
                  shown.current.add(next.reconciliationId);
                  updatePlan(next);
                }
              } catch (error: unknown) {
                if (isSessionCurrent()) {
                  notificationManager.error(
                    error instanceof Error
                      ? error.message
                      : i18n.t("vault.reconciliation.failed")
                  );
                }
              }
            })();
          } else if (
            result.status === "resolved" ||
            result.status === "merged"
          ) {
            updatePlan(null);
            window.dispatchEvent(new Event("keyharbor:vault-data-synced"));
          } else {
            updatePlan(null);
          }
        } catch (error: unknown) {
          if (isCurrent()) {
            setResolutionError(
              error instanceof Error
                ? error.message
                : i18n.t("vault.merge.mergeFailed", { error: "" })
            );
          }
        }
      },
      () => {
        finishResolution();
      }
    );
  };

  return (
    <>
      {children}
      <Dialog
        open={Boolean(plan)}
        onOpenChange={() => {
          // A reconciliation plan requires an explicit resolution decision.
        }}
      >
        {plan && (
          <DialogContent
            ref={dialog}
            className="lk-ui-theme lk-vault-merge-dialog"
            closeLabel={t("common.close")}
            showCloseButton={false}
            overlayClassName="lk-vault-merge-overlay"
            tabIndex={-1}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              returnFocus.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
              dialog.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = returnFocus.current;
              if (
                session.current?.state === "active" &&
                target?.isConnected &&
                target.getClientRects().length &&
                !target.hasAttribute("disabled")
              ) {
                target.focus();
              }
            }}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <DialogHeader className="lk-vault-merge-header">
              <DialogTitle className="lk-vault-merge-title">
                {t("vault.merge.title")}
              </DialogTitle>
              <DialogDescription className="lk-vault-merge-intro lk-muted">
                {t(`vault.merge.reason.${plan.reason || "conflict"}`)}
              </DialogDescription>
            </DialogHeader>

            <div className="lk-vault-merge-table-scroll">
              <table className="lk-vault-merge-table">
                <thead>
                  <tr>
                    {[
                      "colProject",
                      "colEnvironment",
                      "colSecret",
                      "colSession",
                      "colDisk",
                    ].map((key) => (
                      <th key={key} scope="col">
                        {t(`vault.merge.${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(plan.conflicts || []).map((conflict, index) => {
                    const configuration =
                      conflict.kind === "configurationBaseline";
                    const sessionValue = configuration
                      ? summarize(conflict.sessionRequiredKeys)
                      : conflict.sessionPreview || "—";
                    const diskValue = configuration
                      ? summarize(conflict.diskRequiredKeys)
                      : conflict.diskPreview || "—";
                    const collision =
                      conflict.reason === "environment_name_collision";
                    const candidate = (
                      name: string | undefined,
                      id: string | undefined
                    ) =>
                      name
                        ? `${name}${id ? ` (${id.slice(0, 8)})` : ""}`
                        : t("vault.merge.defaultSelection");
                    let environment;
                    if (conflict.kind === "environment_default") {
                      environment = t("vault.merge.defaultCandidates", {
                        disk:
                          conflict.diskEnvironmentName ||
                          t("vault.merge.defaultSelection"),
                        session:
                          conflict.sessionEnvironmentName ||
                          t("vault.merge.defaultSelection"),
                      });
                    } else if (collision) {
                      environment = t("vault.merge.conflictCandidates", {
                        disk: candidate(
                          conflict.diskEnvironmentName,
                          conflict.diskEnvironmentId
                        ),
                        session: candidate(
                          conflict.sessionEnvironmentName,
                          conflict.sessionEnvironmentId
                        ),
                      });
                    } else {
                      environment =
                        conflict.environmentName ||
                        conflict.environmentId ||
                        t("vault.merge.projectLevel");
                    }
                    const detail = configuration
                      ? t("vault.merge.requiredKeysLabel")
                      : conflict.key || conflict.reason || "—";

                    return (
                      <tr
                        className="lk-vault-merge-row-conflict"
                        key={`${conflict.project || ""}:${environment}:${conflict.key || index}`}
                      >
                        <td>{conflict.project || "—"}</td>
                        <td>{environment}</td>
                        <td>{detail}</td>
                        <td>
                          <code>{sessionValue}</code>
                        </td>
                        <td>
                          <code>{diskValue}</code>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="lk-vault-merge-hint lk-muted">
              {t("vault.merge.explicitDecision")}
            </p>
            {resolutionError && (
              <p role="alert" className="lk-error lk-vault-merge-error">
                {resolutionError}
              </p>
            )}
            <DialogFooter className="lk-vault-merge-footer">
              {plan.allowedDecisions?.includes("use_disk") && (
                <Button
                  type="button"
                  variant="secondary"
                  className="lk-merge-use-disk"
                  disabled={busy}
                  onClick={() => resolve("use_disk")}
                >
                  {t("vault.merge.useDisk")}
                </Button>
              )}
              {plan.allowedDecisions?.includes("keep_session") && (
                <Button
                  type="button"
                  className="lk-merge-keep-session"
                  disabled={busy}
                  onClick={() => resolve("keep_session")}
                >
                  {t("vault.merge.keepSession")}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      {confirmationDialog}
    </>
  );
};
