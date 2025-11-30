import { Octokit } from "@octokit/rest";

// Initialize Octokit with the GITHUB_TOKEN from environment variables
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// GitHub gives repo in "owner/repo" format, e.g., "Reconfirmed/Lunda"
const [owner, repo] = (process.env.GITHUB_REPOSITORY as string).split("/");

// Parse the DAYS_THRESHOLD from environment variables, defaulting to 90
const DAYS_THRESHOLD: number = parseInt(process.env.INPUT_DAYS_THRESHOLD || "90", 10);

// Path to the workflow file that calls this action (provided as input)
const WORKFLOW_PATH: string = process.env.INPUT_WORKFLOW_PATH || ".github/workflows/lunda.yml";

// Path to store our tracking data
const TRACKING_FILE = "lunda-tracking.json";

interface BranchEntry {
  name: string;
  lastCommitDate: string;      // ISO date string of last commit
  lastCommitSha: string;       // SHA to detect updates
  mValue: number;              // Days until this branch becomes stale
  calculatedAt: string;        // ISO date when we calculated this m-value
}

interface TrackingData {
  threshold: number;
  branches: BranchEntry[];     // Sorted ascending by mValue (soonest-to-stale first)
  lastFullScan: string;        // ISO date of last full scan
}

interface ForgottenBranch {
  name: string;
  lastCommitDate: string;
  days: number;
}

async function loadTrackingData(): Promise<TrackingData | null> {
  try {
    // Try to fetch from the repo
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: TRACKING_FILE,
    });

    if ("content" in response.data) {
      const content = Buffer.from(response.data.content, "base64").toString("utf-8");
      return JSON.parse(content) as TrackingData;
    }
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 404) {
      console.log("📋 No tracking data found. Will perform initial scan.");
      return null;
    }
    throw err;
  }
  return null;
}

async function saveTrackingData(data: TrackingData): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  const encodedContent = Buffer.from(content).toString("base64");

  let sha: string | undefined;
  try {
    const existing = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: TRACKING_FILE,
    });
    if ("sha" in existing.data) {
      sha = existing.data.sha;
    }
  } catch {
    // File doesn't exist yet, that's fine
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: TRACKING_FILE,
    message: "chore(lunda): update branch tracking data",
    content: encodedContent,
    sha,
  });

  console.log("💾 Tracking data saved.");
}

async function getBranchLastCommit(branchName: string): Promise<{ date: string; sha: string } | null> {
  try {
    const commitsResponse = await octokit.rest.repos.listCommits({
      owner,
      repo,
      sha: branchName,
      per_page: 1,
    });

    if (commitsResponse.data.length === 0) {
      return null;
    }

    const lastCommit = commitsResponse.data[0];
    return {
      date: lastCommit.commit.committer?.date as string,
      sha: lastCommit.sha,
    };
  } catch {
    return null;
  }
}

function calculateMValue(lastCommitDate: string, threshold: number): number {
  const now = new Date();
  const commitDate = new Date(lastCommitDate);
  const daysSinceUpdate = (now.getTime() - commitDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.ceil(threshold - daysSinceUpdate);
}

function calculateNextCronDate(daysFromNow: number): string {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + Math.max(1, daysFromNow)); // At least 1 day from now

  // GitHub cron format: minute hour day month day-of-week
  // We'll schedule for midnight UTC on the target day
  const day = nextDate.getUTCDate();
  const month = nextDate.getUTCMonth() + 1; // 0-indexed to 1-indexed

  return `0 0 ${day} ${month} *`;
}

