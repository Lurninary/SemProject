import os
import ee
import geopandas as gpd
from shapely import wkt
from typing import List, Dict, Any

class GeeClient:
    def __init__(self, service_account_path: str = None):
        """
        Инициализация Earth Engine.
        Если указан путь к ключу, используется сервисный аккаунт.
        Иначе пробует анонимный доступ (может не работать без предварительной авторизации).
        """
        credentials = ee.ServiceAccountCredentials(key_file=service_account_path)
        ee.Initialize(credentials)

        print("Earth Engine initialized successfully.")

    def _wkt_to_ee_geometry(self, wkt_str: str) -> ee.Geometry:
        """Преобразует WKT строку в ee.Geometry.Polygon."""
        gdf = gpd.GeoDataFrame(geometry=[wkt.loads(wkt_str)], crs='EPSG:4326')
        geojson = gdf.__geo_interface__['features'][0]['geometry']
        return ee.Geometry(geojson)

    def get_smap_daily(self, geometry_wkt: str, date_from: str, date_to: str) -> List[Dict[str, Any]]:
        """
        Получает среднюю влажность почвы (поверхностный слой) из SMAP L4 за каждый день в диапазоне.
        Возвращает список словарей: {'date': 'YYYY-MM-DD', 'soil_moisture': float (в процентах)}.
        """
        geom = self._wkt_to_ee_geometry(geometry_wkt)

        # Коллекция SMAP L4 Global 9 km (поверхностная влажность 0-5 см)
        smap_collection = ee.ImageCollection('NASA/SMAP/SPL4SMGP/007') \
            .filterDate(date_from, date_to) \
            .select(['sm_surface'])  # объёмная доля влаги (0-1)

        def extract_data(image):
            date = ee.Date(image.get('system:time_start')).format('YYYY-MM-dd')
            mean_sm = image.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geom,
                scale=9000,       # масштаб SMAP ~9 км
                bestEffort=True
            ).get('sm_surface')
            return ee.Feature(None, {'date': date, 'soil_moisture': mean_sm})

        features = smap_collection.map(extract_data)
        result = features.getInfo()

        data = []
        for feat in result['features']:
            props = feat['properties']
            if props.get('soil_moisture') is not None:
                data.append({
                    'date': props['date'],
                    'soil_moisture': round(props['soil_moisture'] * 100, 2)
                })
        return data