from fastapi import FastAPI
from pydantic import BaseModel
from math import sqrt

app = FastAPI(title="Dhwani AI Service", version="1.0.0")

class Incident(BaseModel):
    type: str
    description: str = ""
    latitude: float = 0
    longitude: float = 0
    reports: int = 1
    imageUrl: str = ""

class Analysis(BaseModel):
    confidence: float
    severity: str
    riskScore: float
    priority: str
    recommendation: str
    affectedRoads: int
    nearbySchools: int
    trafficLevel: int

TYPE_BASE = {
    "POTHOLE": 55,
    "FLOODING": 70,
    "WATER_LEAKAGE": 65,
    "GARBAGE": 40,
    "STREETLIGHT": 35,
    "POWER_PROBLEM": 60,
    "PUBLIC_SAFETY": 75,
    "OTHER": 30,
}

def analyze_image(data: Incident) -> tuple[float, str]:
    # Demo inference only.
    # Replace this function with YOLO/OpenCV inference after training/loading
    # your model. No claim of real image recognition is made here.
    text = (data.description or "").lower()
    if "huge" in text or "deep" in text or "dangerous" in text:
        return 0.93, "HIGH"
    return 0.86, "MEDIUM"

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/analyze", response_model=Analysis)
def analyze(data: Incident):
    confidence, vision_severity = analyze_image(data)

    base = TYPE_BASE.get(data.type.upper(), 30)
    report_factor = min(data.reports * 1.5, 25)

    # Demo geospatial/context signals.
    nearby_schools = 1 if (abs(data.latitude - 12.9716) < 0.01 and
                            abs(data.longitude - 77.5946) < 0.01) else 0
    traffic_level = 8 if nearby_schools else 5
    affected_roads = max(1, min(5, int(data.reports / 10) + 1))

    risk = min(100, base + report_factor + nearby_schools * 10 + traffic_level)
    if risk >= 90:
        priority = "CRITICAL"
    elif risk >= 70:
        priority = "HIGH"
    elif risk >= 45:
        priority = "MEDIUM"
    else:
        priority = "LOW"

    if data.type == "POTHOLE":
        recommendation = "Inspect road surface and repair or barricade the pothole."
    elif data.type == "WATER_LEAKAGE":
        recommendation = "Inspect the suspected pipeline section and isolate leakage if required."
    elif data.type == "FLOODING":
        recommendation = "Inspect drainage, clear blockage and assess traffic diversion."
    elif data.type == "GARBAGE":
        recommendation = "Dispatch sanitation team and inspect repeated accumulation."
    elif data.type == "STREETLIGHT":
        recommendation = "Dispatch electrical maintenance team."
    elif data.type == "POWER_PROBLEM":
        recommendation = "Inspect electrical infrastructure and assess public-safety risk."
    else:
        recommendation = "Verify the incident and assign the appropriate response team."

    return Analysis(
        confidence=confidence,
        severity=vision_severity,
        riskScore=round(risk, 1),
        priority=priority,
        recommendation=recommendation,
        affectedRoads=affected_roads,
        nearbySchools=nearby_schools,
        trafficLevel=traffic_level
    )
