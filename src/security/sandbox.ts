import path from 'node:path';
import fs from 'node:fs';
import { isSecretFile } from './secrets.js';

export interface PathValidationResult {
  allowed: boolean;
  resolvedPath: string;
  relativePath: string;
  reason?: string;
}

const isWindows = process.platform === 'win32';

/**
 * Normalizes a path for consistent cross-platform comparison
 */
function normalizeForComparison(p: string): string {
  const resolved = path.resolve(p);
  return isWindows ? resolved.toLowerCase() : resolved;
}

/**
 * Checks if target path is safely contained within parent directory
 */
function isContainedWithin(parent: string, target: string): boolean {
  const normParent = normalizeForComparison(parent);
  const normTarget = normalizeForComparison(target);

  const rel = path.relative(normParent, normTarget);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function validateWorkspacePath(
  targetPath: string,
  workspaceDir: string,
  allowedExternalPaths: string[] = []
): PathValidationResult {
  if (!targetPath || typeof targetPath !== 'string') {
    return {
      allowed: false,
      resolvedPath: '',
      relativePath: '',
      reason: 'Empty or invalid file path provided.'
    };
  }

  // Canonicalize workspace directory
  let normalizedWorkspace = path.resolve(workspaceDir);
  try {
    if (fs.existsSync(normalizedWorkspace)) {
      normalizedWorkspace = fs.realpathSync(normalizedWorkspace);
    }
  } catch {
    // Fall back to resolved path if realpath fails
  }

  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(normalizedWorkspace, targetPath);

  // Check if explicitly allowed (e.g. user-attached files)
  const isExplicitlyAllowed = allowedExternalPaths.some(p => {
    const normAllowed = normalizeForComparison(p);
    const normTarget = normalizeForComparison(resolvedTarget);
    return normAllowed === normTarget;
  });

  if (isExplicitlyAllowed) {
    return {
      allowed: true,
      resolvedPath: resolvedTarget,
      relativePath: path.relative(normalizedWorkspace, resolvedTarget) || path.basename(resolvedTarget)
    };
  }

  // Prevent path traversal outside workspace
  if (!isContainedWithin(normalizedWorkspace, resolvedTarget)) {
    return {
      allowed: false,
      resolvedPath: resolvedTarget,
      relativePath: path.relative(normalizedWorkspace, resolvedTarget),
      reason: `Path '${targetPath}' is outside the authorized workspace: ${normalizedWorkspace}`
    };
  }

  // Check symlinks if path exists
  try {
    if (fs.existsSync(resolvedTarget)) {
      const realTarget = fs.realpathSync(resolvedTarget);
      if (!isContainedWithin(normalizedWorkspace, realTarget)) {
        return {
          allowed: false,
          resolvedPath: realTarget,
          relativePath: path.relative(normalizedWorkspace, realTarget),
          reason: `Symlink target points outside the workspace: ${realTarget}`
        };
      }
    }
  } catch {
    // If realpath check cannot be resolved, safe to continue if resolvedTarget was inside
  }

  // Secret file check
  if (isSecretFile(resolvedTarget)) {
    return {
      allowed: false,
      resolvedPath: resolvedTarget,
      relativePath: path.relative(normalizedWorkspace, resolvedTarget),
      reason: `Access to secret or credential file '${path.basename(resolvedTarget)}' is blocked for security.`
    };
  }

  return {
    allowed: true,
    resolvedPath: resolvedTarget,
    relativePath: path.relative(normalizedWorkspace, resolvedTarget) || '.'
  };
}
