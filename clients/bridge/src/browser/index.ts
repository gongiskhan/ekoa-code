export {
  ProfileManager,
  ProfileError,
  BrowserUnavailableError,
  BROWSER_INSTALL_COMMAND,
  isMissingBrowserBinary,
  parseSessionState,
  sanitizeProfileId,
  WEBDRIVER_INIT_SCRIPT,
  type ProfileLease,
  type ProfileManagerDeps,
  type ProfileSession,
} from './profile.js';
export {
  launchHeadedRealChrome,
  sweepSingletonMarkers,
  type HeadedChromeContext,
  type HeadedChromePage,
  type PersistentContextLauncher,
} from './chrome-launch.js';
export {
  runBrowserAction,
  observePage,
  resolveLocator,
  describeStepFailure,
  BrowserStepError,
  type PageObservation,
} from './executor.js';
export {
  NetworkRecorder,
  MAX_CAPTURE_BODY_CHARS,
  MAX_BUFFERED_EXCHANGES,
  originOf,
  type CapturePage,
  type CaptureRequest,
  type CaptureResponse,
  type NetworkRecorderDeps,
} from './capture.js';
export {
  runInjectedCall,
  forwardableHeaderNames,
  InjectedCallError,
  MAX_INJECTED_BODY_CHARS,
} from './inject.js';
export type {
  PersistentLauncher,
  PersistentLaunchOptions,
  ProfileContext,
  ProfileCookie,
  ProfileLocator,
  ProfilePage,
} from './types.js';
