import type { ApprovalRequest, KeyHarborBridge } from "./bridge";

declare global {
  interface Window {
    keyharbor: KeyHarborBridge;
    platform: string;
    isDev: boolean;
    electronAPI: {
      sendApprovalResponse: (approved: boolean, channel: string) => void;
      onApprovalData: (callback: (data: ApprovalRequest) => void) => () => void;
    };
  }
}
