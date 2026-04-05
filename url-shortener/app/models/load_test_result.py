from peewee import AutoField, CharField, DateTimeField, FloatField, IntegerField, TextField

from app.database import BaseModel


class LoadTestResult(BaseModel):
    id = AutoField()
    tier = CharField(max_length=20)  # bronze, silver, gold
    ran_at = DateTimeField()
    duration_s = FloatField()
    vus_max = IntegerField()
    iterations = IntegerField()
    requests_total = IntegerField()
    requests_per_sec = FloatField()
    avg_response_ms = FloatField()
    p95_response_ms = FloatField()
    error_rate = FloatField()
    thresholds_passed = IntegerField()
    thresholds_failed = IntegerField()
    raw_summary = TextField()  # full JSON summary from k6

    class Meta:
        table_name = "load_test_results"
