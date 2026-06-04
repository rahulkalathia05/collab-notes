/**
 * Minimal two-pass diff for version comparison.
 *
 * Pass 1 — line-level LCS (Myers-style patience diff via DP).
 * Pass 2 — word-level refinement on changed lines for readable inline diffs.
 */

export type LineType = 'same' | 'add' | 'remove';

export interface DiffLine {
  type: LineType;
  text: string;
  /** Word-level spans for changed lines (present when type != 'same') */
  spans?: WordSpan[];
}

export interface WordSpan {
  type: 'same' | 'add' | 'remove';
  text: string;
}

// ── public API ────────────────────────────────────────────────────────────────

export function diffTexts(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const raw = lineDiff(oldLines, newLines);

  // Pair consecutive remove/add blocks and refine word-level
  const result: DiffLine[] = [];
  let i = 0;
  while (i < raw.length) {
    const chunk = raw[i];
    if (chunk.type === 'remove' && i + 1 < raw.length && raw[i + 1].type === 'add') {
      // Refine the paired remove/add with word-level spans
      result.push({ type: 'remove', text: chunk.text, spans: wordSpans(chunk.text, raw[i + 1].text, 'remove') });
      result.push({ type: 'add', text: raw[i + 1].text, spans: wordSpans(chunk.text, raw[i + 1].text, 'add') });
      i += 2;
    } else {
      result.push(chunk);
      i++;
    }
  }
  return result;
}

/** Summary counts for a diff. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number; changed: number } {
  let added = 0, removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'remove') removed++;
  }
  return { added, removed, changed: Math.min(added, removed) };
}

// ── line-level LCS ────────────────────────────────────────────────────────────

function lineDiff(oldL: string[], newL: string[]): DiffLine[] {
  const m = oldL.length;
  const n = newL.length;

  // DP table: lcs[i][j] = length of LCS of oldL[0..i-1] and newL[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldL[i - 1] === newL[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to reconstruct diff
  const out: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldL[i - 1] === newL[j - 1]) {
      out.push({ type: 'same', text: oldL[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.push({ type: 'add', text: newL[j - 1] });
      j--;
    } else {
      out.push({ type: 'remove', text: oldL[i - 1] });
      i--;
    }
  }
  return out.reverse();
}

// ── word-level refinement ─────────────────────────────────────────────────────

function wordSpans(oldLine: string, newLine: string, side: 'remove' | 'add'): WordSpan[] {
  const src = side === 'remove' ? oldLine : newLine;
  const other = side === 'remove' ? newLine : oldLine;

  const srcWords = tokenizeWords(src);
  const otherWords = tokenizeWords(other);

  const lcs = wordLCS(srcWords, otherWords);
  const spans: WordSpan[] = [];

  let si = 0, lcsIdx = 0;
  while (si < srcWords.length) {
    if (lcsIdx < lcs.length && srcWords[si] === lcs[lcsIdx]) {
      spans.push({ type: 'same', text: srcWords[si] });
      si++; lcsIdx++;
    } else {
      spans.push({ type: side, text: srcWords[si] });
      si++;
    }
  }
  return spans;
}

function wordLCS(a: string[], b: string[]): string[] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.push(a[i - 1]); i--; j--; }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--;
    else j--;
  }
  return result.reverse();
}

// ── helpers ───────────────────────────────────────────────────────────────────

function splitLines(text: string): string[] {
  return (text ?? '').split('\n');
}

function tokenizeWords(line: string): string[] {
  // Split on word boundaries, keeping whitespace as tokens so spans reassemble correctly
  return line.split(/(\s+)/).filter((t) => t.length > 0);
}
