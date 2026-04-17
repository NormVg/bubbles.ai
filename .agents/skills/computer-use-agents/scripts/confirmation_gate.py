from enum import Enum
from dataclasses import dataclass
from typing import Callable, Optional
import asyncio

class ActionSeverity(Enum):
    LOW = "low"           # Auto-approve
    MEDIUM = "medium"     # Log, optional confirm
    HIGH = "high"         # Always confirm
    CRITICAL = "critical" # Confirm + review details

@dataclass
class SensitiveAction:
    """Action that may need user confirmation."""
    action_type: str
    description: str
    severity: ActionSeverity
    details: dict

class ConfirmationGate:
    """
    Gate sensitive actions through user confirmation.
    """

    # Action type -> severity mapping
    ACTION_SEVERITY = {
        # LOW - auto-approve
        "navigate": ActionSeverity.LOW,
        "scroll": ActionSeverity.LOW,
        "read": ActionSeverity.LOW,
        "screenshot": ActionSeverity.LOW,

        # MEDIUM - log and maybe confirm
        "click": ActionSeverity.MEDIUM,
        "type": ActionSeverity.MEDIUM,
        "search": ActionSeverity.MEDIUM,

        # HIGH - always confirm
        "download": ActionSeverity.HIGH,
        "submit_form": ActionSeverity.HIGH,
        "login": ActionSeverity.HIGH,
        "file_write": ActionSeverity.HIGH,

        # CRITICAL - confirm with full review
        "purchase": ActionSeverity.CRITICAL,
        "enter_password": ActionSeverity.CRITICAL,
        "enter_credit_card": ActionSeverity.CRITICAL,
        "send_money": ActionSeverity.CRITICAL,
        "delete": ActionSeverity.CRITICAL,
    }

    def __init__(
        self,
        confirm_callback: Callable[[SensitiveAction], bool] = None,
        auto_confirm_low: bool = True,
        auto_confirm_medium: bool = False
    ):
        self.confirm_callback = confirm_callback or self._default_confirm
        self.auto_confirm_low = auto_confirm_low
        self.auto_confirm_medium = auto_confirm_medium
        self.action_log = []

    def _default_confirm(self, action: SensitiveAction) -> bool:
        """Default confirmation via CLI prompt."""
        print(f"\n{'='*60}")
        print(f"ACTION CONFIRMATION REQUIRED")
        print(f"{'='*60}")
        print(f"Type: {action.action_type}")
        print(f"Severity: {action.severity.value.upper()}")
        print(f"Description: {action.description}")
        print(f"Details: {action.details}")
        print(f"{'='*60}")

        while True:
            response = input("Allow this action? [y/n]: ").lower().strip()
            if response in ['y', 'yes']:
                return True
            elif response in ['n', 'no']:
                return False

    def classify_action(self, action_type: str, context: dict) -> ActionSeverity:
        """Classify action severity, considering context."""
        base_severity = self.ACTION_SEVERITY.get(action_type, ActionSeverity.MEDIUM)

        # Escalate based on context
        if context.get("involves_credentials"):
            return ActionSeverity.CRITICAL
        if context.get("involves_money"):
            return ActionSeverity.CRITICAL
        if context.get("irreversible"):
            return max(base_severity, ActionSeverity.HIGH, key=lambda x: x.value)

        return base_severity

    def check_action(
        self,
        action_type: str,
        description: str,
        details: dict = None
    ) -> tuple[bool, str]:
        """
        Check if action should proceed.
        Returns (approved, reason).
        """
        details = details or {}
        severity = self.classify_action(action_type, details)

        action = SensitiveAction(
            action_type=action_type,
            description=description,
            severity=severity,
            details=details
        )

        # Log all actions
        self.action_log.append({
            "action": action,
            "timestamp": __import__('datetime').datetime.now().isoformat()
        })

        # Auto-approve low severity
        if severity == ActionSeverity.LOW and self.auto_confirm_low:
            return True, "auto-approved (low severity)"

        # Maybe auto-approve medium
        if severity == ActionSeverity.MEDIUM and self.auto_confirm_medium:
            return True, "auto-approved (medium severity)"

        # Request confirmation
        approved = self.confirm_callback(action)

        if approved:
            return True, "user approved"
        else:
            return False, "user rejected"

class ConfirmedComputerUseAgent:
    """
    Computer use agent with confirmation gates.
    """

    def __init__(self, base_agent, confirmation_gate: ConfirmationGate):
        self.agent = base_agent
        self.gate = confirmation_gate

    def execute_action(self, action: dict) -> dict:
        """Execute action with confirmation check."""
        action_type = action.get("type", "unknown")

        # Build description
        if action_type == "click":
            desc = f"Click at ({action.get('x')}, {action.get('y')})"
        elif action_type == "type":
            text = action.get('text', '')
            # Mask if looks like password
            if self._looks_sensitive(text):
                desc = f"Type sensitive text ({len(text)} chars)"
            else:
                desc = f"Type: {text[:50]}..."
        else:
            desc = f"Execute: {action_type}"

        # Context for severity classification
        context = {
            "involves_credentials": self._looks_sensitive(action.get("text", "")),
            "involves_money": self._mentions_money(action),
        }

        # Check with gate
        approved, reason = self.gate.check_action(
            action_type, desc, context
        )

        if not approved:
            return {
                "success": False,
                "error": f"Action blocked: {reason}",
                "action": action_type
            }

        # Execute if approved
        return self.agent.execute_action(action)

    def _looks_sensitive(self, text: str) -> bool:
        """Check if text looks like sensitive data."""
        if not text:
            return False
        # Common patterns
        patterns = [
            r'\b\d{16}\b',  # Credit card
            r'\b\d{3,4}\b.*\b\d{3,4}\b',  # CVV-like
            r'password',
            r'secret',
            r'api.?key',
            r'token'
        ]
        import re
        return any(re.search(p, text.lower()) for p in patterns)

    def _mentions_money(self, action: dict) -> bool:
        """Check if action involves money."""
        text = str(action)
        money_patterns = [
            r'\$\d+', r'pay', r'purchase', r'buy', r'checkout',
            r'credit', r'debit', r'invoice', r'payment'
        ]
        import re
        return any(re.search(p, text.lower()) for p in money_patterns)

# Usage
gate = ConfirmationGate(
    auto_confirm_low=True,
    auto_confirm_medium=False  # Confirm clicks, typing
)

agent = ConfirmedComputerUseAgent(base_agent, gate)
result = agent.execute_action({"type": "click", "x": 500, "y": 300})

