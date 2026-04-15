# Discord Bot with Web Terminal & Auto-Updater

A feature-rich Discord bot built with `discord.js` (v14) that exclusively uses Slash Commands. It includes an auto-updater, a process restarter, and a secure, on-demand web-based terminal routed through Cloudflare Tunnels.

## Features

- **Slash Commands**: Fully migrated to Discord's modern Slash Commands API.
- **Auto-Updater (`/update`)**: Automatically pulls the latest code from GitHub, installs any new `pnpm` dependencies, and restarts the bot.
- **Process Restarter (`/restart`)**: Instantly reboots the bot process.
- **Secure Web Terminal (`/terminal`)**: Spawns a writeable `ttyd` web terminal instance secured by credentials and proxies it through a Cloudflare Quick Tunnel so you can access your server's CLI directly from a browser.
- **Owner-Only Protection**: Sensitive commands are strictly locked to the bot owner's Discord User ID.

## Prerequisites

Before running this bot, ensure you have the following installed on your host machine:

- [Node.js](https://nodejs.org/) (v16.11.0 or newer)
- [pnpm](https://pnpm.io/)
- `git`
- `ttyd` (for the web terminal)
  - macOS: `brew install ttyd`
  - Linux: `sudo apt install ttyd` (or built from source)
- `cloudflared` (for tunneling the terminal)
  - macOS: `brew install cloudflare/cloudflare/cloudflared`
  - Linux: See [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation)

## Setup & Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/NormVg/discord-deploy.git
   cd discord-deploy
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory and add the following:
   ```env
   # Your Discord Bot Token
   DISCORD_TOKEN=your_bot_token_here

   # (Optional) For instant slash command registration during testing
   DISCORD_GUILD_ID=your_server_id_here

   # Your personal Discord User ID to lock down /update, /restart, and /terminal
   OWNER_ID=your_discord_user_id_here

   # Credentials for the web terminal
   TERMINAL_USERNAME=admin
   TERMINAL_PASSWORD=yoursupersecretpassword
   ```

4. **Make the start script executable:**
   ```bash
   chmod +x start.sh
   ```

## Running the Bot

To ensure the bot can automatically restart itself when using `/update` or `/restart`, you must run it using the provided `start.sh` wrapper script:

```bash
pnpm start
```
*(This will execute `./start.sh` which loops `node index.js` so it comes back online if it exits).*

## Commands

| Command | Description | Permission |
| :--- | :--- | :--- |
| `/ping` | Replies with Pong! | Everyone |
| `/update` | Pulls latest code from GitHub, installs deps, and restarts | Owner Only |
| `/restart` | Restarts the bot process | Owner Only |
| `/terminal` | Spawns a secure web terminal session and provides the URL/Login | Owner Only |
| `/closeterminal` | Securely kills the active terminal session | Owner Only |

## Notes

- Global slash commands can take up to an hour to cache on Discord. Set `DISCORD_GUILD_ID` in your `.env` to register them instantly to a specific server.
- The web terminal uses Cloudflare Quick Tunnels (`trycloudflare.com`). The domain may take 5-10 seconds to propagate after the command is run.
