/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// Injected by vite.config.ts via `define`. True for iOS builds (and when
// VITE_TABLET_LAYOUT=true), selecting the tablet full-page library layout.
declare const __TABLET_BUILD__: boolean;
