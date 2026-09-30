// Main CLI entry point
import { program } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';
import { createProject, getProjectByPath, getActiveProjects, closeDb, queryEvents } from './db.js';
import { createWatcher } from './watcher.js';
import { parseNaturalQuery, executeQuery, formatEventsForDisplay } from './query.js';
program
    .name('actis')
    .description('Local-first activity ledger for your filesystem')
    .version('0.1.0');
program
    .command('init <name> [path]')
    .description('Initialize a new project to track')
    .action(async (name, path) => {
    const projectPath = resolve(path || process.cwd());
    try {
        const existing = await getProjectByPath(projectPath);
        if (existing) {
            console.log(chalk.yellow(`Project already exists at ${projectPath}: ${existing.name}`));
            return;
        }
        const project = await createProject(name, projectPath);
        console.log(chalk.green(`✓ Created project "${project.name}" tracking ${project.root_path}`));
    }
    catch (error) {
        console.error(chalk.red('Failed to create project:'), error);
        process.exit(1);
    }
});
program
    .command('watch [path]')
    .description('Start watching a project for changes')
    .option('-d, --debounce <ms>', 'Debounce time in ms', '500')
    .action(async (path, options) => {
    const projectPath = resolve(path || process.cwd());
    const project = await getProjectByPath(projectPath);
    if (!project) {
        console.error(chalk.red(`No project found at ${projectPath}. Run 'actis init <name> [path]' first.`));
        process.exit(1);
    }
    const watcher = await createWatcher({
        projectRoot: projectPath,
        debounceMs: parseInt(options?.debounce || '500', 10),
    });
    watcher.start();
    // Handle graceful shutdown
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
    .action(async (question, options) => {
    const projectPath = options?.project ? resolve(options.project) : process.cwd();
    const parsed = parseNaturalQuery(question, projectPath);
    parsed.limit = parseInt(options?.limit || '50', 10);
    const result = await executeQuery(parsed);
    if (!result.project) {
        console.log(chalk.yellow('No active project found. Run "actis init" first.'));
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
    .action(async (filePath, options) => {
    const projectPath = options?.project ? resolve(options.project) : process.cwd();
    const project = await getProjectByPath(projectPath);
    if (!project) {
        console.error(chalk.red(`No project found at ${projectPath}`));
        process.exit(1);
    }
    const { events } = await queryEvents(project.id, {
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
program.parse();
// If no command provided, show help
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
//# sourceMappingURL=cli.js.map