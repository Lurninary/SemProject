// --- Инициализация карты ---
const map = L.map('map').setView([55.75, 37.62], 9);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> & CartoDB'
}).addTo(map);

const gridLayer = L.layerGroup().addTo(map);
let selectedGeometryLayer = null;
let heatmapMap = null;
let heatmapOverlayLayer = null;
let heatmapGeometryLayer = null;
const GRID_LEVELS = [
    { id: "coarse", minZoom: 0, maxZoom: 8, cellSizePx: 144, anchorZoom: 8 },
    { id: "medium", minZoom: 9, maxZoom: 11, cellSizePx: 120, anchorZoom: 11 },
    { id: "fine", minZoom: 12, maxZoom: 13, cellSizePx: 92, anchorZoom: 13 },
    { id: "x-fine", minZoom: 14, maxZoom: 30, cellSizePx: 72, anchorZoom: 14 },
];

let currentGridLevel = null;
let selectedCells = new Map();

function getGridLevel(zoom) {
    return GRID_LEVELS.find((lvl) => zoom >= lvl.minZoom && zoom <= lvl.maxZoom) || GRID_LEVELS[0];
}

function buildCell(ix, iy, level) {
    const sizePx = level.cellSizePx;
    const minPoint = L.point(ix * sizePx, iy * sizePx);
    const maxPoint = L.point((ix + 1) * sizePx, (iy + 1) * sizePx);
    const nw = map.unproject(minPoint, level.anchorZoom);
    const se = map.unproject(maxPoint, level.anchorZoom);

    return {
        key: `${level.id}:${ix}:${iy}`,
        ix,
        iy,
        levelId: level.id,
        minLat: se.lat,
        minLng: nw.lng,
        maxLat: nw.lat,
        maxLng: se.lng,
        center: map.unproject(L.point((ix + 0.5) * sizePx, (iy + 0.5) * sizePx), level.anchorZoom),
    };
}

function getCellForLatLng(lat, lng, level) {
    const sizePx = level.cellSizePx;
    const p = map.project([lat, lng], level.anchorZoom);
    const ix = Math.floor(p.x / sizePx);
    const iy = Math.floor(p.y / sizePx);

    return buildCell(ix, iy, level);
}

function remapSelectedCells(targetLevel) {
    if (!selectedCells.size) return;
    const next = new Map();
    selectedCells.forEach((cell) => {
        const mapped = getCellForLatLng(cell.center.lat, cell.center.lng, targetLevel);
        next.set(mapped.key, mapped);
    });
    selectedCells = next;
}

function updateGeometryFieldFromSelection() {
    const cells = Array.from(selectedCells.values())
        .sort((a, b) => (a.minLat - b.minLat) || (a.minLng - b.minLng));

    if (!cells.length) {
        document.getElementById('geometry').value = '';
        return;
    }

    const polygonWkts = cells.map((cell) =>
        `((${cell.minLng} ${cell.minLat}, ${cell.maxLng} ${cell.minLat}, ${cell.maxLng} ${cell.maxLat}, ${cell.minLng} ${cell.maxLat}, ${cell.minLng} ${cell.minLat}))`
    );

    if (polygonWkts.length === 1) {
        document.getElementById('geometry').value = `POLYGON${polygonWkts[0]}`;
    } else {
        document.getElementById('geometry').value = `MULTIPOLYGON(${polygonWkts.join(',')})`;
    }
}

function toggleCellSelection(cell) {
    if (selectedCells.has(cell.key)) {
        selectedCells.delete(cell.key);
    } else {
        selectedCells.set(cell.key, cell);
    }

    updateGeometryFieldFromSelection();
    drawGrid();
}

