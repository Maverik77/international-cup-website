// Historic Tournament Data Handler

let historicData = null;

// Day 1 Team Matches Data
const DAY1_MATCHES = [
    {
        match_no: 1,
        usa_team: ["Rizzo, Anthony", "Walsh, Thomas"],
        international_team: ["Olivero, Philip", "Perumbala, Bala"],
        results: {
            best_ball: 1,      // +1 for USA
            alternate_shot: -2, // -2 for USA (International wins by 2)
            shamble: -1        // -1 for USA (International wins by 1)
        }
    },
    {
        match_no: 2,
        usa_team: ["Herman, Victor", "Dunn, Tom"],
        international_team: ["Kumar, Anuj", "Venkataramani, Sundu"],
        results: {
            best_ball: -2,     // -2 for USA (International wins by 2)
            alternate_shot: -1, // -1 for USA (International wins by 1)
            shamble: -1        // -1 for USA (International wins by 1)
        }
    },
    {
        match_no: 3,
        usa_team: ["Gillie, Jim", "Kozlowski, Kevin"],
        international_team: ["Jewell, Phillip", "Davuluri, Vijay"],
        results: {
            best_ball: -1,     // -1 for USA (International wins by 1)
            alternate_shot: 0,  // Tied
            shamble: 0         // Tied
        }
    },
    {
        match_no: 4,
        usa_team: ["Altman, John", "Covino, Scott"],
        international_team: ["Neilson, Robert", "Pearce, Tim"],
        results: {
            best_ball: 2,      // +2 for USA
            alternate_shot: -1, // -1 for USA (International wins by 1)
            shamble: 0         // Tied
        }
    },
    {
        match_no: 5,
        usa_team: ["Barnes, Keith", "Esposito, Victor"],
        international_team: ["Bae, Jaejin", "Yedulla, Surender"],
        results: {
            best_ball: "Lost 2 & 1",  // USA lost 2 & 1
            alternate_shot: 1,        // +1 for USA
            shamble: 0               // Tied
        }
    },
    {
        match_no: 6,
        usa_team: ["Freedman, Mitch", "Gallo, Bob"],
        international_team: ["Muthusamy, Sridhar", "Bharwani, Uttam"],
        results: {
            best_ball: "Lost 3 & 2",  // USA lost 3 & 2
            alternate_shot: -1,       // -1 for USA (International wins by 1)
            shamble: "Lost 2 & 1"    // USA lost 2 & 1
        }
    },
    {
        match_no: 7,
        usa_team: ["Chiari, Derek", "Sutch, Brett"],
        international_team: ["Hazzard, Troy", "Wagner, Erik"],
        results: {
            best_ball: "Won 2 & 1",   // USA won 2 & 1
            alternate_shot: "Won 2 & 1", // USA won 2 & 1
            shamble: 0               // Tied
        }
    },
    {
        match_no: 8,
        usa_team: ["Kritsberg, Jeff", "Hoff, Philip"],
        international_team: ["Bae, Jun", "Kim, Michael"],
        results: {
            best_ball: "Lost 2 & 1",  // USA lost 2 & 1
            alternate_shot: "Lost 3 & 2", // USA lost 3 & 2
            shamble: 0               // Tied
        }
    },
    {
        match_no: 9,
        usa_team: ["O'Braitis, Robert", "Taliaferro, Will"],
        international_team: ["Siu, James", "Wickham, Daren"],
        results: {
            best_ball: 0,            // Tied
            alternate_shot: -1,       // -1 for USA (International wins by 1)
            shamble: "Lost 2 & 1"    // USA lost 2 & 1
        }
    },
    {
        match_no: 10,
        usa_team: ["Crouse, Christopher", "McNamee, Michael"],
        international_team: ["Ansari, Soban", "Lin, Terry"],
        results: {
            best_ball: 2,            // +2 for USA
            alternate_shot: 1,        // +1 for USA
            shamble: 0               // Tied
        }
    },
    {
        match_no: 11,
        usa_team: ["Murphy, Thomas", "Corkhill, Norm"],
        international_team: ["Woodisse, Philip", "Lambert, Stefan"],
        results: {
            best_ball: 0,            // Tied
            alternate_shot: -1,       // -1 for USA (International wins by 1)
            shamble: -1              // -1 for USA (International wins by 1)
        }
    },
    {
        match_no: 12,
        usa_team: ["Galkin, Jeff", "Haufler, Kurt"],
        international_team: ["Hedges, Ben", "Silpacharn, Jack"],
        results: {
            best_ball: 0,            // Tied
            alternate_shot: "Lost 3 & 2", // USA lost 3 & 2
            shamble: -2              // -2 for USA (International wins by 2)
        }
    }
];

