import type {
  BridgeResult,
  EnvironmentTarget,
  ImportPreviewResult,
} from "./bridge";

export interface FolderScanFile {
  id: string;
  path: string;
  keyCount: number;
  gitStatus: "ignored" | "tracked" | "unignored" | "unknown";
  missingKeys: string[] | null;
  templatePath: string | null;
  valid: boolean;
  suggestedEnvironment: string | null;
}

export interface FolderScanSummary {
  scanId: string;
  remainingProjects?: number;
  folderName: string;
  files: FolderScanFile[];
  templates: string[];
  warnings: {
    path: string;
    code: "unreadable" | "symlink" | "invalidTemplate";
  }[];
  limited: boolean;
}

export interface FolderImportChoice {
  id: string;
  path: string;
  suggestedName: string;
  fileCount: number;
}

export interface FolderDiscovery {
  folders: FolderImportChoice[];
  limited: boolean;
}

export interface FolderImportSelection {
  choiceId: string;
  target: EnvironmentTarget;
}

export interface FolderImportBridge {
  importFolderDiscover: (
    folder: File
  ) => Promise<BridgeResult<{ discovery: FolderDiscovery }>>;
  importFolderStageChoice: (
    target: EnvironmentTarget,
    choiceId: string
  ) => Promise<BridgeResult>;
  importFolderScan: (
    target: EnvironmentTarget,
    folder?: File
  ) => Promise<BridgeResult<{ scan: FolderScanSummary }>>;
  importFolderStage: (
    target: EnvironmentTarget,
    folder: File
  ) => Promise<BridgeResult>;
  importFolderResume: (
    target: EnvironmentTarget
  ) => Promise<BridgeResult<{ scan: FolderScanSummary }>>;
  importFolderPreview: (
    target: EnvironmentTarget,
    scanId: string,
    fileId: string
  ) => Promise<ImportPreviewResult>;
  importFolderStageChoices: (
    selections: FolderImportSelection[]
  ) => Promise<BridgeResult>;
  importFolderNext: (
    scanId: string
  ) => Promise<BridgeResult<{ target: EnvironmentTarget }>>;
}
