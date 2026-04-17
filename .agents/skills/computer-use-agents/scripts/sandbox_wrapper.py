import subprocess
import os
from dataclasses import dataclass
from typing import Optional

@dataclass
class SandboxConfig:
    """Configuration for agent sandbox."""
    network_allowed: list[str] = None  # Allowed domains
    max_runtime_seconds: int = 300
    max_memory_mb: int = 2048
    allow_downloads: bool = False
    allow_clipboard: bool = False

class SandboxedAgent:
    """
    Run computer use agent in Docker sandbox.
    """

    def __init__(self, config: SandboxConfig):
        self.config = config
        self.container_id: Optional[str] = None

    def start(self):
        """Start sandboxed environment."""
        # Build network rules
        network_rules = ""
        if self.config.network_allowed:
            for domain in self.config.network_allowed:
                network_rules += f"--add-host={domain}:$(dig +short {domain}) "
        else:
            network_rules = "--network=none"

        cmd = f"""
        docker run -d \
            --name computer-use-sandbox-$$ \
            --security-opt no-new-privileges \
            --cap-drop ALL \
            --memory {self.config.max_memory_mb}m \
            --cpus 2 \
            --read-only \
            --tmpfs /tmp \
            {network_rules} \
            computer-use-agent:latest
        """

        result = subprocess.run(cmd, shell=True, capture_output=True)
        self.container_id = result.stdout.decode().strip()

        # Set up kill timer
        subprocess.Popen([
            "sh", "-c",
            f"sleep {self.config.max_runtime_seconds} && docker kill {self.container_id}"
        ])

        return self.container_id

    def execute_task(self, task: str) -> dict:
        """Execute task in sandbox."""
        if not self.container_id:
            self.start()

        # Send task to agent via API
        import requests
        response = requests.post(
            f"http://localhost:8080/task",
            json={"task": task},
            timeout=self.config.max_runtime_seconds
        )

        return response.json()

    def stop(self):
        """Stop and remove sandbox."""
        if self.container_id:
            subprocess.run(f"docker rm -f {self.container_id}", shell=True)
            self.container_id = None

