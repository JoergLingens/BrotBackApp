// ─────────────────────────────────────────────
// BrotBack App – Core Logic
// ─────────────────────────────────────────────



let currentRecipe = null;
let scheduledTimers = [];
let fetchAbortController = null;
let activeStepsData = null;

// ─── RESET APP ───────────────────────────────
function resetApp() {
    // Abort any in-progress fetch
    if (fetchAbortController) { fetchAbortController.abort(); fetchAbortController = null; }
    // Cancel timers
    cancelAllTimers();
    // Reset state
    currentRecipe = null;
    activeStepsData = null;
    searchInput.value = '';
    searchInput.focus();
    // Reset UI
    detailPanel.classList.add('hidden');
    schedulerEl.classList.add('hidden');
    nextStepEl.classList.add('hidden');
    loadingEl.style.display = 'none';
    timelineEl.innerHTML = '';
    ingredientsEl.innerHTML = '';
    stepsEl.innerHTML = '';
    welcomeEl.style.display = 'block';
}

// ─── DOM refs ───────────────────────────────
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const detailPanel = document.getElementById('detail-panel');
const ingredientsEl = document.getElementById('ingredients');
const stepsEl = document.getElementById('steps');
const recipeTitle = document.getElementById('recipe-title');
const recipeLink = document.getElementById('recipe-link');
const schedulerEl = document.getElementById('scheduler');
const startTimeEl = document.getElementById('start-time');
const timelineEl = document.getElementById('timeline');
const notifBanner = document.getElementById('notif-banner');
const notifBtn = document.getElementById('notif-btn');
const loadingEl = document.getElementById('loading');
const welcomeEl = document.getElementById('welcome');
const nextStepEl = document.getElementById('next-step-banner');

// ─── SEARCH ENGINE ──────────────────────────
function normalise(str) {
    return str.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss');
}

function scoreMatch(recipe, query) {
    const n = normalise(recipe.name);
    const q = normalise(query);
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.includes(q)) return 60;
    // word match
    const words = q.split(/\s+/);
    const matchedWords = words.filter(w => n.includes(w));
    if (matchedWords.length === words.length) return 40;
    if (matchedWords.length > 0) return 20 * (matchedWords.length / words.length);
    return 0;
}

searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (query.length < 2) {
        searchResults.innerHTML = '';
        searchResults.classList.remove('active');
        return;
    }
    const results = RECIPE_INDEX
        .map(r => ({ ...r, score: scoreMatch(r, query) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);

    renderSearchResults(results);
});

function renderSearchResults(results) {
    searchResults.innerHTML = '';
    if (results.length === 0) {
        searchResults.innerHTML = '<li class="no-result">Kein Rezept gefunden</li>';
        searchResults.classList.add('active');
        return;
    }
    results.forEach(r => {
        const li = document.createElement('li');
        li.textContent = r.name;
        li.addEventListener('click', () => selectRecipe(r));
        searchResults.appendChild(li);
    });
    searchResults.classList.add('active');
}

// Close dropdown on outside click
document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrapper')) {
        searchResults.classList.remove('active');
    }
});

// ─── RECIPE LOADER ──────────────────────────
let selectRecipeId = 0; // incremented on every call; stale fetches bail out

async function selectRecipe(recipeSearchObj) {
    welcomeEl.style.display = 'none';
    detailPanel.classList.remove('hidden');
    loadingEl.style.display = 'flex';
    ingredientsEl.innerHTML = '';
    stepsEl.innerHTML = '';
    schedulerEl.classList.add('hidden');
    timelineEl.innerHTML = '';
    nextStepEl.classList.add('hidden');
    cancelAllTimers();

    recipeTitle.textContent = recipeSearchObj.name;
    recipeLink.href = recipeSearchObj.url;

    try {
        // Look up the parsed recipe by URL from the local database
        const localRecipe = RECIPE_DATABASE.find(r => r.url === recipeSearchObj.url);

        if (!localRecipe) {
            throw new Error('Local recipe not found in database');
        }

        currentRecipe = { ...recipeSearchObj, ...localRecipe };
        renderRecipe(localRecipe);

        schedulerEl.classList.remove('hidden');
        const now = new Date();
        now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
        startTimeEl.value = toLocalDatetimeInput(now);
    } catch (err) {
        console.error('Failed to load recipe:', err);
        ingredientsEl.innerHTML = `
          <div class="error-box">
            <p>⚠️ <strong>Rezept konnte nicht geladen werden.</strong></p>
            <p>Bitte versuche es erneut oder <a href="${recipeSearchObj.url}" target="_blank">öffne das Rezept auf brotdoc.com →</a></p>
          </div>`;
        stepsEl.innerHTML = '';
    } finally {
        loadingEl.style.display = 'none';
    }
}




