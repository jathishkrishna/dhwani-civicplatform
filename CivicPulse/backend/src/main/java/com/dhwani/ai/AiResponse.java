package com.dhwani.ai;

public record AiResponse(
    double confidence,
    String severity,
    double riskScore,
    String priority,
    String recommendation,
    int affectedRoads,
    int nearbySchools,
    int trafficLevel
) {}
