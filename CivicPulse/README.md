# Dhwani — Java + React + Python AI MVP

A runnable MVP of Dhwani:
Citizen report -> Java Spring Boot API -> Python AI analysis -> risk/priority -> dashboard.

## Stack
- Backend: Java 17, Spring Boot, Spring Web, Spring Data JPA
- Database: H2 by default (easy local demo); PostgreSQL schema included
- Frontend: React + Vite
- AI service: Python FastAPI
- Maps: Leaflet
- Optional production additions: PostgreSQL/PostGIS, Redis, Kafka, YOLO

## Run

### 1. AI service
```bash
cd ai-service
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### 2. Java backend
Requirements: Java 17+ and Maven.

```bash
cd backend
mvn spring-boot:run
```

Backend: http://localhost:8080
H2 console: http://localhost:8080/h2-console
JDBC URL: jdbc:h2:file:./data/dhwani
User: sa
Password: blank

### 3. Frontend
Requirements: Node.js 18+.

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173

## API

POST /api/incidents
```json
{
  "title": "Large pothole near school",
  "description": "Deep pothole on the main road",
  "type": "POTHOLE",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "imageUrl": ""
}
```

GET /api/incidents

PATCH /api/incidents/{id}/resolve

POST /api/ai/analyze

The Java service calls the Python AI service and stores the returned confidence,
severity, risk score, priority and recommendation.

## Important
The included AI service is a demo inference service. It does NOT claim to be a
trained production YOLO model. Replace `analyze_image()` with a trained YOLO/OpenCV
pipeline when you have a dataset/model.

## Suggested production evolution
1. PostgreSQL + PostGIS
2. Real image upload with object storage
3. YOLO model for pothole/flood/garbage detection
4. Redis for caching/live state
5. Kafka for event streaming
6. WebSockets for live dashboard updates
7. Authentication and role-based access
8. Audit logs and human verification before high-impact decisions
