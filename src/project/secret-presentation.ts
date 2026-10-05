import { i18n } from "../renderer/i18n";
import type { SecretRecord } from "./bridge";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
export interface Entry {
  key: string;
  secret: SecretRecord;
  type: "secret" | "config";
  status: Status;
}
export type Status = "config" | "expired" | "rotate" | "healthy";
const SECRET_NAME =
  /(?:secret|token|passwd|password|private|credential|passphrase|(?:[^a-z]|^)(?:auth|session|salt|key)(?:[^a-z]|$))/iu;
const PLAIN_URL = /^https?:\/\/\S+$/iu;
const PLAIN_SCALAR = /^(?:true|false|yes|no|on|off|\d+(?:\.\d+)?)$/iu;
const ROTATE_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;
export const mask = (value: unknown) => {
  const text = String(value ?? "");
  return text.length <= 4 ? "••••" : `••••••••${text.slice(-4)}`;
};
export const deriveType = (
  key: string,
  value: unknown
): "secret" | "config" => {
  if (SECRET_NAME.test(key)) {
    return "secret";
  }
  const text = String(value ?? "").trim();
  return (PLAIN_URL.test(text) && !text.includes("@")) ||
    PLAIN_SCALAR.test(text)
    ? "config"
    : "secret";
};
export const statusFor = (
  entry: SecretRecord,
  type: "secret" | "config",
  now = Date.now()
): Status => {
  if (type === "config") {
    return "config";
  }
  if (entry.expiresAt) {
    const expiry = Date.parse(entry.expiresAt);
    if (Number.isFinite(expiry)) {
      if (expiry < now) {
        return "expired";
      }
      if (expiry - now <= EXPIRING_SOON_MS) {
        return "rotate";
      }
    }
  }
  const updated = Date.parse(entry.updatedAt || entry.createdAt || "");
  return Number.isFinite(updated) &&
    updated > 0 &&
    now - updated > ROTATE_AGE_MS
    ? "rotate"
    : "healthy";
};
export const relative = (value?: string | null) => {
  if (!value) {
    return "—";
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return "—";
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return t("project.time.justNow");
  }
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) {
    return t("project.time.ago", {
      time: t("project.time.minute", { count: mins }),
    });
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return t("project.time.ago", {
      time: t("project.time.hour", { count: hours }),
    });
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return t("project.time.ago", {
      time: t("project.time.day", { count: days }),
    });
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return t("project.time.ago", {
      time: t("project.time.week", { count: weeks }),
    });
  }
  return t("project.time.ago", {
    time: t("project.time.month", { count: Math.floor(days / 30) }),
  });
};
