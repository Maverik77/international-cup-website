(function () {
    'use strict';

    // Both roster views are rendered from data/players.json so a player is only
    // ever listed once. Players who have not consented to appear in detail carry
    // nothing but a name and a country, so they render as an incognito card.

    var DATA_URL = 'data/players.json';
    var THUMB_DIR = 'pics/players/thumb/';

    var FLAGS = {
    'India': '🇮🇳',
    'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'Korea': '🇰🇷',
    'Australia': '🇦🇺',
    'Germany': '🇩🇪',
    'Canada': '🇨🇦',
    'Pakistan': '🇵🇰',
    'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'Spain': '🇪🇸',
    'Tanzania': '🇹🇿',
    };
    var USA_FLAG = '\ud83c\uddfa\ud83c\uddf8';

    var INCOGNITO = '<svg class="pcard-anon" viewBox="0 0 44 55" role="img"' +
        ' aria-label="No photo provided" focusable="false">' +
        '<circle cx="22" cy="21" r="8.2"/>' +
        '<path d="M7.5 45.5c0-8 6.5-13 14.5-13s14.5 5 14.5 13v9.5h-29z"/></svg>';

    var PLAY = '<span class="pcard-play" aria-hidden="true">' +
        '<svg viewBox="0 0 12 14" focusable="false"><path d="M0 0l12 7-12 7z"/></svg></span>';

    var viewMode = 'detailed';
    var filmReturnFocus = null;
    var teams = null;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        var mounts = document.querySelectorAll('[data-roster]');
        if (!mounts.length) { return; }
        wireToggles();
        wireFilms();
        fetch(DATA_URL, { cache: 'no-store' })
            .then(function (res) {
                if (!res.ok) { throw new Error('HTTP ' + res.status); }
                return res.json();
            })
            .then(function (data) {
                teams = data.teams || {};
                render();
            })
            .catch(function (err) {
                console.error('[roster] load failed', err);
                forEach(mounts, function (mount) {
                    mount.innerHTML = '<p class="roster-error">The roster could not be loaded. ' +
                        'Please refresh the page.</p>';
                });
            });
    }

    function wireToggles() {
        forEach(document.querySelectorAll('.roster-views .view-btn'), function (btn) {
            btn.addEventListener('click', function () {
                var next = btn.dataset.view;
                if (next === viewMode) { return; }
                viewMode = next;
                syncToggles();
                render();
            });
        });
        syncToggles();
    }

    function wireFilms() {
        var modal = document.getElementById('film-modal');
        if (!modal) { return; }

        // Delegated: cards are re-rendered whenever the view toggles.
        document.addEventListener('click', function (e) {
            var card = e.target.closest ? e.target.closest('.pcard--film') : null;
            if (card) { openFilm(card); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeFilm(); return; }
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') { return; }
            var card = e.target && e.target.classList && e.target.classList.contains('pcard--film')
                ? e.target : null;
            if (card) { e.preventDefault(); openFilm(card); }
        });

        modal.addEventListener('click', function (e) {
            if (e.target === modal) { closeFilm(); }
        });
        var close = document.getElementById('film-modal-close');
        if (close) {
            close.addEventListener('click', closeFilm);
            close.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeFilm(); }
            });
        }
    }

    function openFilm(card) {
        var modal = document.getElementById('film-modal');
        var video = document.getElementById('film-player');
        var title = document.getElementById('film-modal-name');
        if (!modal || !video) { return; }

        if (title) { title.textContent = card.getAttribute('data-name') || 'Player film'; }
        var poster = card.getAttribute('data-poster');
        if (poster) { video.setAttribute('poster', poster); } else { video.removeAttribute('poster'); }
        video.src = card.getAttribute('data-film');

        filmReturnFocus = card;
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        var started = video.play();
        if (started && started.catch) { started.catch(function () { /* autoplay refused; controls are there */ }); }
    }

    function closeFilm() {
        var modal = document.getElementById('film-modal');
        var video = document.getElementById('film-player');
        if (!modal || modal.style.display === 'none') { return; }

        if (video) {
            video.pause();
            // Dropping the source stops a download that may be only half done -
            // these films are about thirteen megabytes each.
            video.removeAttribute('src');
            video.load();
        }
        modal.style.display = 'none';
        document.body.style.overflow = '';
        if (filmReturnFocus && filmReturnFocus.focus) { filmReturnFocus.focus(); }
        filmReturnFocus = null;
    }

    function syncToggles() {
        forEach(document.querySelectorAll('.roster-views .view-btn'), function (btn) {
            var on = btn.dataset.view === viewMode;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', String(on));
        });
    }

    function render() {
        if (!teams) { return; }
        forEach(document.querySelectorAll('[data-roster]'), function (mount) {
            var roster = teams[mount.dataset.roster] || [];
            mount.innerHTML = mount.dataset.roster === 'usa'
                ? renderFlat(roster)
                : renderByCountry(roster);
        });
    }

    function renderFlat(players) {
        var sorted = bySurname(players);
        if (viewMode === 'simple') {
            return '<ul class="squad-names squad-names--flat">' +
                sorted.map(nameItem).join('') + '</ul>';
        }
        return '<div class="pcard-grid">' + sorted.map(card).join('') + '</div>';
    }

    function renderByCountry(players) {
        var order = [];
        var groups = {};
        players.forEach(function (p) {
            var c = p.country || 'Other';
            if (!groups[c]) { groups[c] = []; order.push(c); }
            groups[c].push(p);
        });
        return '<div class="squad-countries' +
            (viewMode === 'detailed' ? ' squad-countries--cards' : '') + '">' +
            order.map(function (country) {
                var members = bySurname(groups[country]);
                var body = viewMode === 'simple'
                    ? '<ul class="squad-names">' + members.map(nameItem).join('') + '</ul>'
                    : '<div class="pcard-grid">' + members.map(card).join('') + '</div>';
                return '<div class="squad-group">' +
                    '<h4 class="squad-country">' +
                    '<span class="squad-flag" aria-hidden="true">' + flagFor(country) + '</span>' +
                    esc(country) + '</h4>' + body + '</div>';
            }).join('') + '</div>';
    }

    function nameItem(player) {
        return '<li>' + esc(player.name) + '</li>';
    }

    function card(player) {
        var media = player.photo
            ? '<img src="' + esc(THUMB_DIR + basename(player.photo)) + '" alt="" ' +
              'loading="lazy" decoding="async" width="440" height="550">'
            : INCOGNITO;
        var lines = '';
        if (player.hometown) {
            lines += '<p class="pcard-meta"><span class="pcard-flag" aria-hidden="true">' +
                flagFor(player.country) + '</span>' + esc(player.hometown) + '</p>';
        }
        if (player.school) {
            lines += '<p class="pcard-school">' + esc(player.school) + '</p>';
        }
        // Only a player who consented to appear in detail ever carries a film;
        // data/players.json is written that way by scripts/build-films.mjs.
        var film = player.film
            ? ' pcard--film" role="button" tabindex="0"' +
              ' data-film="' + esc(player.film) + '"' +
              ' data-poster="' + esc(player.filmPoster || '') + '"' +
              ' data-name="' + esc(player.name) + '"' +
              ' aria-label="Play the film about ' + esc(player.name) + '"'
            : '"';
        return '<article class="pcard' + (player.photo ? '' : ' pcard--anon') + film + '>' +
            '<div class="pcard-media">' + media + (player.film ? PLAY : '') + '</div>' +
            '<div class="pcard-body"><h5 class="pcard-name">' + esc(player.name) + '</h5>' +
            lines + '</div></article>';
    }

    function flagFor(country) {
        return country ? (FLAGS[country] || '') : USA_FLAG;
    }

    function bySurname(players) {
        return players.slice().sort(function (a, b) {
            return surname(a.name).localeCompare(surname(b.name)) ||
                a.name.localeCompare(b.name);
        });
    }

    function surname(name) {
        var parts = String(name || '').trim().split(/\s+/);
        return parts[parts.length - 1] || '';
    }

    function basename(path) {
        return String(path).split('/').pop();
    }

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    function forEach(list, fn) {
        Array.prototype.forEach.call(list, fn);
    }
})();
