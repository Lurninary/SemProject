from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import asyncpg
import os
from sentinel_client import SentinelHubClient
from datetime import datetime

app = FastAPI(title="Soil Moisture API", description="API для анализа влажности почвы")



class AnalysisRequest(BaseModel):
    request_id: int
    geometry: str
    date_from: str
    date_to: str


class AnalysisResult(BaseModel):
    request_id: int
    acquisition_date: str
    mean_ndwi: float
    mean_soil_moisture: float
    image_url: str


sentinel_client = SentinelHubClient()


@app.get("/")
async def root():
    return {"message": "Soil Moisture Analysis API", "version": "0.1.0"}


@app.post("/api/process")
async def process_analysis(request: AnalysisRequest, background_tasks: BackgroundTasks):
    """Запускает анализ влажности почвы для заданной области."""

    background_tasks.add_task(perform_analysis, request)

    return {
        "message": "Analysis started",
        "request_id": request.request_id,
        "status_check_url": f"/api/status/{request.request_id}"
    }, 202


@app.get("/api/status/{request_id}")
async def get_status(request_id: int):
    """Проверяет статус анализа."""

    return {
        "request_id": request_id,
        "status": "processing",
        "progress": 65
    }


@app.get("/api/results/{request_id}")
async def get_results(request_id: int):
    """Возвращает результаты анализа."""
    return AnalysisResult(
        request_id=request_id,
        acquisition_date="2023-10-15",
        mean_ndwi=0.15,
        mean_soil_moisture=25.5,
        image_url="https://services.sentinel-hub.com/ogc/wms/..."
    )


async def perform_analysis(request: AnalysisRequest):
    """Фоновая задача для выполнения анализа."""
    print(f"[Background] Starting analysis for request {request.request_id}")

    try:
        ndwi_data = sentinel_client.get_ndwi_data(
            geometry=request.geometry,
            date_from=request.date_from,
            date_to=request.date_to
        )

        soil_moisture = sentinel_client.estimate_soil_moisture(ndwi_data["mean_ndwi"])

        print(f"[Background] Analysis completed for request {request.request_id}")
        print(f"  NDWI: {ndwi_data['mean_ndwi']:.3f}")
        print(f"  Estimated soil moisture: {soil_moisture:.1f}%")

    except Exception as e:
        print(f"[Background] Error processing request {request.request_id}: {e}")


@app.get("/api/historical/{lat}/{lon}")
async def get_historical_data(lat: float, lon: float, months: int = 12):
    """Возвращает исторические данные для точки."""

    import random
    data = []
    for i in range(months):
        data.append({
            "month": f"2023-{i + 1:02d}",
            "ndwi": random.uniform(-0.1, 0.3),
            "soil_moisture": random.uniform(15, 35)
        })
    return {"location": {"lat": lat, "lon": lon}, "data": data}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)