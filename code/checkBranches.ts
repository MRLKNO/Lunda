import { Octokit } from "@octokit/rest";

// Initialize Octokit with the GITHUB_TOKEN from environment variables
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// GitHub gives repo in "owner/repo" format, e.g., "Reconfirmed/Lunda"
const [owner, repo] = (process.env.GITHUB_REPOSITORY as string).split("/");

// Parse the DAYS_THRESHOLD from environment variables, defaulting to 90
const DAYS_THRESHOLD: number = parseInt(process.env.INPUT_DAYS_THRESHOLD || "90", 10);

interface ForgottenBranch {
  name: string;
  lastCommitDate: string;
  days: number;
}

async function run(): Promise<void> {
  console.log("🔍 Lunda is scanning your repository for forgotten branches...\n");

  try {
    // 1. Get all branches
    const branchesResponse = await octokit.rest.repos.listBranches({ owner, repo });
    const branches = branchesResponse.data;
    const now = new Date();
    const forgottenBranches: ForgottenBranch[] = [];

    // 2. Iterate through branches
    for (const branch of branches) {
      // Skip main/master branches
      if (["main", "master"].includes(branch.name)) continue;

      // 3. Get the last commit for the branch
      const commitsResponse = await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: branch.name,
        per_page: 1
      });

      // Check if there are any commits
      if (commitsResponse.data.length === 0) {
        console.log(`⚠️ Branch ${branch.name} has no commits. Skipping.`);
        continue;
      }

      const lastCommit = commitsResponse.data[0];
      const lastCommitDate = new Date(lastCommit.commit.committer?.date as string);

      // 4. Calculate the difference in days
      const diffDays = (now.getTime() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24);

      // 5. Check if the branch is forgotten
      if (diffDays > DAYS_THRESHOLD) {
        forgottenBranches.push({
          name: branch.name,
          lastCommitDate: lastCommit.commit.committer?.date as string,
          days: Math.floor(diffDays)
        });
      }
    }

    // 6. Report results
    if (forgottenBranches.length === 0) {
      console.log("✨ No forgotten branches found. Your repo is clean!");
      return;
    }

    console.log("⚠️ Forgotten branches detected:\n");

    forgottenBranches.forEach(b =>
      console.log(`🔸 ${b.name} — last commit ${b.days} days ago (${b.lastCommitDate})`)
    );

  } catch (err) {
    console.error("❌ Lunda encountered an error:", err);
    // Exit with a non-zero code to indicate failure in a CI/CD environment
    process.exit(1);
  }
}

run();
