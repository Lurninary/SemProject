from flask import Flask, render_template, request, jsonify
from models import db, AnalysisRequest
import os
import requests

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
            geometry=data['geometry'],
            date_from=data['date_from'],
            date_to=data['date_to']
        )
        db.session.add(new_request)
        db.session.commit()

        task_data = {
            "request_id": new_request.id,
            "geometry": data['geometry'],
            "date_from": data['date_from'],
            "date_to": data['date_to']
        }

        response = requests.post(f"{FASTAPI_URL}/api/process", json=task_data)

        if response.status_code == 202:
            new_request.status = 'processing'
            db.session.commit()
            return jsonify({"message": "Analysis started", "id": new_request.id}), 202
        else:
            new_request.status = 'failed'
            db.session.commit()
            return jsonify({"error": "Failed to start analysis"}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route('/api/results/<int:request_id>')
def get_results(request_id):
    """Получает результаты анализа по ID запроса."""

    return jsonify({
        "status": "completed",
        "results": {
            "mean_ndwi": 0.15,
            "mean_soil_moisture": 25.5,
            "image_url": "https://example.com/tile.png"
        }
    })


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=5000, debug=True)