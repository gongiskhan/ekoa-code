export {
  ProfileManager,
  ProfileError,
  parseSessionState,
  sanitizeProfileId,
  WEBDRIVER_INIT_SCRIPT,
  type ProfileLease,
  type ProfileManagerDeps,
  type ProfileSession,
} from './profile.js';
export {
  runBrowserAction,
  observePage,
  resolveLocator,
  describeStepFailure,
  BrowserStepError,
  type PageObservation,
} from './executor.js';
export type {
  PersistentLauncher,
  PersistentLaunchOptions,
  ProfileContext,
  ProfileCookie,
  ProfileLocator,
  ProfilePage,
} from './types.js';
