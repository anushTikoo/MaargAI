-- Reset
DROP TABLE IF EXISTS trip_segments CASCADE;
DROP TABLE IF EXISTS routes CASCADE;
DROP TABLE IF EXISTS trips CASCADE;
DROP TABLE IF EXISTS trucks CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS trip_locations CASCADE;

-- Users
CREATE TABLE users (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT,
    google_id VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trucks
CREATE TABLE trucks (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fleet_manager_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    truck_number VARCHAR(50) UNIQUE NOT NULL,
    truck_type VARCHAR(20) NOT NULL,
    capacity_kg NUMERIC(10,2) NOT NULL,
    height_m NUMERIC(5,2),
    mileage_kmpl NUMERIC(6,2),
    truck_weight NUMERIC(10,2),
    is_custom BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_truck_type
        CHECK (truck_type IN ('mini','light','medium','heavy','trailer')),

    CONSTRAINT chk_capacity_positive
        CHECK (capacity_kg > 0),

    CONSTRAINT chk_height_valid
        CHECK (height_m IS NULL OR height_m BETWEEN 1.5 AND 5.0),

    CONSTRAINT chk_mileage_valid
        CHECK (mileage_kmpl IS NULL OR mileage_kmpl > 0),

    CONSTRAINT chk_weight_valid
        CHECK (truck_weight IS NULL OR truck_weight > 0)
);

-- Trips
CREATE TABLE trips (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fleet_manager_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    truck_id INT NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    destination TEXT NOT NULL,
    source_lat DOUBLE PRECISION NOT NULL,
    source_lng DOUBLE PRECISION NOT NULL,
    dest_lat DOUBLE PRECISION NOT NULL,
    dest_lng DOUBLE PRECISION NOT NULL,
    deadline_timestamp TIMESTAMP,
    status VARCHAR(20) DEFAULT 'not started',
    baseline_eta_seconds INT,
    baseline_distance_meters INT,
    current_route_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_trip_status
        CHECK (status IN ('not started','active','completed')),

    CONSTRAINT chk_trip_source_not_empty
        CHECK (length(trim(source)) > 0),

    CONSTRAINT chk_trip_destination_not_empty
        CHECK (length(trim(destination)) > 0)
);

-- Routes
CREATE TABLE routes (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    route_index VARCHAR(5) NOT NULL,
    polyline TEXT NOT NULL,
    distance_meters INT,
    duration_seconds INT,
    has_tolls BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Circular FK
ALTER TABLE trips
ADD CONSTRAINT fk_trips_current_route
FOREIGN KEY (current_route_id)
REFERENCES routes(id)
ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_trucks_fleet_manager ON trucks(fleet_manager_id);
CREATE INDEX idx_trucks_type ON trucks(truck_type);

CREATE INDEX idx_trips_fleet_manager ON trips(fleet_manager_id);
CREATE INDEX idx_trips_truck ON trips(truck_id);
CREATE INDEX idx_trips_status ON trips(status);

CREATE INDEX idx_routes_trip ON routes(trip_id);

CREATE TABLE trip_locations (
    id SERIAL PRIMARY KEY,
    trip_id INT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

-- Trip Segments (For AI Analysis)
CREATE TABLE trip_segments (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    route_id INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    segment_index INT NOT NULL,
    start_lat DOUBLE PRECISION NOT NULL,
    start_lng DOUBLE PRECISION NOT NULL,
    end_lat DOUBLE PRECISION NOT NULL,
    end_lng DOUBLE PRECISION NOT NULL,
    distance_meters NUMERIC(10,2) NOT NULL,
    points_json JSONB NOT NULL,
    duration_in_traffic_seconds INT,
    delay_ratio NUMERIC(6,3),
    traffic_checked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trip_segments_route ON trip_segments(route_id);