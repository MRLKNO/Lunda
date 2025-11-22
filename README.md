# Lunda

With ❤️ from the human and the robot who finally played the symphony

---

Lunda is a lightweight, smart, and friendly GitHub Action tool designed to help developers and security-focused teams detect forgotten branches — branches that haven’t seen activity for a long time and may introduce maintenance or security risks.

---

## 🚀 Features

- Detects inactive branches based on a configurable threshold  
- Ignores main branches (main and master) by default  
- Lists forgotten branches with their last commit date  
- Easy to integrate as a GitHub Action  
- Extensible: notifications (Slack, Teams, email) or auto-cleanup  
- Helps maintain repository hygiene and reduces security risks from stale code  

---

## 🛠️ Usage

Lunda is now an official GitHub Action. You can integrate it directly into your repository workflows.

### Example Workflow

name: Scan Forgotten Branches

on:
  workflow_dispatch: # Run manually
  schedule:
    - cron: '0 12 * * 1' # Every Monday at 12:00

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: your-username/lunda@v1
        with:
          days_threshold: 60 # optional, defaults to 90

### Inputs

- days_threshold (optional) – Number of days a branch can be inactive before being flagged. Default is 90.

Lunda will scan your repository for branches inactive longer than the threshold and list them in the workflow logs.
```

---

## ⚙️ Script Configuration
``` Javascript
    const DAYS_THRESHOLD = 90; // number of inactivity days
```

- Adjust DAYS_THRESHOLD to match your repository’s activity  
- main and master are always ignored  

---

## 📄 License

MIT License

---

With love — and for your repo’s safety — Lunda!
