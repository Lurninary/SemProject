CREATE EXTENSION IF NOT EXISTS postgis;


CREATE TABLE IF NOT EXISTS analysis_requests (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    geometry GEOGRAPHY(GEOMETRY, 4326),
    date_from DATE,
    date_to DATE,
    analysis_parameter VARCHAR(50) DEFAULT 'smap_soil_moisture',
    created_at TIMESTAMP DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'pending'
);


CREATE TABLE IF NOT EXISTS analysis_results (
    id SERIAL PRIMARY KEY,
    request_id INTEGER REFERENCES analysis_requests(id) ON DELETE CASCADE,
    acquisition_date DATE,
    mean_ndwi FLOAT,
    mean_ndmi FLOAT,
    mean_soil_moisture FLOAT,
    image_url TEXT,
    processed_at TIMESTAMP DEFAULT NOW()
);


CREATE INDEX idx_analysis_requests_geometry ON analysis_requests USING GIST(geometry);