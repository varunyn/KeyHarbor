import * as React from "react";
import { useEffect, useRef } from "react";

import { i18n } from "../i18n";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { cn } from "./utils";

export interface ModalCloseButtonProps {
  onClose: () => void;
  label?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

export const ModalCloseButton = ({
  onClose,
  label = "common.cancel",
  id,
  className,
  disabled,
}: ModalCloseButtonProps) => (
  <Button
    variant="secondary"
    type="button"
    id={id}
    data-close
    disabled={disabled}
    className={className}
    onClick={onClose}
  >
    {i18n.t(label)}
  </Button>
);

export const ModalTitle = ({
  children,
  className,
  id,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogTitle>) => (
  <DialogTitle
    id={id}
    className={cn(
      "text-foreground text-base font-semibold tracking-tight",
      className
    )}
    {...props}
  >
    {children}
  </DialogTitle>
);

export const ModalDescription = ({
  children,
  className,
  id,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogDescription>) => (
  <DialogDescription
    id={id}
    className={cn("text-muted-foreground mt-1 text-xs", className)}
    {...props}
  >
    {children}
  </DialogDescription>
);

export const ModalFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <DialogFooter
    className={cn(
      "border-border mt-6 flex justify-end gap-2 border-t pt-4",
      className
    )}
    {...props}
  />
);

export interface ModalDialogProps {
  id?: string;
  open?: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleId?: string;
  titleClassName?: string;
  description?: React.ReactNode;
  descriptionId?: string;
  descriptionClassName?: string;
  headerContent?: React.ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  initialFocusId?: string;
  initialFocusSelector?: string;
  fallbackReturnFocusSelector?: string;
  className?: string;
  overlayClassName?: string;
  closeLabel?: string;
  showCloseButton?: boolean;
  contentRef?: React.RefObject<HTMLDivElement | null>;
  ariaDescribedBy?: string;
}

export const ModalDialog = ({
  id,
  open = true,
  onClose,
  title,
  titleId,
  titleClassName,
  description,
  descriptionId,
  descriptionClassName,
  headerContent,
  headerClassName,
  bodyClassName,
  children,
  footer,
  initialFocusId,
  initialFocusSelector,
  fallbackReturnFocusSelector,
  className,
  overlayClassName,
  closeLabel,
  showCloseButton = false,
  contentRef,
  ariaDescribedBy,
}: ModalDialogProps) => {
  const internalRef = useRef<HTMLDivElement>(null);
  const ref = contentRef ?? internalRef;
  const priorFocus = useRef<HTMLElement | null>(null);
  const previousInitialFocusId = useRef(initialFocusId);

  useEffect(() => {
    if (previousInitialFocusId.current === initialFocusId || !initialFocusId) {
      return;
    }
    previousInitialFocusId.current = initialFocusId;
    ref.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(initialFocusId)}`)
      ?.focus();
  }, [initialFocusId, ref]);

  const resolvedCloseLabel = closeLabel ?? i18n.t("common.close");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        ref={ref}
        id={id}
        className={cn("lk-ui-theme lk-form-dialog text-foreground", className)}
        closeLabel={resolvedCloseLabel}
        showCloseButton={showCloseButton}
        overlayClassName={overlayClassName}
        aria-describedby={ariaDescribedBy}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          priorFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;

          const selector = initialFocusId
            ? `#${CSS.escape(initialFocusId)}`
            : initialFocusSelector;

          const target = selector
            ? ref.current?.querySelector<HTMLElement>(selector)
            : ref.current?.querySelector<HTMLElement>(
                "input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not([data-close]):not(:disabled)"
              );
          target?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = priorFocus.current;
          if (
            target?.isConnected &&
            target.getClientRects().length > 0 &&
            !target.hasAttribute("disabled")
          ) {
            target.focus();
            return;
          }
          if (fallbackReturnFocusSelector) {
            const opener = target
              ?.closest(".dropdown")
              ?.querySelector<HTMLElement>("button");
            const fallback = opener?.getClientRects().length
              ? opener
              : document.querySelector<HTMLElement>(
                  fallbackReturnFocusSelector
                );
            fallback?.focus();
          }
        }}
      >
        {(title !== undefined ||
          description !== undefined ||
          headerContent !== undefined) && (
          <DialogHeader
            className={cn("lk-form-dialog-header", headerClassName)}
          >
            {title !== undefined && (
              <DialogTitle
                data-title-id={titleId}
                className={cn(
                  "modal-title text-foreground text-base font-semibold tracking-tight",
                  titleClassName
                )}
              >
                {title}
              </DialogTitle>
            )}
            {description !== undefined && (
              <DialogDescription
                id={descriptionId}
                className={cn(
                  "text-muted-foreground mt-1 text-xs",
                  descriptionClassName
                )}
              >
                {description}
              </DialogDescription>
            )}
            {headerContent}
          </DialogHeader>
        )}
        {bodyClassName ? (
          <div className={bodyClassName}>{children}</div>
        ) : (
          children
        )}
        {footer}
      </DialogContent>
    </Dialog>
  );
};
