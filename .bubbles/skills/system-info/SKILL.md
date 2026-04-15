---
name: system-info
description: Gather system information like OS, CPU, RAM, disk usage, network, and running processes. Use when the user asks about the machine's status or specs.
---

# System Info Skill

## When to use
Use this skill when the user asks about:
- System specs (CPU, RAM, OS)
- Disk usage or free space
- Running processes
- Network info (IP, interfaces)
- System uptime

## Commands

### Basic system info
```bash
uname -a          # OS and kernel
sw_vers           # macOS version (macOS only)
sysctl -n machdep.cpu.brand_string  # CPU name (macOS)
sysctl -n hw.memsize               # Total RAM in bytes (macOS)
```

### Disk usage
```bash
df -h             # Disk usage (human readable)
du -sh ~/Desktop  # Size of a specific directory
```

### Running processes
```bash
ps aux --sort=-%mem | head -20   # Top 20 by memory
ps aux --sort=-%cpu | head -20   # Top 20 by CPU
```

### Network
```bash
ifconfig | grep "inet "    # IP addresses
curl -s ifconfig.me        # Public IP
```

### Uptime
```bash
uptime
```

## Response format
Present results in a clean, concise format. Use code blocks for raw output. Summarize key metrics (e.g. "8 GB RAM, 45% disk used").
