from app import main
from app.observability import HttpMetricsRegistry, PROMETHEUS_CONTENT_TYPE


def test_prometheus_metrics_endpoint_renders_http_samples(monkeypatch):
    registry = HttpMetricsRegistry()
    registry.observe_request(
        method="GET",
        route="/api/health",
        status_code=200,
        duration_seconds=0.012,
    )
    monkeypatch.setattr(main, "http_metrics", registry)

    response = main.observability_metrics()
    body = response.body.decode("utf-8")

    assert response.headers["content-type"].startswith(PROMETHEUS_CONTENT_TYPE)
    assert (
        'edgelab_http_requests_total{method="GET",route="/api/health",status="200"} 1'
        in body
    )
    assert (
        'edgelab_http_request_duration_seconds_count{method="GET",route="/api/health"} 1'
        in body
    )
    assert "edgelab_http_in_flight_requests 0" in body
