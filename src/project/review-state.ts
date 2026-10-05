import { useRef, useState } from "react";

import type { ReviewTarget } from "./bridge";
import type { ConfigDraft, ImportRow, ImportReveal } from "./components";

export const useConfigurationReviewState = () => {
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const handle = useRef<string | null>(null);
  const pending = useRef(false);
  const epoch = useRef(0);

  return { draft, epoch, handle, pending, setDraft };
};

export const useImportReviewState = () => {
  const [source, setSource] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [handle, setHandle] = useState<string | null>(null);
  const [target, setTarget] = useState<ReviewTarget | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [reveals, setReveals] = useState<Record<string, ImportReveal>>({});
  const handleRef = useRef<string | null>(null);
  const pending = useRef(false);
  const epoch = useRef(0);
  const revealEpoch = useRef(0);

  return {
    busy,
    committing,
    diagnostics,
    epoch,
    handle,
    handleRef,
    pending,
    revealEpoch,
    reveals,
    rows,
    setBusy,
    setCommitting,
    setDiagnostics,
    setHandle,
    setReveals,
    setRows,
    setSource,
    setTarget,
    setText,
    source,
    target,
    text,
  };
};
