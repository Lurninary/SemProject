# Краткое описание API

| Метод | URL | Назначение |
|---|---|---|
| `POST` | `/api/submit_analysis` | Создание анализа |
| `POST` | `/api/process` | Запуск фоновой обработки |
| `GET` | `/api/status/{request_id}` | Статус анализа |
| `GET` | `/api/results/{request_id}` | Результаты анализа |
| `GET` | `/api/map/{request_id}` | Растровый слой карты |
| `GET` | `/api/requests` | История анализов |
| `GET` | `/api/requests/{request_id}/geometry` | Геометрия анализа |
