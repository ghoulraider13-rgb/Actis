// Main CLI entry point
import { program } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';
import { createProject, getProjectByPath, getActiveProjects, closeDb, queryEvents, getEventById } from '@actis/core';
import { createWatcher } from '@actis/core';
import { parseNaturalQuery, formatEventsForDisplay, ParsedQuery } from '@actis/core';
import { executeQuery } from './query-cli.js';
import { parseQueryWithLLMFallback, type LLMQueryOptions } from '@actis/core/llm-query';
import { gcCommand } from './gc.js';
import { startDaemon, stopDaemon, getDaemonStatus } from './daemon.js';
import * as chrono from 'chrono-node';

const ACTIS_LOGO = `
${chalk.cyan('  █████╗  ██████╗ ██████╗ ██╗   ██╗██████╗ ███╗   ██╗███████╗')}
${chalk.cyan(' ██╔══██╗██╔════╝██╔═══██╗██║   ██║██╔══██╗████╗  ██║██╔════╝')}
${chalk.cyan(' ███████║██║     ██║   ██║██║   ██║██████╔╝██╔██╗ ██║█████╗  ')}
${chalk.cyan(' ██╔══██║██║     ██║   ██║██║   ██║██╔═══╝ ██║╚██╗██║██╔══╝  ')}
${chalk.cyan(' ██║  ██║╚██████╗╚██████╔╝╚██████╔╝██║     ██║ ╚████║███████╗')}
${chalk.cyan(' ╚═╝  ╚═╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝  ╚═══╝╚══════╝')}
${chalk.gray('        Local-first activity ledger for your filesystem')}${chalk.cyan(' v0.1.0')}
`;

function printBanner() {
  console.log(ACTIS_LOGO);
  console.log();
}

function printSection(title: string) {
  const line = '─'.repeat(Math.max(40, title.length + 4));
  console.log(chalk.cyan(`┌${line}┐`));
  console.log(chalk.cyan(`│  ${chalk.bold(title)}  │`));
  console.log(chalk.cyan(`└${line}┘`));
  console.log();
}

function printKV(label: string, value: string, status?: 'ok' | 'warn' | 'error') {
  const icon = status === 'ok' ? chalk.green('✓') : status === 'warn' ? chalk.yellow('⚠') : status === 'error' ? chalk.red('✗') : '•';
  console.log(`  ${icon} ${chalk.bold(label)}: ${value}`);
}

function printTree(prefix: string, items: string[], lastPrefix = '└─ ') {
  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    const p = isLast ? lastPrefix : '├─ ';
    console.log(`${prefix}${chalk.gray(p)}${item}`);
  });
}

