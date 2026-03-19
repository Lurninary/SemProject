const map = L.map('map').setView([55.75, 37.62], 10); // Центр на Москве

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let drawnRectangle = null;

function drawRectangle() {
    if (drawnRectangle) {
        map.removeLayer(drawnRectangle);
    }
    const bounds = map.getBounds();
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    const latDelta = (northEast.lat - southWest.lat) * 0.2;
    const lngDelta = (northEast.lng - southWest.lng) * 0.2;
    const sw = [southWest.lat + latDelta, southWest.lng + lngDelta];
    const ne = [northEast.lat - latDelta, northEast.lng - lngDelta];
    drawnRectangle = L.rectangle([sw, ne], { color: "#ff7800", weight: 2 }).addTo(map);
    updateGeometryField(sw, ne);
}

function clearDrawing() {
    if (drawnRectangle) {
        map.removeLayer(drawnRectangle);
        drawnRectangle = null;
        document.getElementById('geometry').value = '';
    }
}

// Преобразование координат в WKT POLYGON
function updateGeometryField(sw, ne) {
    // sw и ne - массивы [lat, lng]
    const wkt = `POLYGON((${sw[1]} ${sw[0]}, ${ne[1]} ${sw[0]}, ${ne[1]} ${ne[0]}, ${sw[1]} ${ne[0]}, ${sw[1]} ${sw[0]}))`;
    document.getElementById('geometry').value = wkt;
}

document.getElementById('analysisForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value;
    const geometry = document.getElementById('geometry').value;
    const date_from = document.getElementById('date_from').value;
    const date_to = document.getElementById('date_to').value;

    if (!geometry) {
        alert('Пожалуйста, нарисуйте область на карте.');
        return;
    }

    const formData = { name, geometry, date_from, date_to };

    try {
        const response = await fetch('/api/submit_analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (response.status === 202) {
            const requestId = result.id;
            document.getElementById('results').classList.remove('hidden');
            document.getElementById('status').innerText = 'processing...';

            pollResult(requestId);
        } else {
            alert('Ошибка: ' + (result.error || 'Неизвестная ошибка'));
        }
    } catch (err) {
        alert('Ошибка сети: ' + err.message);
    }
};

// Функция опроса результата
async function pollResult(requestId) {
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`/api/results/${requestId}`);
            if (res.status === 200) {
                const data = await res.json();
                document.getElementById('status').innerText = 'completed';
                document.getElementById('moisture').innerText = data.mean_soil_moisture;
                if (data.details) {
                    console.log('Детали по дням:', data.details);
                }
                clearInterval(interval);
            } else if (res.status === 202) {
                document.getElementById('status').innerText = 'processing...';
            } else if (res.status === 404) {
                // Результат не найден, возможно запрос ещё не начат или статус unknown
                // Ничего не делаем, продолжаем опрос
            } else if (res.status === 500) {
                const err = await res.json();
                document.getElementById('status').innerText = 'failed';
                alert('Анализ завершился ошибкой: ' + (err.error || 'Unknown error'));
                clearInterval(interval);
            }
        } catch (err) {
            console.error('Polling error:', err);
        }
    }, 3000);
}

window.onload = function() {
    drawRectangle();
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    document.getElementById('date_from').valueAsDate = sevenDaysAgo;
    document.getElementById('date_to').valueAsDate = today;
};