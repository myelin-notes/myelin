/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

declare module 'react-devtools-core' {
  export function connectToDevTools(options?: {
    host?: string;
    port?: number;
    useHttps?: boolean;
    resolveRNStyle?: (style: number) => unknown;
    isAppActive?: () => boolean;
    websocket?: WebSocket;
  }): void;
}
