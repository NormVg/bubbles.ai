from anthropic import Anthropic
from PIL import Image
import base64
import pyautogui
import time

class ComputerUseAgent:
    """
    Perception-Reasoning-Action loop implementation.
    Based on Anthropic Computer Use patterns.
    """

    def __init__(self, client: Anthropic, model: str = "claude-sonnet-4-20250514"):
        self.client = client
        self.model = model
        self.max_steps = 50  # Prevent runaway loops
        self.action_delay = 0.5  # Seconds between actions

    def capture_screenshot(self) -> str:
        """Capture screen and return base64 encoded image."""
        screenshot = pyautogui.screenshot()
        # Resize for token efficiency (1280x800 is good balance)
        screenshot = screenshot.resize((1280, 800), Image.LANCZOS)

        import io
        buffer = io.BytesIO()
        screenshot.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode()

    def execute_action(self, action: dict) -> dict:
        """Execute mouse/keyboard action on the computer."""
        action_type = action.get("type")

        if action_type == "click":
            x, y = action["x"], action["y"]
            button = action.get("button", "left")
            pyautogui.click(x, y, button=button)
            return {"success": True, "action": f"clicked at ({x}, {y})"}

        elif action_type == "type":
            text = action["text"]
            pyautogui.typewrite(text, interval=0.02)
            return {"success": True, "action": f"typed {len(text)} chars"}

        elif action_type == "key":
            key = action["key"]
            pyautogui.press(key)
            return {"success": True, "action": f"pressed {key}"}

        elif action_type == "scroll":
            direction = action.get("direction", "down")
            amount = action.get("amount", 3)
            scroll = -amount if direction == "down" else amount
            pyautogui.scroll(scroll)
            return {"success": True, "action": f"scrolled {direction}"}

        elif action_type == "move":
            x, y = action["x"], action["y"]
            pyautogui.moveTo(x, y)
            return {"success": True, "action": f"moved to ({x}, {y})"}

        else:
            return {"success": False, "error": f"Unknown action: {action_type}"}

    def run(self, task: str) -> dict:
        """
        Run perception-reasoning-action loop until task complete.

        The loop:
        1. Screenshot current state
        2. Send to vision model with task context
        3. Parse action from response
        4. Execute action
        5. Repeat until done or max steps
        """
        messages = []
        step_count = 0

        system_prompt = """You are a computer use agent. You can see the screen
        and control mouse/keyboard.

        Available actions (respond with JSON):
        - {"type": "click", "x": 100, "y": 200, "button": "left"}
        - {"type": "type", "text": "hello world"}
        - {"type": "key", "key": "enter"}
        - {"type": "scroll", "direction": "down", "amount": 3}
        - {"type": "done", "result": "task completed successfully"}

        Always respond with ONLY a JSON action object.
        Be precise with coordinates - click exactly where needed.
        If you see an error, try to recover.
        """

        while step_count < self.max_steps:
            step_count += 1

            # 1. PERCEPTION: Capture current screen
            screenshot_b64 = self.capture_screenshot()

            # 2. REASONING: Send to vision model
            user_content = [
                {"type": "text", "text": f"Task: {task}\n\nStep {step_count}. What action should I take?"},
                {"type": "image", "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": screenshot_b64
                }}
            ]

            messages.append({"role": "user", "content": user_content})

            response = self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=system_prompt,
                messages=messages
            )

            assistant_message = response.content[0].text
            messages.append({"role": "assistant", "content": assistant_message})

            # 3. Parse action from response
            import json
            try:
                action = json.loads(assistant_message)
            except json.JSONDecodeError:
                # Try to extract JSON from response
                import re
                match = re.search(r'\{[^}]+\}', assistant_message)
                if match:
                    action = json.loads(match.group())
                else:
                    continue

            # Check if done
            if action.get("type") == "done":
                return {
                    "success": True,
                    "result": action.get("result"),
                    "steps": step_count
                }

            # 4. ACTION: Execute
            result = self.execute_action(action)

            # Small delay for UI to update
            time.sleep(self.action_delay)

        return {
            "success": False,
            "error": "Max steps reached",
            "steps": step_count
        }

# Usage
agent = ComputerUseAgent(Anthropic())
result = agent.run("Open Chrome and search for 'weather today'")

