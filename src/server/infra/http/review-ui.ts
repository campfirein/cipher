/**
 * Returns the complete HTML page for the local HITL review UI.
 *
 * Self-contained: all CSS and JS are inline. No external dependencies.
 * Shows semantic summaries of previous/current versions for each operation.
 */
export function getReviewPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ByteRover Review</title>
<style>
  :root {
    --bg: #0d1117;
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --green: #238636;
    --green-bg: rgba(46, 160, 67, 0.15);
    --red: #da3633;
    --red-bg: rgba(248, 81, 73, 0.1);
    --blue: #58a6ff;
    --yellow: #d29922;
    --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  header {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    padding: 12px 24px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  header h1 {
    font-size: 18px;
    font-weight: 600;
  }

  header .badge {
    background: var(--yellow);
    color: var(--bg);
    font-size: 12px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
  }

  .loading, .empty, .error {
    text-align: center;
    padding: 48px 24px;
    color: var(--text-muted);
  }

  .error { color: var(--red); }

  .file-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }

  .file-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    user-select: none;
  }

  .file-path {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--blue);
  }

  .file-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .op-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
  }

  .op-badge.DELETE { background: var(--red-bg); color: var(--red); }
  .op-badge.UPDATE, .op-badge.UPSERT { background: var(--green-bg); color: var(--green); }
  .op-badge.MERGE { background: rgba(88, 166, 255, 0.15); color: var(--blue); }
  .op-badge.ADD { background: var(--green-bg); color: var(--green); }

  .reason-text {
    font-size: 12px;
    color: var(--text-muted);
    margin-left: 8px;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    padding: 6px 16px;
    transition: opacity 0.15s;
  }

  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-approve {
    background: var(--green);
    color: #fff;
  }

  .btn-reject {
    background: var(--red);
    color: #fff;
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .summary-content {
    padding: 12px 16px;
  }

  .summary-block {
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 8px;
    font-size: 13px;
    line-height: 1.6;
  }

  .summary-block:last-child {
    margin-bottom: 0;
  }

  .summary-block.previous {
    background: var(--red-bg);
    border-left: 3px solid var(--red);
  }

  .summary-block.current {
    background: var(--green-bg);
    border-left: 3px solid var(--green);
  }

  .summary-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }

  .summary-block.previous .summary-label { color: var(--red); }
  .summary-block.current .summary-label { color: var(--green); }

  .summary-text {
    color: var(--text);
  }

  .no-summary {
    color: var(--text-muted);
    font-style: italic;
    font-size: 13px;
    padding: 8px 12px;
  }

  .decided {
    padding: 16px;
    text-align: center;
    font-weight: 500;
  }

  .decided.approved { color: var(--green); }
  .decided.rejected { color: var(--red); }

  .summary-bar {
    display: flex;
    gap: 16px;
    padding: 12px 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  .bulk-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  /* ── Diff styles (retained for future use) ─────────────────────────── */

  .diff-container {
    overflow-x: auto;
  }

  .diff-loading {
    padding: 16px;
    color: var(--text-muted);
    font-style: italic;
  }

  table.diff {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 20px;
  }

  table.diff td {
    padding: 0 12px;
    white-space: pre-wrap;
    word-break: break-all;
    vertical-align: top;
  }

  table.diff .line-num {
    color: var(--text-muted);
    text-align: right;
    width: 50px;
    min-width: 50px;
    user-select: none;
    padding: 0 8px;
  }

  table.diff tr.added { background: var(--green-bg); }
  table.diff tr.removed { background: var(--red-bg); }
  table.diff tr.context { background: transparent; }

  table.diff tr.added .line-num { color: var(--green); }
  table.diff tr.removed .line-num { color: var(--red); }

  table.diff .marker {
    width: 20px;
    min-width: 20px;
    text-align: center;
    user-select: none;
  }

  table.diff tr.added .marker { color: var(--green); }
  table.diff tr.removed .marker { color: var(--red); }
</style>
</head>
<body>
<header>
  <h1>ByteRover Review</h1>
  <span class="badge" id="pending-count">...</span>
</header>

<div class="container">
  <div id="summary-bar" class="summary-bar"></div>
  <div id="bulk-actions" class="bulk-actions" style="display:none">
    <button class="btn btn-approve" onclick="bulkDecide('approved')">Approve All</button>
    <button class="btn btn-reject" onclick="bulkDecide('rejected')">Reject All</button>
  </div>
  <div id="content">
    <div class="loading">Loading pending reviews...</div>
  </div>
</div>

<script>
// ── State ──────────────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const project = params.get('project') || '';
let fileData = [];

// ── Diff algorithm (retained for future use — currently un-wired) ───────

function computeLineDiff(oldText, newText) {
  const oldLines = oldText.split('\\n');
  const newLines = newText.split('\\n');
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i-1] === newLines[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }

  // Backtrack to get diff
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i-1] === newLines[j-1]) {
      result.unshift({type: 'context', oldNum: i, newNum: j, text: oldLines[i-1]});
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      result.unshift({type: 'added', oldNum: null, newNum: j, text: newLines[j-1]});
      j--;
    } else {
      result.unshift({type: 'removed', oldNum: i, newNum: null, text: oldLines[i-1]});
      i--;
    }
  }

  return result;
}

