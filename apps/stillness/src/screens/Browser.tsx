import { useState } from 'react';
import { controller, type AppState } from '../lib/controller';
import { IconChevron, IconFile, IconFolder, IconPlus, IconRefresh } from '../components/Icons';
import { EmptyState, ScreenHeader, useDocumentTitle } from '../components/ui';
import { formatBytes, relativeTime } from '../lib/format';

export function BrowserScreen({ state }: { state: AppState }) {
  const browser = state.browser;
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState('');
  const project = state.projects.find((item) => item.project_id === browser?.projectId) ?? null;
  useDocumentTitle('Server files');
  const segments = (browser?.path ?? '').split('/').filter(Boolean);
  const navigate = (index: number) => {
    if (!browser) return;
    const next = segments.slice(0, index + 1).join('/');
    void controller.loadDirectory(browser.projectId, next);
  };
  return (
    <div className="screen" data-testid="browser-screen">
      <ScreenHeader
        title="Server files"
        subtitle={project?.label ?? 'Project'}
        back="project"
        right={
          <button className="icon-btn" aria-label="Refresh folder" onClick={() => {
            if (browser) void controller.loadDirectory(browser.projectId, browser.path);
          }}>
            <IconRefresh />
          </button>
        }
      />
      <main className="body-scroll">
        <div className="view-content browser-view">
          {!browser ? (
            <EmptyState title="Choose a project folder.">
              The browser is root-scoped and never exposes files outside the adapter’s allowed roots.
            </EmptyState>
          ) : (
            <>
              <div className="browser-server">
                <span className="status-mark" />
                {state.credential?.baseUrl ?? 'Server'}
                <span className="preview-tag">ROOT-SCOPED</span>
              </div>
              <nav className="path-crumbs" aria-label="Current folder path">
                <button onClick={() => controller.loadDirectory(browser.projectId, '')}>Project</button>
                {segments.map((segment, index) => (
                  <span key={`${segment}-${index}`}>
                    <IconChevron size={13} style={{ transform: 'rotate(-90deg)' }} />
                    <button onClick={() => navigate(index)}>{segment}</button>
                  </span>
                ))}
              </nav>
              <div className="browser-location">
                <IconFolder />
                <span>{project?.path}{browser.path ? `/${browser.path}` : ''}</span>
              </div>
              {browser.error ? <p className="inline-error" role="alert">{browser.error}</p> : null}
              {browser.preview ? (
                <div className="file-preview">
                  <div className="file-preview-head">
                    <button className="tiny-action" onClick={() => {
                      if (browser) void controller.loadDirectory(browser.projectId, browser.path);
                    }}>
                      ← Folder
                    </button>
                    <span className="mono">{browser.preview.path}</span>
                    <span className="preview-meta">
                      {formatBytes(browser.preview.size)}
                      {browser.preview.truncated ? ' · truncated' : ''}
                    </span>
                  </div>
                  {browser.preview.binary ? (
                    <p className="empty-note">This file is binary and was not decoded.</p>
                  ) : (
                    <pre className="file-preview-body">{browser.preview.content}</pre>
                  )}
                </div>
              ) : (
                <>
                  <div className="browser-tools">
                    <button className="tiny-action" onClick={() => setCreating((value) => !value)}>
                      <IconPlus size={14} /> New folder
                    </button>
                    <span className="note-sub">{browser.entries.length} entries</span>
                  </div>
                  {creating ? (
                    <form
                      className="new-folder-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!folderName.trim()) return;
                        void controller.createFolder(folderName.trim());
                        setFolderName('');
                        setCreating(false);
                      }}
                    >
                      <input
                        value={folderName}
                        onChange={(event) => setFolderName(event.target.value)}
                        placeholder="Folder name"
                        maxLength={100}
                        autoFocus
                      />
                      <button className="onboard-secondary compact" type="submit">Create</button>
                    </form>
                  ) : null}
                  {browser.loading ? <p className="empty-note">Reading folder…</p> : null}
                  <div className="browser-entries" data-testid="browser-entries">
                    {browser.entries.map((entry) => (
                      <button
                        key={entry.name}
                        className={`browser-entry ${entry.kind}`}
                        onClick={() => {
                          const next = browser.path ? `${browser.path}/${entry.name}` : entry.name;
                          if (entry.kind === 'dir') void controller.loadDirectory(browser.projectId, next);
                          else if (entry.kind === 'file') void controller.openFile(next);
                        }}
                        disabled={entry.kind !== 'dir' && entry.kind !== 'file'}
                        title={entry.kind === 'symlink' ? 'Symlinks are shown but not traversable' : entry.name}
                      >
                        <span className="entry-icon">
                          {entry.kind === 'dir' ? <IconFolder /> : <IconFile />}
                        </span>
                        <span className="entry-name">
                          {entry.name}
                          {entry.hidden ? <span className="hidden-tag">hidden</span> : null}
                          {entry.kind === 'symlink' ? <span className="hidden-tag">symlink</span> : null}
                        </span>
                        <span className="entry-meta">
                          {entry.size != null ? formatBytes(entry.size) : ''}
                          {entry.modified_at_ms ? ` · ${relativeTime(entry.modified_at_ms)}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                  {!browser.loading && browser.entries.length === 0 ? (
                    <p className="empty-note">This folder is empty, or everything in it is protected.</p>
                  ) : null}
                </>
              )}
              <p className="browser-footnote">
                Paths are canonicalized under the project root. Traversal, external symlinks and
                protected credential files are rejected. Folder rename is not implemented.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
