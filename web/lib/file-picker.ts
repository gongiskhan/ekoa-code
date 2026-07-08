/**
 * Shared file/folder picker utility.
 *
 * Browser file input -> upload to Cortex staging endpoint -> returns absolute path.
 * The agent always receives absolute filesystem paths and uses Read/Glob tools to access them.
 */

import type { FileAttachment } from '@/types/attachment';
import { api } from '@/lib/api';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// -- Staging upload (browser fallback) --

async function stageFile(file: File, folder?: string): Promise<{ path: string; displayName: string; size: number; folderRoot?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-Filename': file.name,
  };
  if (folder) headers['X-Folder'] = folder;

  const buffer = await file.arrayBuffer();
  // The uploads endpoint stages the file (auth + base URL handled by the request
  // core) and returns an opaque uploadId, the attachment's reference in the new model.
  const res = await api.uploads.create({}, { rawBody: buffer, headers });
  return { path: res.uploadId, displayName: res.displayName, size: res.size, folderRoot: res.folderRoot };
}

/** Recursively collect files from a FileSystemDirectoryHandle */
async function collectDirFiles(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string = '',
): Promise<Array<{ file: File; relativePath: string }>> {
  const results: Array<{ file: File; relativePath: string }> = [];
  for await (const [name, handle] of dirHandle as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    const path = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      results.push({ file, relativePath: path });
    } else if (handle.kind === 'directory') {
      const subFiles = await collectDirFiles(handle as FileSystemDirectoryHandle, path);
      results.push(...subFiles);
    }
  }
  return results;
}

// -- Hidden file input helpers --

function createFileInput(multiple: boolean, directory: boolean): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  if (multiple) input.multiple = true;
  if (directory) {
    input.setAttribute('webkitdirectory', '');
  }
  document.body.appendChild(input);
  return input;
}

function waitForFiles(input: HTMLInputElement): Promise<FileList | null> {
  return new Promise((resolve) => {
    input.addEventListener('change', () => {
      resolve(input.files);
      input.remove();
    }, { once: true });
    // Handle cancel (focus returns to window without change)
    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) {
          resolve(null);
          input.remove();
        }
      }, 500);
    }, { once: true });
    input.click();
  });
}

// -- Public API --

export async function pickFiles(): Promise<FileAttachment[]> {
  const input = createFileInput(true, false);
  const files = await waitForFiles(input);
  if (!files || files.length === 0) return [];

  const results: FileAttachment[] = [];
  for (const file of Array.from(files)) {
    try {
      const staged = await stageFile(file);
      results.push({
        attachmentId: makeId('file'),
        displayName: staged.displayName,
        path: staged.path,
        type: 'file',
        size: staged.size,
      });
    } catch (err) {
      console.error(`[file-picker] Failed to stage ${file.name}:`, err);
    }
  }
  return results;
}

/**
 * Capture a single frame from the user's screen via getDisplayMedia.
 * Returns null if the user cancels or the API is unavailable.
 * The captured frame is uploaded as a PNG and surfaces as a regular file attachment.
 */
export async function captureScreen(): Promise<FileAttachment | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    console.warn('[file-picker] getDisplayMedia not available in this browser');
    return null;
  }

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    return null;
  }

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // One frame is enough; wait for metadata to ensure dimensions are populated.
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) resolve();
      else video.onloadedmetadata = () => resolve();
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;

    const filename = `screenshot-${Date.now()}.png`;
    const file = new File([blob], filename, { type: 'image/png' });
    const staged = await stageFile(file);
    return {
      attachmentId: makeId('screenshot'),
      displayName: staged.displayName,
      path: staged.path,
      type: 'file',
      size: staged.size,
    };
  } catch (err) {
    console.error('[file-picker] captureScreen failed:', err);
    return null;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/**
 * Wrap a URL as a FileAttachment chip. The `path` field carries the URL itself;
 * on send, the chat page strips these and appends them to the message body so
 * the agent can fetch them with WebFetch.
 */
export function makeUrlAttachment(url: string): FileAttachment {
  return {
    attachmentId: makeId('url'),
    displayName: url,
    path: url,
    type: 'url',
  };
}

export async function pickFolder(): Promise<FileAttachment | null> {
  // Browser: use showDirectoryPicker for a clean native folder dialog,
  // then stage the folder contents to disk so the agent can access them by path.
  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
      const folderName = `${makeId('dir')}-${dirHandle.name}`;

      // Collect and stage all files preserving directory structure
      const files = await collectDirFiles(dirHandle);
      let folderRoot = '';

      for (const { file, relativePath } of files) {
        try {
          const staged = await stageFile(
            new File([await file.arrayBuffer()], relativePath, { type: file.type }),
            folderName,
          );
          if (!folderRoot && staged.folderRoot) folderRoot = staged.folderRoot;
        } catch (err) {
          console.error(`[file-picker] Failed to stage ${relativePath}:`, err);
        }
      }

      if (!folderRoot) return null;

      return {
        attachmentId: makeId('folder'),
        displayName: dirHandle.name,
        path: folderRoot,
        type: 'folder',
      };
    } catch {
      // User cancelled the picker
      return null;
    }
  }

  // Browsers without File System Access API cannot pick folders
  console.warn('[file-picker] Folder selection is not supported in this browser. Use a Chromium-based browser (Chrome, Edge) for folder uploads.');
  return null;
}
