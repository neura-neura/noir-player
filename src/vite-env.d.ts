/// <reference types="vite/client" />

declare module 'jschardet' {
  export type DetectResult = {
    encoding?: string;
    confidence?: number;
  };

  export function detect(buffer: Uint8Array | ArrayBuffer | string): DetectResult;
}

declare module 'hls.js/light' {
  import Hls from 'hls.js';

  export default Hls;
}
