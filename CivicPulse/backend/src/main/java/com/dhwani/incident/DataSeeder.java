package com.dhwani.incident;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class DataSeeder implements CommandLineRunner {
    private final IncidentRepository repository;

    public DataSeeder(IncidentRepository repository) {
        this.repository = repository;
    }

    @Override
    public void run(String... args) {
        if (repository.count() > 0) return;

        Incident a = new Incident();
        a.setTitle("Large pothole near school");
        a.setDescription("Deep pothole reported by citizens");
        a.setType(IncidentType.POTHOLE);
        a.setLatitude(12.9716);
        a.setLongitude(77.5946);
        a.setReports(17);
        a.setConfidence(0.93);
        a.setSeverity("HIGH");
        a.setRiskScore(87);
        a.setPriority(Priority.HIGH);
        a.setRecommendation("Inspect and barricade the affected road section.");
        repository.save(a);

        Incident b = new Incident();
        b.setTitle("Water leakage");
        b.setDescription("Multiple reports of water leakage");
        b.setType(IncidentType.WATER_LEAKAGE);
        b.setLatitude(12.9780);
        b.setLongitude(77.6000);
        b.setReports(37);
        b.setConfidence(0.91);
        b.setSeverity("HIGH");
        b.setRiskScore(94);
        b.setPriority(Priority.CRITICAL);
        b.setRecommendation("Inspect pipeline section and check nearby roads.");
        repository.save(b);
    }
}
