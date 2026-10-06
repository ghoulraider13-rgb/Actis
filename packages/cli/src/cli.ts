// Main CLI entry point
import { program } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';
import { createProject, getProjectByPath, getActiveProjects, closeDb, queryEvents, getEventById } from '@actis/core';
import { createWatcher } from '@actis/core';
import { parseNaturalQuery, formatEventsForDisplay, ParsedQuery } from '@actis/core';
import { executeQuery } from './query-cli.js';
import * as chrono from 'chrono-node';

program
  .name('actis')
  .description('Local-first activity ledger for your filesystem')
  .version('0.1.0');

program
  .command('init <name> [path]')
  .description('Initialize a new project to track')
  .action(async (name: string, path?: string) => {
    const projectPath = resolve(path || process.cwd());
    try {
      const existing = await getProjectByPath(projectPath);
      if (existing) {
        console.log(chalk.yellow(`Project already exists at ${projectPath}: ${existing.name}`));
        return;
      }
      const project = await createProject(name, projectPath);
      console.log(chalk.green(`✓ Created project "${project.name}" tracking ${project.root_path}`));
    } catch (error) {
      console.error(chalk.red('Failed to create project:'), error);
      process.exit(1);
    }
  });

program
  .command('watch [path]')
  .description('Start watching a project for changes')
  .option('-d, --debounce <ms>', 'Debounce time in ms', '500')
  .option('--poll', 'Force polling (needed on WSL /mnt paths)')
  .option('--no-poll', 'Disable automatic /mnt polling')
  .option('--poll-interval <ms>', 'Polling interval in ms', '1000')
  .option('--rescan', 'Rescan project on start to catch changes made while watcher was off')
  .action(async (path?: string, options?: any) => {
    const projectPath = resolve(path || process.cwd());
    const project = await getProjectByPath(projectPath);

    if (!project) {
      console.error(chalk.red(`No project found at ${projectPath}. Run 'actis init <name> [path]' first.`));
      process.exit(1);
    }

    const watcher = await createWatcher({
      projectRoot: projectPath,
      debounceMs: parseInt(options?.debounce || '500', 10),
      usePolling: options?.poll === true ? true : options?.poll === false ? false : undefined,
      pollingIntervalMs: parseInt(options?.pollInterval || '1000', 10),
      rescanOnStart: options?.rescan ?? false,
    });

    watcher.start();
    await watcher.whenReady();

    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\nStopping watcher...'));
      await watcher.stop();
      closeDb();
      process.exit(0);
    });

    console.log(chalk.green(`Watching "${project.name}" at ${projectPath}. Press Ctrl+C to stop.`));
  });

