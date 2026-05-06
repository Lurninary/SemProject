import ee
import geopandas as gpd
from shapely import wkt
from typing import List, Dict, Any
from datetime import datetime, timedelta


class GeeClient:
    def __init__(self, service_account_path: str = None):
        credentials = ee.ServiceAccountCredentials(key_file=service_account_path)
        ee.Initialize(credentials)

        print("Earth Engine initialized successfully.")

    def _wkt_to_ee_geometry(self, wkt_str: str, buffer_meters: int = 0) -> ee.Geometry:
        """
        Преобразует WKT строку в ee.Geometry.

        buffer_meters:
        - 0 — использовать точную геометрию пользователя;
        - >0 — расширить область, если нужно повысить шанс попадания в пиксели SMAP.
        """
        gdf = gpd.GeoDataFrame(geometry=[wkt.loads(wkt_str)], crs="EPSG:4326")
        geojson = gdf.__geo_interface__["features"][0]["geometry"]

        geom = ee.Geometry(geojson)

        if buffer_meters and buffer_meters > 0:
            geom = geom.buffer(buffer_meters)

        return geom

    def _get_smap_collection(self, date_from: str, date_to: str) -> ee.ImageCollection:
        """
        Возвращает коллекцию SMAP L4 за выбранный период.

        Earth Engine filterDate обычно работает как [start, end),
        поэтому к date_to добавляем 1 день.
        """
        start = datetime.strptime(date_from, "%Y-%m-%d").date()
        end = datetime.strptime(date_to, "%Y-%m-%d").date() + timedelta(days=1)

        return (
            ee.ImageCollection("NASA/SMAP/SPL4SMGP/008")
            .filterDate(start.isoformat(), end.isoformat())
            .select("sm_surface")
        )

    def get_smap_daily(self, geometry_wkt: str, date_from: str, date_to: str) -> List[Dict[str, Any]]:
        """
        Получает среднюю влажность почвы из SMAP L4 за каждый день в диапазоне.
        Возвращает список:
        {
            'date': 'YYYY-MM-DD',
            'soil_moisture': float
        }
        """
        # Для расчёта среднего можно оставить небольшой buffer,
        # чтобы очень маленькая область не дала пустой результат.
        geom = self._wkt_to_ee_geometry(geometry_wkt, buffer_meters=1000)

        collection = self._get_smap_collection(date_from, date_to)

        original_start = datetime.strptime(date_from, "%Y-%m-%d").date()
        original_end = datetime.strptime(date_to, "%Y-%m-%d").date()

        def extract_data(image):
            date = ee.Date(image.get("system:time_start")).format("YYYY-MM-dd")
            mean_sm = image.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geom,
                scale=9000,
                bestEffort=True
            ).get("sm_surface")

            return ee.Feature(None, {
                "date": date,
                "soil_moisture": mean_sm
            })

        features = collection.map(extract_data)
        result = features.getInfo()

        # Если в коллекции несколько наблюдений за одни сутки,
        # сначала соберём значения по датам, затем усредним.
        grouped = {}

        for feat in result["features"]:
            props = feat["properties"]

            if props.get("soil_moisture") is None:
                continue

            item_date = datetime.strptime(props["date"], "%Y-%m-%d").date()

            if not (original_start <= item_date <= original_end):
                continue

            grouped.setdefault(props["date"], []).append(props["soil_moisture"] * 100)

        data = []

        for date_str, values in sorted(grouped.items()):
            avg_value = sum(values) / len(values)
            data.append({
                "date": date_str,
                "soil_moisture": round(avg_value, 2)
            })

        return data

    def get_smap_period_tile_url(
        self,
        geometry_wkt: str,
        date_from: str,
        date_to: str
    ) -> Dict[str, Any]:
        """
        Создаёт настоящий растровый слой SMAP для отображения на карте.

        Это не псевдотепловая карта, а визуализация среднего значения sm_surface
        за выбранный период по реальным пикселям SMAP.
        """
        # Для карты используем точную геометрию пользователя без buffer.
        geom = self._wkt_to_ee_geometry(geometry_wkt, buffer_meters=0)

        collection = self._get_smap_collection(date_from, date_to)

        # Среднее изображение за период.
        image = (
            collection
            .mean()
            .multiply(100)
            .rename("soil_moisture_pct")
            .clip(geom)
        )

        # Палитру можно поменять под стиль интерфейса.
        # min/max лучше согласовать с предметной областью.
        vis_params = {
            "bands": ["soil_moisture_pct"],
            "min": 0,
            "max": 50,
            "palette": [
                "8c510a",
                "d8b365",
                "f6e8c3",
                "c7eae5",
                "5ab4ac",
                "01665e"
            ]
        }

        map_id = image.getMapId(vis_params)

        return {
            "tile_url": map_id["tile_fetcher"].url_format,
            "date_from": date_from,
            "date_to": date_to,
            "min": vis_params["min"],
            "max": vis_params["max"],
            "palette": vis_params["palette"],
            "units": "%"
        }