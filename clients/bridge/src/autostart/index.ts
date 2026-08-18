/**
 * autostart/index.ts — barrel for the reboot-survival registration (launchd LaunchAgent on macOS,
 * systemd user unit on Linux). See autostart.ts for why it is per-user and Aqua-bound.
 */
export {
  enableAutostart,
  disableAutostart,
  autostartStatus,
  launchdPlist,
  systemdUnit,
  registrationPath,
  AutostartError,
  AUTOSTART_LABEL,
  SYSTEMD_UNIT,
  type AutostartDeps,
  type AutostartStatus,
} from './autostart.js';