// Course Data - RTJ2 (Lansdowne - Robert Trent Jones 2 Course)
const COURSE_DATA = {
    RTJ2: {
        name: "Lansdowne - Robert Trent Jones 2 Course",
        holes: [
            { hole: 1, par: 4 },
            { hole: 2, par: 4 },
            { hole: 3, par: 4 },
            { hole: 4, par: 3 }, // Par 3
            { hole: 5, par: 5 }, // Par 5
            { hole: 6, par: 4 },
            { hole: 7, par: 3 }, // Par 3
            { hole: 8, par: 5 }, // Par 5
            { hole: 9, par: 4 },
            { hole: 10, par: 4 },
            { hole: 11, par: 5 }, // Par 5
            { hole: 12, par: 4 },
            { hole: 13, par: 3 }, // Par 3
            { hole: 14, par: 4 },
            { hole: 15, par: 4 },
            { hole: 16, par: 5 }, // Par 5
            { hole: 17, par: 3 }, // Par 3
            { hole: 18, par: 4 }
        ]
    }
};

// Get par for a specific hole
function getHolePar(holeNumber, course = 'RTJ2') {
    const courseData = COURSE_DATA[course];
    if (!courseData) return 4; // Default to par 4
    
    const hole = courseData.holes.find(h => h.hole === holeNumber);
    return hole ? hole.par : 4;
}

// Initialize historic data functionality
document.addEventListener('DOMContentLoaded', function() {
    setupHistoricDataHandlers();
});

function setupHistoricDataHandlers() {
    const view2024Btn = document.getElementById('view-2024-results');
    if (view2024Btn) {
        view2024Btn.addEventListener('click', show2024ResultsModal);
    }
}

async function loadHistoricData() {
    if (historicData) return historicData;
    
    try {
        const response = await fetch('../single_matches_perhole.json');
        if (!response.ok) {
            throw new Error('Failed to load historic data');
        }
        historicData = await response.json();
        return historicData;
    } catch (error) {
        console.error('Error loading historic data:', error);
        showNotification('Failed to load historic tournament data', 'error');
        return null;
    }
}

