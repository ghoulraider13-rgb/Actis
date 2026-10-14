import { resolve } from 'path';
import { getDb, getProjectByPath, getActiveProjects, type Project } from '@actis/core';
import { applyRetention, previewRetention, type RetentionPolicy, type RetentionResult } from '@actis/core';
import chalk from 'chalk';

export interface GcCommandOptions {
  projectPath?: string;
  keepDays?: number;
  keepDiffsDays?: number;
  maxDiffsPerFile?: number;
  dryRun?: boolean;
  json?: boolean;
}

export async function gcCommand(options: GcCommandOptions): Promise<RetentionResult> {
  const { projectPath, keepDays = 365, keepDiffsDays = 90, maxDiffsPerFile, dryRun = false, json = false } = options;

  // Resolve project
  const resolvedPath = projectPath ? resolve(projectPath) : process.cwd();
  let project: Project | undefined;

  try {
    project = await getProjectByPath(resolvedPath);
  } catch {
    project = undefined;
  }

  if (!project) {
    const errorMsg = `No project found at ${resolvedPath}. Run 'actis init <name> [path]' first.`;
    if (json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(errorMsg));
    }
    process.exit(1);
  }

  // Build policy
  const policy: RetentionPolicy = {
    keepDays,
    keepDiffsDays,
    maxDiffsPerFile,
  };

  // Validate policy
  if (keepDays <= 0) {
    const errorMsg = '--keep-days must be a positive number';
    if (json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(errorMsg));
    }
    process.exit(1);
  }

  if (keepDiffsDays <= 0) {
    const errorMsg = '--keep-diffs-days must be a positive number';
    if (json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(errorMsg));
    }
    process.exit(1);
  }

  if (keepDiffsDays > keepDays) {
    const errorMsg = '--keep-diffs-days cannot exceed --keep-days';
    if (json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(errorMsg));
    }
    process.exit(1);
  }

  // Get database
  const db = getDb();

  // Run retention
  let result: RetentionResult = { eventsDeleted: 0, diffsNulledByAge: 0, diffsNulledByCap: 0 };

  if (dryRun) {
    // For dry-run, use previewRetention which does SELECT-only queries
    result = previewRetention(db, project.id!, policy);
  } else {
    result = applyRetention(db, project.id!, policy);
  }

  // Output
  if (json) {
    console.log(JSON.stringify({ ...result, project: { name: project.name, path: project.root_path } }, null, 2));
  } else {
    if (dryRun) {
      console.log(chalk.cyan('\n=== Dry Run (no changes will be made) ===\n'));
    }
    console.log(chalk.cyan(`Project: ${project.name} (${project.root_path})`));
    console.log(chalk.cyan(`Policy: keepDays=${keepDays}, keepDiffsDays=${keepDiffsDays}${maxDiffsPerFile ? `, maxDiffsPerFile=${maxDiffsPerFile}` : ''}`));
    console.log();
    console.log(chalk.green(`Events to delete: ${result.eventsDeleted}`));
    console.log(chalk.yellow(`Diffs to null (by age): ${result.diffsNulledByAge}`));
    if (maxDiffsPerFile) {
      console.log(chalk.yellow(`Diffs to null (by cap): ${result.diffsNulledByCap}`));
    }
    console.log();
    if (dryRun) {
      console.log(chalk.gray('Run without --dry-run to execute.'));
    }
  }

  return result!;
}