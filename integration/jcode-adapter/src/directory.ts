import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, sep } from 'node:path';

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: 'directory' | 'symlink';
  hidden: boolean;
  readable: boolean;
}

export interface DirectoryListing {
  canonicalPath: string;
  parent: string | null;
  entries: DirectoryEntry[];
  cursor: string | null;
  roots: string[];
}

/**
 * Read-only canonical listing inside configured roots. No shell, no recursive
 * preload, no path escape. A symlink outside a root is visible but unreadable.
 */
export async function listDirectories(
  workspaceRoots: string[],
  requestedPath: string,
  showHidden: boolean,
  cursor: number,
  limit: number,
): Promise<{ ok: true; listing: DirectoryListing } | { ok: false; error: string }> {
  const roots: string[] = [];
  for (const root of workspaceRoots) {
    try {
      roots.push(await realpath(root));
    } catch {
      // A configured root that does not exist is omitted, not invented.
    }
  }
  if (roots.length === 0) {
    return { ok: false, error: 'No permitted workspace roots are configured on this server.' };
  }
  const inside = (candidate: string) =>
    roots.some((root) => candidate === root || candidate.startsWith(`${root}${sep}`));
  const requested = (requestedPath || roots[0]).trim();
  if (!isAbsolute(requested) || requested.includes('\u0000')) {
    return { ok: false, error: 'Enter an absolute folder path on the server.' };
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(requested);
  } catch {
    return { ok: false, error: `The folder ${requested} does not exist on the server.` };
  }
  if (!inside(canonicalPath)) {
    return { ok: false, error: 'That path is outside the permitted workspace roots.' };
  }
  const info = await stat(canonicalPath).catch(() => null);
  if (!info) return { ok: false, error: `The folder ${requested} could not be read.` };
  if (!info.isDirectory()) return { ok: false, error: `${requested} is a file, not a folder.` };

  let dirents;
  try {
    dirents = await readdir(canonicalPath, { withFileTypes: true });
  } catch {
    return { ok: false, error: `Permission denied reading ${canonicalPath}.` };
  }
  const entries: DirectoryEntry[] = [];
  if (limit > 0) {
    for (const dirent of dirents) {
      const hidden = dirent.name.startsWith('.');
      if (hidden && !showHidden) continue;
      const entryPath = join(canonicalPath, dirent.name);
      if (dirent.isDirectory()) {
        entries.push({ name: dirent.name, path: entryPath, kind: 'directory', hidden, readable: true });
        continue;
      }
      if (dirent.isSymbolicLink()) {
        const target = await realpath(entryPath).catch(() => null);
        const readable = target !== null && inside(target);
        if (target) {
          const targetInfo = await stat(target).catch(() => null);
          if (!targetInfo?.isDirectory()) continue;
        }
        entries.push({ name: dirent.name, path: entryPath, kind: 'symlink', hidden, readable });
      }
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const page = entries.slice(cursor, cursor + Math.max(limit, 0));
  const next = cursor + page.length < entries.length ? String(cursor + page.length) : null;
  const parentCandidate = dirname(canonicalPath);
  const parent =
    parentCandidate !== canonicalPath && inside(parentCandidate) ? parentCandidate : null;
  return {
    ok: true,
    listing: {
      canonicalPath,
      parent,
      entries: limit > 0 ? page : [],
      cursor: next,
      roots,
    },
  };
}

/**
 * Create one directory inside an existing permitted folder. No recursion, no
 * shell, no traversal, and the created path is canonicalized and rechecked.
 */
export async function createDirectory(
  workspaceRoots: string[],
  parentPath: string,
  name: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const roots: string[] = [];
  for (const root of workspaceRoots) {
    try {
      roots.push(await realpath(root));
    } catch {
      // Omitted, never invented.
    }
  }
  if (roots.length === 0) {
    return { ok: false, error: 'No permitted workspace roots are configured on this server.' };
  }
  const inside = (candidate: string) =>
    roots.some((root) => candidate === root || candidate.startsWith(`${root}${sep}`));
  const trimmedName = name.trim();
  if (
    !trimmedName ||
    trimmedName === '.' ||
    trimmedName === '..' ||
    trimmedName.length > 255 ||
    /[/\\\u0000]/.test(trimmedName)
  ) {
    return { ok: false, error: 'Enter a single folder name, not a path.' };
  }
  const requestedParent = parentPath.trim();
  if (!isAbsolute(requestedParent) || requestedParent.includes('\u0000')) {
    return { ok: false, error: 'Choose an absolute parent folder first.' };
  }
  let parent: string;
  try {
    parent = await realpath(requestedParent);
  } catch {
    return { ok: false, error: `The folder ${requestedParent} does not exist on the server.` };
  }
  if (!inside(parent)) {
    return { ok: false, error: 'That path is outside the permitted workspace roots.' };
  }
  const info = await stat(parent).catch(() => null);
  if (!info?.isDirectory()) return { ok: false, error: `${parent} is not a folder.` };
  const target = join(parent, trimmedName);
  try {
    await mkdir(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return { ok: false, error: `${trimmedName} already exists.` };
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, error: `Permission denied creating ${trimmedName}.` };
    }
    return { ok: false, error: `Could not create ${trimmedName}.` };
  }
  const canonical = await realpath(target).catch(() => null);
  if (!canonical || !inside(canonical)) {
    return { ok: false, error: 'The created folder resolved outside the permitted roots.' };
  }
  return { ok: true, path: canonical };
}
