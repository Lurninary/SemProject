from flask import Flask, render_template, request, jsonify
from models import db, AnalysisRequest
import os
import requests
import json
from datetime import datetime
from sqlalchemy import func, cast
from geoalchemy2 import Geometry

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
FASTAPI_URL = os.getenv('FASTAPI_URL', 'http://fastapi_app:8000')

db.init_app(app)


@app.route('/')
def index():
    """Главная страница с картой и формой."""
    return render_template('index.html')


@app.route('/api/submit_analysis', methods=['POST'])
def submit_analysis():
    """Принимает данные с формы, создает запрос в БД и отправляет задачу в FastAPI."""
    try:
        data = request.json
        analysis_parameter = data.get('analysis_parameter', 'smap_soil_moisture')

        allowed_parameters = {'smap_soil_moisture', 's2_ndmi'}
        if analysis_parameter not in allowed_parameters:
            return jsonify({"error": "Unknown analysis parameter"}), 400

        new_request = AnalysisRequest(
            name=data.get('name', 'Unnamed Request'),
            geometry=data.get('geometry'),
            date_from=datetime.strptime(data.get('date_from'), '%Y-%m-%d').date(),
            date_to=datetime.strptime(data.get('date_to'), '%Y-%m-%d').date(),
            analysis_parameter=analysis_parameter
        )
        db.session.add(new_request)
        db.session.commit()

        payload = {
            "request_id": new_request.id,
            "geometry": data['geometry'],
            "date_from": data['date_from'],
            "date_to": data['date_to'],
            "analysis_parameter": analysis_parameter
        }
        fastapi_resp = requests.post(f"{FASTAPI_URL}/api/process", json=payload)
        if fastapi_resp.status_code != 200:
            new_request.status = 'failed'
            db.session.commit()
            return jsonify({"error": "Failed to start analysis in backend"}), 500

        return jsonify({
            "message": "Analysis started",
            "id": new_request.id
        }), 202

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route('/api/results/<int:request_id>')
def get_results(request_id):
    """Получает результаты анализа из БД (данные уже должны быть сохранены FastAPI)."""
    from models import AnalysisResult
    results = AnalysisResult.query.filter_by(request_id=request_id).all()
    if results:
        avg_moisture = sum(r.mean_soil_moisture for r in results) / len(results)
        return jsonify({
            "status": "completed",
            "mean_soil_moisture": round(avg_moisture, 2),
            "details": [{"date": str(r.acquisition_date), "moisture": r.mean_soil_moisture} for r in results]
        })
    else:
        req = AnalysisRequest.query.get(request_id)
        if req and req.status == 'processing':
            return jsonify({"status": "processing"}), 202
        elif req and req.status == 'failed':
            return jsonify({"status": "failed", "error": "Analysis failed"}), 500
        else:
            return jsonify({"error": "Results not found"}), 404

@app.route('/api/requests')
def list_requests():
    """Список всех запросов."""
    limit = request.args.get("limit", default=20, type=int)
    q = AnalysisRequest.query.order_by(AnalysisRequest.id.desc())
    if limit and limit > 0:
        q = q.limit(limit)
    requests_list = q.all()
    return jsonify([{
        "id": r.id,
        "name": r.name,
        "status": r.status,
        "analysis_parameter": r.analysis_parameter,
        "created_at": str(r.created_at)
    } for r in requests_list])


@app.route('/api/requests/<int:request_id>/bounds')
def request_bounds(request_id):
    """
    Bounding box of saved request geometry for map zoom.
    Returns {south, west, north, east}.
    """
    row = (
        db.session.query(
            func.ST_YMin(cast(AnalysisRequest.geometry, Geometry)).label("south"),
            func.ST_XMin(cast(AnalysisRequest.geometry, Geometry)).label("west"),
            func.ST_YMax(cast(AnalysisRequest.geometry, Geometry)).label("north"),
            func.ST_XMax(cast(AnalysisRequest.geometry, Geometry)).label("east"),
        )
        .filter(AnalysisRequest.id == request_id)
        .first()
    )

    if not row or row.south is None:
        return jsonify({"error": "Geometry not found"}), 404

    return jsonify({
        "request_id": request_id,
        "south": float(row.south),
        "west": float(row.west),
        "north": float(row.north),
        "east": float(row.east),
    })


@app.route('/api/requests/<int:request_id>/geometry')
def request_geometry(request_id):
    row = (
        db.session.query(
            AnalysisRequest.name.label("name"),
            func.ST_AsGeoJSON(cast(AnalysisRequest.geometry, Geometry)).label("geometry_json"),
        )
        .filter(AnalysisRequest.id == request_id)
        .first()
    )

    if not row or not row.geometry_json:
        return jsonify({"error": "Geometry not found"}), 404

    return jsonify({
        "request_id": request_id,
        "name": row.name,
        "geometry": json.loads(row.geometry_json),
    })

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=5000, debug=True)