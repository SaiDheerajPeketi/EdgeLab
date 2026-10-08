import pytest
from pydantic import ValidationError

from app.schemas import (
    WorkspaceShareChartPane,
    WorkspaceShareChartSettings,
    WorkspaceShareDrawing,
    WorkspaceShareFibLevel,
    WorkspaceShareIndicatorSettings,
)


def drawing(**patch):
    return {"id": "drawing-alpha", "tool": "fib", "color": "#abc",
            "points": [{"time": 1700000100, "price": 100}],
            "createdAt": "2026-10-08T00:00:00Z", **patch}


@pytest.mark.parametrize("raw, expected", [
    ("#aBc", "#AABBCC"), ("#0a1B2c", "#0A1B2C"),
    ("#1a2B3c80", "#1A2B3C80"), ("#12345600", "#12345600"),
    ("#abcdefFF", "#ABCDEFFF"),
])
def test_drawing_channels_and_fib_canonicalize_without_losing_alpha(raw, expected):
    value = WorkspaceShareDrawing.model_validate(drawing(color=raw, rewardColor=raw, riskColor=raw,
        fillOpacity=.4, labelBackgroundOpacity=.3,
        fibLevels=[{"id": "half", "value": .5, "color": raw, "backgroundOpacity": .25}]))
    assert value.color == value.reward_color == value.risk_color == expected
    assert value.fib_levels[0].color == expected
    assert value.fill_opacity == .4 and value.label_background_opacity == .3
    assert value.fib_levels[0].background_opacity == .25
    assert WorkspaceShareDrawing.model_validate_json(value.model_dump_json()).model_dump() == value.model_dump()


@pytest.mark.parametrize("raw", ["#1234", "#12345", "#1234567", "#123456789", "12345680",
                                  "#gg000080", "rgba(1,2,3,.5)", " #abcdef80", "#abcdef80\n"])
@pytest.mark.parametrize("field", ["color", "rewardColor", "riskColor", "fib"])
def test_malformed_raw_share_colors_are_rejected(raw, field):
    patch = {field: raw} if field != "fib" else {"fibLevels": [{"id": "half", "value": .5, "color": raw}]}
    with pytest.raises(ValidationError):
        WorkspaceShareDrawing.model_validate(drawing(**patch))


def test_non_drawing_colors_remain_six_digit_only():
    for raw in ("#abc", "#11223380"):
        with pytest.raises(ValidationError):
            WorkspaceShareIndicatorSettings.model_validate({"color": raw})
        with pytest.raises(ValidationError):
            WorkspaceShareChartSettings.model_validate({"backgroundColor": raw})
    assert WorkspaceShareIndicatorSettings.model_validate({"color": "#112233"}).color == "#112233"


@pytest.mark.parametrize("field, patch", [
    ("points", [{"time": 1700000100, "price": 100}] * 65),
    ("fibLevels", [{"id": str(i), "value": .5, "color": "#11223380"} for i in range(33)]),
    ("fillOpacity", 1.01), ("labelBackgroundOpacity", -.01),
])
def test_alpha_does_not_relax_drawing_bounds(field, patch):
    with pytest.raises(ValidationError):
        WorkspaceShareDrawing.model_validate(drawing(**{field: patch}))


def test_alpha_does_not_relax_pane_or_fib_bounds():
    with pytest.raises(ValidationError):
        WorkspaceShareChartPane.model_validate({"id": "pane-1", "timeframe": "1m",
                                               "drawings": [drawing()] * 501})
    with pytest.raises(ValidationError):
        WorkspaceShareFibLevel.model_validate({"id": "half", "value": .5,
                                               "color": "#11223380", "backgroundOpacity": 1.01})