function drawGrid() {
    gridLayer.clearLayers();

    const bounds = map.getBounds();
    const nextLevel = getGridLevel(map.getZoom());
    const levelChanged = !currentGridLevel || nextLevel.id !== currentGridLevel.id;
    currentGridLevel = nextLevel;
    if (levelChanged) {
        remapSelectedCells(currentGridLevel);
        updateGeometryFieldFromSelection();
    }

    const sizePx = currentGridLevel.cellSizePx;

    const nwPoint = map.project(bounds.getNorthWest(), currentGridLevel.anchorZoom);
    const sePoint = map.project(bounds.getSouthEast(), currentGridLevel.anchorZoom);

    const minIx = Math.floor(nwPoint.x / sizePx) - 1;
    const maxIx = Math.ceil(sePoint.x / sizePx) + 1;
    const minIy = Math.floor(nwPoint.y / sizePx) - 1;
    const maxIy = Math.ceil(sePoint.y / sizePx) + 1;

    for (let ix = minIx; ix <= maxIx; ix += 1) {
        for (let iy = minIy; iy <= maxIy; iy += 1) {
            const cell = buildCell(ix, iy, currentGridLevel);

            const isSelected = selectedCells.has(cell.key);
            const rect = L.rectangle(
                [[cell.minLat, cell.minLng], [cell.maxLat, cell.maxLng]],
                isSelected
                    ? { color: "#ff7800", weight: 2, fillColor: "#ffb74d", fillOpacity: 0.28, opacity: 1 }
                    : { color: "#7aa87a", weight: 1, fillOpacity: 0, opacity: 0.55 }
            );

            rect.on("click", () => toggleCellSelection(cell));
            rect.addTo(gridLayer);
        }
    }
}

function drawRectangle() {
    const center = map.getCenter();
    const level = currentGridLevel || getGridLevel(map.getZoom());
    const centerCell = getCellForLatLng(center.lat, center.lng, level);
    if (!selectedCells.has(centerCell.key)) {
        selectedCells.set(centerCell.key, centerCell);
        updateGeometryFieldFromSelection();
    }
    drawGrid();
}

function clearDrawing() {
    selectedCells.clear();
    document.getElementById('geometry').value = '';
    drawGrid();
}

function clearUserSelectionAndGeometry() {
    selectedCells.clear();
    document.getElementById('geometry').value = '';
    drawGrid();
}

// При движении/масштабировании карты обновляем сетку
map.on('moveend zoomend', () => {
    drawGrid();
});

function setMainMapGeometryHighlight(geojson, fitBounds = false) {
    if (selectedGeometryLayer) {
        map.removeLayer(selectedGeometryLayer);
        selectedGeometryLayer = null;
    }
    if (!geojson) return;

    selectedGeometryLayer = L.geoJSON(geojson, {
        style: {
            color: "#145a8d",
            weight: 2.5,
            fillColor: "#53a4d6",
            fillOpacity: 0.12
        }
    }).addTo(map);

    if (fitBounds) {
        map.fitBounds(selectedGeometryLayer.getBounds(), { padding: [24, 24], maxZoom: 14 });
    }
}

async function fetchRequestGeometry(requestId) {
    const res = await fetch(`/api/requests/${requestId}/geometry`);
    if (!res.ok) {
        throw new Error(`Failed to load geometry for request ${requestId}`);
    }
    return res.json();
}

function initHeatmapMapIfNeeded() {
    const section = document.getElementById("heatmapSection");
    section.classList.remove("hidden");

    if (!heatmapMap) {
        heatmapMap = L.map("heatmapMap", { zoomControl: true });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> & CartoDB'
        }).addTo(heatmapMap);
    }
    setTimeout(() => heatmapMap.invalidateSize(), 50);
}

function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function computeSeriesVariability(details) {
    if (!Array.isArray(details) || details.length < 2) return 0.2;
    const values = details
        .map((d) => Number(d.moisture))
        .filter((v) => Number.isFinite(v));
    if (values.length < 2) return 0.2;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + ((v - mean) ** 2), 0) / values.length;
    const std = Math.sqrt(variance);
    return Math.max(0.15, Math.min(0.55, std / 12));
}

function pseudoSpatialModulation(lat, lng, seed) {
    const s1 = Math.sin((lat * 37.17) + seed);
    const s2 = Math.cos((lng * 29.41) - seed * 0.7);
    const s3 = Math.sin((lat + lng) * 11.3 + seed * 0.31);
    return (s1 + s2 + s3) / 3; // ~[-1..1]
}

