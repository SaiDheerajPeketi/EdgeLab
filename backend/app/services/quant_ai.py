from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING
from hashlib import sha256
import json
import logging
import re
from time import monotonic
from typing import Any, Protocol

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AIBacktestRun,
    AIConversation,
    AIGeneratedArtifact,
    AIGenerationJob,
    AIJobEvent,
    AIMessage,
    AIAuditLog,
    AIUsageLedger,
    BetaUser,
    IntegrationSecret,
    MarketInstrument,
    NormalizedCandle,
    QuantScript,
    QuantScriptPermission,
    QuantScriptVersion,
    utcnow,
)
from app.schemas import (
    AIBacktestRead,
    AIBacktestRequest,
    AIConversationCreate,
    AIConversationRead,
    AIGeneratedArtifactRead,
    AIGenerationJobRead,
    AIGenerationRequest,
    AIJobEventRead,
    AIMessageRead,
    AIModelRead,
    AIRetentionResult,
    AIUsageSummaryRead,
    QuantScriptCreate,
    QuantScriptPermissionCreate,
    QuantScriptPermissionRead,
    QuantScriptRead,
    QuantScriptVersionCreate,
    QuantScriptVersionRead,
)
from app.services import integration_secrets


logger = logging.getLogger(__name__)
UTC = timezone.utc
DSL_VERSION = 1
MAX_SOURCE_BYTES = 64 * 1024
MAX_DSL_NODES = 256
MAX_INPUTS = 32
MAX_SERIES = 64
MAX_PLOTS = 64
MAX_SIGNALS = 64
MAX_BARS = 100_000
MAX_OUTPUT_VALUES = 8_000_000
MAX_ESTIMATED_OPERATIONS = 5_000_000
MAX_EXECUTION_SECONDS = 2.0
DAILY_JOB_LIMIT = 50
PER_MINUTE_JOB_LIMIT = 10
DAILY_TOKEN_LIMIT = 200_000
DAILY_COST_LIMIT_MICROS = 5_000_000
MAX_CONCURRENT_JOBS = 2
SENSITIVE_AUDIT_KEYS = frozenset({"prompt", "content", "source", "secret", "credentials", "image", "storage_ref"})
NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
SLUG_PATTERN = re.compile(r"[^a-z0-9]+")
BASE_SERIES = frozenset({"open", "high", "low", "close", "volume"})
SERIES_OPS = frozenset({"sma", "ema", "highest", "lowest", "add", "subtract", "multiply", "divide", "change", "roc"})
SIGNAL_OPS = frozenset({"above", "below", "cross_above", "cross_below"})


class AIServiceError(Exception):
    status_code = 400
    public_message = "Quant request could not be completed"

    def __init__(self, public_message: str | None = None) -> None:
        super().__init__(public_message or self.public_message)
        self.public_message = public_message or self.public_message


class AINotFoundError(AIServiceError):
    status_code = 404


class AIConflictError(AIServiceError):
    status_code = 409


class AIProviderUnavailableError(AIServiceError):
    status_code = 503


class AIQuotaError(AIServiceError):
    status_code = 429


class AICostLimitError(AIServiceError):
    status_code = 402


class AIDSLValidationError(AIServiceError):
    status_code = 422


class AIExecutionLimitError(AIServiceError):
    status_code = 422


class AISecurityError(AIServiceError):
    status_code = 422
    public_message = "Generated output failed security validation"


@dataclass(frozen=True, slots=True)
class AIModelPolicy:
    model_id: str
    display_name: str
    provider: str
    operations: tuple[str, ...]
    input_token_cost_micros: int
    output_token_cost_micros: int
    max_output_tokens: int
    credential_required: bool


@dataclass(frozen=True, slots=True)
class AIProviderResult:
    content: Mapping[str, Any]
    input_tokens: int
    output_tokens: int
    provider_request_id: str | None = None


class AIProviderAdapter(Protocol):
    provider_id: str

    def generate(
        self,
        credentials: Mapping[str, str],
        request: Mapping[str, Any],
        emit: Callable[[str, Mapping[str, Any]], None],
        cancelled: Callable[[], bool],
    ) -> AIProviderResult: ...


SAFE_FIXTURE_SOURCE = json.dumps(
    {
        "dsl_version": 1,
        "name": "Fixture moving average",
        "description": "Deterministic offline fixture; not investment advice.",
        "inputs": {"length": {"type": "integer", "default": 3, "min": 1, "max": 500}},
        "series": [{"name": "average", "op": "sma", "source": "close", "length": "length"}],
        "plots": [{"series": "average", "color": "#22d3ee"}],
        "signals": [
            {"name": "cross_up", "op": "cross_above", "left": "close", "right": "average"},
            {"name": "cross_down", "op": "cross_below", "left": "close", "right": "average"},
        ],
    },
    separators=(",", ":"),
    sort_keys=True,
)


