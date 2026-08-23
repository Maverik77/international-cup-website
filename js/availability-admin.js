(function () {
    var API_URL = 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod/availability';
    var STORAGE_KEY = 'icup-admin-password';

    var currentItems = [];
    var currentFilter = 'all';
    var currentSort = { key: 'updatedAt', dir: 'desc' };

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        var loginBtn = document.getElementById('login-btn');
        var loginInput = document.getElementById('password-input');
        var loginError = document.getElementById('login-error');
        var loginBox = document.getElementById('login-box');
        var dashboard = document.getElementById('dashboard');
        var chips = document.querySelectorAll('.chip');
        var exportBtn = document.getElementById('export-btn');

        var stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
            tryLoad(stored, function (ok) {
                if (ok) { showDashboard(); }
                else { sessionStorage.removeItem(STORAGE_KEY); }
            });
        }

        loginBtn.addEventListener('click', function () {
            var pw = loginInput.value;
            if (!pw) return;
            loginError.hidden = true;
            tryLoad(pw, function (ok) {
                if (ok) {
                    sessionStorage.setItem(STORAGE_KEY, pw);
                    showDashboard();
                } else {
                    loginError.hidden = false;
                }
            });
        });
        loginInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') loginBtn.click(); });

        chips.forEach(function (chip) {
            chip.addEventListener('click', function () {
                chips.forEach(function (c) { c.classList.remove('active'); });
                chip.classList.add('active');
                currentFilter = chip.dataset.filter;
                render();
            });
        });

        exportBtn.addEventListener('click', exportCsv);

        document.addEventListener('click', function (e) {
            var th = e.target.closest('th[data-sortkey]');
            if (!th) return;
            var key = th.dataset.sortkey;
            if (currentSort.key === key) currentSort.dir = currentSort.dir === 'desc' ? 'asc' : 'desc';
            else { currentSort.key = key; currentSort.dir = 'asc'; }
            render();
        });

        function showDashboard() {
            loginBox.hidden = true;
            dashboard.hidden = false;
        }
    }

    function tryLoad(password, cb) {
        fetch(API_URL, { headers: { 'X-Admin-Password': password } })
            .then(function (r) {
                if (r.status === 401) return cb(false);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json().then(function (j) {
                    currentItems = j.items || [];
                    render();
                    cb(true);
                });
            })
            .catch(function (err) {
                console.error('[admin] load failed', err);
                cb(false);
            });
    }

    function filtered() {
        if (currentFilter === 'attending') return currentItems.filter(function (i) { return i.attending; });
        if (currentFilter === 'declined') return currentItems.filter(function (i) { return !i.attending; });
        if (currentFilter === 'updated') return currentItems.filter(function (i) { return (i.submissionCount || 0) > 1; });
        return currentItems;
    }

    function sorted(items) {
        var key = currentSort.key;
        var dir = currentSort.dir === 'desc' ? -1 : 1;
        return items.slice().sort(function (a, b) {
            var av = a[key];
            var bv = b[key];
            if (av === bv) return 0;
            if (av === undefined) return 1;
            if (bv === undefined) return -1;
            return av < bv ? -dir : dir;
        });
    }

    function render() {
        var items = sorted(filtered());
        var attendingCount = currentItems.filter(function (i) { return i.attending; }).length;
        var declinedCount = currentItems.filter(function (i) { return !i.attending; }).length;
        var updatedCount = currentItems.filter(function (i) { return (i.submissionCount || 0) > 1; }).length;
        document.getElementById('summary').textContent =
            attendingCount + ' attending · ' + declinedCount + ' declined · ' + updatedCount + ' updated';

        var tbody = document.getElementById('rows');
        tbody.innerHTML = items.map(function (it) {
            var rowClass = (it.submissionCount || 0) > 1 ? 'updated-row' : '';
            return '<tr class="' + rowClass + '">'
                + td(esc(it.name || ''))
                + td(esc(it.email || ''))
                + td(it.attending ? '<span class="yes">Yes</span>' : '<span class="no">No</span>')
                + td(bool(it.pairingsParty))
                + td(bool(it.day1))
                + td(bool(it.day2))
                + td(fmt(it.firstSubmittedAt))
                + td(fmt(it.updatedAt))
                + td(String(it.submissionCount || 1))
                + '</tr>';
        }).join('');
    }

    function td(html) { return '<td>' + html + '</td>'; }
    function bool(v) { return v ? '<span class="yes">✓</span>' : '<span class="no">–</span>'; }
    function fmt(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleString(); } catch (e) { return esc(iso); } }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function exportCsv() {
        var items = sorted(filtered());
        var header = ['Name', 'Email', 'Attending', 'Party', 'Day1', 'Day2', 'FirstSubmittedAt', 'UpdatedAt', 'SubmissionCount'];
        var rows = items.map(function (it) {
            return [
                it.name || '',
                it.email || '',
                it.attending ? 'Yes' : 'No',
                it.pairingsParty ? 'Yes' : 'No',
                it.day1 ? 'Yes' : 'No',
                it.day2 ? 'Yes' : 'No',
                it.firstSubmittedAt || '',
                it.updatedAt || '',
                String(it.submissionCount || 1),
            ];
        });
        var csv = [header].concat(rows).map(function (r) {
            return r.map(function (v) {
                var s = String(v);
                // OWASP CSV formula-injection guard: prefix cells that Excel/Sheets
                // would evaluate as formulas with a single quote so they render as text.
                if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'availability-2026.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
})();
