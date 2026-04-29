// --- Инициализация карты ---
const map = L.map('map').setView([55.75, 37.62], 9);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> & CartoDB'
}).addTo(map);

let drawnRectangle = null;
let currentBounds = null;

function drawRectangle() {
    if (drawnRectangle) map.removeLayer(drawnRectangle);
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    // Отступ 10% от границ, чтобы прямоугольник был чуть меньше видимой области
    const pad = 0.08;
    const latPad = (ne.lat - sw.lat) * pad;
    const lngPad = (ne.lng - sw.lng) * pad;
    const newSw = [sw.lat + latPad, sw.lng + lngPad];
    const newNe = [ne.lat - latPad, ne.lng - lngPad];
    drawnRectangle = L.rectangle([newSw, newNe], { color: "#ff7800", weight: 3, opacity: 0.8 }).addTo(map);
    updateGeometryField(newSw, newNe);
}

function clearDrawing() {
    if (drawnRectangle) {
        map.removeLayer(drawnRectangle);
        drawnRectangle = null;
    }
    document.getElementById('geometry').value = '';
}

function updateGeometryField(sw, ne) {
    // sw, ne – массивы [lat, lng]
    const wkt = `POLYGON((${sw[1]} ${sw[0]}, ${ne[1]} ${sw[0]}, ${ne[1]} ${ne[0]}, ${sw[1]} ${ne[0]}, ${sw[1]} ${sw[0]}))`;
    document.getElementById('geometry').value = wkt;
}

// При движении карты обновляем прямоугольник
map.on('moveend', () => {
    if (document.getElementById('geometry').value) drawRectangle();
});

// --- Управление формой ---
window.onload = () => {
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
        alert('Пожалуйста, нарисуйте область на карте (кнопка "Обновить область").');
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

function selectHistory(requestId) {
    pollHistoryResult(requestId);
}