function sampleHeatPointsFromPolygonRing(ring, baseIntensity, variability, seed) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    ring.forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
    });

    const spanLng = Math.max(0.0001, maxLng - minLng);
    const spanLat = Math.max(0.0001, maxLat - minLat);
    const step = Math.max(0.0012, Math.min(0.018, Math.max(spanLng, spanLat) / 22));

    const points = [];
    let guard = 0;
    for (let lat = minLat; lat <= maxLat; lat += step) {
        for (let lng = minLng; lng <= maxLng; lng += step) {
            if (pointInRing(lng, lat, ring)) {
                const modulation = pseudoSpatialModulation(lat, lng, seed);
                const intensity = Math.max(
                    0.05,
                    Math.min(1.0, baseIntensity + modulation * variability)
                );
                points.push([lat, lng, intensity]);
                guard += 1;
                if (guard > 3500) return points;
            }
        }
    }

    if (!points.length) {
        const avgLng = ring.reduce((acc, p) => acc + p[0], 0) / ring.length;
        const avgLat = ring.reduce((acc, p) => acc + p[1], 0) / ring.length;
        points.push([avgLat, avgLng, baseIntensity]);
    }

    return points;
}

function sampleHeatPointsFromGeometry(geojson, meanMoisture, details) {
    const intensity = Math.max(0.2, Math.min(1.0, (meanMoisture || 0) / 50));
    const variability = computeSeriesVariability(details);
    const pts = [];

    if (!geojson) return pts;
    if (geojson.type === "Polygon") {
        pts.push(...sampleHeatPointsFromPolygonRing(geojson.coordinates[0], intensity, variability, 1));
    } else if (geojson.type === "MultiPolygon") {
        geojson.coordinates.forEach((poly, idx) => {
            if (poly[0]) pts.push(...sampleHeatPointsFromPolygonRing(poly[0], intensity, variability, idx + 1));
        });
    }

    return pts;
}

function renderHeatmapForGeometry(geojson, meanMoisture, titleText, details = []) {
    initHeatmapMapIfNeeded();

    if (heatmapOverlayLayer) {
        heatmapMap.removeLayer(heatmapOverlayLayer);
        heatmapOverlayLayer = null;
    }
    if (heatmapGeometryLayer) {
        heatmapMap.removeLayer(heatmapGeometryLayer);
        heatmapGeometryLayer = null;
    }

    const heatPoints = sampleHeatPointsFromGeometry(geojson, meanMoisture, details);
    heatmapOverlayLayer = L.heatLayer(heatPoints, {
        radius: 18,
        blur: 14,
        maxZoom: 17,
        minOpacity: 0.25,
        gradient: {
            0.2: "#2a6fdb",
            0.45: "#2db84d",
            0.7: "#f4b400",
            1.0: "#d93025"
        }
    }).addTo(heatmapMap);

    heatmapGeometryLayer = L.geoJSON(geojson, {
        style: {
            color: "#253036",
            weight: 2,
            fillOpacity: 0
        }
    }).addTo(heatmapMap);

    heatmapMap.fitBounds(heatmapGeometryLayer.getBounds(), { padding: [20, 20], maxZoom: 15 });
    document.getElementById("heatmapMeta").innerText = titleText || "Тепловая карта влажности";
}

// --- Управление формой ---
window.onload = () => {
    drawGrid();
    drawRectangle();
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    document.getElementById('date_from').valueAsDate = weekAgo;
    document.getElementById('date_to').valueAsDate = today;
};

let analysisChartInstance = null;
let historyChartInstance = null;
let historyPollInterval = null;
let historyLoaded = false;
let historyData = [];
let currentHistoryGeometry = null;

function renderChart(details, canvasId, existingChartInstance) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if (existingChartInstance) existingChartInstance.destroy();
    const labels = details.map(d => d.date.slice(5)); // MM-DD
    const values = details.map(d => d.moisture);
    const newChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Влажность почвы (%)',
                data: values,
                borderColor: '#3c8c3c',
                backgroundColor: 'rgba(76,154,42,0.1)',
                tension: 0.2,
                fill: true,
                pointBackgroundColor: '#2b6e2b',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: (ctx) => `${ctx.raw}%` } }
            },
            scales: {
                y: { title: { display: true, text: 'Влажность (%)' }, min: 0, max: 50 }
            }
        }
    });
    return newChart;
}