class DeterministicFixtureAIAdapter:
    """Offline-only fixture. It does not claim model intelligence or external connectivity."""

    provider_id = "offline-ai-fixture"

    def generate(
        self,
        credentials: Mapping[str, str],
        request: Mapping[str, Any],
        emit: Callable[[str, Mapping[str, Any]], None],
        cancelled: Callable[[], bool],
    ) -> AIProviderResult:
        if credentials:
            raise AISecurityError("Offline fixture does not accept credentials")
        if cancelled():
            raise AIConflictError("Generation was cancelled")
        emit("PROGRESS", {"stage": "validated", "percent": 50})
        operation = str(request["operation"])
        if operation in {"GENERATE_INDICATOR", "EDIT_INDICATOR", "ANALYSIS_TO_INDICATOR"}:
            content: Mapping[str, Any] = {
                "source": SAFE_FIXTURE_SOURCE,
                "summary": "Created a deterministic restricted-DSL fixture indicator.",
            }
        elif operation == "CHART_ANALYSIS":
            content = {
                "daily_bias": "NEUTRAL",
                "levels": [],
                "invalidation": "No market inference is made by the offline fixture.",
                "uncertainty": "External analysis is unavailable without a configured provider.",
                "risk_warning": "This fixture output is not trading or investment advice.",
            }
        else:
            content = {"text": "Offline fixture acknowledged the request; no external model was called."}
        emit("DELTA", {"delta": str(content.get("summary") or content.get("text") or "Structured result ready.")})
        emit("PROGRESS", {"stage": "generated", "percent": 100})
        prompt = str(request.get("prompt", ""))
        return AIProviderResult(
            content=content,
            input_tokens=max(1, (len(prompt) + 3) // 4),
            output_tokens=max(1, (len(json.dumps(content)) + 3) // 4),
            provider_request_id=None,
        )


DEFAULT_MODEL_POLICIES = (
    AIModelPolicy(
        model_id="offline-deterministic",
        display_name="Offline deterministic fixture",
        provider="offline-ai-fixture",
        operations=("CHAT", "CHART_ANALYSIS", "GENERATE_INDICATOR", "EDIT_INDICATOR", "ANALYSIS_TO_INDICATOR"),
        input_token_cost_micros=0,
        output_token_cost_micros=0,
        max_output_tokens=4096,
        credential_required=False,
    ),
    AIModelPolicy(
        model_id="external-standard",
        display_name="Configured external AI model",
        provider="external-ai",
        operations=("CHAT", "CHART_ANALYSIS", "GENERATE_INDICATOR", "EDIT_INDICATOR", "ANALYSIS_TO_INDICATOR"),
        input_token_cost_micros=2,
        output_token_cost_micros=8,
        max_output_tokens=8192,
        credential_required=True,
    ),
)


class AIProviderRouter:
    def __init__(
        self,
        policies: Sequence[AIModelPolicy] = DEFAULT_MODEL_POLICIES,
        adapters: Sequence[AIProviderAdapter] = (),
    ) -> None:
        self._policies = {policy.model_id: policy for policy in policies}
        self._adapters = {adapter.provider_id: adapter for adapter in adapters}

    def policy(self, model_id: str) -> AIModelPolicy:
        policy = self._policies.get(model_id)
        if policy is None:
            raise AIProviderUnavailableError(f"AI model '{model_id}' is not supported")
        return policy

    def adapter(self, provider: str) -> AIProviderAdapter:
        adapter = self._adapters.get(provider)
        if adapter is None:
            raise AIProviderUnavailableError(
                f"Provider '{provider}' has no configured server adapter"
            )
        return adapter

    def catalog(self, db: Session, user_id: int) -> list[AIModelRead]:
        result: list[AIModelRead] = []
        for policy in sorted(self._policies.values(), key=lambda item: item.model_id):
            adapter_configured = policy.provider in self._adapters
            credential = _provider_secret(db, user_id, policy.provider) if policy.credential_required else None
            credential_available = not policy.credential_required or credential is not None
            available = adapter_configured and credential_available
            if not adapter_configured:
                reason = "Server adapter is not configured; no external call will be attempted."
            elif not credential_available:
                reason = "Add an active encrypted AI-provider credential before using this model."
            elif policy.provider == "offline-ai-fixture":
                reason = "Available as a deterministic offline fixture; it is not a live AI model."
            else:
                reason = "Configured server adapter and encrypted credential are available."
            result.append(
                AIModelRead(
                    model_id=policy.model_id,
                    display_name=policy.display_name,
                    provider=policy.provider,
                    operations=list(policy.operations),
                    input_token_cost_micros=policy.input_token_cost_micros,
                    output_token_cost_micros=policy.output_token_cost_micros,
                    max_output_tokens=policy.max_output_tokens,
                    credential_required=policy.credential_required,
                    adapter_configured=adapter_configured,
                    available=available,
                    availability_reason=reason,
                )
            )
        return result


ai_provider_router = AIProviderRouter(adapters=(DeterministicFixtureAIAdapter(),))


def _utc_naive(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _hash(value: Any) -> str:
    return sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def _decimal_text(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    return "0" if text in {"", "-0"} else text


def _safe_json(value: Any) -> Any:
    return json.loads(json.dumps(value, sort_keys=True, default=str))


def _slug(value: str) -> str:
    slug = SLUG_PATTERN.sub("-", value.strip().lower()).strip("-")
    if not slug:
        raise AIDSLValidationError("Script name must include a letter or number")
    return slug[:120]


def _provider_secret(db: Session, user_id: int, provider: str) -> IntegrationSecret | None:
    return db.scalar(
        select(IntegrationSecret)
        .where(
            IntegrationSecret.user_id == user_id,
            IntegrationSecret.provider == provider,
            IntegrationSecret.purpose == "ai-provider",
            IntegrationSecret.revoked_at.is_(None),
        )
        .order_by(IntegrationSecret.updated_at.desc(), IntegrationSecret.id.desc())
        .limit(1)
    )


def _audit_details(details: Mapping[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, value in details.items():
        normalized = key.lower()
        clean[key] = "[REDACTED]" if any(part in normalized for part in SENSITIVE_AUDIT_KEYS) else _safe_json(value)
    return clean


def _audit(
    db: Session,
    user_id: int,
    *,
    action: str,
    resource_type: str,
    resource_id: int | None,
    outcome: str,
    details: Mapping[str, Any] = {},
) -> None:
    db.add(
        AIAuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome=outcome,
            details=_audit_details(details),
        )
    )


def validate_dsl(source: str, *, bars: int = MAX_BARS) -> dict[str, Any]:
    encoded = source.encode("utf-8")
    if len(encoded) > MAX_SOURCE_BYTES:
        raise AIDSLValidationError(f"DSL source exceeds the {MAX_SOURCE_BYTES} byte limit")
    try:
        document = json.loads(source)
    except json.JSONDecodeError as exc:
        raise AIDSLValidationError(
            f"EdgeLab DSL must be valid JSON (line {exc.lineno}, column {exc.colno})"
        ) from exc
    if not isinstance(document, dict):
        raise AIDSLValidationError("EdgeLab DSL root must be a JSON object")
    allowed_root = {"dsl_version", "name", "description", "inputs", "series", "plots", "signals"}
    unknown = sorted(set(document) - allowed_root)
    if unknown:
        raise AIDSLValidationError(f"Unsupported DSL field(s): {', '.join(unknown)}")
    if document.get("dsl_version") != DSL_VERSION:
        raise AIDSLValidationError(f"dsl_version must be {DSL_VERSION}")
    name = document.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 160:
        raise AIDSLValidationError("DSL name must be a non-empty string up to 160 characters")
    inputs = document.get("inputs", {})
    series = document.get("series", [])
    plots = document.get("plots", [])
    signals = document.get("signals", [])
    if not isinstance(inputs, dict) or len(inputs) > MAX_INPUTS:
        raise AIDSLValidationError(f"inputs must be an object with at most {MAX_INPUTS} entries")
    if not isinstance(series, list) or len(series) > MAX_SERIES:
        raise AIDSLValidationError(f"series must be a list with at most {MAX_SERIES} entries")
    if not isinstance(plots, list) or len(plots) > MAX_PLOTS:
        raise AIDSLValidationError(f"plots must be a list with at most {MAX_PLOTS} entries")
    if not isinstance(signals, list) or len(signals) > MAX_SIGNALS:
        raise AIDSLValidationError(f"signals must be a list with at most {MAX_SIGNALS} entries")
    node_count = len(inputs) + len(series) + len(plots) + len(signals)
    if node_count > MAX_DSL_NODES:
        raise AIDSLValidationError(f"DSL contains more than {MAX_DSL_NODES} nodes")
    if bars < 0 or bars > MAX_BARS:
        raise AIExecutionLimitError(f"Input contains more than {MAX_BARS} bars")
    if bars * max(1, len(series) + len(signals)) > MAX_ESTIMATED_OPERATIONS:
        raise AIExecutionLimitError("Indicator exceeds the deterministic operation limit")
    if bars * max(1, len(series) + len(signals) + len(plots)) > MAX_OUTPUT_VALUES:
        raise AIExecutionLimitError("Indicator exceeds the deterministic memory/output limit")

    input_defaults: dict[str, Any] = {}
    for input_name, spec in inputs.items():
        if not NAME_PATTERN.fullmatch(input_name) or not isinstance(spec, dict):
            raise AIDSLValidationError("Input names must be safe identifiers and specifications must be objects")
        if set(spec) - {"type", "default", "min", "max", "options"}:
            raise AIDSLValidationError(f"Input '{input_name}' contains unsupported fields")
        input_type = spec.get("type")
        if input_type not in {"integer", "number", "boolean", "string"}:
            raise AIDSLValidationError(f"Input '{input_name}' has unsupported type")
        if "default" not in spec:
            raise AIDSLValidationError(f"Input '{input_name}' requires a default")
        default = spec["default"]
        if input_type == "integer" and (isinstance(default, bool) or not isinstance(default, int)):
            raise AIDSLValidationError(f"Input '{input_name}' default must be an integer")
        if input_type == "number" and (isinstance(default, bool) or not isinstance(default, (int, float))):
            raise AIDSLValidationError(f"Input '{input_name}' default must be numeric")
        if input_type == "boolean" and not isinstance(default, bool):
            raise AIDSLValidationError(f"Input '{input_name}' default must be boolean")
        if input_type == "string" and (not isinstance(default, str) or len(default) > 200):
            raise AIDSLValidationError(f"Input '{input_name}' default must be a short string")
        if isinstance(default, (int, float)) and not isinstance(default, bool):
            if "min" in spec and default < spec["min"]:
                raise AIDSLValidationError(f"Input '{input_name}' default is below min")
            if "max" in spec and default > spec["max"]:
                raise AIDSLValidationError(f"Input '{input_name}' default is above max")
        input_defaults[input_name] = default

    available = set(BASE_SERIES)
    series_names: list[str] = []
    for index, item in enumerate(series):
        if not isinstance(item, dict) or set(item) - {"name", "op", "source", "length", "left", "right"}:
            raise AIDSLValidationError(f"Series node {index} is invalid or contains unsupported fields")
        node_name, op = item.get("name"), item.get("op")
        if not isinstance(node_name, str) or not NAME_PATTERN.fullmatch(node_name) or node_name in available:
            raise AIDSLValidationError(f"Series node {index} requires a unique safe name")
        if op not in SERIES_OPS:
            raise AIDSLValidationError(f"Series '{node_name}' uses unsupported op '{op}'")
        if op in {"sma", "ema", "highest", "lowest"}:
            _validate_reference(item.get("source"), available, input_defaults, node_name)
            length = item.get("length")
            resolved_length = input_defaults.get(length) if isinstance(length, str) else length
            if isinstance(resolved_length, bool) or not isinstance(resolved_length, int) or not 1 <= resolved_length <= 5000:
                raise AIDSLValidationError(f"Series '{node_name}' length must resolve to an integer from 1 to 5000")
        elif op in {"change", "roc"}:
            _validate_reference(item.get("source"), available, input_defaults, node_name)
        else:
            _validate_reference(item.get("left"), available, input_defaults, node_name)
            _validate_reference(item.get("right"), available, input_defaults, node_name)
        available.add(node_name)
        series_names.append(node_name)

    plot_series: list[str] = []
    for index, item in enumerate(plots):
        if not isinstance(item, dict) or set(item) - {"series", "color", "width", "style"}:
            raise AIDSLValidationError(f"Plot node {index} is invalid or contains unsupported fields")
        reference = item.get("series")
        if reference not in available:
            raise AIDSLValidationError(f"Plot node {index} references unknown series '{reference}'")
        color = item.get("color", "#22d3ee")
        if not isinstance(color, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
            raise AIDSLValidationError(f"Plot node {index} color must be a six-digit hex value")
        plot_series.append(reference)

    signal_names: list[str] = []
    for index, item in enumerate(signals):
        if not isinstance(item, dict) or set(item) - {"name", "op", "left", "right"}:
            raise AIDSLValidationError(f"Signal node {index} is invalid or contains unsupported fields")
        signal_name, op = item.get("name"), item.get("op")
        if not isinstance(signal_name, str) or not NAME_PATTERN.fullmatch(signal_name) or signal_name in signal_names:
            raise AIDSLValidationError(f"Signal node {index} requires a unique safe name")
        if op not in SIGNAL_OPS:
            raise AIDSLValidationError(f"Signal '{signal_name}' uses unsupported op '{op}'")
        _validate_reference(item.get("left"), available, input_defaults, signal_name)
        _validate_reference(item.get("right"), available, input_defaults, signal_name)
        signal_names.append(signal_name)

    return {
        "valid": True,
        "dsl_version": DSL_VERSION,
        "source_bytes": len(encoded),
        "node_count": node_count,
        "estimated_operations": bars * max(1, len(series) + len(signals)),
        "limits": {
            "max_source_bytes": MAX_SOURCE_BYTES,
            "max_bars": MAX_BARS,
            "max_operations": MAX_ESTIMATED_OPERATIONS,
            "max_output_values": MAX_OUTPUT_VALUES,
            "max_execution_seconds": MAX_EXECUTION_SECONDS,
        },
        "input_schema": inputs,
        "output_schema": {"series": series_names, "plots": plot_series, "signals": signal_names},
    }


def _validate_reference(value: Any, available: set[str], inputs: Mapping[str, Any], node_name: str) -> None:
    if isinstance(value, bool):
        raise AIDSLValidationError(f"Node '{node_name}' has an invalid boolean operand")
    if isinstance(value, (int, float)):
        return
    if isinstance(value, str) and (value in available or value in inputs):
        return
    raise AIDSLValidationError(f"Node '{node_name}' references unsupported value '{value}'")


def execute_dsl(source: str, candles: Sequence[Any]) -> dict[str, list[Decimal | bool | None]]:
    report = validate_dsl(source, bars=len(candles))
    document = json.loads(source)
    started = monotonic()
    values: dict[str, list[Decimal | None]] = {
        name: [Decimal(str(getattr(candle, name) if hasattr(candle, name) else candle[name])) for candle in candles]
        for name in BASE_SERIES
    }
    input_defaults = {name: spec["default"] for name, spec in document.get("inputs", {}).items()}

    def operand(value: Any) -> list[Decimal | None]:
        if isinstance(value, str) and value in values:
            return values[value]
        if isinstance(value, str) and value in input_defaults:
            constant = Decimal(str(input_defaults[value]))
        else:
            constant = Decimal(str(value))
        return [constant] * len(candles)

    for node_index, node in enumerate(document.get("series", [])):
        if node_index % 8 == 0 and monotonic() - started > MAX_EXECUTION_SECONDS:
            raise AIExecutionLimitError("Indicator exceeded the deterministic execution-time limit")
        op = node["op"]
        if op in {"sma", "ema", "highest", "lowest"}:
            source_values = operand(node["source"])
            raw_length = node["length"]
            length = int(input_defaults[raw_length] if isinstance(raw_length, str) else raw_length)
            result = _rolling(op, source_values, length)
        elif op in {"change", "roc"}:
            source_values = operand(node["source"])
            result = [None]
            for index in range(1, len(source_values)):
                current, previous = source_values[index], source_values[index - 1]
                if current is None or previous is None or (op == "roc" and previous == 0):
                    result.append(None)
                else:
                    result.append(current - previous if op == "change" else ((current - previous) / previous) * 100)
        else:
            left, right = operand(node["left"]), operand(node["right"])
            result = []
            for left_value, right_value in zip(left, right, strict=True):
                if left_value is None or right_value is None or (op == "divide" and right_value == 0):
                    result.append(None)
                elif op == "add":
                    result.append(left_value + right_value)
                elif op == "subtract":
                    result.append(left_value - right_value)
                elif op == "multiply":
                    result.append(left_value * right_value)
                else:
                    result.append(left_value / right_value)
        values[node["name"]] = result

    outputs: dict[str, list[Decimal | bool | None]] = {
        name: values[name] for name in report["output_schema"]["series"]
    }
    for signal in document.get("signals", []):
        left, right = operand(signal["left"]), operand(signal["right"])
        result: list[bool] = []
        for index, (left_value, right_value) in enumerate(zip(left, right, strict=True)):
            if left_value is None or right_value is None:
                result.append(False)
            elif signal["op"] == "above":
                result.append(left_value > right_value)
            elif signal["op"] == "below":
                result.append(left_value < right_value)
            elif index == 0 or left[index - 1] is None or right[index - 1] is None:
                result.append(False)
            elif signal["op"] == "cross_above":
                result.append(left[index - 1] <= right[index - 1] and left_value > right_value)
            else:
                result.append(left[index - 1] >= right[index - 1] and left_value < right_value)
        outputs[signal["name"]] = result
    if monotonic() - started > MAX_EXECUTION_SECONDS:
        raise AIExecutionLimitError("Indicator exceeded the deterministic execution-time limit")
    return outputs


def _rolling(op: str, values: list[Decimal | None], length: int) -> list[Decimal | None]:
    result: list[Decimal | None] = []
    ema: Decimal | None = None
    alpha = Decimal(2) / Decimal(length + 1)
    for index, value in enumerate(values):
        window = values[max(0, index - length + 1) : index + 1]
        if value is None or len(window) < length or any(item is None for item in window):
            result.append(None)
            continue
        complete = [item for item in window if item is not None]
        if op == "sma":
            result.append(sum(complete, Decimal("0")) / Decimal(length))
        elif op == "highest":
            result.append(max(complete))
        elif op == "lowest":
            result.append(min(complete))
        else:
            ema = sum(complete, Decimal("0")) / Decimal(length) if ema is None else value * alpha + ema * (1 - alpha)
            result.append(ema)
    return result


def _owned_script(db: Session, user_id: int, script_id: int, *, load_versions: bool = False) -> QuantScript:
    statement = select(QuantScript).where(QuantScript.id == script_id, QuantScript.user_id == user_id)
    if load_versions:
        statement = statement.options(selectinload(QuantScript.versions))
    row = db.scalar(statement)
    if row is None:
        raise AINotFoundError("Quant script not found")
    return row


def _owned_version(db: Session, user_id: int, version_id: int) -> QuantScriptVersion:
    row = db.scalar(
        select(QuantScriptVersion).where(
            QuantScriptVersion.id == version_id, QuantScriptVersion.user_id == user_id
        )
    )
    if row is None:
        raise AINotFoundError("Quant script version not found")
    return row


def _verify_version(version: QuantScriptVersion) -> dict[str, Any]:
    if _hash(version.source) != version.source_hash:
        raise AISecurityError("Stored script source failed integrity verification")
    return validate_dsl(version.source)


def _version_read(row: QuantScriptVersion) -> QuantScriptVersionRead:
    return QuantScriptVersionRead(
        id=row.id,
        script_id=row.script_id,
        parent_version_id=row.parent_version_id,
        generation_job_id=row.generation_job_id,
        version=row.version,
        dsl_version=row.dsl_version,
        source=row.source,
        source_hash=row.source_hash,
        created_by=row.created_by,
        status=row.status,
        validation_report=dict(row.validation_report or {}),
        input_schema=dict(row.input_schema or {}),
        output_schema=dict(row.output_schema or {}),
        created_at=row.created_at,
        activated_at=row.activated_at,
    )


def _script_read(row: QuantScript) -> QuantScriptRead:
    return QuantScriptRead(
        id=row.id,
        name=row.name,
        slug=row.slug,
        description=row.description,
        language=row.language,
        visibility=row.visibility,
        active_version_number=row.active_version_number,
        status=row.status,
        versions=[_version_read(item) for item in sorted(row.versions, key=lambda value: value.version)],
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
    )


def create_script(db: Session, user_id: int, payload: QuantScriptCreate) -> QuantScriptRead:
    report = validate_dsl(payload.source)
    base_slug = _slug(payload.name)
    slug = base_slug
    suffix = 2
    while db.scalar(select(QuantScript.id).where(QuantScript.user_id == user_id, QuantScript.slug == slug)):
        slug = f"{base_slug[:110]}-{suffix}"
        suffix += 1
    row = QuantScript(
        user_id=user_id,
        name=payload.name.strip(),
        slug=slug,
        description=payload.description,
    )
    db.add(row)
    db.flush()
    version = _new_version(
        db,
        user_id,
        row,
        source=payload.source,
        report=report,
        parent_version_id=None,
        created_by="USER",
        generation_job_id=None,
    )
    _audit(
        db,
        user_id,
        action="SCRIPT_CREATE",
        resource_type="QUANT_SCRIPT",
        resource_id=row.id,
        outcome="SUCCESS",
        details={"source_digest": version.source_hash, "dsl_version": DSL_VERSION},
    )
    db.commit()
    return _script_read(_owned_script(db, user_id, row.id, load_versions=True))


def _new_version(
    db: Session,
    user_id: int,
    script: QuantScript,
    *,
    source: str,
    report: Mapping[str, Any],
    parent_version_id: int | None,
    created_by: str,
    generation_job_id: int | None,
) -> QuantScriptVersion:
    next_version = int(
        db.scalar(select(func.max(QuantScriptVersion.version)).where(QuantScriptVersion.script_id == script.id)) or 0
    ) + 1
    row = QuantScriptVersion(
        user_id=user_id,
        script_id=script.id,
        parent_version_id=parent_version_id,
        generation_job_id=generation_job_id,
        version=next_version,
        source=source,
        source_hash=_hash(source),
        created_by=created_by,
        status="VALIDATED",
        validation_report=_safe_json(report),
        input_schema=_safe_json(report["input_schema"]),
        output_schema=_safe_json(report["output_schema"]),
    )
    db.add(row)
    db.flush()
    return row


def create_script_version(
    db: Session, user_id: int, script_id: int, payload: QuantScriptVersionCreate
) -> QuantScriptVersionRead:
    script = db.scalar(
        select(QuantScript)
        .where(QuantScript.id == script_id, QuantScript.user_id == user_id)
        .with_for_update()
    )
    if script is None:
        raise AINotFoundError("Quant script not found")
    parent_id = payload.parent_version_id
    if parent_id is not None:
        parent = _owned_version(db, user_id, parent_id)
        if parent.script_id != script_id:
            raise AIConflictError("parent_version_id belongs to another script")
    report = validate_dsl(payload.source)
    try:
        version = _new_version(
            db,
            user_id,
            script,
            source=payload.source,
            report=report,
            parent_version_id=parent_id,
            created_by="USER",
            generation_job_id=None,
        )
        _audit(
            db,
            user_id,
            action="SCRIPT_VERSION_CREATE",
            resource_type="QUANT_SCRIPT_VERSION",
            resource_id=version.id,
            outcome="SUCCESS",
            details={"source_digest": version.source_hash, "parent_version_id": parent_id},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AIConflictError("Another version was created concurrently; retry the edit") from exc
    db.refresh(version)
    return _version_read(version)


def activate_script_version(
    db: Session, user_id: int, script_id: int, version_id: int
) -> QuantScriptRead:
    script = _owned_script(db, user_id, script_id)
    version = _owned_version(db, user_id, version_id)
    if version.script_id != script.id:
        raise AIConflictError("Script version belongs to another script")
    _verify_version(version)
    script.active_version_number = version.version
    script.status = "ACTIVE"
    version.status = "ACTIVE"
    version.activated_at = utcnow()
    _audit(
        db,
        user_id,
        action="SCRIPT_ACTIVATE",
        resource_type="QUANT_SCRIPT_VERSION",
        resource_id=version.id,
        outcome="SUCCESS",
        details={"source_digest": version.source_hash},
    )
    db.commit()
    return _script_read(_owned_script(db, user_id, script_id, load_versions=True))


def list_scripts(db: Session, user_id: int) -> list[QuantScriptRead]:
    rows = db.scalars(
        select(QuantScript)
        .where(QuantScript.user_id == user_id, QuantScript.archived_at.is_(None))
        .options(selectinload(QuantScript.versions))
        .order_by(QuantScript.updated_at.desc(), QuantScript.id.desc())
    ).all()
    return [_script_read(row) for row in rows]


def get_script(db: Session, user_id: int, script_id: int) -> QuantScriptRead:
    return _script_read(_owned_script(db, user_id, script_id, load_versions=True))


def grant_script_permission(
    db: Session, user_id: int, script_id: int, payload: QuantScriptPermissionCreate
) -> QuantScriptPermissionRead:
    _owned_script(db, user_id, script_id)
    if payload.grantee_user_id == user_id:
        raise AIConflictError("Script owner already has full permission")
    if db.get(BetaUser, payload.grantee_user_id) is None:
        raise AINotFoundError("Permission recipient not found")
    row = db.scalar(
        select(QuantScriptPermission).where(
            QuantScriptPermission.script_id == script_id,
            QuantScriptPermission.grantee_user_id == payload.grantee_user_id,
        )
    )
    if row is None:
        row = QuantScriptPermission(
            user_id=user_id,
            script_id=script_id,
            grantee_user_id=payload.grantee_user_id,
            permission=payload.permission,
        )
        db.add(row)
    else:
        row.permission = payload.permission
        row.revoked_at = None
    db.commit()
    db.refresh(row)
    return QuantScriptPermissionRead.model_validate(row, from_attributes=True)


def list_script_permissions(db: Session, user_id: int, script_id: int) -> list[QuantScriptPermissionRead]:
    _owned_script(db, user_id, script_id)
    rows = db.scalars(
        select(QuantScriptPermission)
        .where(QuantScriptPermission.user_id == user_id, QuantScriptPermission.script_id == script_id)
        .order_by(QuantScriptPermission.id.asc())
    ).all()
    return [QuantScriptPermissionRead.model_validate(row, from_attributes=True) for row in rows]


def revoke_script_permission(
    db: Session, user_id: int, script_id: int, permission_id: int
) -> QuantScriptPermissionRead:
    _owned_script(db, user_id, script_id)
    row = db.scalar(
        select(QuantScriptPermission).where(
            QuantScriptPermission.id == permission_id,
            QuantScriptPermission.user_id == user_id,
            QuantScriptPermission.script_id == script_id,
        )
    )
    if row is None:
        raise AINotFoundError("Quant script permission not found")
    if row.revoked_at is None:
        row.revoked_at = utcnow()
        db.commit()
        db.refresh(row)
    return QuantScriptPermissionRead.model_validate(row, from_attributes=True)


def create_conversation(
    db: Session, user_id: int, payload: AIConversationCreate
) -> AIConversationRead:
    now = utcnow()
    row = AIConversation(
        user_id=user_id,
        kind=payload.kind,
        title=payload.title.strip(),
        retention_days=payload.retention_days,
        retention_until=now + timedelta(days=payload.retention_days),
    )
    db.add(row)
    db.flush()
    _audit(
        db,
        user_id,
        action="CONVERSATION_CREATE",
        resource_type="AI_CONVERSATION",
        resource_id=row.id,
        outcome="SUCCESS",
        details={"kind": row.kind, "retention_days": row.retention_days},
    )
    db.commit()
    return _conversation_read(_owned_conversation(db, user_id, row.id, load_messages=True))


def _owned_conversation(
    db: Session, user_id: int, conversation_id: int, *, load_messages: bool = False
) -> AIConversation:
    statement = select(AIConversation).where(
        AIConversation.id == conversation_id, AIConversation.user_id == user_id
    )
    if load_messages:
        statement = statement.options(selectinload(AIConversation.messages))
    row = db.scalar(statement)
    if row is None:
        raise AINotFoundError("AI conversation not found")
    return row


def _message_read(row: AIMessage) -> AIMessageRead:
    return AIMessageRead(
        id=row.id,
        conversation_id=row.conversation_id,
        parent_message_id=row.parent_message_id,
        sequence=row.sequence,
        role=row.role,
        content=row.content,
        content_digest=row.content_digest,
        chart_context=dict(row.chart_context or {}),
        image_metadata=dict(row.image_metadata or {}),
        model_id=row.model_id,
        created_at=row.created_at,
        purged_at=row.purged_at,
    )


def _conversation_read(row: AIConversation) -> AIConversationRead:
    return AIConversationRead(
        id=row.id,
        kind=row.kind,
        title=row.title,
        status=row.status,
        retention_days=row.retention_days,
        retention_until=row.retention_until,
        messages=[_message_read(item) for item in sorted(row.messages, key=lambda value: value.sequence)],
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
    )


def list_conversations(db: Session, user_id: int, *, kind: str | None = None) -> list[AIConversationRead]:
    statement = (
        select(AIConversation)
        .where(AIConversation.user_id == user_id, AIConversation.deleted_at.is_(None))
        .options(selectinload(AIConversation.messages))
    )
    if kind:
        statement = statement.where(AIConversation.kind == kind)
    rows = db.scalars(statement.order_by(AIConversation.updated_at.desc(), AIConversation.id.desc())).all()
    return [_conversation_read(row) for row in rows]


def get_conversation(db: Session, user_id: int, conversation_id: int) -> AIConversationRead:
    return _conversation_read(_owned_conversation(db, user_id, conversation_id, load_messages=True))


def _append_message(
    db: Session,
    conversation: AIConversation,
    *,
    role: str,
    content: str,
    chart_context: Mapping[str, Any] | None = None,
    image_metadata: Mapping[str, Any] | None = None,
    model_id: str | None = None,
    parent_message_id: int | None = None,
) -> AIMessage:
    sequence = int(
        db.scalar(select(func.max(AIMessage.sequence)).where(AIMessage.conversation_id == conversation.id)) or 0
    ) + 1
    row = AIMessage(
        user_id=conversation.user_id,
        conversation_id=conversation.id,
        parent_message_id=parent_message_id,
        sequence=sequence,
        role=role,
        content=content,
        content_digest=_hash(content),
        chart_context=_safe_json(chart_context or {}),
        image_metadata=_safe_json(image_metadata or {}),
        model_id=model_id,
    )
    db.add(row)
    conversation.updated_at = utcnow()
    db.flush()
    return row


def _period_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    current = _utc_naive(now or utcnow())
    start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def usage_summary(db: Session, user_id: int, *, now: datetime | None = None) -> AIUsageSummaryRead:
    start, end = _period_bounds(now)
    aggregate = db.execute(
        select(
            func.count(AIUsageLedger.id),
            func.coalesce(func.sum(AIUsageLedger.input_tokens), 0),
            func.coalesce(func.sum(AIUsageLedger.output_tokens), 0),
            func.coalesce(func.sum(AIUsageLedger.credits), 0),
            func.coalesce(func.sum(AIUsageLedger.cost_micros), 0),
        ).where(
            AIUsageLedger.user_id == user_id,
            AIUsageLedger.occurred_at >= start,
            AIUsageLedger.occurred_at < end,
        )
    ).one()
    return AIUsageSummaryRead(
        period_start=start,
        period_end=end,
        jobs=int(aggregate[0]),
        input_tokens=int(aggregate[1]),
        output_tokens=int(aggregate[2]),
        credits=int(aggregate[3]),
        cost_micros=int(aggregate[4]),
        job_limit=DAILY_JOB_LIMIT,
        token_limit=DAILY_TOKEN_LIMIT,
        cost_limit_micros=DAILY_COST_LIMIT_MICROS,
    )


def _estimate_tokens(payload: AIGenerationRequest) -> int:
    serialized_context = json.dumps(
        {
            "chart_context": payload.chart_context.model_dump(mode="json") if payload.chart_context else {},
            "image_metadata": payload.image.model_dump(mode="json") if payload.image else {},
            "auto_backtest": payload.auto_backtest.model_dump(mode="json") if payload.auto_backtest else {},
        },
        separators=(",", ":"),
    )
    return max(1, (len(payload.prompt) + len(serialized_context) + 3) // 4)


def _estimate_cost(policy: AIModelPolicy, input_tokens: int, output_tokens: int) -> int:
    return input_tokens * policy.input_token_cost_micros + output_tokens * policy.output_token_cost_micros


def _enforce_job_limits(
    db: Session,
    user_id: int,
    *,
    estimated_tokens: int,
    estimated_cost: int,
    requested_ceiling: int,
    now: datetime,
) -> None:
    day_start, day_end = _period_bounds(now)
    day_jobs = int(
        db.scalar(
            select(func.count(AIGenerationJob.id)).where(
                AIGenerationJob.user_id == user_id,
                AIGenerationJob.created_at >= day_start,
                AIGenerationJob.created_at < day_end,
            )
        )
        or 0
    )
    minute_start = _utc_naive(now) - timedelta(minutes=1)
    recent_jobs = int(
        db.scalar(
            select(func.count(AIGenerationJob.id)).where(
                AIGenerationJob.user_id == user_id,
                AIGenerationJob.created_at >= minute_start,
            )
        )
        or 0
    )
    usage = usage_summary(db, user_id, now=now)
    if day_jobs >= DAILY_JOB_LIMIT:
        raise AIQuotaError(f"Daily AI job limit of {DAILY_JOB_LIMIT} reached")
    if recent_jobs >= PER_MINUTE_JOB_LIMIT:
        raise AIQuotaError(f"AI job rate limit of {PER_MINUTE_JOB_LIMIT} per minute reached")
    if usage.input_tokens + usage.output_tokens + estimated_tokens > DAILY_TOKEN_LIMIT:
        raise AIQuotaError(f"Daily AI token limit of {DAILY_TOKEN_LIMIT} would be exceeded")
    if estimated_cost > requested_ceiling:
        raise AICostLimitError("Estimated model cost exceeds the requested hard cost ceiling")
    if usage.cost_micros + estimated_cost > DAILY_COST_LIMIT_MICROS:
        raise AICostLimitError("Daily AI cost ceiling would be exceeded")


def create_generation_job(
    db: Session,
    user_id: int,
    payload: AIGenerationRequest,
    *,
    router: AIProviderRouter = ai_provider_router,
    now: datetime | None = None,
) -> AIGenerationJobRead:
    current = _utc_naive(now or utcnow())
    conversation = _owned_conversation(db, user_id, payload.conversation_id)
    if conversation.deleted_at is not None or conversation.status != "ACTIVE":
        raise AIConflictError("AI conversation is not active")
    policy = router.policy(payload.model_id)
    if payload.operation not in policy.operations:
        raise AIConflictError(f"Model '{payload.model_id}' does not support {payload.operation}")
    if payload.max_output_tokens > policy.max_output_tokens:
        raise AIConflictError(
            f"Model '{payload.model_id}' allows at most {policy.max_output_tokens} output tokens"
        )
    if payload.script_id is not None:
        _owned_script(db, user_id, payload.script_id)
    if payload.base_version_id is not None:
        version = _owned_version(db, user_id, payload.base_version_id)
        if payload.script_id is not None and version.script_id != payload.script_id:
            raise AIConflictError("base_version_id belongs to another script")
        _verify_version(version)
    key = payload.idempotency_key or _hash(
        [payload.conversation_id, payload.operation, payload.model_id, payload.prompt,
         payload.chart_context.model_dump(mode="json") if payload.chart_context else None,
         payload.image.model_dump(mode="json") if payload.image else None,
         payload.script_id, payload.base_version_id,
         payload.auto_backtest.model_dump(mode="json") if payload.auto_backtest else None]
    )[:64]
    existing = db.scalar(
        select(AIGenerationJob).where(
            AIGenerationJob.user_id == user_id, AIGenerationJob.idempotency_key == key
        )
    )
    if existing is not None:
        return _job_read(existing)
    router.adapter(policy.provider)
    secret = _provider_secret(db, user_id, policy.provider) if policy.credential_required else None
    if policy.credential_required and secret is None:
        raise AIProviderUnavailableError(
            f"Model '{payload.model_id}' requires an active encrypted provider credential"
        )
    estimated_input = _estimate_tokens(payload)
    estimated_cost = _estimate_cost(policy, estimated_input, payload.max_output_tokens)
    _enforce_job_limits(
        db,
        user_id,
        estimated_tokens=estimated_input + payload.max_output_tokens,
        estimated_cost=estimated_cost,
        requested_ceiling=payload.hard_cost_ceiling_micros,
        now=current,
    )
    message_context = payload.chart_context.model_dump(mode="json") if payload.chart_context else {}
    if payload.script_id is not None:
        message_context["script_id"] = payload.script_id
    if payload.base_version_id is not None:
        message_context["base_version_id"] = payload.base_version_id
    if payload.auto_backtest is not None:
        message_context["auto_backtest"] = payload.auto_backtest.model_dump(mode="json")
    message = _append_message(
        db,
        conversation,
        role="USER",
        content=payload.prompt,
        chart_context=message_context,
        image_metadata=payload.image.model_dump(mode="json") if payload.image else {},
        model_id=payload.model_id,
    )
    job = AIGenerationJob(
        user_id=user_id,
        conversation_id=conversation.id,
        request_message_id=message.id,
        secret_id=secret.id if secret else None,
        idempotency_key=key,
        operation=payload.operation,
        model_id=payload.model_id,
        provider=policy.provider,
        status="QUEUED",
        estimated_input_tokens=estimated_input,
        max_output_tokens=payload.max_output_tokens,
        estimated_cost_micros=estimated_cost,
        hard_cost_ceiling_micros=payload.hard_cost_ceiling_micros,
    )
    db.add(job)
    db.flush()
    _job_event(db, job, "STATUS", {"status": "QUEUED"})
    _audit(
        db,
        user_id,
        action="GENERATION_ENQUEUE",
        resource_type="AI_JOB",
        resource_id=job.id,
        outcome="SUCCESS",
        details={
            "model_id": policy.model_id,
            "operation": job.operation,
            "prompt_digest": message.content_digest,
            "chart_context_digest": _hash(message.chart_context),
            "image_metadata_digest": _hash(message.image_metadata),
            "estimated_cost_micros": estimated_cost,
        },
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        existing = db.scalar(
            select(AIGenerationJob).where(
                AIGenerationJob.user_id == user_id, AIGenerationJob.idempotency_key == key
            )
        )
        if existing is not None:
            return _job_read(existing)
        raise AIConflictError("Generation job could not be allocated; retry with the same idempotency key") from exc
    db.refresh(job)
    return _job_read(job)


def _owned_job(db: Session, user_id: int, job_id: int, *, for_update: bool = False) -> AIGenerationJob:
    statement = select(AIGenerationJob).where(
        AIGenerationJob.id == job_id, AIGenerationJob.user_id == user_id
    )
    if for_update:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row is None:
        raise AINotFoundError("AI generation job not found")
    return row


def _job_read(row: AIGenerationJob) -> AIGenerationJobRead:
    return AIGenerationJobRead(
        id=row.id,
        conversation_id=row.conversation_id,
        request_message_id=row.request_message_id,
        operation=row.operation,
        model_id=row.model_id,
        provider=row.provider,
        status=row.status,
        estimated_input_tokens=row.estimated_input_tokens,
        max_output_tokens=row.max_output_tokens,
        estimated_cost_micros=row.estimated_cost_micros,
        hard_cost_ceiling_micros=row.hard_cost_ceiling_micros,
        actual_input_tokens=row.actual_input_tokens,
        actual_output_tokens=row.actual_output_tokens,
        actual_cost_micros=row.actual_cost_micros,
        cancel_requested_at=row.cancel_requested_at,
        started_at=row.started_at,
        completed_at=row.completed_at,
        error_code=row.error_code,
        error_message=row.error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _job_event(db: Session, job: AIGenerationJob, event_type: str, payload: Mapping[str, Any]) -> AIJobEvent:
    sequence = int(db.scalar(select(func.max(AIJobEvent.sequence)).where(AIJobEvent.job_id == job.id)) or 0) + 1
    safe_payload = _audit_details(payload)
    row = AIJobEvent(
        user_id=job.user_id,
        job_id=job.id,
        sequence=sequence,
        event_type=event_type,
        payload=safe_payload,
    )
    db.add(row)
    db.flush()
    return row


def cancel_generation_job(db: Session, user_id: int, job_id: int) -> AIGenerationJobRead:
    job = _owned_job(db, user_id, job_id, for_update=True)
    if job.status in {"COMPLETED", "FAILED", "CANCELLED"}:
        return _job_read(job)
    now = utcnow()
    job.cancel_requested_at = now
    if job.status == "QUEUED":
        job.status = "CANCELLED"
        job.completed_at = now
        _job_event(db, job, "STATUS", {"status": "CANCELLED"})
    else:
        _job_event(db, job, "CANCELLATION_REQUESTED", {"status": job.status})
    _audit(
        db,
        user_id,
        action="GENERATION_CANCEL",
        resource_type="AI_JOB",
        resource_id=job.id,
        outcome="SUCCESS",
    )
    db.commit()
    db.refresh(job)
    return _job_read(job)


def run_generation_job(
    db: Session,
    user_id: int,
    job_id: int,
    *,
    router: AIProviderRouter = ai_provider_router,
) -> AIGenerationJobRead:
    job = _owned_job(db, user_id, job_id, for_update=True)
    if job.status == "CANCELLED":
        return _job_read(job)
    if job.status != "QUEUED":
        raise AIConflictError(f"Job cannot run from status {job.status}")
    running = int(
        db.scalar(
            select(func.count(AIGenerationJob.id)).where(
                AIGenerationJob.user_id == user_id,
                AIGenerationJob.status == "RUNNING",
                AIGenerationJob.id != job.id,
            )
        )
        or 0
    )
    if running >= MAX_CONCURRENT_JOBS:
        raise AIQuotaError(f"At most {MAX_CONCURRENT_JOBS} AI jobs may run concurrently")
    job.status = "RUNNING"
    job.started_at = utcnow()
    _job_event(db, job, "STATUS", {"status": "RUNNING"})
    db.commit()
    logger.info("AI job %s entered RUNNING for user %s", job.id, user_id)

    try:
        job = _owned_job(db, user_id, job_id)
        message = db.scalar(
            select(AIMessage).where(
                AIMessage.id == job.request_message_id, AIMessage.user_id == user_id
            )
        )
        if message is None or message.purged_at is not None:
            raise AIConflictError("Generation input is no longer retained")
        policy = router.policy(job.model_id)
        adapter = router.adapter(job.provider)
        base_source = None
        if job.operation == "EDIT_INDICATOR":
            base_id = dict(message.chart_context or {}).get("base_version_id")
            if base_id:
                base_source = _owned_version(db, user_id, int(base_id)).source
        provider_request = {
            "operation": job.operation,
            "prompt": message.content,
            "chart_context": dict(message.chart_context or {}),
            "image_metadata": dict(message.image_metadata or {}),
            "base_source": base_source,
            "max_output_tokens": job.max_output_tokens,
        }

        buffered_events: list[tuple[str, dict[str, Any]]] = []

        def emit(event_type: str, event_payload: Mapping[str, Any]) -> None:
            buffered_events.append((event_type[:32], _safe_json(event_payload)))

        def cancelled() -> bool:
            return job.cancel_requested_at is not None

        def call(credentials: Mapping[str, str]) -> AIProviderResult:
            result = adapter.generate(credentials, provider_request, emit, cancelled)
            serialized = json.dumps(
                {"content": result.content, "events": buffered_events}, sort_keys=True, default=str
            )
            if any(secret and secret in serialized for secret in credentials.values()):
                raise AISecurityError("Provider output contained credential material")
            return result

        if policy.credential_required:
            if job.secret_id is None:
                raise AIProviderUnavailableError("Encrypted provider credential is unavailable")
            result = integration_secrets.use_integration_credentials(
                db, user_id, job.secret_id, lambda _provider, _purpose, credentials: call(credentials)
            )
        else:
            result = call({})
        if job.cancel_requested_at is not None:
            raise AIConflictError("Generation was cancelled")
        if result.input_tokens < 0 or result.output_tokens < 0 or result.output_tokens > job.max_output_tokens:
            raise AISecurityError("Provider returned invalid usage accounting")
        for event_type, event_payload in buffered_events:
            _job_event(db, job, event_type, event_payload)
        actual_cost = _estimate_cost(policy, result.input_tokens, result.output_tokens)
        current_usage = usage_summary(db, user_id)
        if actual_cost > job.hard_cost_ceiling_micros or current_usage.cost_micros + actual_cost > DAILY_COST_LIMIT_MICROS:
            raise AICostLimitError("Provider usage exceeded the hard cost ceiling")
        artifact, assistant_content = _persist_provider_result(db, job, message, result)
        auto_backtest = dict(message.chart_context or {}).get("auto_backtest")
        if artifact.script_version_id is not None and isinstance(auto_backtest, dict):
            run_indicator_backtest(
                db,
                user_id,
                AIBacktestRequest(script_version_id=artifact.script_version_id, **auto_backtest),
                job_id=job.id,
                artifact_id=artifact.id,
                commit=False,
            )
        _append_message(
            db,
            _owned_conversation(db, user_id, job.conversation_id),
            role="ASSISTANT",
            content=assistant_content,
            model_id=job.model_id,
            parent_message_id=message.id,
        )
        cost_credits = 0 if actual_cost == 0 else max(1, (result.input_tokens + result.output_tokens + 999) // 1000)
        db.add(
            AIUsageLedger(
                user_id=user_id,
                job_id=job.id,
                provider=job.provider,
                model_id=job.model_id,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                credits=cost_credits,
                cost_micros=actual_cost,
            )
        )
        job.actual_input_tokens = result.input_tokens
        job.actual_output_tokens = result.output_tokens
        job.actual_cost_micros = actual_cost
        job.status = "COMPLETED"
        job.completed_at = utcnow()
        _job_event(db, job, "ARTIFACT", {"artifact_id": artifact.id, "artifact_type": artifact.artifact_type})
        _job_event(db, job, "STATUS", {"status": "COMPLETED"})
        _audit(
            db,
            user_id,
            action="GENERATION_COMPLETE",
            resource_type="AI_JOB",
            resource_id=job.id,
            outcome="SUCCESS",
            details={
                "artifact_id": artifact.id,
                "provider_request_id_digest": _hash(result.provider_request_id) if result.provider_request_id else None,
                "usage": {"input_tokens": result.input_tokens, "output_tokens": result.output_tokens, "cost_micros": actual_cost},
            },
        )
        db.commit()
        db.refresh(job)
        logger.info("AI job %s entered COMPLETED for user %s", job.id, user_id)
        return _job_read(job)
    except AIServiceError as exc:
        db.rollback()
        job = _owned_job(db, user_id, job_id, for_update=True)
        now = utcnow()
        job.status = "CANCELLED" if job.cancel_requested_at is not None else "FAILED"
        job.completed_at = now
        job.error_code = type(exc).__name__.replace("AI", "").replace("Error", "").upper()
        job.error_message = exc.public_message
        _job_event(db, job, "STATUS", {"status": job.status, "error_code": job.error_code})
        _audit(
            db,
            user_id,
            action="GENERATION_FAIL",
            resource_type="AI_JOB",
            resource_id=job.id,
            outcome=job.status,
            details={"error_code": job.error_code},
        )
        db.commit()
        logger.warning("AI job %s failed with code %s", job.id, job.error_code)
        raise
    except Exception as exc:
        db.rollback()
        job = _owned_job(db, user_id, job_id, for_update=True)
        job.status = "FAILED"
        job.completed_at = utcnow()
        job.error_code = "PROVIDER_EXECUTION_FAILED"
        job.error_message = "AI provider execution failed safely"
        _job_event(db, job, "STATUS", {"status": "FAILED", "error_code": job.error_code})
        _audit(
            db,
            user_id,
            action="GENERATION_FAIL",
            resource_type="AI_JOB",
            resource_id=job.id,
            outcome="FAILED",
            details={"error_code": job.error_code, "exception_type": type(exc).__name__},
        )
        db.commit()
        logger.warning("AI job %s failed with provider execution error", job.id)
        raise AIProviderUnavailableError("AI provider execution failed safely") from exc


def _persist_provider_result(
    db: Session,
    job: AIGenerationJob,
    message: AIMessage,
    result: AIProviderResult,
) -> tuple[AIGeneratedArtifact, str]:
    content = _safe_json(result.content)
    retention_until = _owned_conversation(db, job.user_id, job.conversation_id).retention_until
    script_id = script_version_id = None
    if job.operation in {"GENERATE_INDICATOR", "EDIT_INDICATOR", "ANALYSIS_TO_INDICATOR"}:
        source = content.get("source")
        if not isinstance(source, str):
            raise AISecurityError("Indicator generation did not return restricted DSL source")
        report = validate_dsl(source)
        context = dict(message.chart_context or {})
        requested_script_id = context.get("script_id")
        base_version_id = context.get("base_version_id")
        if requested_script_id is not None:
            script = _owned_script(db, job.user_id, int(requested_script_id))
            if base_version_id is not None:
                base = _owned_version(db, job.user_id, int(base_version_id))
                if base.script_id != script.id:
                    raise AIConflictError("Base version belongs to another script")
            version = _new_version(
                db,
                job.user_id,
                script,
                source=source,
                report=report,
                parent_version_id=int(base_version_id) if base_version_id else None,
                created_by="AI",
                generation_job_id=job.id,
            )
        else:
            document = json.loads(source)
            base_slug = _slug(document["name"])
            slug, suffix = base_slug, 2
            while db.scalar(select(QuantScript.id).where(QuantScript.user_id == job.user_id, QuantScript.slug == slug)):
                slug, suffix = f"{base_slug[:110]}-{suffix}", suffix + 1
            script = QuantScript(
                user_id=job.user_id,
                name=document["name"],
                slug=slug,
                description=document.get("description"),
            )
            db.add(script)
            db.flush()
            version = _new_version(
                db,
                job.user_id,
                script,
                source=source,
                report=report,
                parent_version_id=None,
                created_by="AI",
                generation_job_id=job.id,
            )
        script_id, script_version_id = script.id, version.id
        artifact_type = "INDICATOR_SOURCE"
        assistant_content = str(content.get("summary") or "Generated restricted EdgeLab DSL source.")
    elif job.operation == "CHART_ANALYSIS":
        required = {"daily_bias", "levels", "invalidation", "uncertainty", "risk_warning"}
        if not required <= set(content):
            raise AISecurityError("Chart analysis response omitted required risk and uncertainty fields")
        artifact_type = "CHART_ANALYSIS"
        assistant_content = json.dumps(content, sort_keys=True)
    else:
        artifact_type = "ASSISTANT_RESPONSE"
        assistant_content = str(content.get("text") or "")
        if not assistant_content:
            raise AISecurityError("Assistant response was empty")
    artifact = AIGeneratedArtifact(
        user_id=job.user_id,
        job_id=job.id,
        conversation_id=job.conversation_id,
        script_id=script_id,
        script_version_id=script_version_id,
        artifact_type=artifact_type,
        content=content,
        content_digest=_hash(content),
        provenance={
            "model_id": job.model_id,
            "provider": job.provider,
            "request_message_digest": message.content_digest,
            "chart_context_digest": _hash(message.chart_context),
            "image_metadata_digest": _hash(message.image_metadata),
            "dsl_version": DSL_VERSION if script_version_id else None,
        },
        retention_until=retention_until,
    )
    db.add(artifact)
    db.flush()
    return artifact, assistant_content


def list_generation_jobs(db: Session, user_id: int, *, limit: int = 100) -> list[AIGenerationJobRead]:
    rows = db.scalars(
        select(AIGenerationJob)
        .where(AIGenerationJob.user_id == user_id)
        .order_by(AIGenerationJob.created_at.desc(), AIGenerationJob.id.desc())
        .limit(limit)
    ).all()
    return [_job_read(row) for row in rows]


def get_generation_job(db: Session, user_id: int, job_id: int) -> AIGenerationJobRead:
    return _job_read(_owned_job(db, user_id, job_id))


def list_job_events(
    db: Session, user_id: int, job_id: int, *, after_sequence: int = 0
) -> list[AIJobEventRead]:
    _owned_job(db, user_id, job_id)
    rows = db.scalars(
        select(AIJobEvent)
        .where(
            AIJobEvent.user_id == user_id,
            AIJobEvent.job_id == job_id,
            AIJobEvent.sequence > after_sequence,
        )
        .order_by(AIJobEvent.sequence.asc())
    ).all()
    return [AIJobEventRead.model_validate(row, from_attributes=True) for row in rows]


def list_artifacts(db: Session, user_id: int, *, conversation_id: int | None = None) -> list[AIGeneratedArtifactRead]:
    statement = select(AIGeneratedArtifact).where(AIGeneratedArtifact.user_id == user_id)
    if conversation_id is not None:
        _owned_conversation(db, user_id, conversation_id)
        statement = statement.where(AIGeneratedArtifact.conversation_id == conversation_id)
    rows = db.scalars(
        statement.order_by(AIGeneratedArtifact.created_at.desc(), AIGeneratedArtifact.id.desc())
    ).all()
    return [_artifact_read(row) for row in rows]


def _artifact_read(row: AIGeneratedArtifact) -> AIGeneratedArtifactRead:
    return AIGeneratedArtifactRead(
        id=row.id,
        job_id=row.job_id,
        conversation_id=row.conversation_id,
        script_id=row.script_id,
        script_version_id=row.script_version_id,
        artifact_type=row.artifact_type,
        content=dict(row.content or {}),
        content_digest=row.content_digest,
        provenance=dict(row.provenance or {}),
        created_at=row.created_at,
        retention_until=row.retention_until,
        activated_at=row.activated_at,
        purged_at=row.purged_at,
    )


def activate_artifact(db: Session, user_id: int, artifact_id: int) -> AIGeneratedArtifactRead:
    artifact = db.scalar(
        select(AIGeneratedArtifact).where(
            AIGeneratedArtifact.id == artifact_id, AIGeneratedArtifact.user_id == user_id
        )
    )
    if artifact is None:
        raise AINotFoundError("Generated artifact not found")
    if artifact.purged_at is not None or artifact.script_id is None or artifact.script_version_id is None:
        raise AIConflictError("Only a retained indicator artifact can be activated")
    activate_script_version(db, user_id, artifact.script_id, artifact.script_version_id)
    artifact = db.get(AIGeneratedArtifact, artifact_id)
    artifact.activated_at = utcnow()
    _audit(
        db,
        user_id,
        action="ARTIFACT_ACTIVATE",
        resource_type="AI_ARTIFACT",
        resource_id=artifact.id,
        outcome="SUCCESS",
        details={"script_version_id": artifact.script_version_id},
    )
    db.commit()
    db.refresh(artifact)
    return _artifact_read(artifact)


def run_indicator_backtest(
    db: Session,
    user_id: int,
    payload: AIBacktestRequest,
    *,
    job_id: int | None = None,
    artifact_id: int | None = None,
    commit: bool = True,
) -> AIBacktestRead:
    version = _owned_version(db, user_id, payload.script_version_id)
    _verify_version(version)
    instrument = db.scalar(
        select(MarketInstrument).where(
            MarketInstrument.id == payload.instrument_id, MarketInstrument.user_id == user_id
        )
    )
    if instrument is None:
        raise AINotFoundError("Market instrument not found")
    start, end = _utc_naive(payload.from_at), _utc_naive(payload.to_at)
    candles = db.scalars(
        select(NormalizedCandle)
        .where(
            NormalizedCandle.user_id == user_id,
            NormalizedCandle.instrument_id == payload.instrument_id,
            NormalizedCandle.interval_seconds == payload.interval_seconds,
            NormalizedCandle.start_at >= start,
            NormalizedCandle.start_at < end,
        )
        .order_by(NormalizedCandle.start_at.asc())
        .limit(MAX_BARS + 1)
    ).all()
    if not candles:
        raise AIConflictError("No normalized candles are available for the requested backtest window")
    if len(candles) > MAX_BARS:
        raise AIExecutionLimitError(f"Backtest input exceeds the {MAX_BARS} bar limit")
    outputs = execute_dsl(version.source, candles)
    if payload.entry_signal not in outputs or not all(isinstance(value, bool) for value in outputs[payload.entry_signal]):
        raise AIConflictError(f"Entry signal '{payload.entry_signal}' is not defined by the script")
    if payload.exit_signal and (
        payload.exit_signal not in outputs or not all(isinstance(value, bool) for value in outputs[payload.exit_signal])
    ):
        raise AIConflictError(f"Exit signal '{payload.exit_signal}' is not defined by the script")
    closes = [Decimal(str(candle.close)) for candle in candles]
    entries = outputs[payload.entry_signal]
    exits = outputs[payload.exit_signal] if payload.exit_signal else [False] * len(candles)
    position_entry: Decimal | None = None
    trade_pnls: list[Decimal] = []
    for index, (entry, exit_) in enumerate(zip(entries, exits, strict=True)):
        if position_entry is None and entry:
            position_entry = closes[index]
        elif position_entry is not None and exit_:
            trade_pnls.append(
                (closes[index] - position_entry) * payload.position_size - payload.cost_per_trade
            )
            position_entry = None
    if position_entry is not None:
        trade_pnls.append((closes[-1] - position_entry) * payload.position_size - payload.cost_per_trade)
    equity = Decimal("0")
    peak = Decimal("0")
    max_drawdown = Decimal("0")
    for pnl in trade_pnls:
        equity += pnl
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
    wins = sum(pnl > 0 for pnl in trade_pnls)
    assumptions = {
        "symbol": instrument.canonical_symbol,
        "interval_seconds": payload.interval_seconds,
        "from_at": start.isoformat(),
        "to_at": end.isoformat(),
        "entry_signal": payload.entry_signal,
        "exit_signal": payload.exit_signal,
        "position_size": str(payload.position_size),
        "cost_per_trade": str(payload.cost_per_trade),
        "fill_rule": "signal-bar close; one long position at a time; final open position exits at last close",
        "source_version": version.version,
        "source_hash": version.source_hash,
    }
    reproducibility_hash = _hash(
        [version.source_hash, assumptions, [candle.fingerprint for candle in candles]]
    )
    existing = db.scalar(
        select(AIBacktestRun).where(
            AIBacktestRun.user_id == user_id,
            AIBacktestRun.reproducibility_hash == reproducibility_hash,
        )
    )
    if existing is not None:
        return AIBacktestRead.model_validate(existing, from_attributes=True)
    warnings = []
    if any(not candle.complete for candle in candles):
        warnings.append("Input contains incomplete candles; results should not be treated as final.")
    metrics = {
        "bars": len(candles),
        "trades": len(trade_pnls),
        "wins": wins,
        "losses": len(trade_pnls) - wins,
        "win_rate": _decimal_text(
            (Decimal(wins) / Decimal(len(trade_pnls)) * 100) if trade_pnls else Decimal("0")
        ),
        "net_pnl": _decimal_text(sum(trade_pnls, Decimal("0"))),
        "max_drawdown": _decimal_text(max_drawdown),
    }
    row = AIBacktestRun(
        user_id=user_id,
        job_id=job_id,
        artifact_id=artifact_id,
        script_version_id=version.id,
        instrument_id=instrument.id,
        interval_seconds=payload.interval_seconds,
        from_at=start,
        to_at=end,
        assumptions=assumptions,
        metrics=metrics,
        warnings=warnings,
        reproducibility_hash=reproducibility_hash,
        status="COMPLETED",
        completed_at=utcnow(),
    )
    db.add(row)
    db.flush()
    if job_id:
        job = _owned_job(db, user_id, job_id)
        _job_event(db, job, "BACKTEST", {"backtest_id": row.id, "status": row.status})
    _audit(
        db,
        user_id,
        action="BACKTEST_RUN",
        resource_type="AI_BACKTEST",
        resource_id=row.id,
        outcome="SUCCESS",
        details={"reproducibility_hash": reproducibility_hash, "script_version_id": version.id},
    )
    if commit:
        db.commit()
        db.refresh(row)
    else:
        db.flush()
    return AIBacktestRead.model_validate(row, from_attributes=True)


def list_backtests(db: Session, user_id: int, *, limit: int = 100) -> list[AIBacktestRead]:
    rows = db.scalars(
        select(AIBacktestRun)
        .where(AIBacktestRun.user_id == user_id)
        .order_by(AIBacktestRun.created_at.desc(), AIBacktestRun.id.desc())
        .limit(limit)
    ).all()
    return [AIBacktestRead.model_validate(row, from_attributes=True) for row in rows]


def purge_expired_ai_data(
    db: Session, user_id: int, *, now: datetime | None = None
) -> AIRetentionResult:
    current = _utc_naive(now or utcnow())
    conversations = db.scalars(
        select(AIConversation).where(
            AIConversation.user_id == user_id,
            AIConversation.retention_until <= current,
            AIConversation.deleted_at.is_(None),
        )
    ).all()
    conversation_ids = [row.id for row in conversations]
    messages = (
        db.scalars(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.conversation_id.in_(conversation_ids),
                AIMessage.purged_at.is_(None),
            )
        ).all()
        if conversation_ids
        else []
    )
    artifacts = db.scalars(
        select(AIGeneratedArtifact).where(
            AIGeneratedArtifact.user_id == user_id,
            AIGeneratedArtifact.retention_until <= current,
            AIGeneratedArtifact.purged_at.is_(None),
        )
    ).all()
    for conversation in conversations:
        conversation.status = "EXPIRED"
        conversation.deleted_at = current
    for message in messages:
        message.content = ""
        message.chart_context = {}
        message.image_metadata = {}
        message.purged_at = current
    for artifact in artifacts:
        artifact.content = {}
        artifact.purged_at = current
    _audit(
        db,
        user_id,
        action="RETENTION_PURGE",
        resource_type="AI_RETENTION",
        resource_id=None,
        outcome="SUCCESS",
        details={
            "conversations_purged": len(conversations),
            "messages_purged": len(messages),
            "artifacts_purged": len(artifacts),
        },
    )
    db.commit()
    return AIRetentionResult(
        conversations_purged=len(conversations),
        messages_purged=len(messages),
        artifacts_purged=len(artifacts),
    )
