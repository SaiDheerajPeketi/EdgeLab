from fastapi import Response

from app.api import routes


def clear_ui_rollout_environment(monkeypatch):
    for name in (
        "EDGELAB_UI_REVISION", "EDGELAB_UI_KILL_SWITCH", "EDGELAB_UI_SHELL_V2", "EDGELAB_UI_JOURNAL_V2",
        "EDGELAB_UI_SETTINGS_V2", "EDGELAB_UI_CHART_V2", "EDGELAB_UI_PUBLIC_V2",
    ):
        monkeypatch.delenv(name, raising=False)


def test_ui_rollout_defaults_to_completed_route_groups(monkeypatch):
    clear_ui_rollout_environment(monkeypatch)
    response = Response()
    result = routes.ui_rollout_config(response)
    assert result.kill_switch is False
    assert all(result.flags.values())
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.headers["pragma"] == "no-cache"


def test_ui_rollout_kill_switch_and_group_override(monkeypatch):
    clear_ui_rollout_environment(monkeypatch)
    monkeypatch.setenv("EDGELAB_UI_REVISION", "incident-42")
    monkeypatch.setenv("EDGELAB_UI_KILL_SWITCH", "true")
    result = routes.ui_rollout_config(Response())
    assert result.revision == "incident-42"
    assert result.kill_switch is True
    assert all(value is False for value in result.flags.values())


def test_ui_rollout_requires_shell_before_dependent_groups(monkeypatch):
    clear_ui_rollout_environment(monkeypatch)
    monkeypatch.setenv("EDGELAB_UI_SHELL_V2", "false")
    monkeypatch.setenv("EDGELAB_UI_JOURNAL_V2", "true")
    monkeypatch.setenv("EDGELAB_UI_SETTINGS_V2", "true")
    monkeypatch.setenv("EDGELAB_UI_CHART_V2", "true")
    result = routes.ui_rollout_config(Response())
    assert result.flags == {
        "shell": False,
        "journal": False,
        "settings": False,
        "chart": False,
        "public": True,
    }


def test_ui_rollout_invalid_values_fail_closed(monkeypatch):
    clear_ui_rollout_environment(monkeypatch)
    monkeypatch.setenv("EDGELAB_UI_KILL_SWITCH", "typo")
    monkeypatch.setenv("EDGELAB_UI_PUBLIC_V2", "typo")
    result = routes.ui_rollout_config(Response())
    assert result.kill_switch is True
    assert all(value is False for value in result.flags.values())