program
  .name('actis')
  .description('Local-first activity ledger for your filesystem')
  .version('0.1.0')
  .hook('preAction', () => printBanner());

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
      printSection('Project Created');
      printKV('Name', project.name, 'ok');
      printKV('Path', project.root_path, 'ok');
      printKV('ID', String(project.id), 'ok');
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
  .option('--daemon', 'Run as background daemon')
  .action(async (path?: string, options?: any) => {
    const projectPath = resolve(path || process.cwd());
    const project = await getProjectByPath(projectPath);

    if (!project) {
      console.error(chalk.red(`No project found at ${projectPath}. Run 'actis init <name> [path]' first.`));
      process.exit(1);
    }

    if (options?.daemon) {
      try {
        const result = await startDaemon({
          projectPath,
          projectName: project.name,
          debounceMs: parseInt(options?.debounce || '500', 10),
          usePolling: options?.poll === true ? true : options?.poll === false ? false : undefined,
          pollingIntervalMs: parseInt(options?.pollInterval || '1000', 10),
          rescanOnStart: options?.rescan ?? false,
        });
        printSection('Daemon Started');
        printKV('PID', String(result.pid), 'ok');
        printKV('Project', project.name, 'ok');
        printKV('Path', projectPath, 'ok');
        return;
      } catch (error) {
        console.error(chalk.red('Failed to start daemon:'), error);
        process.exit(1);
      }
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

    printSection('Watching');
    printKV('Project', project.name, 'ok');
    printKV('Path', projectPath, 'ok');
    printKV('Mode', 'Foreground (Ctrl+C to stop)', 'ok');
    if (options?.poll) printKV('Polling', 'Enabled', 'warn');
    if (options?.rescan) printKV('Rescan on start', 'Yes', 'ok');
    console.log();
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
  .option('--llm', 'Force LLM-based query translation (requires Ollama)')
  .option('--no-llm', 'Force rule-based query translation (default)')
  .action(async (question: string, options?: any) => {
    const projectPath = options?.project ? resolve(options.project) : process.cwd();

    // Determine which parser to use
    const useLLM = options?.llm === true;
    const useRuleParser = options?.llm === false;

    // If neither flag is set, check env var
    let llmEnabled = process.env.ACTIS_LLM_ENABLED === 'true';
    if (useLLM) llmEnabled = true;
    if (useRuleParser) llmEnabled = false;

    const llmOptions: LLMQueryOptions = {
      baseUrl: process.env.ACTIS_OLLAMA_URL || undefined,
      model: process.env.ACTIS_OLLAMA_MODEL || undefined,
      timeout: 5000,
    };

    // Parse with LLM fallback
    const { parsed, usedLLM } = await parseQueryWithLLMFallback(
      question,
      (q) => parseNaturalQuery(q, projectPath),
      llmOptions,
      llmEnabled
    );

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
      if (usedLLM) {
        console.log(chalk.green('\n(Translated via Ollama LLM)'));
      } else {
        console.log(chalk.gray('\n(Translated via rule parser)'));
      }
      return;
    }

    const result = await executeQuery(parsed, projectPath);

    if (!result.project) {
      console.log(chalk.yellow('No active project found. Run "actis init" first.'));
      return;
    }

    if (options?.json) {
      console.log(JSON.stringify({ ...result, usedLLM }, null, 2));
      return;
    }

    printSection('Query Results');
    printKV('Query', `"${question}"`);
    printKV('Project', `${result.project.name} (${result.project.root_path})`);
    printKV('Total Results', String(result.total), 'ok');
    printKV('Mode', usedLLM ? 'LLM (Ollama)' : 'Rule parser', usedLLM ? 'ok' : 'warn');
    console.log();

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
    printSection('Tracked Projects');
    projects.forEach((p, i) => {
      const prefix = i === projects.length - 1 ? '└─ ' : '├─ ';
      console.log(`  ${chalk.gray(prefix)}${chalk.green.bold(p.name)} ${chalk.gray('→')} ${chalk.gray(p.root_path)}`);
    });
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

    printSection(`History for ${filePath}`);
    printKV('Project', project.name, 'ok');
    printKV('Events', String(events.length), 'ok');
    console.log();

    for (const event of events) {
      const time = new Date(event.timestamp).toLocaleString();
      console.log(`\n  ${chalk.bold(time)} — ${event.event_type.toUpperCase()}`);
      if (event.diff) {
        const lines = event.diff.split('\n').slice(0, 20);
        console.log(chalk.gray(lines.join('\n')));
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

    try {
      const result = await startDaemon({
        projectPath,
        projectName: project.name,
        debounceMs: parseInt(options?.debounce || '500', 10),
        usePolling: options?.poll === true ? true : options?.poll === false ? false : undefined,
        pollingIntervalMs: parseInt(options?.pollInterval || '1000', 10),
        rescanOnStart: options?.rescan ?? false,
      });
      printSection('Daemon Started');
      printKV('PID', String(result.pid), 'ok');
      printKV('Project', project.name, 'ok');
      printKV('Path', projectPath, 'ok');
    } catch (error) {
      console.error(chalk.red('Failed to start daemon:'), error);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop the actis daemon')
  .action(async () => {
    const result = await stopDaemon();
    if (result.success) {
      printSection('Daemon Stopped');
      printKV('PID', String(result.pid), 'ok');
      printKV('Status', 'Stopped gracefully', 'ok');
    } else {
      console.error(chalk.red(result.error));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    const status = getDaemonStatus();
    printSection('Daemon Status');
    if (status.running) {
      const uptimeSec = Math.floor((status.uptimeMs || 0) / 1000);
      const hours = Math.floor(uptimeSec / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      const seconds = uptimeSec % 60;
      let uptimeStr = '';
      if (hours > 0) uptimeStr += `${hours}h `;
      if (minutes > 0 || hours > 0) uptimeStr += `${minutes}m `;
      uptimeStr += `${seconds}s`;
      printKV('State', 'RUNNING', 'ok');
      printKV('PID', String(status.pid), 'ok');
      printKV('Project', status.projectName || 'unknown', 'ok');
      printKV('Path', status.projectPath || 'unknown', 'ok');
      printKV('Uptime', uptimeStr.trim(), 'ok');
    } else {
      printKV('State', 'STOPPED', 'warn');
    }
    console.log();
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

    printSection(`Weekly Summary: ${project.name}`);
    printKV('Period', `${weekStart.toLocaleDateString()} - ${new Date(weekEnd.getTime() - 1).toLocaleDateString()}`);
    printKV('Total Events', String(events.length), 'ok');
    console.log();

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
  .command('gc')
  .description('Garbage collect old events and diffs per retention policy')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('--keep-days <n>', 'Delete events older than N days', '365')
  .option('--keep-diffs-days <n>', 'Null out diffs older than N days (but keep events)', '90')
  .option('--max-diffs-per-file <n>', 'Max diffs to keep per file (oldest diffs nulled)')
  .option('--dry-run', 'Show what would be deleted/nulled without doing it')
  .option('--json', 'Output as JSON')
  .action(async (options?: any) => {
    await gcCommand({
      projectPath: options?.project,
      keepDays: options?.keepDays ? parseInt(options.keepDays, 10) : 365,
      keepDiffsDays: options?.keepDiffsDays ? parseInt(options.keepDiffsDays, 10) : 90,
      maxDiffsPerFile: options?.maxDiffsPerFile ? parseInt(options.maxDiffsPerFile, 10) : undefined,
      dryRun: options?.dryRun ?? false,
      json: options?.json ?? false,
    });
  });

program
  .command('doctor')
  .description('Diagnose actis installation and configuration')
  .action(async () => {
    printSection('actis doctor');

    // Node version
    printKV('Node.js', process.version);
    if (parseInt(process.version.slice(1).split('.')[0]) < 22) {
      printKV('Node >= 22', 'No (prebuilds may be missing)', 'warn');
    } else {
      printKV('Node >= 22', 'Yes', 'ok');
    }

    // DB path
    const { homedir } = await import('os');
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const dbPath = join(homedir(), '.actis', 'ledger.db');
    printKV('Database', dbPath);
    if (existsSync(dbPath)) {
      const stats = await import('fs').then(fs => fs.statSync(dbPath));
      printKV('Database Exists', `Yes (${(stats.size / 1024).toFixed(1)} KB)`, 'ok');
    } else {
      printKV('Database Exists', 'No (will be created on first init)', 'warn');
    }

    // Platform info
    printKV('Platform', `${process.platform} ${process.arch}`);
    if (process.platform === 'linux' && process.cwd().startsWith('/mnt/')) {
      printKV('WSL /mnt', 'Detected (polling will be used)', 'warn');
    }

    // Projects
    const projects = await getActiveProjects();
    printKV('Projects Tracked', String(projects.length));
    if (projects.length > 0) {
      projects.forEach((p, i) => {
        const prefix = i === projects.length - 1 ? '└─ ' : '├─ ';
        console.log(`  ${chalk.gray(prefix)}${chalk.green(p.name)} ${chalk.gray('→')} ${chalk.gray(p.root_path)}`);
      });
    }
    console.log();
  });

// When spawned as a `daemon-worker` subprocess, daemon.ts runs the watcher
// directly. In that mode the CLI must not parse argv (commander would reject
// the unknown `daemon-worker` sentinel command).
if (process.argv[2] !== 'daemon-worker') {
  program.parse();

  if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
}