program
  .command('query <question>')
  .alias('q')
  .description('Query the activity log using natural language')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-l, --limit <n>', 'Maximum results', '50')
  .option('--since <date>', 'Start time (ISO or natural language)')
  .option('--until <date>', 'End time (ISO or natural language)')
  .option('--json', 'Output as JSON')
  .option('--explain', 'Show how the query was parsed')
  .action(async (question: string, options?: any) => {
    const projectPath = options?.project ? resolve(options.project) : process.cwd();
    let parsed = parseNaturalQuery(question, projectPath);

    // Apply explicit time bounds
    if (options?.since) {
      parsed.since = parseTimeOption(options.since);
    }
    if (options?.until) {
      parsed.until = parseTimeOption(options.until);
    }
    if (options?.limit) {
      parsed.limit = parseInt(options.limit, 10);
    }

    if (options?.explain) {
      console.log(chalk.cyan('\nParsed query:'));
      console.log(JSON.stringify(parsed, null, 2));
      return;
    }

    const result = await executeQuery(parsed, projectPath);

    if (!result.project) {
      console.log(chalk.yellow('No active project found. Run "actis init" first.'));
      return;
    }

    if (options?.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(chalk.cyan(`\nQuery: "${question}"`));
    console.log(chalk.cyan(`Project: ${result.project.name} (${result.project.root_path})`));
    console.log(chalk.cyan(`Results: ${result.total} total\n`));

    if (result.events.length === 0) {
      console.log(chalk.gray('No matching events.'));
      return;
    }

    console.log(formatEventsForDisplay(result.events, result.project.root_path));
  });

function parseTimeOption(value: string): number {
  // Try ISO date first
  const iso = Date.parse(value);
  if (!isNaN(iso)) return iso;

  // Try chrono-node for natural language
  const results = chrono.parse(value);
  if (results.length > 0) {
    return results[0].start.date().getTime();
  }

  // Fallback to current time
  return Date.now();
}

program
  .command('list')
  .description('List all tracked projects')
  .action(async () => {
    const projects = await getActiveProjects();
    if (projects.length === 0) {
      console.log(chalk.gray('No projects tracked yet. Run "actis init <name> [path]" to start.'));
      return;
    }
    console.log(chalk.cyan('\nTracked Projects:'));
    for (const p of projects) {
      console.log(`  ${chalk.green(p.name)} → ${chalk.gray(p.root_path)}`);
    }
    console.log();
  });

program
  .command('show <path>')
  .description('Show detailed history for a specific file')
  .option('-p, --project <path>', 'Project path')
  .option('-n, --limit <n>', 'Number of events', '20')
  .action(async (filePath: string, options?: { project?: string; limit: string }) => {
    const projectPath = options?.project ? resolve(options.project) : process.cwd();
    const project = await getProjectByPath(projectPath);

    if (!project) {
      console.error(chalk.red(`No project found at ${projectPath}`));
      process.exit(1);
    }

    const { events } = await queryEvents(project.id!, {
      path: filePath,
      limit: parseInt(options?.limit || '20', 10),
    });

    if (events.length === 0) {
      console.log(chalk.gray(`No history for ${filePath}`));
      return;
    }

    console.log(chalk.cyan(`\nHistory for ${filePath} in ${project.name}:`));
    for (const event of events) {
      const time = new Date(event.timestamp).toLocaleString();
      console.log(`\n  ${chalk.bold(time)} — ${event.event_type.toUpperCase()}`);
      if (event.diff) {
        console.log(chalk.gray(event.diff.split('\n').slice(0, 20).join('\n')));
        if (event.diff.split('\n').length > 20) {
          console.log(chalk.gray(`  ... (${event.diff.split('\n').length - 20} more lines)`));
        }
      }
    }
  });

// Daemon commands
program
  .command('start [path]')
  .description('Start the actis daemon (background watcher)')
  .option('-d, --debounce <ms>', 'Debounce time in ms', '500')
  .option('--poll', 'Force polling')
  .option('--no-poll', 'Disable polling')
  .option('--poll-interval <ms>', 'Polling interval in ms', '1000')
  .option('--rescan', 'Rescan on start')
  .action(async (path?: string, options?: any) => {
    const projectPath = resolve(path || process.cwd());
    const project = await getProjectByPath(projectPath);

    if (!project) {
      console.error(chalk.red(`No project found at ${projectPath}. Run 'actis init <name> [path]' first.`));
      process.exit(1);
    }

    // TODO: Implement daemon with PID file and logging
    console.log(chalk.yellow('Daemon mode not yet implemented. Use "actis watch" for now.'));
    console.log('See docs/systemd/actis.service and docs/launchd/com.actis.daemon.plist for service files.');
  });

program
  .command('stop')
  .description('Stop the actis daemon')
  .action(async () => {
    console.log(chalk.yellow('Daemon mode not yet implemented.'));
  });

program
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    console.log(chalk.yellow('Daemon mode not yet implemented.'));
  });

