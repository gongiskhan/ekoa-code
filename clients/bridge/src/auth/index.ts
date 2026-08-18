/**
 * auth/index.ts — barrel for the pairing/credential surface: home resolution, the credential store,
 * device login, and bridge-token mint/refresh. The CLI and transport wire against this surface only.
 */
export { ekoaBridgeHome, ensureHome } from './home.js';
export {
  BridgeConfig,
  PlatformCredentials,
  StoredUser,
  CredentialsError,
  configPath,
  loadConfig,
  saveConfig,
  isExpired,
} from './credentials.js';
export {
  DeviceLoginError,
  runDeviceLogin,
  decodeJwtExpiryMs,
  type DeviceLoginOptions,
  type DeviceLoginReason,
  type FetchLike,
} from './device-login.js';
export {
  BridgeTokenError,
  createBridgeTokenProvider,
  mintBridgeToken,
  refreshPlatformToken,
  type BridgeTokenDeps,
  type BridgeTokenMint,
  type BridgeTokenProvider,
  type BridgeTokenReason,
} from './bridge-token.js';
export { StoredGrant, grantsPath, loadGrants, saveGrants, addGrant, removeGrant } from './grants-store.js';
