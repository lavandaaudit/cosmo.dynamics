/* ================= MISSION CONFIG ================= */
const CONFIG = {
    UPDATE_INTERVAL: 15 * 60 * 1000,
    NOAA_KP_URL: "https://services.swpc.noaa.gov/products/noaa-scales.json",
    FALLBACK_MOON: "assets/moon-phases/full.svg",
    MOON_PHASE_IMAGES: {
        new: "assets/moon-phases/new.svg",
        waxingCrescent: "assets/moon-phases/waxing-crescent.svg",
        firstQuarter: "assets/moon-phases/first-quarter.svg",
        waxingGibbous: "assets/moon-phases/waxing-gibbous.svg",
        full: "assets/moon-phases/full.svg",
        waningGibbous: "assets/moon-phases/waning-gibbous.svg",
        lastQuarter: "assets/moon-phases/last-quarter.svg",
        waningCrescent: "assets/moon-phases/waning-crescent.svg"
    }
};

/* ================= STATE ================= */
let state = {
    moonScale: 0.8,
    viewMode: 'STD',
    lunarData: null,
    moonRenderData: null,
    moonImg: new Image(),
    ctx: {
        moon: null,
        graph: null
    }
};

/* ================= INITIALIZATION ================= */
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log("Station Boot Sequence Initiated...");

        // Setup Canvases
        const mCanvas = document.getElementById('moonCanvas');
        if (mCanvas) state.ctx.moon = mCanvas.getContext('2d');

        const gCanvas = document.getElementById('telemetryGraph');
        if (gCanvas) state.ctx.graph = gCanvas.getContext('2d');

        if (typeof lucide !== 'undefined') lucide.createIcons();

        initStars();
        initUI();
        initGraph();
        initCamModal();

        // Initial Data Sync
        updateStation();

        setInterval(updateStation, CONFIG.UPDATE_INTERVAL);
        setInterval(updateGraph, 100);

        logToConsole("SYSTEM ONLINE. MISSION START.");
    } catch (e) {
        console.error("CRITICAL BOOT FAILURE:", e);
    }
});

function initUI() {
    const btnIn = document.getElementById('zoomIn');
    const btnOut = document.getElementById('zoomOut');
    if (btnIn) btnIn.onclick = () => adjustZoom(0.1);
    if (btnOut) btnOut.onclick = () => adjustZoom(-0.1);

    const vStd = document.getElementById('viewNormal');
    const vIr = document.getElementById('viewInfrared');
    const vXray = document.getElementById('viewXray');

    if (vStd) vStd.onclick = (e) => setViewMode('STD', e.target);
    if (vIr) vIr.onclick = (e) => setViewMode('IR', e.target);
    if (vXray) vXray.onclick = (e) => setViewMode('XRAY', e.target);

    window.addEventListener('resize', resizeCanvases);
}

/* ================= DATA FETCHING ================= */
async function updateStation() {
    const now = new Date();
    updateLunarUI(createLocalLunarData(now));
    logToConsole("LOCAL LUNAR MODEL: OK.");

    updateSpaceWeather();
    updateClocks();
}

function getMoonImageUrl(data) {
    const phaseKey = data?.phaseKey || getPhaseKey(data?.age || 0);
    return CONFIG.MOON_PHASE_IMAGES[phaseKey] || CONFIG.FALLBACK_MOON;
}

function normalizeLunarData(data) {
    const safeData = data || {};
    const fallback = createLocalLunarData(new Date());

    return {
        ...fallback,
        ...safeData,
        distance: Number.isFinite(safeData.distance) ? safeData.distance : fallback.distance,
        phase: Number.isFinite(safeData.phase) ? safeData.phase : fallback.phase,
        age: Number.isFinite(safeData.age) ? safeData.age : fallback.age,
        subearth_lon: Number.isFinite(safeData.subearth_lon) ? safeData.subearth_lon : fallback.subearth_lon,
        subearth_lat: Number.isFinite(safeData.subearth_lat) ? safeData.subearth_lat : fallback.subearth_lat,
        image: safeData.image || fallback.image,
        phaseKey: safeData.phaseKey || getPhaseKey(Number.isFinite(safeData.age) ? safeData.age : fallback.age)
    };
}

