import fs from 'node:fs';
import path from 'node:path';
import type { FileAttachment } from '../types.js';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.ts': 'text/plain',
  '.js': 'text/plain',
  '.py': 'text/plain',
  '.sh': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css'
};

const BINARY_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf']);
const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024; // 15MB

export function loadAttachment(filePath: string): FileAttachment {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Attached file does not exist: ${filePath}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Attachment target is not a file: ${filePath}`);
  }

  if (stat.size > MAX_ATTACHMENT_SIZE) {
    throw new Error(`Attachment file too large: ${filePath} (${(stat.size / (1024 * 1024)).toFixed(1)}MB, max 15MB)`);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeType = MIME_MAP[ext] || 'application/octet-stream';
  const name = path.basename(resolved);

  if (BINARY_IMAGE_EXTS.has(ext)) {
    const buffer = fs.readFileSync(resolved);
    return {
      path: resolved,
      name,
      mimeType,
      size: stat.size,
      base64Data: buffer.toString('base64')
    };
  }

  // Treat as text
  const textContent = fs.readFileSync(resolved, 'utf8');
  return {
    path: resolved,
    name,
    mimeType: mimeType.startsWith('text/') ? mimeType : 'text/plain',
    size: stat.size,
    textContent
  };
}

export function loadAttachments(filePaths?: string[]): FileAttachment[] {
  if (!filePaths || filePaths.length === 0) return [];
  return filePaths.map(p => loadAttachment(p));
}
