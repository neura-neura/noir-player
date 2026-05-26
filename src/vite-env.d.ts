/// <reference types="vite/client" />

declare module 'jschardet' {
  export type DetectResult = {
    encoding?: string;
    confidence?: number;
  };

  export function detect(buffer: Uint8Array | ArrayBuffer): DetectResult;
}