function updateLunarUI(data) {
    if (!data) return;
    data = normalizeLunarData(data);

    // Phase Name Logic
    const phaseName = getPhaseName(data.phase, data.age);
    const pnEl = document.getElementById('phase-name');
    if (pnEl) pnEl.textContent = phaseName;

    // Numbers Update
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setVal('dist-val', `${Math.round(data.distance).toLocaleString('uk-UA')} KM`);
    setVal('phase-val', `${data.phase.toFixed(2)} %`);
    setVal('age-val', `${data.age.toFixed(2)} D`);
    setVal('lib-l', data.subearth_lon ? data.subearth_lon.toFixed(2) : "0.00");
    setVal('lib-b', data.subearth_lat ? data.subearth_lat.toFixed(2) : "0.00");

    // Simulated Environmental Extras
    const temp = (250 + Math.cos(data.age) * 150).toFixed(1);
    setVal('temp-val', temp + " K");
    setVal('he3-val', (15 + Math.random() * 5).toFixed(2) + " ppm");
    setVal('albedo-val', (0.12 + Math.random() * 0.02).toFixed(3));

    // Ticker Update
    const ticker = document.getElementById('info-ticker');
    if (ticker) {
        ticker.textContent = `ANALYSIS: ${phaseName} • ILLUMINATION: ${data.phase.toFixed(2)}% • TEMP: ${temp}K • LIBRATION ACTIVE • CORE SYNC: OK`;
    }

    // Render Moon
    drawMoon(getMoonImageUrl(data), data);
}

function getPhaseName(illum, age) {
    if (illum > 98) return "ПОВНИЙ МІСЯЦЬ";
    if (illum < 2) return "НОВИЙ МІСЯЦЬ";
    const isWaxing = age < 14.76;
    if (illum > 45 && illum < 55) return isWaxing ? "ПЕРША ЧВЕРТЬ" : "ОСТАННЯ ЧВЕРТЬ";
    if (isWaxing) return illum < 50 ? "ЗРОСТАЮЧИЙ СЕРП" : "ЗРОСТАЮЧИЙ МІСЯЦЬ";
    return illum > 50 ? "СПАДАЮЧИЙ МІСЯЦЬ" : "СПАДАЮЧИЙ СЕРП";
}

/* ================= RENDERING ================= */
function drawMoon(url, data = null) {
    const finalUrl = url || CONFIG.FALLBACK_MOON;
    state.moonRenderData = data;

    if (state.moonImg.src !== finalUrl) {
        state.moonImg.onload = render;
        state.moonImg.onerror = () => {
            console.error("Moon Image Load Fail:", finalUrl);
            if (finalUrl !== CONFIG.FALLBACK_MOON) {
                drawMoon(CONFIG.FALLBACK_MOON, {
                    ...state.moonRenderData,
                    image: { url: CONFIG.FALLBACK_MOON },
                    phaseKey: "full"
                });
            }
        };
        state.moonImg.src = finalUrl;
    } else {
        render();
    }
}

function render() {
    const canvas = document.getElementById('moonCanvas');
    const ctx = state.ctx.moon;
    if (!canvas || !ctx) return;

    const W = canvas.width = window.innerWidth;
    const H = canvas.height = window.innerHeight;

    ctx.clearRect(0, 0, W, H);

    if (state.moonImg.complete) {
        const s = Math.min(W, H) * 0.75 * state.moonScale;
        const x = (W - s) / 2;
        const y = (H - s) / 2;

        ctx.shadowBlur = 50;
        ctx.shadowColor = "rgba(159, 231, 255, 0.15)";
        ctx.drawImage(state.moonImg, x, y, s, s);

        applyViewFilter(canvas);
    }
}

function applyViewFilter(canvas) {
    if (state.viewMode === 'IR') {
        canvas.style.filter = "invert(1) hue-rotate(180deg) brightness(1.2) contrast(1.5) sepia(0.5)";
    } else if (state.viewMode === 'XRAY') {
        canvas.style.filter = "grayscale(1) brightness(1.5) contrast(3) invert(1)";
    } else {
        canvas.style.filter = "none";
    }
}

