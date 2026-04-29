import asyncio
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from geoalchemy2 import Geometry
from pydantic import BaseModel
from sqlalchemy import cast, desc, func
from sqlalchemy.exc import SQLAlchemyError

from database import SessionLocal
from gee_client import GeeClient
from models import AnalysisRequestModel, AnalysisResultModel

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
    db = SessionLocal()
    try:
        req = db.query(AnalysisRequestModel).filter(AnalysisRequestModel.id == request_id).first()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        return {"request_id": request_id, "status": req.status}
    finally:
        db.close()


@app.get("/api/results/{request_id}")
async def get_results(request_id: int):
    db = SessionLocal()
    try:
        request_row = db.query(AnalysisRequestModel).filter(AnalysisRequestModel.id == request_id).first()
        if not request_row:
            raise HTTPException(status_code=404, detail="Request not found")

        rows = (
            db.query(
                AnalysisResultModel.acquisition_date,
                AnalysisResultModel.mean_soil_moisture
            )
            .filter(AnalysisResultModel.request_id == request_id)
            .order_by(AnalysisResultModel.acquisition_date)
            .all()
        )
        if not rows:
            status = request_row.status
            if status in {"pending", "processing"}:
                return JSONResponse(
                    status_code=202,
                    content={"request_id": request_id, "status": "processing"}
                )
            if status == "failed":
                raise HTTPException(status_code=500, detail="Analysis failed")
            raise HTTPException(status_code=404, detail="Results not found")
        avg_moisture = sum(r.mean_soil_moisture for r in rows) / len(rows)
        return {
            "request_id": request_id,
            "mean_soil_moisture": round(avg_moisture, 2),
            "status": "completed",
            "details": [{"date": r.acquisition_date, "moisture": r.mean_soil_moisture} for r in rows]
        }
    finally:
        db.close()


@app.get("/api/historical/{lat}/{lon}")
async def get_historical_data(lat: float, lon: float, months: int = 12):
    if months < 1 or months > 60:
        raise HTTPException(status_code=400, detail="months must be between 1 and 60")

    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(days=30 * months)
        point_geom = func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)

        rows = (
            db.query(
                AnalysisRequestModel.id.label("request_id"),
                AnalysisRequestModel.name.label("name"),
                func.avg(AnalysisResultModel.mean_soil_moisture).label("avg_moisture"),
                func.json_agg(
                    func.json_build_object(
                        "date", AnalysisResultModel.acquisition_date,
                        "moisture", AnalysisResultModel.mean_soil_moisture
                    )
                ).label("series")
            )
            .join(AnalysisResultModel, AnalysisResultModel.request_id == AnalysisRequestModel.id)
            .filter(AnalysisRequestModel.status == "completed")
            .filter(AnalysisRequestModel.created_at >= cutoff)
            .filter(
                func.ST_Intersects(
                    cast(AnalysisRequestModel.geometry, Geometry),
                    point_geom
                )
            )
            .group_by(AnalysisRequestModel.id, AnalysisRequestModel.name, AnalysisRequestModel.created_at)
            .order_by(desc(AnalysisRequestModel.created_at))
            .all()
        )

        if not rows:
            return {
                "lat": lat,
                "lon": lon,
                "months": months,
                "count": 0,
                "analyses": []
            }

        analyses = []
        for row in rows:
            series = row.series or []
            analyses.append({
                "request_id": row.request_id,
                "name": row.name,
                "mean_soil_moisture": round(float(row.avg_moisture), 2) if row.avg_moisture is not None else None,
                "details": series
            })

        return {
            "lat": lat,
            "lon": lon,
            "months": months,
            "count": len(analyses),
            "analyses": analyses
        }
    finally:
        db.close()


async def perform_analysis(request: AnalysisRequest):
    print(f"[Background] Starting SMAP analysis for request {request.request_id}")

    db = SessionLocal()
    try:
        req = db.query(AnalysisRequestModel).filter(AnalysisRequestModel.id == request.request_id).first()
        if not req:
            print(f"[Background] Request {request.request_id} not found")
            return
        req.status = "processing"
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        print(f"[Background] Failed to set processing status: {e}")
        return
    finally:
        db.close()

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
        db = SessionLocal()
        try:
            req = db.query(AnalysisRequestModel).filter(AnalysisRequestModel.id == request.request_id).first()
            if req:
                req.status = "failed"
                db.commit()
        finally:
            db.close()
        return

    db = SessionLocal()
    try:
        for item in smap_data:
            db.add(
                AnalysisResultModel(
                    request_id=request.request_id,
                    acquisition_date=item["date"],
                    mean_soil_moisture=item["soil_moisture"],
                    image_url=None
                )
            )

        req = db.query(AnalysisRequestModel).filter(AnalysisRequestModel.id == request.request_id).first()
        if req:
            req.status = "completed"

        db.commit()
        print(f"[Background] Completed for request {request.request_id}, {len(smap_data)} records saved.")
    except SQLAlchemyError as e:
        db.rollback()
        print(f"[Background] DB error: {e}")
        req = db.query(AnalysisRequestModel).filter(AnalysisRequestModel.id == request.request_id).first()
        if req:
            req.status = "failed"
            db.commit()
    finally:
        db.close()