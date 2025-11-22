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

### GitHub Action Setup

Create a workflow file in your repository:
```YAML
    name: Check Forgotten Branches

    on:
      schedule:
        - cron: '0 12 * * 1'
      workflow_dispatch:

    jobs:
      lunda:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v3

          - name: Setup Node.js
            uses: actions/setup-node@v3
            with:
              node-version: '20'

          - name: Install dependencies
            run: npm install @octokit/rest

          - name: Run Lunda
            run: node .github/scripts/checkBranches.js
            env:
              GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
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
