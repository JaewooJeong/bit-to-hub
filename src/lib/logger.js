import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

export class Logger {
  constructor(logDir = './logs') {
    this.logDir = logDir;
    this.logFile = path.join(logDir, `migration-${new Date().toISOString().split('T')[0]}.log`);
    this.ensureLogDir();
  }

  async ensureLogDir() {
    try {
      await fs.access(this.logDir);
    } catch (error) {
      await fs.mkdir(this.logDir, { recursive: true });
    }
  }

  async writeToFile(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}\n`;
    
    try {
      await fs.appendFile(this.logFile, logEntry);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  info(message) {
    console.log(chalk.blue('ℹ'), message);
    this.writeToFile('info', message);
  }

  success(message) {
    console.log(chalk.green('✓'), message);
    this.writeToFile('success', message);
  }

  warning(message) {
    console.log(chalk.yellow('⚠'), message);
    this.writeToFile('warning', message);
  }

  error(message) {
    console.log(chalk.red('✗'), message);
    this.writeToFile('error', message);
  }

  progress(message) {
    console.log(chalk.cyan('→'), message);
    this.writeToFile('progress', message);
  }

  debug(message) {
    if (process.env.DEBUG === 'true') {
      console.log(chalk.gray('🐛'), message);
      this.writeToFile('debug', message);
    }
  }

  separator() {
    const line = '─'.repeat(50);
    console.log(chalk.gray(line));
    this.writeToFile('info', line);
  }

  summary(stats) {
    this.separator();
    console.log(chalk.bold('\n📊 Migration Summary:'));
    console.log(`${chalk.green('✓')} Successfully migrated: ${stats.success}`);
    console.log(`${chalk.yellow('⚠')} Skipped: ${stats.skipped}`);
    console.log(`${chalk.red('✗')} Failed: ${stats.failed}`);
    console.log(`${chalk.blue('ℹ')} Total repositories: ${stats.total}`);
    this.separator();

    const summaryText = `Migration Summary - Success: ${stats.success}, Skipped: ${stats.skipped}, Failed: ${stats.failed}, Total: ${stats.total}`;
    this.writeToFile('summary', summaryText);
  }
}