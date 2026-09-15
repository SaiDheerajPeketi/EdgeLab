from app.api import routes


def test_ui_rollout_defaults_to_completed_route_groups(monkeypatch):
    for name in (
        "EDGELAB_UI_KILL_SWITCH", "EDGELAB_UI_SHELL_V2", "EDGELAB_UI_JOURNAL_V2",
        "EDGELAB_UI_SETTINGS_V2", "EDGELAB_UI_CHART_V2", "EDGELAB_UI_PUBLIC_V2",
    ):
        monkeypatch.delenv(name, raising=False)
    result = routes.ui_rollout_config()
    assert result.kill_switch is False
    assert all(result.flags.values())


def test_ui_rollout_kill_switch_and_group_override(monkeypatch):
    monkeypatch.setenv("EDGELAB_UI_REVISION", "incident-42")
    monkeypatch.setenv("EDGELAB_UI_KILL_SWITCH", "true")
    monkeypatch.setenv("EDGELAB_UI_CHART_V2", "false")
    result = routes.ui_rollout_config()
    assert result.revision == "incident-42"
    assert result.kill_switch is True
    assert result.flags["chart"] is False
