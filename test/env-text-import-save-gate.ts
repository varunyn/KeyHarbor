export interface EnvTextImportSaveGate {
  block: Promise<void>;
  started: () => void;
}

export interface EnvTextImportSaveGateState {
  current: EnvTextImportSaveGate | null;
}