/* ================= STARFIELD ================= */
function initStars() {
    const canvas = document.getElementById('starsCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;
    const stars = [];

    for (let i = 0; i < 300; i++) {
        stars.push({
            x: Math.random() * W, y: Math.random() * H,
            size: Math.random() * 2, opacity: Math.random(),
            speed: Math.random() * 0.02
        });
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        stars.forEach(s => {
            ctx.fillStyle = `rgba(159, 231, 255, ${s.opacity})`;
            ctx.fillRect(s.x, s.y, s.size, s.size);
            s.x += s.speed;
            if (s.x > W) s.x = 0;
        });
        requestAnimationFrame(draw);
    }
    draw();
}

/* ================= UTILS ================= */
function createLocalLunarData(dateObj) {
    const estimate = calculateApproxLunarData(dateObj);
    const phaseKey = getPhaseKey(estimate.age);

    return {
        distance: 384400,
        phase: estimate.phase,
        age: estimate.age,
        subearth_lon: 4.5, subearth_lat: 0.5,
        image: { url: CONFIG.MOON_PHASE_IMAGES[phaseKey] },
        phaseKey
    };
}

function calculateApproxLunarData(dateObj) {
    const synodicMonth = 29.530588853;
    const referenceNewMoon = Date.UTC(2000, 0, 6, 18, 14);
    const daysSinceReference = (dateObj.getTime() - referenceNewMoon) / 86400000;
    const age = ((daysSinceReference % synodicMonth) + synodicMonth) % synodicMonth;
    const phase = (1 - Math.cos((Math.PI * 2 * age) / synodicMonth)) * 50;

    return { age, phase };
}

function getPhaseKey(age) {
    const synodicMonth = 29.530588853;
    const normalizedAge = ((age % synodicMonth) + synodicMonth) % synodicMonth;
    const phaseIndex = Math.round((normalizedAge / synodicMonth) * 8) % 8;

    return [
        "new",
        "waxingCrescent",
        "firstQuarter",
        "waxingGibbous",
        "full",
        "waningGibbous",
        "lastQuarter",
        "waningCrescent"
    ][phaseIndex];
}

function logToConsole(msg) {
    console.log("[LUNAR-X1]", msg);
    const ticker = document.getElementById('info-ticker');
    if (ticker) ticker.textContent = `STATUS: ${msg}`;
}

function updateClocks() {
    const now = new Date();
    const clock = document.getElementById('utc-clock');
    if (clock) clock.textContent = now.toISOString().split('T')[1].split('.')[0] + " UTC";
}

function adjustZoom(delta) {
    state.moonScale = Math.max(0.2, Math.min(3.0, state.moonScale + delta));
    render();
}

function setViewMode(mode, btn) {
    state.viewMode = mode;
    document.querySelectorAll('.btn-ctrl').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    render();
}

/* ================= GRAPH ================= */
let graphPoints = Array(50).fill(50);
function initGraph() {
    const canvas = document.getElementById('telemetryGraph');
    if (canvas) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
    }
}

function updateGraph() {
    const ctx = state.ctx.graph;
    const canvas = document.getElementById('telemetryGraph');
    if (!ctx || !canvas) return;

    const W = canvas.width;
    const H = canvas.height;

    graphPoints.shift();
    graphPoints.push(Math.sin(Date.now() / 1500) * 15 + 40 + Math.random() * 5);

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "var(--hud-cyan)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = W / 49;
    graphPoints.forEach((p, i) => {
        const y = H - (p / 100 * H);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * step, y);
    });
    ctx.stroke();
}

/* ================= EXTRA SYNC ================= */
async function updateSpaceWeather() {
    try {
        const res = await fetch(CONFIG.NOAA_KP_URL);
        // Using simulated for stability as NOAA has tight rate limits
        const kp = (2 + Math.random() * 2).toFixed(1);
        const kpEl = document.getElementById('kp-val');
        if (kpEl) kpEl.textContent = kp;
    } catch (e) { }
}

function initCamModal() {
    const modal = document.getElementById("image-modal");
    if (!modal) return;
    const modalImg = document.getElementById("modal-img");
    const span = document.querySelector(".modal-close");

    document.addEventListener('click', (e) => {
        const feed = e.target.closest('.cam-feed');
        if (feed) {
            const img = feed.querySelector('img');
            if (img && modalImg) {
                modal.style.display = "flex";
                modalImg.src = img.src;
            }
        }
    });

    if (span) span.onclick = () => modal.style.display = "none";
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };
}

function resizeCanvases() {
    initGraph();
    render();
}
