import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

interface Notice {
  message: string;
  detail?: string;
  type: "success" | "error" | "warning";
}
let publish: ((notice: Notice) => void) | null = null;
export const notificationManager = {
  error(message: string) {
    this.show(message, "error");
  },
  show(message: string, type = "info", detail?: string) {
    publish?.({
      detail,
      message: String(message),
      type: type === "error" || type === "warning" ? type : "success",
    });
  },
  success(message: string) {
    this.show(message, "success");
  },
  warning(message: string) {
    this.show(message, "warning");
  },
};
const NoticeContext = createContext<(notice: Notice) => void>(() => {
  // Notifications are ignored until a viewport is mounted.
});
export const NotificationViewport = ({ children }: { children: ReactNode }) => {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timeout = useRef<number | null>(null);
  const push = useCallback((next: Notice) => {
    if (timeout.current) {
      window.clearTimeout(timeout.current);
    }
    setNotice(next);
    timeout.current = window.setTimeout(() => setNotice(null), 10_000);
  }, []);
  useEffect(() => {
    publish = push;
    return () => {
      if (publish === push) {
        publish = null;
      }
      if (timeout.current) {
        window.clearTimeout(timeout.current);
      }
    };
  }, [push]);
  const icon = notice
    ? { error: "x", success: "check", warning: "circle-alert" }[notice.type]
    : "check";
  return (
    <NoticeContext.Provider value={push}>
      {children}
      {notice && (
        <div
          className={`message message-${notice.type} show`}
          role={notice.type === "error" ? "alert" : "status"}
        >
          <div className="message-content">
            <div className="message-header">
              <div className="message-left">
                <div className="message-icon">
                  <span
                    className={`lk-icon lk-icon-${icon}`}
                    aria-hidden="true"
                  />
                </div>
                <div className="message-text">
                  {notice.message}
                  {notice.detail && (
                    <div className="message-detail">{notice.detail}</div>
                  )}
                </div>
              </div>
            </div>
            <button
              className="message-close"
              type="button"
              aria-label="Close"
              onClick={() => {
                if (timeout.current) {
                  window.clearTimeout(timeout.current);
                }
                setNotice(null);
              }}
            >
              <span className="lk-icon lk-icon-x" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </NoticeContext.Provider>
  );
};
export const useNotifications = () => useContext(NoticeContext);
