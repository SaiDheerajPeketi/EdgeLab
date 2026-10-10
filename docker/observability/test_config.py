"""Static deployment safety checks; binary startup is a separate integration gate."""
from pathlib import Path
import json
import re
import subprocess
import unittest

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


class MonitoringConfigTests(unittest.TestCase):
    def setUp(self):
        self.compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
        self.services = self.compose["services"]

    def test_socket_is_isolated_and_inspect_does_not_forward_environment(self):
        owners = [name for name, config in self.services.items()
                  if any("/var/run/docker.sock" in str(mount) for mount in config.get("volumes", []))]
        self.assertEqual(owners, ["docker-log-proxy"])
        proxy = self.services["docker-log-proxy"]
        self.assertEqual(proxy["networks"], ["docker-logs"])
        self.assertFalse(proxy.get("ports"))
        self.assertTrue(self.compose["networks"]["docker-logs"]["internal"])
        cfg = (HERE / "docker-log-proxy.cfg").read_text()
        metadata = json.loads(re.search(r"string '(.*)' if is_get inspect", cfg).group(1))
        self.assertEqual(metadata, {"Config": {"Tty": False}, "State": {
            "Running": True, "FinishedAt": "0001-01-01T00:00:00Z"}})
        self.assertLess(cfg.index("string '"), cfg.index("default_backend"))
        self.assertIn("unless is_get or is_head ping", cfg)
        allowed = [re.compile(pattern) for _, pattern in re.findall(r"acl (\w+) path_reg (.+)", cfg)]
        cid = "a" * 64
        for path in ["/v1.53/containers/json", "/v1.53/networks", f"/v1.53/containers/{cid}/logs"]:
            self.assertTrue(any(pattern.fullmatch(path) for pattern in allowed), path)
        for path in ["/v1.53/info", "/v1.53/images/json", "/v1.53/volumes",
                     f"/v1.53/containers/{cid}/archive", f"/v1.53/containers/{cid}/export",
                     f"/v1.53/containers/{cid}/exec", "/v1.53/exec/example/json",
                     f"/v1.53/networks/{cid}", "/v1.53/secrets", "/v1.53/services"]:
            self.assertFalse(any(pattern.fullmatch(path) for pattern in allowed), path)
        self.assertIn("http-request set-query filters=", cfg)
        self.assertIn("%[env(EDGELAB_LOG_COMPOSE_PROJECT)]", cfg)

    def test_log_discovery_is_project_scoped_and_app_only_without_tty(self):
        config = (HERE / "config.alloy").read_text()
        self.assertIn('"com.docker.compose.project=" + sys.env("EDGELAB_LOG_COMPOSE_PROJECT")', config)
        pattern = re.search(r'regex = "(api\|[^"]+)"', config).group(1)
        included = set(pattern.split("|"))
        self.assertEqual(included, {"api", "market-api", "auth", "frontend", "data-populator", "analytics-worker", "legacy-api"})
        for service in included:
            self.assertFalse(self.services[service].get("tty", False))
        self.assertNotIn("/var/run/docker.sock", str(self.services["alloy"]))

    def test_optional_credentials_and_durable_retained_stores(self):
        for name in ("prometheus", "grafana", "alloy", "loki", "tempo", "docker-log-proxy", "postgres-exporter", "timescaledb-exporter"):
            self.assertEqual(set(self.services[name]["profiles"]), {"observability", "benchmark"})
        efficient = yaml.compose((ROOT / "docker-compose.efficient.yml").read_text())
        services = dict((key.value, value) for key, value in efficient.value)["services"]
        exporter = dict((key.value, value) for key, value in services.value)["timescaledb-exporter"]
        profiles = dict((key.value, value) for key, value in exporter.value)["profiles"]
        # Ordinary lists merge with the base profile and start an unused exporter.
        self.assertEqual(profiles.tag, "!override")
        self.assertEqual([item.value for item in profiles.value], ["timescale-observability"])
        for name, path in (("prometheus", "/prometheus"), ("grafana", "/var/lib/grafana"), ("alloy", "/var/lib/alloy/data")):
            self.assertIn(f"{name}-data:{path}", self.services[name]["volumes"])
        self.assertEqual(self.services["grafana"]["environment"]["GF_SECURITY_ADMIN_PASSWORD"], "${EDGELAB_GRAFANA_ADMIN_PASSWORD:-}")
        for password in ("", "edgelab", "short"):
            result = subprocess.run(["sh", str(HERE / "grafana-start.sh")], env={"GF_SECURITY_ADMIN_PASSWORD": password}, capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn(b"at least 12", result.stderr)
        for name in ("postgres-exporter", "timescaledb-exporter"):
            env = self.services[name]["environment"]
            self.assertNotIn("DATA_SOURCE_NAME", env)
            self.assertIn("DATA_SOURCE_URI", env)
            self.assertEqual(env["DATA_SOURCE_PASS"], "${EDGELAB_MONITOR_DATABASE_PASSWORD:-}")
            self.assertNotIn("--collector.stat_statements", self.services[name]["command"])
        loki = yaml.safe_load((HERE / "loki-config.yml").read_text())
        self.assertTrue(loki["compactor"]["retention_enabled"])
        self.assertIn("retention_period", loki["limits_config"])
        self.assertEqual(loki["compactor"]["delete_request_store"], "filesystem")

    def test_metrics_discover_replicas_and_alerts_stay_local(self):
        config = yaml.safe_load((HERE / "prometheus.yml").read_text())
        api = config["scrape_configs"][0]
        self.assertEqual(api["dns_sd_configs"][0]["names"], ["api", "market-api"])
        db = next(job for job in config["scrape_configs"] if job["job_name"] == "edgelab-postgres")
        self.assertEqual(db["dns_sd_configs"][0]["names"], ["postgres-exporter", "timescaledb-exporter"])
        self.assertNotIn("static_configs", db)
        self.assertNotIn("alerting", config)
        self.assertEqual(config["rule_files"], ["/etc/prometheus/alerts.yml"])
        alerts = yaml.safe_load((HERE / "alerts.yml").read_text())["groups"][0]["rules"]
        self.assertTrue({"EdgeLabApiDiscoveryMissing", "EdgeLabDatabaseUnavailable", "EdgeLabLogsDropped"}.issubset({rule["alert"] for rule in alerts}))


if __name__ == "__main__":
    unittest.main()
