import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// GitHub gives repo in "owner/repo" format, not with dot ;)
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

const DAYS_THRESHOLD = parseInt(process.env.INPUT_DAYS_THRESHOLD) || 90;

async function run() {
  console.log("🔍 Lunda is scanning your repository for forgotten branches...\n");

  const branches = await octokit.rest.repos.listBranches({ owner, repo });
  const now = new Date();
  const forgottenBranches = [];

  for (const branch of branches.data) {

    if (["main", "master"].includes(branch.name)) continue;

    const commits = await octokit.rest.repos.listCommits({
      owner,
      repo,
      sha: branch.name,
      per_page: 1
    });

    const lastCommitDate = new Date(commits.data[0].commit.committer.date);
    const diffDays =
      (now - lastCommitDate) / (1000 * 60 * 60 * 24);

    if (diffDays > DAYS_THRESHOLD) {
      forgottenBranches.push({
        name: branch.name,
        lastCommitDate: commits.data[0].commit.committer.date,
        days: Math.floor(diffDays)
      });
    }
  }

  if (forgottenBranches.length === 0) {
    console.log("✨ No forgotten branches found. Your repo is clean!");
    return;
  }

  console.log("⚠️ Forgotten branches detected:\n");

  forgottenBranches.forEach(b =>
    console.log(`🔸 ${b.name} — last commit ${b.days} days ago (${b.lastCommitDate})`)
  );
}

run().catch(err => {
  console.error("❌ Lunda encountered an error:", err);
  process.exit(1);
});
