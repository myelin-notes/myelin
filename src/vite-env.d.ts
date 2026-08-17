/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// Injected by vite.config.ts via `define`. True for iOS and Android builds (and
// when VITE_TABLET_LAYOUT=true), selecting the full-page mobile library layout.
declare const __MOBILE_BUILD__: boolean;
