import { useRef, useState } from "react";

import type { FolderScanSummary, ReviewTarget } from "./bridge";
import type { ConfigDraft, ImportRow, ImportReveal } from "./components";

export const useConfigurationReviewState = () => {
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const handle = useRef<string | null>(null);
  const pending = useRef(false);
  const epoch = useRef(0);

  return { draft, epoch, handle, pending, setDraft };
};

export const useImportReviewState = () => {
  const [source, setSource] = useState<"text" | "file" | "folder">("text");
  const [folderScan, setFolderScan] = useState<FolderScanSummary | null>(null);
  const folderScanRef = useRef<string | null>(null);
  const [folderEnvironmentId, setFolderEnvironmentId] = useState("");
  const [folderFileId, setFolderFileId] = useState<string | null>(null);
  const [reviewedFileIds, setReviewedFileIds] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
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
    fileContent,
    fileName,
    folderEnvironmentId,
    folderFileId,
    folderScan,
    folderScanRef,
    handle,
    handleRef,
    pending,
    revealEpoch,
    reveals,
    reviewedFileIds,
    rows,
    setBusy,
    setCommitting,
    setDiagnostics,
    setFileContent,
    setFileName,
    setFolderEnvironmentId,
    setFolderFileId,
    setFolderScan,
    setHandle,
    setReveals,
    setReviewedFileIds,
    setRows,
    setSource,
    setTarget,
    setText,
    source,
    target,
    text,
  };
};
