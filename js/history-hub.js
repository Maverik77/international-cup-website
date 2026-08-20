(function () {
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    const mount = document.getElementById('history-hub-cards');
    if (!mount) return;
    try {
      const res = await fetch('../data/archive/index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
      const manifest = await res.json();
      render(mount, manifest.years || []);
    } catch (err) {
      console.error('[history-hub] failed to load manifest', err);
      mount.innerHTML = '<p>Archive is currently unavailable. Please try again shortly.</p>';
    }
  }

  function render(mount, years) {
    mount.innerHTML = '';
    if (years.length === 0) {
      mount.innerHTML = '<p>No past tournaments archived yet.</p>';
      return;
    }
    for (const y of years) {
      const card = document.createElement('a');
      card.className = 'history-card';
      card.href = `${y.year}/`;
      card.innerHTML = `
        <div class="history-card__year">${escape(String(y.year))}</div>
        <div class="history-card__dates">${escape(y.dates || '')}</div>
        <div class="history-card__venue">${escape(y.venue || 'Venue TBA')}</div>
        <div class="history-card__result">${escape(y.winner || '')} ${y.finalScore ? '· ' + escape(y.finalScore) : ''}</div>
      `;
      mount.appendChild(card);
    }
    // Inert cards for pre-archive years.
    for (const y of [2023, 2022, 2021]) {
      if (years.some((x) => x.year === y)) continue;
      const card = document.createElement('div');
      card.className = 'history-card inert';
      card.innerHTML = `
        <div class="history-card__year">${y}</div>
        <div class="history-card__dates">Archive coming soon</div>
      `;
      mount.appendChild(card);
    }
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
})();