function renderTable(details, containerId) {
    const container = document.getElementById(containerId);
    if (!details.length) {
        container.innerHTML = '<p>Нет детальных данных</p>';
        return;
    }
    let html = '<table class="detail-table"><thead><tr><th>Дата</th><th>Влажность (%)</th></tr></thead><tbody>';
    details.forEach(d => {
        html += `<tr><td>${d.date}</td><td>${d.moisture}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

async function pollResult(requestId) {
    const resultsDiv = document.getElementById('resultsPanel');
    resultsDiv.classList.remove('hidden');
    const statusSpan = document.getElementById('statusValue');
    const moistureSpan = document.getElementById('moistureValue');
    const submitBtn = document.getElementById('submitBtn');

    const interval = setInterval(async () => {
        try {
            const res = await fetch(`/api/results/${requestId}`);
            const data = await res.json();

            if (res.status === 200 && data.status === 'completed') {
                // Готово
                statusSpan.innerText = '✅ Завершён';
                moistureSpan.innerText = data.mean_soil_moisture;
                if (data.details && data.details.length) {
                    analysisChartInstance = renderChart(data.details, 'moistureChart', analysisChartInstance);
                    renderTable(data.details, 'detailsTable');
                }
                try {
                    const geomPayload = await fetchRequestGeometry(requestId);
                    setMainMapGeometryHighlight(geomPayload.geometry, false);
                    renderHeatmapForGeometry(
                        geomPayload.geometry,
                        data.mean_soil_moisture,
                        `Анализ #${requestId}: ${geomPayload.name || "без названия"}`,
                        data.details || []
                    );
                } catch (e) {
                    console.warn("failed to render heatmap for analysis", e);
                }
                clearInterval(interval);
                submitBtn.disabled = false;
            }
            else if (res.status === 202) {
                // В обработке
                statusSpan.innerText = '⏳ Обработка... (запрос данных SMAP)';
                moistureSpan.innerText = '—';
                if (analysisChartInstance) analysisChartInstance.destroy();
                analysisChartInstance = null;
                document.getElementById('detailsTable').innerHTML = '';
            }
            else if (res.status === 500) {
                statusSpan.innerText = '❌ Ошибка анализа';
                moistureSpan.innerText = '—';
                clearInterval(interval);
                submitBtn.disabled = false;
            }
            else {
                // 404 или что-то ещё – продолжаем ждать
                statusSpan.innerText = '⏳ Ожидание начала...';
            }
        } catch (err) {
            console.warn('poll error', err);
        }
    }, 3000);
}

document.getElementById('analysisForm').onsubmit = async (e) => {
    e.preventDefault();
    const geometry = document.getElementById('geometry').value;
    if (!geometry) {
        alert('Пожалуйста, выберите одну или несколько ячеек на карте.');
        return;
    }

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerText = '⏳ Отправка...';

    const payload = {
        name: document.getElementById('name').value || 'Анализ',
        geometry: geometry,
        date_from: document.getElementById('date_from').value,
        date_to: document.getElementById('date_to').value
    };

    try {
        const resp = await fetch('/api/submit_analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (resp.status === 202 || resp.ok) {
            const requestId = result.id;
            // показать панель и запустить опрос
            document.getElementById('resultsPanel').classList.remove('hidden');
            document.getElementById('statusValue').innerText = '🔄 Запуск...';
            pollResult(requestId);
        } else {
            alert('Ошибка: ' + (result.error || 'неизвестная'));
            submitBtn.disabled = false;
            submitBtn.innerText = '🚀 Запустить анализ';
        }
    } catch (err) {
        alert('Сетевая ошибка: ' + err.message);
        submitBtn.disabled = false;
        submitBtn.innerText = '🚀 Запустить анализ';
    }
};

// --- Вкладки ---
function openTab(tabName) {
    const analysisTab = document.getElementById('tab-analysis');
    const historyTab = document.getElementById('tab-history');
    const analysisBtn = document.querySelector(".tab-btn[data-tab='analysis']");
    const historyBtn = document.querySelector(".tab-btn[data-tab='history']");

    if (tabName === 'analysis') {
        analysisTab.classList.remove('hidden');
        historyTab.classList.add('hidden');
        if (analysisBtn) analysisBtn.classList.add('active');
        if (historyBtn) historyBtn.classList.remove('active');
    } else {
        historyTab.classList.remove('hidden');
        analysisTab.classList.add('hidden');
        if (historyBtn) historyBtn.classList.add('active');
        if (analysisBtn) analysisBtn.classList.remove('active');
        if (!historyLoaded) {
            historyLoaded = true;
            loadHistory();
        }
    }
}

