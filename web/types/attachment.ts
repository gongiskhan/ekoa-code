/**
 * UI-local composer attachment chip (ch12: live types re-homed off the deleted legacy
 * client). Distinct from the wire `UploadRef` in `@ekoa/shared`: this is the in-composer
 * representation of a picked file / folder / URL before it becomes an upload reference.
 */
export interface FileAttachment {
  attachmentId: string;
  displayName: string;
  path: string;
  type: 'file' | 'folder' | 'url';
  size?: number;
}
