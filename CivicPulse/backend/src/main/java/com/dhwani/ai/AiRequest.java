package com.dhwani.ai;

public record AiRequest(
    String type,
    String description,
    double latitude,
    double longitude,
    int reports,
    String imageUrl
) {}
