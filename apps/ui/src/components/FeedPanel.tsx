/**
 * Every advisory, newest first, with its hop count. The suppressions collapse
 * into one quiet line — `…47 suppressed` is the product's whole argument, and
 * it expands on click for anyone who wants to audit it.
 */
import { useState } from 'react';
import type { FeedItem, FunnelStats } from '@hopper/contracts';
import { splitFeed } from '../lib/reducer.js';

function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function hopsLabel(item: FeedItem): string {
  if (item.state === 'suppressed') return '0';
  if (item.state === 'traversing') return 'walking';
  if (item.hops === 0) return '0';
  return `${item.hops} hops`;
}

function Row({ item, onSelect, fresh }: { item: FeedItem; onSelect?: (id: string) => void; fresh?: boolean }) {
  const actionable = onSelect !== undefined;
  return (
    <div
      className={`feed-row is-${item.state}${actionable ? ' is-actionable' : ''}${fresh ? ' is-new' : ''}`}
      onClick={actionable ? () => onSelect(item.ghsa_id) : undefined}
      role={actionable ? 'button' : undefined}
      tabIndex={actionable ? 0 : undefined}
      onKeyDown={
        actionable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(item.ghsa_id);
            }
          : undefined
      }
      title={item.summary}
    >
      <span className="feed-time">{hhmm(item.received_at)}</span>
      <span className="feed-pkg">
        {item.package}
        {item.in_kev && <span className="feed-kev">KEV</span>}
      </span>
      <span className="feed-hops">{hopsLabel(item)}</span>
    </div>
  );
}

export function FeedPanel({
  feed,
  funnel,
  onSelect,
  selectable,
}: {
  feed: FeedItem[];
  funnel: FunnelStats;
  onSelect: (ghsa_id: string) => void;
  selectable: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { shown, collapsed } = splitFeed(feed);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="label">Feed</h2>
        <span className="funnel mono">
          <strong>{funnel.ingested}</strong> ingested &rarr; <strong>{funnel.escalated}</strong> escalated
          <span className="sep"> · </span>p99 {funnel.p99_ms}ms
        </span>
      </div>

      <div className="scroll">
        {shown.map((item, i) => (
          <Row
            key={item.ghsa_id}
            item={item}
            fresh={i === 0 && item.state !== 'suppressed'}
            onSelect={selectable.has(item.ghsa_id) ? onSelect : undefined}
          />
        ))}

        {collapsed.length > 0 && (
          <button
            type="button"
            className="feed-collapse mono"
            onClick={() => setExpanded((v) => !v)}
          >
            <span>&hellip;{collapsed.length} suppressed</span>
            <span className="feed-collapse-hint">
              {expanded ? 'collapse' : 'zero hops from any repo'}
            </span>
          </button>
        )}

        {expanded && collapsed.map((item) => <Row key={item.ghsa_id} item={item} />)}
      </div>
    </section>
  );
}