// ─── RENDER RECIPE ──────────────────────────
function renderRecipe({ ingredients, steps }) {
    // Ingredients
    if (ingredients.length === 0) {
        ingredientsEl.innerHTML = '<p class="hint">Keine strukturierten Zutaten gefunden. <a href="#" id="open-link">Rezept direkt öffnen →</a></p>';
    } else {
        ingredientsEl.innerHTML = '';
        ingredients.forEach(item => {
            if (item.type === 'section') {
                const h = document.createElement('h4');
                h.className = 'ingredient-section';
                h.textContent = item.name;
                ingredientsEl.appendChild(h);
            } else {
                const li = document.createElement('div');
                li.className = 'ingredient-item';
                li.innerHTML = `<span class="ing-bullet">•</span>${item.text}`;
                ingredientsEl.appendChild(li);
            }
        });
    }

    // Steps
    if (steps.length === 0) {
        stepsEl.innerHTML = '<p class="hint">Keine Schritte gefunden. <a href="${recipeLink.href}" target="_blank">Rezept auf brotdoc.com →</a></p>';
    } else {
        stepsEl.innerHTML = '';
        let stepCount = 0;
        steps.forEach((step, i) => {
            if (typeof step === 'object' && step.type === 'section') {
                const header = document.createElement('h4');
                header.className = 'step-section-header';
                header.textContent = step.text;
                stepsEl.appendChild(header);
            } else {
                stepCount++;
                const div = document.createElement('div');
                div.className = 'step-item';
                const duration = extractDuration(step);
                div.innerHTML = `
            <div class="step-number">${stepCount}</div>
            <div class="step-body">
              <p class="step-text">${step}</p>
              ${duration ? `<span class="step-duration">⏱ ~${formatDuration(duration)}</span>` : ''}
            </div>`;
                stepsEl.appendChild(div);
            }
        });
    }
}

// ─── DURATION EXTRACTION ────────────────────
// Returns duration in minutes
function extractDuration(text) {
    const patterns = [
        // "3-4 Stunden" or "3 bis 4 Stunden"
        /(\d+(?:[,.]\d+)?)\s*[-–]\s*(\d+(?:[,.]\d+)?)\s*stunden?/i,
        // "3 Stunden"
        /(\d+(?:[,.]\d+)?)\s*stunden?/i,
        // "30-45 Minuten"
        /(\d+)\s*[-–]\s*(\d+)\s*minuten?/i,
        // "30 Minuten"
        /(\d+)\s*minuten?/i,
        // "1 Stunde 30 Minuten"
        /(\d+)\s*stunde[n]?\s*(\d+)\s*minuten?/i,
        // "overnight" / "12 hours"
        /über\s*nacht/i,
        /(\d+)\s*hours?/i,
        /(\d+)\s*minutes?/i,
    ];

    for (const p of patterns) {
        const m = text.match(p);
        if (m) {
            if (p.source.includes('über') && p.source.includes('nacht')) return 480; // 8h default
            if (p.source.includes('stunden') && m[2]) {
                return ((parseFloat(m[1]) + parseFloat(m[2])) / 2) * 60;
            }
            if (p.source.includes('stunden')) return parseFloat(m[1]) * 60;
            if (p.source.includes('minuten') && m[2]) {
                return (parseInt(m[1]) + parseInt(m[2])) / 2;
            }
            if (p.source.includes('minuten')) return parseInt(m[1]);
            if (p.source.includes('stunde') && p.source.includes('minuten')) {
                return parseInt(m[1]) * 60 + parseInt(m[2]);
            }
            if (p.source.includes('hours')) return parseFloat(m[1]) * 60;
            if (p.source.includes('minutes')) return parseInt(m[1]);
        }
    }
    return 0;
}

