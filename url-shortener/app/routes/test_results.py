import json
from datetime import UTC, datetime

from flask import Blueprint, jsonify, request

from app.models.load_test_result import LoadTestResult

test_results_bp = Blueprint("test_results", __name__)


@test_results_bp.route("/test-results", methods=["POST"])
def store_test_result():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    metrics = data.get("metrics", {})
    root_group = data.get("root_group", {})

    # Extract key metrics from k6 summary
    http_req_duration = metrics.get("http_req_duration", {}).get("values", {})
    http_reqs = metrics.get("http_reqs", {}).get("values", {})
    iterations = metrics.get("iterations", {}).get("values", {})
    vus_max = metrics.get("vus_max", {}).get("values", {})
    errors = metrics.get("errors", {}).get("values", {})

    # Count threshold passes/failures
    thresholds_passed = 0
    thresholds_failed = 0
    for metric_name, metric_data in metrics.items():
        for t in metric_data.get("thresholds", {}).values():
            if t.get("ok", False):
                thresholds_passed += 1
            else:
                thresholds_failed += 1

    # Determine tier from the state.testRunDurationMs or from the request
    tier = data.get("tier", "unknown")

    result = LoadTestResult.create(
        tier=tier,
        ran_at=datetime.now(UTC),
        duration_s=data.get("state", {}).get("testRunDurationMs", 0) / 1000.0,
        vus_max=int(vus_max.get("max", 0)),
        iterations=int(iterations.get("count", 0)),
        requests_total=int(http_reqs.get("count", 0)),
        requests_per_sec=http_reqs.get("rate", 0),
        avg_response_ms=http_req_duration.get("avg", 0),
        p95_response_ms=http_req_duration.get("p(95)", 0),
        error_rate=errors.get("rate", 0) if errors else 0,
        thresholds_passed=thresholds_passed,
        thresholds_failed=thresholds_failed,
        raw_summary=json.dumps(data),
    )

    return jsonify({"id": result.id, "message": "Test result stored"}), 201


@test_results_bp.route("/test-results", methods=["GET"])
def list_test_results():
    tier = request.args.get("tier")
    query = LoadTestResult.select().order_by(LoadTestResult.ran_at.desc())
    if tier:
        query = query.where(LoadTestResult.tier == tier)

    results = []
    for r in query.limit(50):
        results.append({
            "id": r.id,
            "tier": r.tier,
            "ran_at": r.ran_at.isoformat(),
            "duration_s": r.duration_s,
            "vus_max": r.vus_max,
            "iterations": r.iterations,
            "requests_total": r.requests_total,
            "requests_per_sec": round(r.requests_per_sec, 2),
            "avg_response_ms": round(r.avg_response_ms, 2),
            "p95_response_ms": round(r.p95_response_ms, 2),
            "error_rate": round(r.error_rate * 100, 2),
            "thresholds_passed": r.thresholds_passed,
            "thresholds_failed": r.thresholds_failed,
        })

    return jsonify(results)
