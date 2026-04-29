from geoalchemy2 import Geography
from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, func

from database import Base


class AnalysisRequestModel(Base):
    __tablename__ = "analysis_requests"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255))
    geometry = Column(Geography(geometry_type="POLYGON", srid=4326))
    date_from = Column(Date)
    date_to = Column(Date)
    created_at = Column(DateTime, server_default=func.now())
    status = Column(String(50), default="pending")


class AnalysisResultModel(Base):
    __tablename__ = "analysis_results"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("analysis_requests.id"))
    acquisition_date = Column(Date)
    mean_ndwi = Column(Float)
    mean_soil_moisture = Column(Float)
    image_url = Column(Text)
    processed_at = Column(DateTime, server_default=func.now())