async function updateWorkflowCron(newCron: string): Promise<void> {
  console.log(`🔄 Updating workflow cron to: ${newCron}`);

  try {
    // Get the current workflow file
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: WORKFLOW_PATH,
    });

    if (!("content" in response.data)) {
      console.error("❌ Could not read workflow file.");
      return;
    }

    const currentContent = Buffer.from(response.data.content, "base64").toString("utf-8");
    const sha = response.data.sha;

    // Update the cron expression in the workflow file
    // Matches patterns like: - cron: '...' or - cron: "..."
    const cronRegex = /(schedule:\s*\n\s*-\s*cron:\s*)(['"])([^'"]+)\2/;

    if (!cronRegex.test(currentContent)) {
      console.log("⚠️ Could not find cron schedule in workflow file. Skipping cron update.");
      return;
    }

    const updatedContent = currentContent.replace(cronRegex, `$1$2${newCron}$2`);

    if (updatedContent === currentContent) {
      console.log("ℹ️ Cron schedule unchanged.");
      return;
    }

    // Commit the updated workflow file
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: WORKFLOW_PATH,
      message: `chore(lunda): schedule next scan for ${newCron}`,
      content: Buffer.from(updatedContent).toString("base64"),
      sha,
    });

    console.log(`✅ Workflow updated. Next run scheduled for cron: ${newCron}`);
  } catch (err) {
    console.error("❌ Failed to update workflow cron:", err);
  }
}

async function getAllBranches(): Promise<string[]> {
  const branches: string[] = [];
  let page = 1;

  while (true) {
    const response = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
      page,
    });

    for (const branch of response.data) {
      // Skip main/master branches
      if (!["main", "master"].includes(branch.name)) {
        branches.push(branch.name);
      }
    }

    if (response.data.length < 100) break;
    page++;
  }

  return branches;
}

async function performInitialScan(): Promise<TrackingData> {
  console.log("🔍 Performing initial full scan of all branches...\n");

  const branchNames = await getAllBranches();
  const now = new Date().toISOString();
  const entries: BranchEntry[] = [];

  for (const branchName of branchNames) {
    const commitInfo = await getBranchLastCommit(branchName);
    if (!commitInfo) {
      console.log(`⚠️ Branch ${branchName} has no commits. Skipping.`);
      continue;
    }

    const mValue = calculateMValue(commitInfo.date, DAYS_THRESHOLD);

    entries.push({
      name: branchName,
      lastCommitDate: commitInfo.date,
      lastCommitSha: commitInfo.sha,
      mValue,
      calculatedAt: now,
    });
  }

  // Sort by mValue ascending (soonest to be stale first)
  entries.sort((a, b) => a.mValue - b.mValue);

  return {
    threshold: DAYS_THRESHOLD,
    branches: entries,
    lastFullScan: now,
  };
}

async function performOptimizedCheck(tracking: TrackingData): Promise<{
  staleBranches: ForgottenBranch[];
  updatedTracking: TrackingData;
}> {
  console.log("🔍 Performing optimized check...\n");

  const staleBranches: ForgottenBranch[] = [];
  const now = new Date();
  const nowIso = now.toISOString();

  // First, check for any new branches not in our list
  const currentBranches = await getAllBranches();
  const trackedNames = new Set(tracking.branches.map((b) => b.name));
  const newBranches = currentBranches.filter((name) => !trackedNames.has(name));

  if (newBranches.length > 0) {
    console.log(`📌 Found ${newBranches.length} new branch(es). Adding to tracking.`);
    for (const branchName of newBranches) {
      const commitInfo = await getBranchLastCommit(branchName);
      if (commitInfo) {
        tracking.branches.push({
          name: branchName,
          lastCommitDate: commitInfo.date,
          lastCommitSha: commitInfo.sha,
          mValue: calculateMValue(commitInfo.date, DAYS_THRESHOLD),
          calculatedAt: nowIso,
        });
      }
    }
  }

  // Remove deleted branches
  const currentBranchSet = new Set(currentBranches);
  tracking.branches = tracking.branches.filter((b) => currentBranchSet.has(b.name));

  // Check the first entry (lowest mValue) - the one that triggered this run
  if (tracking.branches.length === 0) {
    console.log("✨ No branches to track.");
    return { staleBranches: [], updatedTracking: tracking };
  }

  // Sort to ensure correct order after additions
  tracking.branches.sort((a, b) => a.mValue - b.mValue);

  const firstEntry = tracking.branches[0];
  const commitInfo = await getBranchLastCommit(firstEntry.name);

  if (!commitInfo) {
    // Branch might have been deleted between our check and now
    tracking.branches.shift();
  } else if (commitInfo.sha === firstEntry.lastCommitSha) {
    // Branch was NOT updated - it's now stale!
    const daysSinceUpdate = (now.getTime() - new Date(commitInfo.date).getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceUpdate >= DAYS_THRESHOLD) {
      staleBranches.push({
        name: firstEntry.name,
        lastCommitDate: commitInfo.date,
        days: Math.floor(daysSinceUpdate),
      });
      // Remove from tracking (it's been reported)
      tracking.branches.shift();
    }
  } else {
    // Branch WAS updated - recalculate and walk backwards
    console.log(`🔄 Branch ${firstEntry.name} was updated. Walking back through list...`);

    // Update this entry
    firstEntry.lastCommitDate = commitInfo.date;
    firstEntry.lastCommitSha = commitInfo.sha;
    firstEntry.mValue = calculateMValue(commitInfo.date, DAYS_THRESHOLD);
    firstEntry.calculatedAt = nowIso;

    // Walk backwards from the end of the list
    // Stop when we find an entry whose SHA hasn't changed
    let needsResort = true;
    for (let i = tracking.branches.length - 1; i > 0; i--) {
      const entry = tracking.branches[i];
      const currentCommit = await getBranchLastCommit(entry.name);

      if (!currentCommit) {
        // Branch deleted
        tracking.branches.splice(i, 1);
        continue;
      }

      if (currentCommit.sha === entry.lastCommitSha) {
        // This entry hasn't changed, so all previous entries (lower indices)
        // that we haven't checked yet also haven't changed (except for the first one we already updated)
        console.log(`✓ Branch ${entry.name} unchanged. Stopping walk.`);
        needsResort = true;
        break;
      } else {
        // Update this entry
        entry.lastCommitDate = currentCommit.date;
        entry.lastCommitSha = currentCommit.sha;
        entry.mValue = calculateMValue(currentCommit.date, DAYS_THRESHOLD);
        entry.calculatedAt = nowIso;
      }
    }

    if (needsResort) {
      tracking.branches.sort((a, b) => a.mValue - b.mValue);
    }
  }

  return { staleBranches, updatedTracking: tracking };
}