// --- История анализов ---
async function loadHistory() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '<p>Загрузка...</p>';

    try {
        const res = await fetch('/api/requests?limit=20');
        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) {
            historyList.innerHTML = '<p>Пока нет созданных анализов.</p>';
            return;
        }

        historyData = data;
        historyList.innerHTML = data.map(r => {
            const status = r.status || 'pending';
            const badge = status === 'completed'
                ? '✅'
                : (status === 'failed' ? '❌' : '⏳');
            return `
                <div class="history-item" role="button" tabindex="0" onclick="selectHistory(${r.id})">
                    <div class="history-item-left">
                        <div class="history-title">${r.name || 'Без названия'}</div>
                        <div class="history-subtitle">ID: ${r.id} • ${r.created_at}</div>
                    </div>
                    <div class="history-badge">${badge}</div>
                </div>
            `;
        }).join('');
    } catch (e) {
        historyList.innerHTML = '<p>Ошибка загрузки истории.</p>';
        console.warn(e);
    }
}

function clearHistoryDetails() {
    const panel = document.getElementById('historyDetailsPanel');
    panel.classList.add('hidden');
    document.getElementById('historyError').classList.add('hidden');
    document.getElementById('detailsTableHistory').innerHTML = '';
    document.getElementById('historyMoistureValue').innerText = '—';
    document.getElementById('historyStatusValue').innerText = '—';
    const nameEl = document.getElementById('historyName');
    if (nameEl) nameEl.innerText = '—';
    const idEl = document.getElementById('historyRequestId');
    if (idEl) idEl.innerText = '—';
    if (historyChartInstance) historyChartInstance.destroy();
    historyChartInstance = null;

    if (historyPollInterval) {
        clearInterval(historyPollInterval);
        historyPollInterval = null;
    }
}

async function pollHistoryResult(requestId) {
    clearHistoryDetails();
    document.getElementById('historyDetailsPanel').classList.remove('hidden');
    document.getElementById('historyRequestId').innerText = requestId;
    const selected = (historyData || []).find(x => x.id === requestId);
    document.getElementById('historyName').innerText = selected?.name || 'Без названия';

    const statusSpan = document.getElementById('historyStatusValue');
    const moistureSpan = document.getElementById('historyMoistureValue');
    const errorBox = document.getElementById('historyError');

    historyPollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/results/${requestId}`);
            const data = await res.json();

            if (res.status === 200 && data.status === 'completed') {
                statusSpan.innerText = '✅ Завершён';
                moistureSpan.innerText = data.mean_soil_moisture;
                errorBox.classList.add('hidden');
                if (data.details && data.details.length) {
                    historyChartInstance = renderChart(data.details, 'moistureChartHistory', historyChartInstance);
                    renderTable(data.details, 'detailsTableHistory');
                }
                if (currentHistoryGeometry) {
                    renderHeatmapForGeometry(
                        currentHistoryGeometry.geometry,
                        data.mean_soil_moisture,
                        `История #${requestId}: ${currentHistoryGeometry.name || "без названия"}`,
                        data.details || []
                    );
                }
                clearInterval(historyPollInterval);
                historyPollInterval = null;
            } else if (res.status === 202) {
                statusSpan.innerText = '⏳ Обработка...';
                moistureSpan.innerText = '—';
                if (historyChartInstance) {
                    historyChartInstance.destroy();
                    historyChartInstance = null;
                }
                document.getElementById('detailsTableHistory').innerHTML = '';
            } else if (res.status === 500) {
                statusSpan.innerText = '❌ Ошибка анализа';
                moistureSpan.innerText = '—';
                errorBox.innerText = data.detail || 'Ошибка анализа';
                errorBox.classList.remove('hidden');
                clearInterval(historyPollInterval);
                historyPollInterval = null;
            } else {
                statusSpan.innerText = '⏳ Ожидание...';
            }
        } catch (err) {
            console.warn('history poll error', err);
        }
    }, 3000);
}

async function selectHistory(requestId) {
    try {
        clearUserSelectionAndGeometry();
        const geomPayload = await fetchRequestGeometry(requestId);
        currentHistoryGeometry = geomPayload;
        setMainMapGeometryHighlight(geomPayload.geometry, true);
    } catch (err) {
        console.warn("history geometry load error", err);
        currentHistoryGeometry = null;
    }
    pollHistoryResult(requestId);
}
