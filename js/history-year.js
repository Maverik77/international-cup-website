(function () {
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    const year = parseYearFromPath();
    if (!year) {
      showError('Invalid archive URL — expected /history/YYYY/.');
      return;
    }
    document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = year; });

    const base = `../../data/archive/${year}`;
    try {
      const [players, pairings, matchResults, news, schedule] = await Promise.all([
        fetchJson(`${base}/players.json`),
        fetchJson(`${base}/pairings.json`),
        fetchJson(`${base}/match-results.json`),
        fetchJson(`${base}/news.json`),
        fetchJson(`${base}/schedule.json`),
      ]);
      renderHeader(schedule);
      renderRosters(players);
      renderSchedule(schedule);
      renderPairings(pairings, matchResults, players);
      renderNews(news);
    } catch (err) {
      console.error('[history-year] load failed', err);
      showError(`Unable to load ${year} archive data.`);
    }
  }

  function parseYearFromPath() {
    const m = location.pathname.match(/\/history\/(\d{4})\/?$/);
    return m ? Number(m[1]) : null;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return res.json();
  }

  function showError(msg) {
    const mount = document.querySelector('.history-detail');
    if (mount) mount.innerHTML = `<p>${escape(msg)}</p>`;
  }

  function renderHeader(schedule) {
    const el = document.getElementById('history-header-line');
    if (!el) return;
    const parts = [];
    if (schedule.dates) parts.push(schedule.dates);
    if (schedule.venue?.name) parts.push(schedule.venue.name);
    el.textContent = parts.join(' · ');
  }

  function renderRosters(players) {
    const usa = players.filter((p) => p.team === 'USA' || p.team === 'usa');
    const intl = players.filter((p) => p.team === 'International' || p.team === 'international');
    const usaList = document.getElementById('roster-usa');
    const intlList = document.getElementById('roster-intl');
    if (usaList) usaList.innerHTML = usa.map((p) => `<li>${escape(playerLabel(p))}</li>`).join('');
    if (intlList) intlList.innerHTML = intl.map((p) => `<li>${escape(playerLabel(p))}</li>`).join('');
  }

  function renderSchedule(schedule) {
    const mount = document.getElementById('schedule-body');
    if (!mount) return;
    const venue = schedule.venue || {};
    const days = (schedule.days || []).map((d) => `
      <div class="schedule-day">
        <h3>${escape(d.label || d.date)}</h3>
        ${d.date ? `<p><strong>Date:</strong> ${escape(d.date)}</p>` : ''}
        ${d.course ? `<p><strong>Course:</strong> ${escape(d.course)}</p>` : ''}
        ${d.teeTimes ? `<p><strong>Tee times:</strong> ${escape(d.teeTimes)}</p>` : ''}
        ${d.location ? `<p><strong>Location:</strong> ${escape(d.location)}</p>` : ''}
        ${d.notes ? `<p>${escape(d.notes)}</p>` : ''}
      </div>
    `).join('');
    mount.innerHTML = `
      <div class="schedule-venue">
        <h3>${escape(venue.name || 'Venue')}</h3>
        ${venue.address ? `<p>${escape(venue.address)}</p>` : ''}
        ${venue.hours ? `<p>${escape(venue.hours)}</p>` : ''}
      </div>
      ${days}
    `;
  }

  function renderPairings(pairings, matchResults, players) {
    const mount = document.getElementById('pairings-body');
    if (!mount) return;
    const resultById = new Map(matchResults.map((r) => [r.matchId || r.id, r]));
    const byId = new Map(players.map((p) => [p.id, p]));
    const nameFor = (id) => { const p = byId.get(id); return p ? playerLabel(p) : ''; };

    let html = '';

    // --- Day 1: team matches, each pairing plays 3 formats (T1/T2/T3). ---
    const day1Pairs = pairings.filter((p) => Number(p.day) === 1)
      .sort((a, b) => Number(a.match_number || 0) - Number(b.match_number || 0));
    if (day1Pairs.length > 0) {
      html += `<h3>Day 1 — Team Matches (Fri Oct 17)</h3>`;
      html += `<p class="pairings-note">Each pairing plays three formats: Best Ball, Alt-Shot, Best Ball. Two points per format (win 2, tie 1).</p>`;
      html += `<table class="pairings-table pairings-day1"><thead><tr>
        <th>#</th><th>USA</th><th>International</th>
        <th>T1<br><span class="format-name">Best Ball</span></th>
        <th>T2<br><span class="format-name">Alt-Shot</span></th>
        <th>T3<br><span class="format-name">Best Ball</span></th>
        <th>Total</th>
      </tr></thead><tbody>`;
      for (const p of day1Pairs) {
        const r = resultById.get(p.id) || {};
        const formats = Array.isArray(r.formats) ? r.formats : [];
        const usaCell = `${escape(nameFor(p.usa_team?.player1_id))}<br>${escape(nameFor(p.usa_team?.player2_id))}`;
        const intlCell = `${escape(nameFor(p.intl_team?.player1_id))}<br>${escape(nameFor(p.intl_team?.player2_id))}`;
        const fmtCell = (f) => {
          if (!f) return '<td class="format-cell empty">—</td>';
          const cls = f.winner === 'USA' ? 'winner-usa'
                    : f.winner === 'International' ? 'winner-intl'
                    : 'winner-tie';
          return `<td class="format-cell ${cls}"><div class="format-status">${escape(f.status)}</div><div class="format-points">${fmtPts(f.usaPoints)}–${fmtPts(f.intlPoints)}</div></td>`;
        };
        const totCls = r.usaTotal > r.intlTotal ? 'winner-usa'
                     : r.intlTotal > r.usaTotal ? 'winner-intl'
                     : 'winner-tie';
        html += `<tr>
          <td class="match-num">${escape(p.match_number || '')}</td>
          <td class="pair-cell">${usaCell}</td>
          <td class="pair-cell">${intlCell}</td>
          ${fmtCell(formats[0])}
          ${fmtCell(formats[1])}
          ${fmtCell(formats[2])}
          <td class="total-cell ${totCls}"><strong>${fmtPts(r.usaTotal)}–${fmtPts(r.intlTotal)}</strong></td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    // --- Day 2: singles, each pairing plays 3 segments worth 1 pt each. ---
    const day2Pairs = pairings.filter((p) => Number(p.day) === 2)
      .sort((a, b) => Number(a.match_number || 0) - Number(b.match_number || 0));
    if (day2Pairs.length > 0) {
      html += `<h3>Day 2 — Singles (Sat Oct 18)</h3>`;
      html += `<p class="pairings-note">Each singles pairing plays three segments. One point per segment (win 1, tie 0.5).</p>`;
      html += `<table class="pairings-table pairings-day2"><thead><tr>
        <th>#</th><th>USA</th><th>International</th>
        <th>Seg 1</th><th>Seg 2</th><th>Seg 3</th><th>Total</th>
      </tr></thead><tbody>`;
      for (const p of day2Pairs) {
        const r = resultById.get(p.id) || {};
        const segments = Array.isArray(r.segments) ? r.segments : [];
        const segCell = (s) => {
          if (!s) return '<td class="seg-cell empty">—</td>';
          const cls = s.winner === 'USA' ? 'winner-usa'
                    : s.winner === 'International' ? 'winner-intl'
                    : 'winner-tie';
          return `<td class="seg-cell ${cls}"><div class="seg-status">${escape(s.status)}</div><div class="seg-points">${fmtPts(s.usaPoints)}–${fmtPts(s.intlPoints)}</div></td>`;
        };
        const totCls = r.usaTotal > r.intlTotal ? 'winner-usa'
                     : r.intlTotal > r.usaTotal ? 'winner-intl'
                     : 'winner-tie';
        html += `<tr>
          <td class="match-num">${escape(p.match_number || '')}</td>
          <td class="pair-cell">${escape(nameFor(p.usa_player_id))}</td>
          <td class="pair-cell">${escape(nameFor(p.intl_player_id))}</td>
          ${segCell(segments[0])}
          ${segCell(segments[1])}
          ${segCell(segments[2])}
          <td class="total-cell ${totCls}"><strong>${fmtPts(r.usaTotal)}–${fmtPts(r.intlTotal)}</strong></td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    mount.innerHTML = html;
  }

  function fmtPts(n) {
    if (n === undefined || n === null) return '';
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function renderNews(news) {
    const mount = document.getElementById('news-body');
    if (!mount) return;
    const sorted = [...news].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    mount.innerHTML = sorted.map((n) => `
      <li class="news-archive-item">
        <h3>${escape(n.title || '')}</h3>
        <time>${escape(n.date || '')}</time>
        <div>${sanitizeHtml(n.content || '')}</div>
      </li>
    `).join('');
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function playerLabel(p) {
    const full = `${p.firstName || ''} ${p.lastName || ''}`.trim();
    return full || p.id || '';
  }

  // Escape all HTML, then hydrate [label](href) markdown-lite links —
  // matches js/news.js's escape-first approach and handles all real news content.
  function sanitizeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s);
    let escaped = div.innerHTML;
    // Allow [label](#anchor) and [label](/path) — same restricted pattern as js/news.js:69-72.
    escaped = escaped.replace(
      /\[([^\]]+)\]\((#[a-zA-Z0-9-]+|\/[a-zA-Z0-9-\/]*)\)/g,
      '<a href="$2" class="news-link" rel="noopener noreferrer">$1</a>'
    );
    return escaped;
  }
})();
