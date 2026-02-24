// ─────────────────────────────────────────────
// BrotBack App – Core Logic
// ─────────────────────────────────────────────

// CORS proxies tried in order until one succeeds
const PROXIES = [
    async (url) => {
        const r = await fetch('https://corsproxy.io/?' + encodeURIComponent(url));
        if (!r.ok) throw new Error('corsproxy.io failed');
        return r.text();
    },
    async (url) => {
        const r = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url));
        if (!r.ok) throw new Error('allorigins failed');
        const j = await r.json();
        return j.contents;
    },
    async (url) => {
        const r = await fetch('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url));
        if (!r.ok) throw new Error('codetabs failed');
        return r.text();
    },
    async (url) => {
        const r = await fetch('https://thingproxy.freeboard.io/fetch/' + url);
        if (!r.ok) throw new Error('thingproxy failed');
        return r.text();
    },
];

let currentRecipe = null;
let scheduledTimers = [];

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
async function selectRecipe(recipe) {
    searchResults.classList.remove('active');
    searchInput.value = recipe.name;
    welcomeEl.style.display = 'none';
    detailPanel.classList.remove('hidden');
    loadingEl.style.display = 'flex';
    ingredientsEl.innerHTML = '';
    stepsEl.innerHTML = '';
    schedulerEl.classList.add('hidden');
    timelineEl.innerHTML = '';
    cancelAllTimers();

    recipeTitle.textContent = recipe.name;
    recipeLink.href = recipe.url;

    try {
        const html = await fetchWithFallback(recipe.url);
        const parsed = parseRecipe(html);
        currentRecipe = { ...recipe, ...parsed };
        renderRecipe(parsed);
        schedulerEl.classList.remove('hidden');
        // prefill start time to now
        const now = new Date();
        now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
        startTimeEl.value = toLocalDatetimeInput(now);
    } catch (err) {
        console.error('All proxies failed:', err);
        ingredientsEl.innerHTML = `
          <div class="error-box">
            <p>⚠️ <strong>Rezept konnte nicht geladen werden.</strong></p>
            <p>Das passiert meist, wenn die App über <code>file://</code> geöffnet wird. Lösung:</p>
            <ol>
              <li>Öffne <strong>Terminal</strong> (Programme → Dienstprogramme)</li>
              <li>Füge diesen Befehl ein und drücke Enter:<br>
                <code class="cmd">cd ~/'Library/CloudStorage/GoogleDrive-familielingens@gmail.com/Meine Ablage/Privat/BrotBackApp' && python3 -m http.server 8080</code>
              </li>
              <li>Öffne dann im Browser: <a href="http://localhost:8080" target="_blank">http://localhost:8080</a></li>
            </ol>
            <p style="margin-top:10px">Oder: <a href="${recipe.url}" target="_blank">Rezept direkt auf brotdoc.com öffnen →</a></p>
          </div>`;
        stepsEl.innerHTML = '';
    } finally {
        loadingEl.style.display = 'none';
    }
}

async function fetchWithFallback(url) {
    // On Netlify: server-side proxy via _redirects rule (no CORS at all)
    const isLocal = location.protocol.startsWith('file') ||
        ['localhost', '127.0.0.1'].includes(location.hostname);

    if (!isLocal) {
        // Deployed: use /brotdoc/... which Netlify proxies to brotdoc.com
        const proxyPath = url.replace('https://brotdoc.com', '/brotdoc');
        const r = await fetch(proxyPath);
        if (r.ok) return r.text();
    }

    // Local fallback: try public CORS proxies in order
    let lastErr;
    for (const proxy of PROXIES) {
        try {
            const html = await Promise.race([
                proxy(url),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
            ]);
            if (html && html.length > 500) return html;
        } catch (e) {
            lastErr = e;
            console.warn('Proxy failed, trying next…', e.message);
        }
    }
    throw lastErr || new Error('All proxies failed');
}