function renderDiff(diffLines) {
  if (diffLines.length === 0) {
    return '<div class="diff-loading">No changes detected</div>';
  }

  let html = '<table class="diff">';
  for (const line of diffLines) {
    const cls = line.type;
    const marker = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
    const oldN = line.oldNum ?? '';
    const newN = line.newNum ?? '';
    const escaped = escapeHtml(line.text);
    html += '<tr class="' + cls + '">'
      + '<td class="line-num">' + oldN + '</td>'
      + '<td class="line-num">' + newN + '</td>'
      + '<td class="marker">' + marker + '</td>'
      + '<td>' + escaped + '</td>'
      + '</tr>';
  }
  html += '</table>';
  return html;
}

// ── Utilities ───────────────────────────────────────────────────────────

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── API calls ──────────────────────────────────────────────────────────────

async function fetchPending() {
  const res = await fetch('/api/review/pending?project=' + encodeURIComponent(project));
  if (!res.ok) throw new Error('Failed to fetch pending reviews');
  return res.json();
}

async function fetchDiff(path) {
  const res = await fetch('/api/review/diff?project=' + encodeURIComponent(project) + '&path=' + encodeURIComponent(path));
  if (!res.ok) throw new Error('Failed to fetch diff');
  return res.json();
}

async function submitDecision(path, decision) {
  const res = await fetch('/api/review/decide', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({project, path, decision}),
  });
  if (!res.ok) throw new Error('Failed to submit decision');
  return res.json();
}

// ── Summary rendering ──────────────────────────────────────────────────

function renderSummaryContent(file) {
  // Use file-level summaries (read from actual files at serve time, always up-to-date)
  const lastOp = file.operations[file.operations.length - 1];
  const opType = lastOp.type;
  const previousSummary = file.previousSummary;
  const summary = file.currentSummary;

  // No summaries available at all
  if (!previousSummary && !summary) {
    return '<div class="no-summary">No summary available for this change.</div>';
  }

  let html = '';

  if (opType === 'DELETE') {
    // DELETE: show only what was removed
    if (previousSummary) {
      html += '<div class="summary-block previous">'
        + '<div class="summary-label">Removed</div>'
        + '<div class="summary-text">' + escapeHtml(previousSummary) + '</div>'
        + '</div>';
    }
  } else if (opType === 'ADD') {
    // ADD: show only the new content
    if (summary) {
      html += '<div class="summary-block current">'
        + '<div class="summary-label">New</div>'
        + '<div class="summary-text">' + escapeHtml(summary) + '</div>'
        + '</div>';
    }
  } else {
    // UPDATE, UPSERT, MERGE: show both versions
    if (previousSummary) {
      html += '<div class="summary-block previous">'
        + '<div class="summary-label">Previous</div>'
        + '<div class="summary-text">' + escapeHtml(previousSummary) + '</div>'
        + '</div>';
    }
    if (summary) {
      html += '<div class="summary-block current">'
        + '<div class="summary-label">Current</div>'
        + '<div class="summary-text">' + escapeHtml(summary) + '</div>'
        + '</div>';
    }
  }

  return html || '<div class="no-summary">No summary available for this change.</div>';
}

// ── Rendering ──────────────────────────────────────────────────────────

