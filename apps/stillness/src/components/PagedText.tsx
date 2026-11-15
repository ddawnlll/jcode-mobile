import { memo, useState } from 'react';

export const TEXT_PAGE_CHARS = 16 * 1024;

// Move both sides of a split past a surrogate pair so paging never breaks
// Unicode and there are no duplicated or lost code units between pages.
function boundary(text: string, position: number): number {
  const code = text.charCodeAt(position);
  return code >= 0xdc00 && code <= 0xdfff ? position + 1 : position;
}

export const PagedText = memo(function PagedText({
  text,
  streaming = false,
  className = '',
}: {
  text: string;
  streaming?: boolean;
  className?: string;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(text.length / TEXT_PAGE_CHARS));
  if (streaming) {
    const start = boundary(text, Math.max(0, text.length - TEXT_PAGE_CHARS));
    return (
      <div className={className}>
        {start > 0 ? <small className="text-pages">Showing latest text</small> : null}
        <div className="paged-text">{text.slice(start)}</div>
      </div>
    );
  }
  const current = Math.min(page, pages - 1);
  const start = boundary(text, current * TEXT_PAGE_CHARS);
  const end = boundary(text, (current + 1) * TEXT_PAGE_CHARS);
  return (
    <div className={className}>
      <div className="paged-text">{text.slice(start, end)}</div>
      {pages > 1 ? (
        <div className="text-pages" role="group" aria-label="Text pages">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
          <span aria-live="polite">{current + 1} / {pages}</span>
          <button type="button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  );
});