program
  .command('summary')
  .description('Show a weekly summary of activity')
  .option('-p, --project <path>', 'Project path')
  .option('-w, --week <n>', 'Weeks ago (0 = this week)', '0')
  .action(async (options?: { project?: string; week?: string }) => {
    const projectPath = options?.project ? resolve(options.project) : process.cwd();
    const project = await getProjectByPath(projectPath);

    if (!project) {
      console.error(chalk.red(`No project found at ${projectPath}`));
      process.exit(1);
    }

    const weekAgo = parseInt(options?.week || '0', 10);
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() - weekAgo * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const { events } = await queryEvents(project.id!, {
      since: weekStart.getTime(),
      until: weekEnd.getTime(),
      limit: 1000,
    });

    if (events.length === 0) {
      console.log(chalk.gray(`No activity in week ${weekAgo === 0 ? 'this' : weekAgo + ' weeks ago'}.`));
      return;
    }

    // Group by day, then by directory
    const byDay = new Map<string, Map<string, { creates: number; modifies: number; deletes: number; renames: number; files: Set<string> }>>();

    for (const event of events) {
      const day = new Date(event.timestamp).toISOString().split('T')[0];
      const dir = event.path.split('/').slice(0, -1).join('/') || '(root)';

      if (!byDay.has(day)) byDay.set(day, new Map());
      const dayMap = byDay.get(day)!;

      if (!dayMap.has(dir)) dayMap.set(dir, { creates: 0, modifies: 0, deletes: 0, renames: 0, files: new Set() });
      const dirStats = dayMap.get(dir)!;

      dirStats.files.add(event.path);
      if (event.event_type === 'create') dirStats.creates++;
      else if (event.event_type === 'modify') dirStats.modifies++;
      else if (event.event_type === 'delete') dirStats.deletes++;
      else if (event.event_type === 'rename') dirStats.renames++;
    }

    console.log(chalk.cyan(`\nWeekly Summary: ${project.name} (${weekAgo === 0 ? 'this week' : weekAgo + ' weeks ago'})`));
    console.log(chalk.cyan(`${weekStart.toLocaleDateString()} - ${new Date(weekEnd.getTime() - 1).toLocaleDateString()}\n`));

    for (const [day, dirMap] of byDay) {
      console.log(chalk.bold(day));
      for (const [dir, stats] of dirMap) {
        const total = stats.creates + stats.modifies + stats.deletes + stats.renames;
        console.log(`  ${dir}: ${total} events (${stats.creates}▲ ${stats.modifies}◆ ${stats.deletes}▼ ${stats.renames}→) across ${stats.files.size} files`);
      }
      console.log();
    }
  });

program
  .command('prune')
  .description('Remove events older than a given duration')
  .option('-p, --project <path>', 'Project path')
  .option('-o, --older-than <duration>', 'Duration (e.g., 30d, 6m, 1y)', '1y')
  .option('--dry-run', 'Show what would be deleted without deleting')
  .action(async (options?: { project?: string; olderThan?: string; dryRun?: boolean }) => {
    console.log(chalk.yellow('Prune command not yet implemented.'));
  });

program
  .command('doctor')
  .description('Diagnose actis installation and configuration')
  .action(async () => {
    console.log(chalk.cyan('\n=== actis doctor ===\n'));

    // Node version
    console.log(chalk.bold('Node.js:'), process.version);
    if (parseInt(process.version.slice(1).split('.')[0]) < 22) {
      console.log(chalk.yellow('  ⚠ Node < 22; better-sqlite3 may not have prebuilds'));
    } else {
      console.log(chalk.green('  ✓ Node >= 22'));
    }

    // DB path
    const { homedir } = await import('os');
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const dbPath = join(homedir(), '.actis', 'ledger.db');
    console.log(chalk.bold('Database:'), dbPath);
    if (existsSync(dbPath)) {
      const stats = await import('fs').then(fs => fs.statSync(dbPath));
      console.log(chalk.green(`  ✓ Exists (${(stats.size / 1024).toFixed(1)} KB)`));
    } else {
      console.log(chalk.yellow('  ⚠ Not found (will be created on first init)'));
    }

    // Platform info
    console.log(chalk.bold('Platform:'), process.platform, process.arch);
    if (process.platform === 'linux' && process.cwd().startsWith('/mnt/')) {
      console.log(chalk.yellow('  ⚠ Running on WSL /mnt; polling will be used'));
    }

    // Projects
    const projects = await getActiveProjects();
    console.log(chalk.bold('Projects:'), projects.length);
    for (const p of projects) {
      console.log(`  - ${p.name} → ${p.root_path}`);
    }

    console.log();
  });

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}