// ─── RECIPE PARSER ──────────────────────────
function parseRecipe(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove scripts, nav, footer, comments section
    ['script', 'style', 'nav', 'footer', '.comments-area', '#comments'].forEach(sel => {
        doc.querySelectorAll(sel).forEach(el => el.remove());
    });

    const ingredients = [];
    const steps = [];

    // Try to find structured recipe content
    const content = doc.querySelector('.entry-content, article, main, .post-content') || doc.body;

    // Find all headings and lists
    let currentSection = null;
    let inIngredients = false;
    let inSteps = false;

    const headingKeywords = {
        ingredients: ['zutat', 'ingredient'],
        steps: ['anleitung', 'zubereitung', 'instruction', 'method', 'step', 'so wird', 'durchführung']
    };

    const elements = Array.from(content.querySelectorAll('h1,h2,h3,h4,h5,ul,ol,li,p'));

    elements.forEach(el => {
        const tag = el.tagName.toLowerCase();
        const text = el.textContent.trim().toLowerCase();

        if (['h1', 'h2', 'h3', 'h4', 'h5'].includes(tag)) {
            const isIngHead = headingKeywords.ingredients.some(k => text.includes(k));
            const isStepHead = headingKeywords.steps.some(k => text.includes(k));
            if (isIngHead) { inIngredients = true; inSteps = false; currentSection = el.textContent.trim(); }
            else if (isStepHead) { inIngredients = false; inSteps = true; currentSection = null; }
            else if (inIngredients || inSteps) {
                // Sub-heading (e.g. "Roggensauerteig:", "Hauptteig:")
                if (inIngredients) {
                    const heading = el.textContent.trim();
                    if (heading && !heading.toLowerCase().includes('navigation') && !heading.toLowerCase().includes('beitrag')) {
                        ingredients.push({ type: 'section', name: heading });
                    }
                }
            }
            return;
        }

        if (inIngredients && (tag === 'li')) {
            const t = el.textContent.trim();
            if (t && t.length < 200) ingredients.push({ type: 'item', text: t });
        }

        if (inSteps && (tag === 'li' || tag === 'p')) {
            const t = el.textContent.trim();
            if (t && t.length > 20 && t.length < 800) {
                const isNavigtation = ['←', '→', 'vorherig', 'nächst', 'beitragsnavigation', 'navigation'].some(w => t.toLowerCase().includes(w));
                if (!isNavigtation) steps.push(t);
            }
        }
    });

    // Fallback: extract all list items if no structured content found
    if (steps.length === 0) {
        content.querySelectorAll('li').forEach(li => {
            const t = li.textContent.trim();
            if (t.length > 30 && t.length < 600) steps.push(t);
        });
    }

    return { ingredients, steps };
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
        steps.forEach((step, i) => {
            const div = document.createElement('div');
            div.className = 'step-item';
            const duration = extractDuration(step);
            div.innerHTML = `
        <div class="step-number">${i + 1}</div>
        <div class="step-body">
          <p class="step-text">${step}</p>
          ${duration ? `<span class="step-duration">⏱ ~${formatDuration(duration)}</span>` : ''}
        </div>`;
            stepsEl.appendChild(div);
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

    const stepsData = currentRecipe.steps.map((text, i) => {
        const duration = extractDuration(text) || 15; // default 15 min if unknown
        const stepStart = new Date(cursor);
        cursor = new Date(cursor.getTime() + duration * 60 * 1000);
        return { index: i + 1, text, duration, start: stepStart, end: new Date(cursor) };
    });

    // Render timeline
    stepsData.forEach(s => {
        const isPast = s.start < now;
        const isNext = !isPast && stepsData.find(x => !x.isPast) === s;
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
    });

    // Schedule notifications
    stepsData.forEach(s => {
        const delay = s.start.getTime() - now.getTime();
        if (delay > 0 && Notification.permission === 'granted') {
            const t = setTimeout(() => {
                new Notification('🍞 BrotBack – Zeit für Schritt ' + s.index, {
                    body: s.text.substring(0, 120) + (s.text.length > 120 ? '…' : ''),
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="90">🍞</text></svg>',
                });
                flashNextStep(s);
            }, delay);
            scheduledTimers.push(t);
        }
    });

    // Show banner for next upcoming step
    const nextStep = stepsData.find(s => s.start > now);
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

function flashNextStep(step) {
    document.querySelectorAll('.timeline-step.next').forEach(el => {
        el.classList.remove('next');
        el.classList.add('past');
    });
    const all = document.querySelectorAll('.timeline-step');
    if (step.index < all.length) {
        all[step.index].classList.add('next');
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
    if (!currentRecipe || !startTimeEl.value) return;
    const startTime = new Date(startTimeEl.value);
    const now = new Date();
    const stepsData = currentRecipe.steps.map((text, i) => {
        const duration = extractDuration(text) || 15;
        return { index: i + 1, text, start: null };
    });
    // Find next upcoming step from timeline cards
    const cards = document.querySelectorAll('.timeline-step:not(.past)');
    if (cards.length > 0 && nextStepEl && !nextStepEl.classList.contains('hidden')) {
        // Just update countdown display
        const nextCard = Array.from(document.querySelectorAll('.timeline-step.next'))[0];
        if (nextCard) {
            const timeEl = nextCard.querySelector('.tl-time span');
            if (timeEl) {
                // find start time from the timeline display
                const timeStr = timeEl.textContent;
                // Reconstruct approximate start time
                const [hh, mm] = timeStr.split(':').map(Number);
                const stepDate = new Date();
                stepDate.setHours(hh, mm, 0, 0);
                if (stepDate < now) stepDate.setDate(stepDate.getDate() + 1);
                const diff = stepDate - now;
                if (diff > 0) {
                    const minsLeft = Math.floor(diff / 60000);
                    const secsLeft = Math.floor((diff % 60000) / 1000);
                    nextStepEl.querySelector('#next-countdown').textContent =
                        minsLeft > 0 ? `${minsLeft}m ${secsLeft}s` : `${secsLeft}s`;
                }
            }
        }
    }
}, 1000);

// ─── INIT ────────────────────────────────────
checkNotificationStatus();
searchInput.focus();