function renderFileCard(file, index) {
  const opBadges = file.operations.map(op =>
    '<span class="op-badge ' + op.type + '">' + op.type + '</span>'
  ).join('');

  const reasons = file.operations
    .filter(op => op.reason)
    .map(op => op.reason);
  const reasonHtml = reasons.length > 0
    ? '<span class="reason-text">' + escapeHtml(reasons[0]) + '</span>'
    : '';

  const summaryHtml = renderSummaryContent(file);

  return '<div class="file-card" id="file-' + index + '">'
    + '<div class="file-header">'
    + '  <div><span class="file-path">' + escapeHtml(file.path) + '</span>' + reasonHtml + '</div>'
    + '  <div class="file-meta">'
    + '    ' + opBadges
    + '    <div class="actions">'
    + '      <button class="btn btn-approve" onclick="decide(event,' + index + ',\\'approved\\')">Approve</button>'
    + '      <button class="btn btn-reject" onclick="decide(event,' + index + ',\\'rejected\\')">Reject</button>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + '<div class="summary-content">' + summaryHtml + '</div>'
    + '</div>';
}

async function decide(event, index, decision) {
  event.stopPropagation();
  const file = fileData[index];
  if (!file) return;

  const card = document.getElementById('file-' + index);
  const buttons = card.querySelectorAll('.btn');
  buttons.forEach(b => b.disabled = true);

  try {
    await submitDecision(file.path, decision);
    // Replace card content with decided state
    const summaryContent = card.querySelector('.summary-content');
    if (summaryContent) summaryContent.style.display = 'none';
    const header = card.querySelector('.file-header');
    const label = decision === 'approved' ? 'Approved' : 'Rejected';
    const cls = decision === 'approved' ? 'approved' : 'rejected';
    header.innerHTML = '<div><span class="file-path">' + escapeHtml(file.path) + '</span></div>'
      + '<div class="decided ' + cls + '">' + label + '</div>';
    header.style.cursor = 'default';

    // Update count
    updatePendingCount();
  } catch (e) {
    buttons.forEach(b => b.disabled = false);
    alert('Error: ' + e.message);
  }
}

async function bulkDecide(decision) {
  const pending = fileData.filter((_, i) => {
    const card = document.getElementById('file-' + i);
    return card && !card.querySelector('.decided');
  });

  for (let i = 0; i < fileData.length; i++) {
    const card = document.getElementById('file-' + i);
    if (card && !card.querySelector('.decided')) {
      await decide({stopPropagation() {}}, i, decision);
    }
  }
}

function updatePendingCount() {
  const remaining = fileData.filter((_, i) => {
    const card = document.getElementById('file-' + i);
    return card && !card.querySelector('.decided');
  }).length;
  document.getElementById('pending-count').textContent = remaining + ' pending';

  if (remaining === 0) {
    clearInterval(poller);
    document.getElementById('bulk-actions').style.display = 'none';
    document.getElementById('summary-bar').textContent = 'All reviews completed.';
  }
}

// Poll every 5 s so the page reflects external decisions (e.g., brv review approve via CLI).
// When the server reports 0 pending items, mark any locally-undecided cards as resolved.
let poller = setInterval(async () => {
  if (!project || fileData.length === 0) return;
  try {
    const data = await fetchPending();
    const serverPaths = new Set((data.files || []).map(f => f.path));
    let anyUpdated = false;

    for (let i = 0; i < fileData.length; i++) {
      const card = document.getElementById('file-' + i);
      if (!card || card.querySelector('.decided')) continue;
      if (!serverPaths.has(fileData[i].path)) {
        // Item was resolved externally
        const header = card.querySelector('.file-header');
        if (header) {
          header.innerHTML = '<div><span class="file-path">' + escapeHtml(fileData[i].path) + '</span></div>'
            + '<div class="decided approved">Resolved</div>';
        }
        const summaryContent = card.querySelector('.summary-content');
        if (summaryContent) summaryContent.style.display = 'none';
        anyUpdated = true;
      }
    }

    if (anyUpdated) updatePendingCount();
  } catch {
    // Ignore transient poll errors
  }
}, 5000);

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  const contentEl = document.getElementById('content');

  if (!project) {
    contentEl.innerHTML = '<div class="error">Missing project parameter in URL</div>';
    return;
  }

  try {
    const data = await fetchPending();
    fileData = data.files || [];

    document.getElementById('pending-count').textContent = fileData.length + ' pending';

    if (fileData.length === 0) {
      contentEl.innerHTML = '<div class="empty">No pending reviews for this project.</div>';
      return;
    }

    document.getElementById('summary-bar').textContent =
      fileData.length + ' file(s) pending review in ' + (data.projectPath || 'unknown project');
    document.getElementById('bulk-actions').style.display = 'flex';

    contentEl.innerHTML = fileData.map((f, i) => renderFileCard(f, i)).join('');
  } catch (e) {
    contentEl.innerHTML = '<div class="error">Failed to load reviews: ' + escapeHtml(e.message) + '</div>';
  }
}

init();
</script>
</body>
</html>`
}