function formatDuration(mins) {
    if (mins < 60) return `${Math.round(mins)} Min.`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m > 0 ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

// ─── SCHEDULER ──────────────────────────────
document.getElementById('generate-schedule').addEventListener('click', generateSchedule);

function generateSchedule() {
    if (!currentRecipe || !currentRecipe.steps) return;
    const startVal = startTimeEl.value;
    if (!startVal) { alert('Bitte Startzeit eingeben!'); return; }

    cancelAllTimers();
    timelineEl.innerHTML = '';

    const startTime = new Date(startVal);
    let cursor = new Date(startTime);
    const now = new Date();

    const stepsData = [];
    let stepCount = 0;
    currentRecipe.steps.forEach((stepObj, i) => {
        if (typeof stepObj === 'object' && stepObj.type === 'section') {
            stepsData.push({
                isSection: true,
                text: stepObj.text,
                start: new Date(cursor),
                end: new Date(cursor)
            });
        } else {
            stepCount++;
            const text = stepObj;
            const duration = extractDuration(text) || 15; // default 15 min if unknown
            const stepStart = new Date(cursor);
            cursor = new Date(cursor.getTime() + duration * 60 * 1000);
            stepsData.push({ index: stepCount, text, duration, start: stepStart, end: new Date(cursor), isSection: false });
        }
    });

    activeStepsData = stepsData;

    // Render timeline
    stepsData.forEach(s => {
        const isPast = s.start < now;
        if (s.isSection) {
            const card = document.createElement('div');
            card.className = `timeline-step section ${isPast ? 'past' : ''}`;
            card.innerHTML = `
          <div class="tl-content section-header">
            <h4>${s.text}</h4>
          </div>`;
            timelineEl.appendChild(card);
        } else {
            const isNext = !isPast && stepsData.find(x => !x.isPast && !x.isSection) === s;
            const card = document.createElement('div');
            card.className = `timeline-step ${isPast ? 'past' : ''} ${isNext ? 'next' : ''}`;
            card.innerHTML = `
          <div class="tl-time">
            <div class="tl-dot"></div>
            <span>${formatTime(s.start)}</span>
          </div>
          <div class="tl-content">
            <div class="tl-stepnum">Schritt ${s.index}</div>
            <p class="tl-text">${s.text}</p>
            <span class="tl-dur">⏱ ~${formatDuration(s.duration)}</span>
          </div>`;
            timelineEl.appendChild(card);
        }
    });

    // Schedule notifications
    stepsData.forEach((s, actIndex) => {
        if (s.isSection) return;
        const delay = s.start.getTime() - now.getTime();
        if (delay > 0 && Notification.permission === 'granted') {
            const t = setTimeout(() => {
                new Notification('🍞 BrotBack – Zeit für Schritt ' + s.index, {
                    body: s.text.substring(0, 120) + (s.text.length > 120 ? '…' : ''),
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="90">🍞</text></svg>',
                });
                flashNextStep(actIndex);
            }, delay);
            scheduledTimers.push(t);
        }
    });

    // Show banner for next upcoming step
    const nextStep = stepsData.find(s => s.start > now && !s.isSection);
    if (nextStep) showNextStepBanner(nextStep, now);

    // Scroll to timeline
    timelineEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showNextStepBanner(step, now) {
    nextStepEl.classList.remove('hidden');
    updateNextStepBanner(step, now);
}

function updateNextStepBanner(step, now) {
    const diff = step.start - now;
    if (diff <= 0) {
        nextStepEl.querySelector('#next-countdown').textContent = 'Jetzt!';
        return;
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const ts = [h > 0 ? `${h}h` : '', m > 0 ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
    nextStepEl.querySelector('#next-countdown').textContent = ts;
    nextStepEl.querySelector('#next-step-text').textContent = step.text.substring(0, 80) + '…';
}

function flashNextStep(actIndex) {
    document.querySelectorAll('.timeline-step.next').forEach(el => {
        el.classList.remove('next');
        el.classList.add('past');
    });
    const all = document.querySelectorAll('.timeline-step');
    if (actIndex < all.length) {
        all[actIndex].classList.add('next');
    }
}

function cancelAllTimers() {
    scheduledTimers.forEach(t => clearTimeout(t));
    scheduledTimers = [];
}

// ─── NOTIFICATIONS ──────────────────────────
function checkNotificationStatus() {
    if (!('Notification' in window)) {
        notifBanner.querySelector('p').textContent = '⚠️ Dein Browser unterstützt keine Benachrichtigungen.';
        return;
    }
    if (Notification.permission === 'granted') {
        notifBanner.style.display = 'none';
    } else if (Notification.permission !== 'denied') {
        notifBanner.style.display = 'flex';
    } else {
        notifBanner.querySelector('p').textContent = '🔕 Benachrichtigungen blockiert. Bitte in den Browser-Einstellungen aktivieren.';
        notifBtn.style.display = 'none';
    }
}

notifBtn.addEventListener('click', async () => {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
        notifBanner.style.display = 'none';
        new Notification('🍞 BrotBack', { body: 'Benachrichtigungen aktiviert! Du wirst rechtzeitig erinnert.' });
    }
});

// ─── UTILS ──────────────────────────────────
function formatTime(date) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function toLocalDatetimeInput(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ─── LIVE COUNTDOWN ─────────────────────────
setInterval(() => {
    if (!activeStepsData) {
        if (nextStepEl && !nextStepEl.classList.contains('hidden')) {
            nextStepEl.classList.add('hidden');
        }
        return;
    }

    const now = new Date();
    const nextStepIndex = activeStepsData.findIndex(s => s.start > now && !s.isSection);
    const nextStep = nextStepIndex !== -1 ? activeStepsData[nextStepIndex] : null;

    if (nextStep) {
        if (nextStepEl.classList.contains('hidden')) {
            nextStepEl.classList.remove('hidden');
        }
        updateNextStepBanner(nextStep, now);

        // Sync timeline visual state (past vs next)
        const allBoxes = document.querySelectorAll('.timeline-step');
        allBoxes.forEach(b => b.classList.remove('next', 'past'));
        allBoxes.forEach((b, i) => {
            if (i < nextStepIndex) {
                b.classList.add('past');
            } else if (i === nextStepIndex) {
                b.classList.add('next');
            }
        });
    } else {
        // All steps have started
        nextStepEl.classList.remove('hidden');
        nextStepEl.querySelector('#next-countdown').textContent = 'Fertig!';
        nextStepEl.querySelector('#next-step-text').textContent = 'Alle Schritte haben begonnen.';

        // Clean up old state
        document.querySelectorAll('.timeline-step').forEach(b => {
            b.classList.remove('next');
            b.classList.add('past');
        });

        activeStepsData = null;
    }
}, 1000);

// ─── INIT ────────────────────────────────────
checkNotificationStatus();
searchInput.focus();
