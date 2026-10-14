// The renderer's only door to the Electron main process (exposed by electron/preload.cjs).
// Features import `api` from here instead of reading window.morph themselves.
export const api = window.morph;