async function run(): Promise<void> {
  console.log("🔍 Lunda is scanning your repository for forgotten branches...\n");
  console.log(`📊 Threshold: ${DAYS_THRESHOLD} days\n`);

  try {
    // Load existing tracking data
    let tracking = await loadTrackingData();

    let staleBranches: ForgottenBranch[] = [];

    if (!tracking || tracking.threshold !== DAYS_THRESHOLD) {
      // First run or threshold changed - do a full scan
      if (tracking && tracking.threshold !== DAYS_THRESHOLD) {
        console.log(`⚠️ Threshold changed from ${tracking.threshold} to ${DAYS_THRESHOLD}. Re-scanning.`);
      }
      tracking = await performInitialScan();

      // Check for any already-stale branches
      const now = new Date();
      staleBranches = tracking.branches
        .filter((b) => b.mValue <= 0)
        .map((b) => ({
          name: b.name,
          lastCommitDate: b.lastCommitDate,
          days: Math.floor((now.getTime() - new Date(b.lastCommitDate).getTime()) / (1000 * 60 * 60 * 24)),
        }));

      // Remove already-stale branches from tracking (they'll be reported)
      tracking.branches = tracking.branches.filter((b) => b.mValue > 0);
    } else {
      // Subsequent run - use optimized check
      const result = await performOptimizedCheck(tracking);
      staleBranches = result.staleBranches;
      tracking = result.updatedTracking;
    }

    // Report stale branches
    if (staleBranches.length > 0) {
      console.log("⚠️ Forgotten branches detected:\n");
      staleBranches.forEach((b) =>
        console.log(`🔸 ${b.name} — last commit ${b.days} days ago (${b.lastCommitDate})`)
      );
      console.log("");
    } else {
      console.log("✨ No forgotten branches found. Your repo is clean!\n");
    }

    // Save updated tracking data
    await saveTrackingData(tracking);

    // Schedule next run
    if (tracking.branches.length > 0) {
      const nextM = tracking.branches[0].mValue;
      const nextCron = calculateNextCronDate(nextM);
      console.log(`\n📅 Next branch will become stale in ${nextM} day(s).`);
      await updateWorkflowCron(nextCron);
    } else {
      console.log("\n📅 No branches to track. Consider running a full scan periodically.");
    }

  } catch (err) {
    console.error("❌ Lunda encountered an error:", err);
    process.exit(1);
  }
}

run();
