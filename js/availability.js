(function () {
    var API_URL = 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod/availability';
    // No staging Lambdas are stood up for this feature — staging URL also hits prod API.
    // (Documented in the spec §5.)

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        var form = document.getElementById('availability-form');
        var attendingYes = document.getElementById('attending-yes');
        var attendingNo = document.getElementById('attending-no');
        var daysBlock = document.getElementById('days-block');
        var status = document.getElementById('status');
        var submit = document.getElementById('submit-btn');

        function updateDaysVisibility() {
            var showing = attendingYes.checked;
            daysBlock.hidden = !showing;
        }
        attendingYes.addEventListener('change', updateDaysVisibility);
        attendingNo.addEventListener('change', updateDaysVisibility);
        updateDaysVisibility();

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            status.hidden = true;
            status.textContent = '';
            status.classList.remove('ok', 'err');

            var name = document.getElementById('name').value.trim();
            var email = document.getElementById('email').value.trim();
            var attending = attendingYes.checked;

            if (!name) return showErr('Please enter your name.');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Please enter a valid email.');
            if (!attendingYes.checked && !attendingNo.checked) return showErr('Please choose Yes or No.');

            var body = {
                name: name,
                email: email,
                attending: attending,
                pairingsParty: attending && document.getElementById('day-party').checked,
                day1: attending && document.getElementById('day-1').checked,
                day2: attending && document.getElementById('day-2').checked,
            };

            submit.disabled = true;
            submit.textContent = 'Submitting…';

            fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
                .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
                .then(function (res) {
                    if (res.status !== 200) {
                        return showErr(res.body.message || 'Submission failed. Please try again.');
                    }
                    var parts = [];
                    if (body.pairingsParty) parts.push('Party');
                    if (body.day1) parts.push('Day 1');
                    if (body.day2) parts.push('Day 2');
                    var summary;
                    if (!attending) summary = 'Sorry you can\'t make it this year.';
                    else if (parts.length === 0) summary = 'Coming but no days selected — did you mean to check some?';
                    else summary = 'Coming for: ' + parts.join(' + ') + '.';
                    var lead = res.body.updated ? 'Thanks, ' + name + ' — updated your RSVP. ' : 'Thanks, ' + name + '. ';
                    showOk(lead + summary + ' Check your email for confirmation.');
                })
                .catch(function (err) {
                    console.error('[availability] submit failed', err);
                    showErr('Network error. Please try again.');
                })
                .finally(function () {
                    submit.disabled = false;
                    submit.textContent = 'Submit RSVP';
                });
        });

        function showErr(msg) { status.textContent = msg; status.classList.add('err'); status.hidden = false; return false; }
        function showOk(msg) { status.textContent = msg; status.classList.add('ok'); status.hidden = false; }
    }
})();
