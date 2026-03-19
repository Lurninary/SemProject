import asyncio
import os
from typing import Optional
import asyncpg
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel

from gee_client import GeeClient

app = FastAPI(title="Soil Moisture API", description="API для анализа влажности почвы")
gee_client = GeeClient(service_account_path=os.getenv('GEE_KEY_PATH'))


class AnalysisRequest(BaseModel):
    request_id: int
    geometry: str
    date_from: str
    date_to: str


class AnalysisResult(BaseModel):
    request_id: int
    acquisition_date: str
    mean_ndwi: Optional[float] = None
    mean_soil_moisture: float
    image_url: Optional[str] = None


@app.get("/")
async def root():
    return {"message": "Soil Moisture Analysis API", "version": "0.2.0"}


@app.post("/api/process")
async def process_analysis(request: AnalysisRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(perform_analysis, request)
    return {
        "message": "Analysis started",
        "request_id": request.request_id,
        "status_check_url": f"/api/status/{request.request_id}"
    }


@app.get("/api/status/{request_id}")
async def get_status(request_id: int):
    return {"request_id": request_id, "status": "processing", "progress": 65}


@app.get("/api/results/{request_id}")
async def get_results(request_id: int):
    conn = await asyncpg.connect(os.getenv('DATABASE_URL'))
    try:
        rows = await conn.fetch(
            "SELECT acquisition_date, mean_soil_moisture FROM analysis_results WHERE request_id = $1 ORDER BY acquisition_date",
            request_id
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Results not found")
        avg_moisture = sum(r['mean_soil_moisture'] for r in rows) / len(rows)
        return {
            "request_id": request_id,
            "mean_soil_moisture": round(avg_moisture, 2),
            "details": [{"date": r['acquisition_date'], "moisture": r['mean_soil_moisture']} for r in rows]
        }
    finally:
        await conn.close()


@app.get("/api/historical/{lat}/{lon}")
async def get_historical_data(lat: float, lon: float, months: int = 12):
    return {"message": "Not implemented yet"}


async def perform_analysis(request: AnalysisRequest):
    print(f"[Background] Starting SMAP analysis for request {request.request_id}")

    conn = await asyncpg.connect(os.getenv('DATABASE_URL'))
    await conn.execute("UPDATE analysis_requests SET status='processing' WHERE id=$1", request.request_id)
    await conn.close()

    try:
        loop = asyncio.get_event_loop()
        smap_data = await loop.run_in_executor(
            None,
            gee_client.get_smap_daily,
            request.geometry,
            request.date_from,
            request.date_to
        )
    except Exception as e:
        print(f"[Background] GEE error: {e}")
        conn = await asyncpg.connect(os.getenv('DATABASE_URL'))
        await conn.execute("UPDATE analysis_requests SET status='failed' WHERE id=$1", request.request_id)
        await conn.close()
        return

    conn = await asyncpg.connect(os.getenv('DATABASE_URL'))
    try:
        for item in smap_data:
            await conn.execute("""
                INSERT INTO analysis_results
                (request_id, acquisition_date, mean_soil_moisture, image_url)
                VALUES ($1, $2, $3, $4)
            """, request.request_id, item['date'], item['soil_moisture'], None)
        await conn.execute("UPDATE analysis_requests SET status='completed' WHERE id=$1", request.request_id)
        print(f"[Background] Completed for request {request.request_id}, {len(smap_data)} records saved.")
    except Exception as e:
        print(f"[Background] DB error: {e}")
        await conn.execute("UPDATE analysis_requests SET status='failed' WHERE id=$1", request.request_id)
    finally:
        await conn.close()