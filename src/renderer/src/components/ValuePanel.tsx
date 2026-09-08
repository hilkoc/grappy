export interface ValueDescription {
  varName: string;
  title: string;
  loading: boolean;
  fullRepr?: string | null;
  htmlTable?: string | null;
  error?: string | null;
}

interface ValuePanelProps {
  description: ValueDescription;
  onClose: () => void;
}

/** Left-side detail view for a value that is too big to show inline on its node. */
export function ValuePanel({ description, onClose }: ValuePanelProps) {
  return (
    <aside className="side-panel left">
      <header className="panel-header">
        <h2>{description.title}</h2>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="panel-content">
        {description.loading ? <p className="panel-hint">Loading…</p> : null}
        {description.error ? <p className="panel-error">{description.error}</p> : null}
        {description.htmlTable ? (
          // The markup comes from pandas' own DataFrame.to_html(), which escapes cell content.
          <div
            className="value-table"
            dangerouslySetInnerHTML={{ __html: description.htmlTable }}
          />
        ) : null}
        {description.fullRepr ? <pre className="value-repr">{description.fullRepr}</pre> : null}
      </div>
    </aside>
  );
}
