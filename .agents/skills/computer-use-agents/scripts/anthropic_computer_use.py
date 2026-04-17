from anthropic import Anthropic
from anthropic.types.beta import (
    BetaToolComputerUse20241022,
    BetaToolBash20241022,
    BetaToolTextEditor20241022,
)
import subprocess
import base64
from PIL import Image
import io

class AnthropicComputerUse:
    """
    Official Anthropic Computer Use implementation.

    Requires:
    - Docker container with virtual display
    - VNC for viewing agent actions
    - Proper tool implementations
    """

    def __init__(self):
        self.client = Anthropic()
        self.model = "claude-sonnet-4-20250514"  # Best for computer use
        self.screen_size = (1280, 800)

    def get_tools(self) -> list:
        """Define computer use tools."""
        return [
            BetaToolComputerUse20241022(
                type="computer_20241022",
                name="computer",
                display_width_px=self.screen_size[0],
                display_height_px=self.screen_size[1],
            ),
            BetaToolBash20241022(
                type="bash_20241022",
                name="bash",
            ),
            BetaToolTextEditor20241022(
                type="text_editor_20241022",
                name="str_replace_editor",
            ),
        ]

    def execute_tool(self, name: str, input: dict) -> dict:
        """Execute a tool and return result."""

        if name == "computer":
            return self._handle_computer_action(input)
        elif name == "bash":
            return self._handle_bash(input)
        elif name == "str_replace_editor":
            return self._handle_editor(input)
        else:
            return {"error": f"Unknown tool: {name}"}

    def _handle_computer_action(self, input: dict) -> dict:
        """Handle computer control actions."""
        action = input.get("action")

        if action == "screenshot":
            # Capture via xdotool/scrot
            subprocess.run(["scrot", "/tmp/screenshot.png"])

            with open("/tmp/screenshot.png", "rb") as f:
                img_data = f.read()

            # Resize for efficiency
            img = Image.open(io.BytesIO(img_data))
            img = img.resize(self.screen_size, Image.LANCZOS)

            buffer = io.BytesIO()
            img.save(buffer, format="PNG")

            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": base64.b64encode(buffer.getvalue()).decode()
                }
            }

        elif action == "mouse_move":
            x, y = input.get("coordinate", [0, 0])
            subprocess.run(["xdotool", "mousemove", str(x), str(y)])
            return {"success": True}

        elif action == "left_click":
            subprocess.run(["xdotool", "click", "1"])
            return {"success": True}

        elif action == "right_click":
            subprocess.run(["xdotool", "click", "3"])
            return {"success": True}

        elif action == "double_click":
            subprocess.run(["xdotool", "click", "--repeat", "2", "1"])
            return {"success": True}

        elif action == "type":
            text = input.get("text", "")
            # Use xdotool type with delay for reliability
            subprocess.run(["xdotool", "type", "--delay", "50", text])
            return {"success": True}

        elif action == "key":
            key = input.get("key", "")
            # Map common key names
            key_map = {
                "return": "Return",
                "enter": "Return",
                "tab": "Tab",
                "escape": "Escape",
                "backspace": "BackSpace",
            }
            xdotool_key = key_map.get(key.lower(), key)
            subprocess.run(["xdotool", "key", xdotool_key])
            return {"success": True}

        elif action == "scroll":
            direction = input.get("direction", "down")
            amount = input.get("amount", 3)
            button = "5" if direction == "down" else "4"
            for _ in range(amount):
                subprocess.run(["xdotool", "click", button])
            return {"success": True}

        return {"error": f"Unknown action: {action}"}

    def _handle_bash(self, input: dict) -> dict:
        """Execute bash command."""
        command = input.get("command", "")

        # Security: Sanitize and limit commands
        dangerous_patterns = ["rm -rf", "mkfs", "dd if=", "> /dev/"]
        for pattern in dangerous_patterns:
            if pattern in command:
                return {"error": "Dangerous command blocked"}

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=30
            )
            return {
                "stdout": result.stdout[:10000],  # Limit output
                "stderr": result.stderr[:1000],
                "returncode": result.returncode
            }
        except subprocess.TimeoutExpired:
            return {"error": "Command timed out"}

    def _handle_editor(self, input: dict) -> dict:
        """Handle text editor operations."""
        command = input.get("command")
        path = input.get("path")

        if command == "view":
            try:
                with open(path, "r") as f:
                    content = f.read()
                return {"content": content[:50000]}  # Limit size
            except Exception as e:
                return {"error": str(e)}

        elif command == "str_replace":
            old_str = input.get("old_str")
            new_str = input.get("new_str")
            try:
                with open(path, "r") as f:
                    content = f.read()
                if old_str not in content:
                    return {"error": "old_str not found in file"}
                content = content.replace(old_str, new_str, 1)
                with open(path, "w") as f:
                    f.write(content)
                return {"success": True}
            except Exception as e:
                return {"error": str(e)}

        return {"error": f"Unknown editor command: {command}"}

    def run_task(self, task: str, max_steps: int = 50) -> dict:
        """Run computer use task with agentic loop."""
        messages = [{"role": "user", "content": task}]
        tools = self.get_tools()

        for step in range(max_steps):
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=4096,
                tools=tools,
                messages=messages,
                betas=["computer-use-2024-10-22"]
            )

            # Check for completion
            if response.stop_reason == "end_turn":
                return {
                    "success": True,
                    "result": response.content[0].text if response.content else "",
                    "steps": step + 1
                }

            # Handle tool use
            if response.stop_reason == "tool_use":
                messages.append({"role": "assistant", "content": response.content})

                tool_results = []
                for block in response.content:
                    if block.type == "tool_use":
                        result = self.execute_tool(block.name, block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result
                        })

                messages.append({"role": "user", "content": tool_results})

        return {"success": False, "error": "Max steps reached"}

