package com.dhwani.incident;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/incidents")
@CrossOrigin(origins = "http://localhost:5173")
public class IncidentController {
    private final IncidentService service;

    public IncidentController(IncidentService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<Incident> create(@RequestBody Incident incident) {
        return ResponseEntity.ok(service.create(incident));
    }

    @GetMapping
    public List<Incident> all() {
        return service.all();
    }

    @PatchMapping("/{id}/resolve")
    public ResponseEntity<Incident> resolve(@PathVariable Long id) {
        return ResponseEntity.ok(service.resolve(id));
    }
}
