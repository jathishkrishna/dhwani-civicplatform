package com.dhwani.incident;

import com.dhwani.ai.*;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class IncidentService {
    private final IncidentRepository repository;
    private final AiClient aiClient;

    public IncidentService(IncidentRepository repository, AiClient aiClient) {
        this.repository = repository;
        this.aiClient = aiClient;
    }

    public Incident create(Incident incident) {
        if (incident.getReports() <= 0) incident.setReports(1);

        AiResponse ai = aiClient.analyze(new AiRequest(
                incident.getType().name(),
                incident.getDescription(),
                incident.getLatitude(),
                incident.getLongitude(),
                incident.getReports(),
                incident.getImageUrl()
        ));

        incident.setConfidence(ai.confidence());
        incident.setSeverity(ai.severity());
        incident.setRiskScore(ai.riskScore());
        incident.setPriority(Priority.valueOf(ai.priority()));
        incident.setRecommendation(ai.recommendation());

        return repository.save(incident);
    }

    public List<Incident> all() {
        return repository.findAllByOrderByCreatedAtDesc();
    }

    public Incident resolve(Long id) {
        Incident incident = repository.findById(id)
                .orElseThrow(() -> new RuntimeException("Incident not found"));
        incident.setResolved(true);
        incident.setResolvedAt(LocalDateTime.now());
        return repository.save(incident);
    }
}
