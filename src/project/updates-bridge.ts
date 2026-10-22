export interface UpdateCheckResult {
  success: boolean;
  newVersion: string | null;
  currentVersion: string;
  error?: string;
}

export interface UpdatesBridge {
  checkNow: () => Promise<UpdateCheckResult>;
}