function show2024ResultsModal() {
    const modal = document.createElement('div');
    modal.className = 'modal results-overview-modal';
    modal.style.display = 'block';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
                <h2>2024 International Cup Results</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="tournament-overview">
                    <div class="tournament-summary">
                        <h3>Tournament Summary</h3>
                        <div class="summary-grid">
                            <div class="summary-item">
                                <span class="summary-label">Location:</span>
                                <span class="summary-value">Lansdowne Resort</span>
                            </div>
                            <div class="summary-item">
                                <span class="summary-label">Dates:</span>
                                <span class="summary-value">October 17-19, 2024</span>
                            </div>
                            <div class="summary-item">
                                <span class="summary-label">Format:</span>
                                <span class="summary-value">Team USA vs International</span>
                            </div>
                            <div class="summary-item">
                                <span class="summary-label">Overall Winner:</span>
                                <span class="summary-value winner">Team International</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="day-selection">
                        <h3>Select Tournament Day</h3>
                        <div class="day-buttons">
                            <button class="day-btn available" onclick="showDay1Results()">
                                <div class="day-title">Day 1</div>
                                <div class="day-subtitle">Team Matches</div>
                                <div class="day-status">12 Matches Available</div>
                            </button>
                            <button class="day-btn available" onclick="showDay2Results()">
                                <div class="day-title">Day 2</div>
                                <div class="day-subtitle">Singles Matches</div>
                                <div class="day-status">24 Matches Available</div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close on outside click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function showDay1Results() {
    // Close the overview modal first
    const overviewModal = document.querySelector('.results-overview-modal');
    if (overviewModal) {
        overviewModal.remove();
    }
    
    // Show the detailed Day 1 results
    showDay1Modal();
}

function showDay1Modal() {
    const modal = document.createElement('div');
    modal.className = 'modal day1-results-modal';
    modal.style.display = 'block';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 1200px; max-height: 90vh; overflow-y: auto;">
            <div class="modal-header">
                <h2>2024 International Cup - Day 1 Team Matches</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="day1-info">
                    <div class="tournament-format">
                        <h3>Tournament Format</h3>
                        <div class="format-details">
                            <div class="format-item">
                                <span class="format-label">Course:</span>
                                <span class="format-value">The Norman Course at Lansdowne</span>
                            </div>
                            <div class="format-item">
                                <span class="format-label">Format:</span>
                                <span class="format-value">Team Matches (2-person teams)</span>
                            </div>
                            <div class="format-item">
                                <span class="format-label">Scoring:</span>
                                <span class="format-value">6 holes Best Ball, 6 holes Alternate Shot, 6 holes Shamble</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="day1-summary">
                        <h3>Day 1 Results Summary</h3>
                        <div class="summary-stats">
                            <div class="stat-item">
                                <span class="stat-label">Total Matches:</span>
                                <span class="stat-value">${DAY1_MATCHES.length}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Team USA Total Points:</span>
                                <span class="stat-value">24</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">International Total Points:</span>
                                <span class="stat-value">48</span>
                            </div>
                        </div>
                        
                        <div class="format-breakdown">
                            <h4>Points by Format</h4>
                            <div class="format-stats">
                                <div class="format-stat">
                                    <span class="format-name">Best Ball:</span>
                                    <span class="format-scores">
                                        <span class="usa-score">USA: 11</span>
                                        <span class="intl-score">INT: 13</span>
                                    </span>
                                </div>
                                <div class="format-stat">
                                    <span class="format-name">Alternate Shot:</span>
                                    <span class="format-scores">
                                        <span class="usa-score">USA: 7</span>
                                        <span class="intl-score">INT: 17</span>
                                    </span>
                                </div>
                                <div class="format-stat">
                                    <span class="format-name">Shamble:</span>
                                    <span class="format-scores">
                                        <span class="usa-score">USA: 6</span>
                                        <span class="intl-score">INT: 18</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="day1-matches">
                    <h3>Match Results</h3>
                    <div class="matches-grid">
                        ${generateDay1MatchesHTML()}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close on outside click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function showDay2Results() {
    // Close the overview modal first
    const overviewModal = document.querySelector('.results-overview-modal');
    if (overviewModal) {
        overviewModal.remove();
    }
    
    // Show the detailed Day 2 results
    await showHistoricDataModal();
}

async function showHistoricDataModal() {
    const data = await loadHistoricData();
    if (!data || !data.matches) {
        showNotification('No historic data available', 'error');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal historic-data-modal';
    modal.style.display = 'block';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 1200px; max-height: 90vh; overflow-y: auto;">
            <div class="modal-header">
                <h2>2024 International Cup - Day 2 Singles Matches</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="historic-data-controls">
                    <div class="data-summary">
                        <h3>Day 2 Singles Results</h3>
                        <div class="summary-stats">
                            <div class="stat-item">
                                <span class="stat-label">Total Matches:</span>
                                <span class="stat-value">${data.matches.length}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Team USA Wins:</span>
                                <span class="stat-value" id="usa-wins">-</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">International Wins:</span>
                                <span class="stat-value" id="intl-wins">-</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Ties:</span>
                                <span class="stat-value" id="ties">-</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="historic-data-content">
                    <div class="matches-overview">
                        ${generateMatchesOverview(data.matches)}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Calculate and display summary stats
    calculateSummaryStats(data.matches);
    
    // Setup click handlers for match headers
    setupMatchClickHandlers();
    
    // Close on outside click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function setupMatchClickHandlers() {
    // Add event listeners to all clickable headers
    const clickableHeaders = document.querySelectorAll('.clickable-header');
    
    clickableHeaders.forEach((header, index) => {
        const matchNo = header.getAttribute('data-match-no');
        
        // Remove any existing listeners
        header.replaceWith(header.cloneNode(true));
        const newHeader = document.querySelectorAll('.clickable-header')[index];
        
        newHeader.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            showGolfScorecard(parseInt(matchNo));
        });
    });
}

function calculateSummaryStats(matches) {
    let usaWins = 0;
    let intlWins = 0;
    let ties = 0;
    
    matches.forEach(match => {
        const usaNet = match.usa_player.net_total;
        const intlNet = match.international_player.net_total;
        
        if (usaNet < intlNet) {
            usaWins++;
        } else if (intlNet < usaNet) {
            intlWins++;
        } else {
            ties++;
        }
    });
    
    document.getElementById('usa-wins').textContent = usaWins;
    document.getElementById('intl-wins').textContent = intlWins;
    document.getElementById('ties').textContent = ties;
}

function generateMatchesOverview(matches) {
    return `
        <div class="matches-overview-grid">
            ${matches.map(match => {
                const usaNetOut = calculateNetScore(match.holes.slice(0, 9), 'usa');
                const usaNetIn = calculateNetScore(match.holes.slice(9, 18), 'usa');
                const intlNetOut = calculateNetScore(match.holes.slice(0, 9), 'international');
                const intlNetIn = calculateNetScore(match.holes.slice(9, 18), 'international');
                
                return `
                <div class="match-overview-card">
                    <div class="match-header clickable-header" onclick="showGolfScorecard(${match.match_no})" data-match-no="${match.match_no}">
                        <div class="match-title">
                            <h4>Match ${match.match_no}</h4>
                            <div class="match-scores">
                                <span class="score-breakdown">Front: ${usaNetOut}-${intlNetOut} | Back: ${usaNetIn}-${intlNetIn} | Total: ${match.usa_player.net_total}-${match.international_player.net_total}</span>
                            </div>
                        </div>
                        <div class="match-winner">
                            ${getMatchWinnerFlag(match)}
                        </div>
                    </div>
                    <div class="players">
                        <div class="player usa-player">
                            <div class="player-name">${match.usa_player.name}</div>
                            <div class="player-details">
                                <span class="handicap">HCP: ${match.usa_player.handicap}</span>
                                <span class="score">Net: ${match.usa_player.net_total}</span>
                            </div>
                        </div>
                        <div class="vs">vs</div>
                        <div class="player intl-player">
                            <div class="player-name">${match.international_player.name}</div>
                            <div class="player-details">
                                <span class="handicap">HCP: ${match.international_player.handicap}</span>
                                <span class="score">Net: ${match.international_player.net_total}</span>
                            </div>
                        </div>
                    </div>
                    <button class="view-scorecard-btn" onclick="showGolfScorecard(${match.match_no})">
                        View Detailed Scorecard
                    </button>
                </div>
            `}).join('')}
        </div>
    `;
}

function generateMatchSummary(matches) {
    return `
        <div class="match-summary-grid">
            ${matches.map(match => `
                <div class="match-summary-card">
                    <div class="match-header">
                        <h4>Match ${match.match_no}</h4>
                        <div class="match-result ${getMatchResult(match)}">
                            ${getMatchResultText(match)}
                        </div>
                    </div>
                    <div class="players">
                        <div class="player usa-player">
                            <div class="player-name">${match.usa_player.name}</div>
                            <div class="player-details">
                                <span class="handicap">HCP: ${match.usa_player.handicap}</span>
                                <span class="score">Net: ${match.usa_player.net_total}</span>
                            </div>
                        </div>
                        <div class="vs">vs</div>
                        <div class="player intl-player">
                            <div class="player-name">${match.international_player.name}</div>
                            <div class="player-details">
                                <span class="handicap">HCP: ${match.international_player.handicap}</span>
                                <span class="score">Net: ${match.international_player.net_total}</span>
                            </div>
                        </div>
                    </div>
                    <button class="view-details-btn" onclick="showMatchDetails(${match.match_no})">
                        View Hole-by-Hole
                    </button>
                </div>
            `).join('')}
        </div>
    `;
}

function generateDetailedView(matches) {
    return `
        <div class="detailed-matches">
            ${matches.map(match => `
                <div class="detailed-match" id="match-${match.match_no}">
                    <div class="detailed-match-header">
                        <h4>Match ${match.match_no} - Detailed Scorecard</h4>
                        <div class="match-players">
                            <div class="usa-summary">
                                <strong>${match.usa_player.name}</strong> (HCP: ${match.usa_player.handicap})
                                <br>Net Total: ${match.usa_player.net_total}
                            </div>
                            <div class="intl-summary">
                                <strong>${match.international_player.name}</strong> (HCP: ${match.international_player.handicap})
                                <br>Net Total: ${match.international_player.net_total}
                            </div>
                        </div>
                    </div>
                    <div class="scorecard">
                        <table class="scorecard-table">
                            <thead>
                                <tr>
                                    <th>Hole</th>
                                    <th colspan="2">USA</th>
                                    <th colspan="2">International</th>
                                    <th>Result</th>
                                </tr>
                                <tr>
                                    <th></th>
                                    <th>Gross</th>
                                    <th>Net</th>
                                    <th>Gross</th>
                                    <th>Net</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${match.holes.map(hole => `
                                    <tr class="hole-row">
                                        <td class="hole-number">${hole.hole}</td>
                                        <td class="usa-gross">${hole.usa.strokes}${hole.usa.stroke_received ? '*' : ''}</td>
                                        <td class="usa-net">${hole.usa.net}</td>
                                        <td class="intl-gross">${hole.international.strokes}${hole.international.stroke_received ? '*' : ''}</td>
                                        <td class="intl-net">${hole.international.net}</td>
                                        <td class="hole-result ${getHoleResult(hole)}">
                                            ${getHoleResultText(hole)}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function getMatchResult(match) {
    const usaNet = match.usa_player.net_total;
    const intlNet = match.international_player.net_total;
    
    if (usaNet < intlNet) return 'usa-win';
    if (intlNet < usaNet) return 'intl-win';
    return 'tie';
}

function getMatchResultText(match) {
    const usaNet = match.usa_player.net_total;
    const intlNet = match.international_player.net_total;
    
    if (usaNet < intlNet) return 'USA Wins';
    if (intlNet < usaNet) return 'International Wins';
    return 'Tie';
}

function getHoleResult(hole) {
    if (hole.usa.result === 'win') return 'usa-win';
    if (hole.international.result === 'win') return 'intl-win';
    return 'tie';
}

function getHoleResultText(hole) {
    if (hole.usa.result === 'win') return 'USA';
    if (hole.international.result === 'win') return 'INT';
    return 'TIE';
}

function calculateNetScore(holes, player) {
    return holes.reduce((total, hole) => {
        if (hole[player].strokes === 0) {
            // Unplayed hole - use net par
            const netPar = hole[player].stroke_received ? getHolePar(hole.hole) - 1 : getHolePar(hole.hole);
            return total + netPar;
        }
        const netStrokes = hole[player].stroke_received ? hole[player].strokes - 1 : hole[player].strokes;
        return total + netStrokes;
    }, 0);
}

function getMatchWinnerFlag(match) {
    const usaNet = match.usa_player.net_total;
    const intlNet = match.international_player.net_total;
    
    if (usaNet < intlNet) {
        return '<span class="winner-flag usa-flag">🇺🇸</span>';
    } else if (intlNet < usaNet) {
        return '<span class="winner-flag intl-flag">🌍</span>';
    } else {
        return '<span class="winner-flag tie-flag">🤝</span>';
    }
}

function calculateHoleByHoleStatus(holes) {
    let frontNineStatus = 0;
    let backNineStatus = 0;
    const holeStatuses = [];
    
    holes.forEach((hole, index) => {
        if (index < 9) {
            // Front nine - running total
            if (hole.usa.result === 'win') {
                frontNineStatus += 1;
            } else if (hole.usa.result === 'loss') {
                frontNineStatus -= 1;
            }
            holeStatuses.push(frontNineStatus);
        } else {
            // Back nine - restart from 0
            if (hole.usa.result === 'win') {
                backNineStatus += 1;
            } else if (hole.usa.result === 'loss') {
                backNineStatus -= 1;
            }
            holeStatuses.push(backNineStatus);
        }
    });
    
    return {
        holes: holeStatuses,
        frontNine: frontNineStatus,
        backNine: backNineStatus
    };
}

function getStatusClass(status) {
    if (status > 0) return 'status-up';
    if (status < 0) return 'status-down';
    return 'status-even';
}

function setupViewSwitching(modal) {
    const viewBtns = modal.querySelectorAll('.view-btn');
    const dataViews = modal.querySelectorAll('.data-view');
    
    viewBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const viewType = this.dataset.view;
            
            // Update button states
            viewBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Update view visibility
            dataViews.forEach(view => {
                if (view.id === `${viewType}-view`) {
                    view.style.display = 'block';
                    view.classList.add('active');
                } else {
                    view.style.display = 'none';
                    view.classList.remove('active');
                }
            });
        });
    });
}

function showMatchDetails(matchNo) {
    const detailedViewBtn = document.querySelector('.view-btn[data-view="detailed"]');
    if (detailedViewBtn) {
        detailedViewBtn.click();
        
        // Scroll to the specific match
        setTimeout(() => {
            const matchElement = document.getElementById(`match-${matchNo}`);
            if (matchElement) {
                matchElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                matchElement.style.backgroundColor = '#f0f8ff';
                setTimeout(() => {
                    matchElement.style.backgroundColor = '';
                }, 2000);
            }
        }, 100);
    }
}

function showGolfScorecard(matchNo) {
    if (!historicData || !historicData.matches) {
        showNotification('Tournament data not loaded yet. Please try again.', 'error');
        return;
    }
    
    const match = historicData.matches.find(m => m.match_no === matchNo);
    
    if (!match) {
        showNotification('Match data not found', 'error');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal golf-scorecard-modal';
    modal.style.display = 'block';
    modal.style.zIndex = '1002'; // Higher than other modals
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 1000px; overflow-x: auto;">
            <div class="modal-header">
                <h2>Match ${match.match_no} - Official Scorecard</h2>
                <span class="close" onclick="closeGolfScorecard(this)">&times;</span>
            </div>
            <div class="modal-body">
                <div class="golf-scorecard">
                    <div class="scorecard-header">
                        <div class="course-info">
                            <h3>Lansdowne - Robert Trent Jones 2 Course</h3>
                            <p>2024 International Cup - Day 2 Singles • October 18, 2024</p>
                        </div>
                    </div>
                    
                    <div class="players-info">
                        <div class="player-info usa">
                            <h4>${match.usa_player.name}</h4>
                            <p>Team USA • Handicap: ${match.usa_player.handicap}</p>
                        </div>
                        <div class="vs-divider">VS</div>
                        <div class="player-info international">
                            <h4>${match.international_player.name}</h4>
                            <p>Team International • Handicap: ${match.international_player.handicap}</p>
                        </div>
                    </div>
                    
                    <div class="scorecard-table-container">
                        ${generateGolfScorecardTable(match)}
                    </div>
                    
                    <div class="scorecard-legend">
                        <div class="legend-item">
                            <span class="legend-symbol birdie">3</span> = Birdie
                        </div>
                        <div class="legend-item">
                            <span class="legend-symbol bogey">5</span> = Bogey
                        </div>
                        <div class="legend-item">
                            <span class="legend-symbol double-bogey">6</span> = Double Bogey+
                        </div>
                        <div class="legend-item">
                            <span class="legend-symbol stroke">*</span> = Stroke Received
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close on outside click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function closeGolfScorecard(closeButton) {
    // Find the specific golf scorecard modal and remove it
    const scorecardModal = closeButton.closest('.golf-scorecard-modal');
    if (scorecardModal) {
        scorecardModal.remove();
    }
}

function generateGolfScorecardTable(match) {
    const holes = match.holes;
    const frontNine = holes.slice(0, 9);
    const backNine = holes.slice(9, 18);
    
    // Calculate net scores for front and back nine
    const usaNetOut = calculateNetScore(frontNine, 'usa');
    const usaNetIn = calculateNetScore(backNine, 'usa');
    const intlNetOut = calculateNetScore(frontNine, 'international');
    const intlNetIn = calculateNetScore(backNine, 'international');
    
    // Calculate hole-by-hole match status from USA player's perspective
    const holeStatus = calculateHoleByHoleStatus(holes);
    
    return `
        <table class="golf-scorecard-table">
            <thead>
                <tr class="hole-numbers">
                    <th class="hole-label">Hole</th>
                    ${frontNine.map(hole => `<th class="hole-number">${hole.hole}</th>`).join('')}
                    <th class="out-total">OUT</th>
                    ${backNine.map(hole => `<th class="hole-number">${hole.hole}</th>`).join('')}
                    <th class="in-total">IN</th>
                    <th class="total">TOTAL</th>
                </tr>
                <tr class="par-row">
                    <th class="par-label">Par</th>
                    ${frontNine.map(hole => `<th class="par-cell">${getHolePar(hole.hole)}</th>`).join('')}
                    <th class="par-total">${frontNine.reduce((sum, hole) => sum + getHolePar(hole.hole), 0)}</th>
                    ${backNine.map(hole => `<th class="par-cell">${getHolePar(hole.hole)}</th>`).join('')}
                    <th class="par-total">${backNine.reduce((sum, hole) => sum + getHolePar(hole.hole), 0)}</th>
                    <th class="par-total">${holes.reduce((sum, hole) => sum + getHolePar(hole.hole), 0)}</th>
                </tr>
            </thead>
            <tbody>
                <tr class="usa-gross-row">
                    <td class="player-label">${match.usa_player.name} (Gross)</td>
                    ${frontNine.map(hole => `<td class="score-cell">${formatGolfScore(hole.usa.strokes, getHolePar(hole.hole), hole.usa.stroke_received)}</td>`).join('')}
                    <td class="subtotal">${match.usa_player.gross_out}</td>
                    ${backNine.map(hole => `<td class="score-cell">${formatGolfScore(hole.usa.strokes, getHolePar(hole.hole), hole.usa.stroke_received)}</td>`).join('')}
                    <td class="subtotal">${match.usa_player.gross_in}</td>
                    <td class="total-score">${match.usa_player.gross_total}</td>
                </tr>
                <tr class="usa-net-row">
                    <td class="player-label">${match.usa_player.name} (Net)</td>
                    ${frontNine.map(hole => {
                        if (hole.usa.strokes === 0) {
                            const netPar = hole.usa.stroke_received ? getHolePar(hole.hole) - 1 : getHolePar(hole.hole);
                            return `<td class="score-cell"><span class="unplayed-hole">X (${netPar})</span></td>`;
                        }
                        const netStrokes = hole.usa.stroke_received ? hole.usa.strokes - 1 : hole.usa.strokes;
                        return `<td class="score-cell">${formatGolfScore(netStrokes, getHolePar(hole.hole), false)}</td>`;
                    }).join('')}
                    <td class="subtotal">${usaNetOut}</td>
                    ${backNine.map(hole => {
                        if (hole.usa.strokes === 0) {
                            const netPar = hole.usa.stroke_received ? getHolePar(hole.hole) - 1 : getHolePar(hole.hole);
                            return `<td class="score-cell"><span class="unplayed-hole">X (${netPar})</span></td>`;
                        }
                        const netStrokes = hole.usa.stroke_received ? hole.usa.strokes - 1 : hole.usa.strokes;
                        return `<td class="score-cell">${formatGolfScore(netStrokes, getHolePar(hole.hole), false)}</td>`;
                    }).join('')}
                    <td class="subtotal">${usaNetIn}</td>
                    <td class="total-score">${usaNetOut + usaNetIn}</td>
                </tr>
                <tr class="intl-gross-row">
                    <td class="player-label">${match.international_player.name} (Gross)</td>
                    ${frontNine.map(hole => `<td class="score-cell">${formatGolfScore(hole.international.strokes, getHolePar(hole.hole), hole.international.stroke_received)}</td>`).join('')}
                    <td class="subtotal">${match.international_player.gross_out}</td>
                    ${backNine.map(hole => `<td class="score-cell">${formatGolfScore(hole.international.strokes, getHolePar(hole.hole), hole.international.stroke_received)}</td>`).join('')}
                    <td class="subtotal">${match.international_player.gross_in}</td>
                    <td class="total-score">${match.international_player.gross_total}</td>
                </tr>
                <tr class="intl-net-row">
                    <td class="player-label">${match.international_player.name} (Net)</td>
                    ${frontNine.map(hole => {
                        if (hole.international.strokes === 0) {
                            const netPar = hole.international.stroke_received ? getHolePar(hole.hole) - 1 : getHolePar(hole.hole);
                            return `<td class="score-cell"><span class="unplayed-hole">X (${netPar})</span></td>`;
                        }
                        const netStrokes = hole.international.stroke_received ? hole.international.strokes - 1 : hole.international.strokes;
                        return `<td class="score-cell">${formatGolfScore(netStrokes, getHolePar(hole.hole), false)}</td>`;
                    }).join('')}
                    <td class="subtotal">${intlNetOut}</td>
                    ${backNine.map(hole => {
                        if (hole.international.strokes === 0) {
                            const netPar = hole.international.stroke_received ? getHolePar(hole.hole) - 1 : getHolePar(hole.hole);
                            return `<td class="score-cell"><span class="unplayed-hole">X (${netPar})</span></td>`;
                        }
                        const netStrokes = hole.international.stroke_received ? hole.international.strokes - 1 : hole.international.strokes;
                        return `<td class="score-cell">${formatGolfScore(netStrokes, getHolePar(hole.hole), false)}</td>`;
                    }).join('')}
                    <td class="subtotal">${intlNetIn}</td>
                    <td class="total-score">${intlNetOut + intlNetIn}</td>
                </tr>
                <tr class="match-status-row">
                    <td class="player-label">Match Status (${match.usa_player.name.split(',')[0]})</td>
                    ${frontNine.map((hole, index) => `<td class="status-cell ${getStatusClass(holeStatus.holes[index])}">${holeStatus.holes[index] > 0 ? '+' + holeStatus.holes[index] : holeStatus.holes[index]}</td>`).join('')}
                    <td class="status-subtotal">${holeStatus.frontNine > 0 ? '+' + holeStatus.frontNine : holeStatus.frontNine}</td>
                    ${backNine.map((hole, index) => `<td class="status-cell ${getStatusClass(holeStatus.holes[index + 9])}">${holeStatus.holes[index + 9] > 0 ? '+' + holeStatus.holes[index + 9] : holeStatus.holes[index + 9]}</td>`).join('')}
                    <td class="status-subtotal">${holeStatus.backNine > 0 ? '+' + holeStatus.backNine : holeStatus.backNine}</td>
                    <td class="status-empty"></td>
                </tr>
            </tbody>
        </table>
    `;
}

function formatGolfScore(strokes, par, strokeReceived) {
    // Handle null or undefined strokes
    if (strokes === null || strokes === undefined) {
        strokes = 0;
    }
    
    // Show "X" for unplayed holes (strokes = 0) with net par score
    if (strokes === 0) {
        const netPar = strokeReceived ? par - 1 : par;
        return `<span class="unplayed-hole">X (${netPar})</span>`;
    }
    
    let scoreClass = '';
    let scoreText = strokes.toString();
    
    if (strokeReceived) {
        scoreText += '*';
    }
    
    const scoreToPar = strokes - par;
    
    if (scoreToPar <= -2) {
        // Eagle or better - double circle
        scoreClass = 'eagle';
        scoreText = `<span class="score-symbol double-circle">${scoreText}</span>`;
    } else if (scoreToPar === -1) {
        // Birdie - circle
        scoreClass = 'birdie';
        scoreText = `<span class="score-symbol circle">${scoreText}</span>`;
    } else if (scoreToPar === 1) {
        // Bogey - square
        scoreClass = 'bogey';
        scoreText = `<span class="score-symbol square">${scoreText}</span>`;
    } else if (scoreToPar >= 2) {
        // Double bogey or worse - double square
        scoreClass = 'double-bogey';
        scoreText = `<span class="score-symbol double-square">${scoreText}</span>`;
    }
    
    return scoreText;
}

function generateDay1MatchesHTML() {
    return DAY1_MATCHES.map(match => `
        <div class="day1-match-card compact">
            <div class="match-header">
                <h4>Match ${match.match_no}</h4>
                <div class="overall-result ${getDay1OverallResult(match)}">
                    ${getDay1OverallResultText(match)}
                </div>
            </div>
            
            <div class="teams-boxes">
                <div class="team-box usa-box">
                    <div class="team-flag">🇺🇸</div>
                    <div class="player-name">${match.usa_team[0]}</div>
                    <div class="player-name">${match.usa_team[1]}</div>
                </div>
                <div class="vs-divider">vs</div>
                <div class="team-box intl-box">
                    <div class="team-flag">🌍</div>
                    <div class="player-name">${match.international_team[0]}</div>
                    <div class="player-name">${match.international_team[1]}</div>
                </div>
            </div>
            
            <div class="format-boxes">
                <div class="format-box ${getFormatResultClass(match.results.best_ball)}">
                    <div class="format-name">Best Ball</div>
                    <div class="format-result">${formatDay1Result(match.results.best_ball)}</div>
                </div>
                <div class="format-box ${getFormatResultClass(match.results.alternate_shot)}">
                    <div class="format-name">Alternate Shot</div>
                    <div class="format-result">${formatDay1Result(match.results.alternate_shot)}</div>
                </div>
                <div class="format-box ${getFormatResultClass(match.results.shamble)}">
                    <div class="format-name">Shamble</div>
                    <div class="format-result">${formatDay1Result(match.results.shamble)}</div>
                </div>
            </div>
        </div>
    `).join('');
}


function getDay1OverallResult(match) {
    let usaWins = 0;
    let intlWins = 0;
    
    // Count format wins
    Object.values(match.results).forEach(result => {
        if (typeof result === 'string') {
            if (result.includes('Won')) {
                usaWins++;
            } else if (result.includes('Lost')) {
                intlWins++;
            }
        } else if (typeof result === 'number') {
            if (result > 0) {
                usaWins++;
            } else if (result < 0) {
                intlWins++;
            }
        }
    });
    
    if (usaWins > intlWins) return 'usa-win';
    if (intlWins > usaWins) return 'intl-win';
    return 'tie';
}

function getDay1OverallResultText(match) {
    const result = getDay1OverallResult(match);
    if (result === 'usa-win') return 'USA Wins';
    if (result === 'intl-win') return 'International Wins';
    return 'Tie';
}

function formatDay1Result(result) {
    if (typeof result === 'string') {
        return result;
    } else if (typeof result === 'number') {
        if (result > 0) return `+${result}`;
        if (result < 0) return result.toString();
        return 'Tied';
    }
    return 'Tied';
}

function getFormatResultClass(result) {
    if (typeof result === 'string') {
        if (result.includes('Won')) return 'usa-win';
        if (result.includes('Lost')) return 'intl-win';
        return 'tie';
    } else if (typeof result === 'number') {
        if (result > 0) return 'usa-win';
        if (result < 0) return 'intl-win';
        return 'tie';
    }
    return 'tie';
}

// Global functions
window.showGolfScorecard = showGolfScorecard;
window.showDay1Results = showDay1Results;
window.showDay2Results = showDay2Results;
window.show2024Results = show2024ResultsModal;
window.closeGolfScorecard = closeGolfScorecard;

// Global function for match details
window.showMatchDetails = showMatchDetails;
