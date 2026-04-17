from playwright.async_api import async_playwright
from dataclasses import dataclass
from typing import Optional
import asyncio

@dataclass
class BrowserAction:
    """Structured browser action."""
    action: str  # click, type, navigate, scroll, extract
    selector: Optional[str] = None
    text: Optional[str] = None
    url: Optional[str] = None

class BrowserUseAgent:
    """
    Browser automation using Playwright with structured commands.
    More efficient than pixel-based for web tasks.
    """

    def __init__(self):
        self.browser = None
        self.page = None

    async def start(self, headless: bool = True):
        """Start browser session."""
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=headless)
        self.page = await self.browser.new_page()

    async def get_page_snapshot(self) -> dict:
        """
        Get structured snapshot of page for LLM.
        Uses accessibility tree for efficiency.
        """
        # Get accessibility tree
        snapshot = await self.page.accessibility.snapshot()

        # Get simplified DOM info
        elements = await self.page.evaluate('''() => {
            const interactable = [];
            const selector = 'a, button, input, select, textarea, [role="button"]';
            document.querySelectorAll(selector).forEach((el, i) => {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    interactable.push({
                        index: i,
                        tag: el.tagName.toLowerCase(),
                        text: el.textContent?.trim().slice(0, 100),
                        type: el.type,
                        placeholder: el.placeholder,
                        name: el.name,
                        id: el.id,
                        class: el.className
                    });
                }
            });
            return interactable;
        }''')

        return {
            "url": self.page.url,
            "title": await self.page.title(),
            "accessibility_tree": snapshot,
            "interactable_elements": elements[:50]  # Limit for token efficiency
        }

    async def execute_action(self, action: BrowserAction) -> dict:
        """Execute structured browser action."""

        try:
            if action.action == "navigate":
                await self.page.goto(action.url, wait_until="domcontentloaded")
                return {"success": True, "url": self.page.url}

            elif action.action == "click":
                await self.page.click(action.selector, timeout=5000)
                await self.page.wait_for_load_state("networkidle", timeout=5000)
                return {"success": True}

            elif action.action == "type":
                await self.page.fill(action.selector, action.text)
                return {"success": True}

            elif action.action == "scroll":
                direction = action.text or "down"
                distance = 500 if direction == "down" else -500
                await self.page.evaluate(f"window.scrollBy(0, {distance})")
                return {"success": True}

            elif action.action == "extract":
                # Extract text content
                if action.selector:
                    text = await self.page.text_content(action.selector)
                else:
                    text = await self.page.text_content("body")
                return {"success": True, "text": text[:5000]}

            elif action.action == "screenshot":
                # Fall back to vision when needed
                screenshot = await self.page.screenshot(type="png")
                import base64
                return {
                    "success": True,
                    "image": base64.b64encode(screenshot).decode()
                }

        except Exception as e:
            return {"success": False, "error": str(e)}

        return {"success": False, "error": f"Unknown action: {action.action}"}

    async def run_with_llm(self, task: str, llm_client, max_steps: int = 20):
        """
        Run browser task with LLM decision making.
        Uses structured DOM instead of screenshots.
        """

        system_prompt = """You are a browser automation agent. You receive
        page snapshots with interactable elements and decide actions.

        Respond with JSON action:
        - {"action": "navigate", "url": "https://..."}
        - {"action": "click", "selector": "button.submit"}
        - {"action": "type", "selector": "input[name='email']", "text": "..."}
        - {"action": "scroll", "text": "down"}
        - {"action": "extract", "selector": ".results"}
        - {"action": "done", "result": "task completed"}

        Use CSS selectors based on the element info provided.
        Prefer id > name > class > text content for selectors.
        """

        messages = []

        for step in range(max_steps):
            # Get current page state
            snapshot = await self.get_page_snapshot()

            user_message = f"""Task: {task}

            Current page:
            URL: {snapshot['url']}
            Title: {snapshot['title']}

            Interactable elements:
            {snapshot['interactable_elements']}

            What action should I take?"""

            messages.append({"role": "user", "content": user_message})

            # Get LLM decision
            response = llm_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=system_prompt,
                messages=messages
            )

            assistant_text = response.content[0].text
            messages.append({"role": "assistant", "content": assistant_text})

            # Parse and execute
            import json
            action_dict = json.loads(assistant_text)

            if action_dict.get("action") == "done":
                return {"success": True, "result": action_dict.get("result")}

            action = BrowserAction(**action_dict)
            result = await self.execute_action(action)

            if not result.get("success"):
                messages.append({
                    "role": "user",
                    "content": f"Action failed: {result.get('error')}"
                })

            await asyncio.sleep(0.5)  # Rate limit

        return {"success": False, "error": "Max steps reached"}

    async def close(self):
        """Clean up browser."""
        if self.browser:
            await self.browser.close()
        if hasattr(self, 'playwright'):
            await self.playwright.stop()

# Usage
async def main():
    agent = BrowserUseAgent()
    await agent.start(headless=False)

    from anthropic import Anthropic
    result = await agent.run_with_llm(
        "Go to weather.com and find the weather for New York",
        Anthropic()
    )

    print(result)
    await agent.close()

asyncio.run(main())
