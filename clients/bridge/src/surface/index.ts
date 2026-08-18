export { startLocalSurface, DEFAULT_SURFACE_PORT, DEFAULT_SURFACE_ORIGINS } from './local-server.js';
export type { LocalSurfaceStatus, LocalSurfaceDeps, LocalSurfaceHandle } from './local-server.js';
export { browseDirectory, defaultBrowseRoots } from './browse.js';
export type { BrowseEntry, BrowseResult, BrowseOutcome } from './browse.js';
export { createBrowserGrant, listBrowserGrants, revokeBrowserGrant } from './browser-grants.js';
export type { BrowserGrantsDeps, CreateGrantInput, CreateGrantOutcome } from './browser-grants.js';
