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
      renderPairings(pairings, matchResults);
      renderDeepResultsCta(year);
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
    if (usaList) usaList.innerHTML = usa.map((p) => `<li>${escape(p.name || p.fullName || p.id)}</li>`).join('');
    if (intlList) intlList.innerHTML = intl.map((p) => `<li>${escape(p.name || p.fullName || p.id)}</li>`).join('');
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

  function renderPairings(pairings, matchResults) {
    const mount = document.getElementById('pairings-body');
    if (!mount) return;
    const resultById = new Map(matchResults.map((r) => [r.matchId || r.id, r]));
    const days = [1, 2];
    let html = '';
    for (const day of days) {
      const dayPairs = pairings.filter((p) => Number(p.day) === day)
        .sort((a, b) => Number(a.match_number || 0) - Number(b.match_number || 0));
      if (dayPairs.length === 0) continue;
      html += `<h3>Day ${day}${day === 1 ? ' — Team Matches' : ' — Singles'}</h3>`;
      html += `<table class="pairings-table"><thead><tr>
        <th>#</th><th>USA</th><th>International</th><th>Winner</th><th>Score</th>
      </tr></thead><tbody>`;
      for (const p of dayPairs) {
        const r = resultById.get(p.id) || {};
        const usaCell = p.type === 'team'
          ? `${escape(p.usa_team?.player1 || '')} / ${escape(p.usa_team?.player2 || '')}`
          : escape(p.usa_player || '');
        const intlCell = p.type === 'team'
          ? `${escape(p.intl_team?.player1 || '')} / ${escape(p.intl_team?.player2 || '')}`
          : escape(p.intl_player || '');
        const winnerCls = r.winner === 'USA' ? 'winner-usa'
                        : r.winner === 'International' ? 'winner-intl'
                        : 'winner-tie';
        html += `<tr>
          <td>${escape(p.match_number || '')}</td>
          <td>${usaCell}</td>
          <td>${intlCell}</td>
          <td class="${winnerCls}">${escape(r.winner || '—')}</td>
          <td>${escape(r.finalScore || '')}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    mount.innerHTML = html;
  }

  function renderDeepResultsCta(year) {
    const el = document.getElementById('deep-results-cta');
    if (el) el.href = `../../tournament/results.html?year=${year}`;
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

  // Very small allowlist — news content includes anchor tags.
  function sanitizeHtml(s) {
    const div = document.createElement('div');
    div.innerHTML = String(s);
    div.querySelectorAll('*').forEach((el) => {
      const allowed = ['A', 'B', 'STRONG', 'I', 'EM', 'BR', 'P', 'UL', 'OL', 'LI'];
      if (!allowed.includes(el.tagName)) el.replaceWith(document.createTextNode(el.textContent || ''));
      else if (el.tagName === 'A') {
        const href = el.getAttribute('href') || '';
        if (!/^(https?:|mailto:|#|\/)/.test(href)) el.removeAttribute('href');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return div.innerHTML;
  }
})();
