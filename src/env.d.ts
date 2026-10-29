/// <reference types="vite/client" />
declare const __APP_BUILD__: string;

interface Window {
  __ledgerStartup?: {
    mark: (type: string, detail?: Record<string, unknown>) => void;
    ready: () => void;
    fail: (name: string) => void;
  };
}
