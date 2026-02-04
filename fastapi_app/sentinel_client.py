import os
from typing import Dict, Any


class SentinelHubClient:
    def __init__(self):
        self.client_id = os.getenv('SENTINEL_HUB_CLIENT_ID', 'demo')
        self.client_secret = os.getenv('SENTINEL_HUB_CLIENT_SECRET', 'demo')
        self.base_url = "https://services.sentinel-hub.com"

    def get_ndwi_data(self, geometry: str, date_from: str, date_to: str) -> Dict[str, Any]:
        """
        Получает данные NDWI (индекс воды) для заданной области и периода.
        В реальности это будет запрос к Process API Sentinel Hub с evalscript.
        """

        print(f"[Mock] Requesting NDWI for area: {geometry[:50]}... from {date_from} to {date_to}")

        return {
            "acquisition_date": "2023-10-15",
            "mean_ndwi": 0.15,
            "image_url": "https://services.sentinel-hub.com/ogc/wms/...",  # URL WMS тайла
            "stats": {
                "min": -0.1,
                "max": 0.3,
                "mean": 0.15,
                "std": 0.05
            }
        }

    def estimate_soil_moisture(self, ndwi_value: float, band_data: Dict = None) -> float:
        """
        Очень упрощенная модель оценки влажности почвы на основе NDWI.
        В реальности нужна сложная модель с машинным обучением и дополнительными данными.
        """

        moisture = 10 + (ndwi_value + 0.5) * 30
        return max(0, min(100, moisture))
