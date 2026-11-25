package com.dhwani.ai;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

@Service
public class AiClient {
    private final RestClient client;

    public AiClient(@Value("${ai.service.url}") String baseUrl) {
        this.client = RestClient.builder().baseUrl(baseUrl).build();
    }

    public AiResponse analyze(AiRequest request) {
        return client.post()
                .uri("/analyze")
                .body(request)
                .retrieve()
                .body(AiResponse.class);
    }
}
