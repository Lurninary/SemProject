from flask import Flask, render_template, request, jsonify
from models import db, AnalysisRequest, AnalysisResult
import os
import requests
from datetime import datetime

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
    """Принимает данные с формы и создает задачу на анализ."""
    try:
        data = request.json
        new_request = AnalysisRequest(
            name=data.get('name', 'Unnamed Request'),
            geometry=data.get('geometry', 'POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))'),
            date_from=datetime.strptime(data.get('date_from', '2023-01-01'), '%Y-%m-%d').date(),
            date_to=datetime.strptime(data.get('date_to', '2023-12-31'), '%Y-%m-%d').date()
        )
        db.session.add(new_request)
        db.session.commit()

        result = AnalysisResult(
            request_id=new_request.id,
            acquisition_date=datetime.now().date(),
            mean_ndwi=0.15,
            mean_soil_moisture=25.5,
            image_url="https://via.placeholder.com/300x200?text=Satellite+Image"
        )
        db.session.add(result)
        new_request.status = 'completed'
        db.session.commit()

        return jsonify({
            "message": "Analysis completed (demo mode)",
            "id": new_request.id,
            "results": {
                "mean_ndwi": result.mean_ndwi,
                "mean_soil_moisture": result.mean_soil_moisture,
                "image_url": result.image_url
            }
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/api/results/<int:request_id>')
def get_results(request_id):
    """Получает результаты анализа по ID запроса."""
    result = AnalysisResult.query.filter_by(request_id=request_id).first()
    if result:
        return jsonify({
            "status": "completed",
            "results": {
                "mean_ndwi": result.mean_ndwi,
                "mean_soil_moisture": result.mean_soil_moisture,
                "image_url": result.image_url,
                "acquisition_date": str(result.acquisition_date)
            }
        })
    else:
        return jsonify({"error": "Results not found"}), 404

@app.route('/api/requests')
def list_requests():
    """Список всех запросов."""
    requests = AnalysisRequest.query.all()
    return jsonify([{
        "id": r.id,
        "name": r.name,
        "status": r.status,
        "created_at": str(r.created_at)
    } for r in requests])

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=5000, debug=True)