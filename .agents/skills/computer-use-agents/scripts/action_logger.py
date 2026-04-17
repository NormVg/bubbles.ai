from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Any
import json
import os

@dataclass
class ActionLogEntry:
    """Single action log entry."""
    timestamp: datetime
    action_type: str
    parameters: dict
    success: bool
    error: Optional[str] = None
    screenshot_before: Optional[str] = None  # Path to screenshot
    screenshot_after: Optional[str] = None
    model_reasoning: Optional[str] = None
    duration_ms: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp.isoformat(),
            "action_type": self.action_type,
            "parameters": self._sanitize_params(self.parameters),
            "success": self.success,
            "error": self.error,
            "screenshot_before": self.screenshot_before,
            "screenshot_after": self.screenshot_after,
            "model_reasoning": self.model_reasoning,
            "duration_ms": self.duration_ms
        }

    def _sanitize_params(self, params: dict) -> dict:
        """Remove sensitive data from params."""
        sanitized = {}
        sensitive_keys = ['password', 'secret', 'token', 'key', 'credit_card']

        for k, v in params.items():
            if any(s in k.lower() for s in sensitive_keys):
                sanitized[k] = "[REDACTED]"
            elif isinstance(v, str) and len(v) > 100:
                sanitized[k] = v[:100] + "...[truncated]"
            else:
                sanitized[k] = v

        return sanitized

@dataclass
class TaskSession:
    """A complete task execution session."""
    session_id: str
    task: str
    start_time: datetime
    end_time: Optional[datetime] = None
    actions: list[ActionLogEntry] = field(default_factory=list)
    success: bool = False
    final_result: Optional[str] = None

class ActionLogger:
    """
    Comprehensive action logging for computer use agents.
    """

    def __init__(self, log_dir: str = "./agent_logs"):
        self.log_dir = log_dir
        self.screenshot_dir = os.path.join(log_dir, "screenshots")
        os.makedirs(self.screenshot_dir, exist_ok=True)

        self.current_session: Optional[TaskSession] = None

    def start_session(self, task: str) -> str:
        """Start a new task session."""
        import uuid
        session_id = str(uuid.uuid4())[:8]

        self.current_session = TaskSession(
            session_id=session_id,
            task=task,
            start_time=datetime.now()
        )

        return session_id

    def log_action(
        self,
        action_type: str,
        parameters: dict,
        success: bool,
        error: Optional[str] = None,
        screenshot_before: bytes = None,
        screenshot_after: bytes = None,
        model_reasoning: str = None,
        duration_ms: int = None
    ):
        """Log a single action."""
        if not self.current_session:
            raise RuntimeError("No active session")

        # Save screenshots if provided
        screenshot_paths = {}
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")

        if screenshot_before:
            path = os.path.join(
                self.screenshot_dir,
                f"{self.current_session.session_id}_{timestamp_str}_before.png"
            )
            with open(path, "wb") as f:
                f.write(screenshot_before)
            screenshot_paths["before"] = path

        if screenshot_after:
            path = os.path.join(
                self.screenshot_dir,
                f"{self.current_session.session_id}_{timestamp_str}_after.png"
            )
            with open(path, "wb") as f:
                f.write(screenshot_after)
            screenshot_paths["after"] = path

        # Create log entry
        entry = ActionLogEntry(
            timestamp=datetime.now(),
            action_type=action_type,
            parameters=parameters,
            success=success,
            error=error,
            screenshot_before=screenshot_paths.get("before"),
            screenshot_after=screenshot_paths.get("after"),
            model_reasoning=model_reasoning,
            duration_ms=duration_ms
        )

        self.current_session.actions.append(entry)

        # Also append to running log file
        self._append_to_log(entry)

    def _append_to_log(self, entry: ActionLogEntry):
        """Append entry to JSONL log file."""
        log_file = os.path.join(
            self.log_dir,
            f"session_{self.current_session.session_id}.jsonl"
        )

        with open(log_file, "a") as f:
            f.write(json.dumps(entry.to_dict()) + "\n")

    def end_session(self, success: bool, result: str = None):
        """End current session."""
        if not self.current_session:
            return

        self.current_session.end_time = datetime.now()
        self.current_session.success = success
        self.current_session.final_result = result

        # Write session summary
        summary_file = os.path.join(
            self.log_dir,
            f"session_{self.current_session.session_id}_summary.json"
        )

        summary = {
            "session_id": self.current_session.session_id,
            "task": self.current_session.task,
            "start_time": self.current_session.start_time.isoformat(),
            "end_time": self.current_session.end_time.isoformat(),
            "duration_seconds": (
                self.current_session.end_time -
                self.current_session.start_time
            ).total_seconds(),
            "total_actions": len(self.current_session.actions),
            "successful_actions": sum(
                1 for a in self.current_session.actions if a.success
            ),
            "failed_actions": sum(
                1 for a in self.current_session.actions if not a.success
            ),
            "success": success,
            "final_result": result
        }

        with open(summary_file, "w") as f:
            json.dump(summary, f, indent=2)

        self.current_session = None

    def get_session_replay(self, session_id: str) -> list[dict]:
        """Get all actions from a session for replay/debugging."""
        log_file = os.path.join(self.log_dir, f"session_{session_id}.jsonl")

        actions = []
        with open(log_file, "r") as f:
            for line in f:
                actions.append(json.loads(line))

        return actions

# Integration with agent
class LoggedComputerUseAgent:
    """Computer use agent with comprehensive logging."""

    def __init__(self, base_agent, logger: ActionLogger):
        self.agent = base_agent
        self.logger = logger

    def run_task(self, task: str) -> dict:
        """Run task with full logging."""
        session_id = self.logger.start_session(task)

        try:
            result = self._run_with_logging(task)
            self.logger.end_session(
                success=result.get("success", False),
                result=result.get("result")
            )
            return result
        except Exception as e:
            self.logger.end_session(success=False, result=str(e))
            raise

    def _run_with_logging(self, task: str) -> dict:
        """Internal run with action logging."""
        # This would wrap the base agent's run method
        # and log each action
        pass

