import { Fragment } from 'react';

type Lang = 'yaml' | 'ts';

const MARK: Record<Lang, string> = { yaml: '#', ts: '//' };

/**
 * Deliberately small: full-line comments, quoted strings, and YAML keys.
 * Enough to make real config readable without pretending to be an editor.
 */
/** Index of the comment marker, ignoring any that sit inside a quoted string. */
function commentAt(src: string, mark: string): number {
  let quote: string | null = null;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (src.startsWith(mark, i)) return i;
  }
  return -1;
}

function line(src: string, lang: Lang, key: number) {
  const out: React.ReactNode[] = [];
  let n = 0;
  const push = (text: string, cls?: string) => {
    if (!text) return;
    out.push(
      cls ? (
        <span className={cls} key={n++}>
          {text}
        </span>
      ) : (
        <Fragment key={n++}>{text}</Fragment>
      ),
    );
  };

  const cut = commentAt(src, MARK[lang]);
  let rest = cut >= 0 ? src.slice(0, cut) : src;
  const comment = cut >= 0 ? src.slice(cut) : '';

  if (lang === 'yaml') {
    const m = /^(\s*-?\s*)([A-Za-z_][\w.-]*)(:)/.exec(rest);
    if (m) {
      push(m[1]);
      push(m[2], 'k');
      push(m[3]);
      rest = rest.slice(m[0].length);
    }
  }

  for (const p of rest.split(/('[^']*'|"[^"]*")/g)) {
    push(p, /^['"]/.test(p) ? 's' : undefined);
  }
  push(comment, 'c');

  return (
    <Fragment key={key}>
      {out}
      {'\n'}
    </Fragment>
  );
}

export function Code({
  title,
  note,
  lang,
  src,
}: {
  title: string;
  note?: string;
  lang: Lang;
  src: string;
}) {
  return (
    <div className="code">
      <div className="code__bar">
        <span className="lbl">{title}</span>
        {note ? <span className="lbl">{note}</span> : null}
      </div>
      <pre>
        <code>{src.split('\n').map((l, i) => line(l, lang, i))}</code>
      </pre>
    </div>
  );
}
