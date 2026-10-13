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

    var viewMode = 'detailed';
    var teams = null;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        var mounts = document.querySelectorAll('[data-roster]');
        if (!mounts.length) { return; }
        wireToggles();
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
        return '<article class="pcard' + (player.photo ? '' : ' pcard--anon') + '">' +
            '<div class="pcard-media">' + media + '</div>' +
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
