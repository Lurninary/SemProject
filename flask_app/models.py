from flask_sqlalchemy import SQLAlchemy
from geoalchemy2 import Geography

db = SQLAlchemy()

class AnalysisRequest(db.Model):
    __tablename__ = 'analysis_requests'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255))
    geometry = db.Column(Geography(geometry_type='POLYGON', srid=4326))
    date_from = db.Column(db.Date)
    date_to = db.Column(db.Date)
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    status = db.Column(db.String(50), default='pending')

class AnalysisResult(db.Model):
    __tablename__ = 'analysis_results'
    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(db.Integer, db.ForeignKey('analysis_requests.id'))
    acquisition_date = db.Column(db.Date)
    mean_ndwi = db.Column(db.Float)
    mean_soil_moisture = db.Column(db.Float)
    image_url = db.Column(db.Text)
    processed_at = db.Column(db.DateTime, server_default=db.func.now())