"""Process-state isolation between tests using independent fixture databases."""
import pytest

from app.services import billing
from app.services.billing_rate_limits import BillingAdmissionLimiter


@pytest.fixture(autouse=True)
def isolate_billing_admission(monkeypatch):
    # Every test gets the real production limits. Requests and owners within a
    # test still share them; reused fixture IDs cannot spend another test's quota.
    monkeypatch.setattr(billing, "billing_limiter", BillingAdmissionLimiter())
