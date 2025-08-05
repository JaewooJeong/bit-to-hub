#!/usr/bin/env node

import dotenv from 'dotenv';
import { program } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { BitbucketAPI } from './lib/bitbucket.js';
import { GitHubAPI } from './lib/github.js';
import { GitManager } from './lib/git.js';
import { Logger } from './lib/logger.js';

dotenv.config();

class BitToHubMigrator {
  constructor(options = {}) {
    this.logger = new Logger();
    this.dryRun = options.dryRun || process.env.DRY_RUN === 'true';
    this.skipExisting = options.skipExisting !== false && process.env.SKIP_EXISTING !== 'false';
    this.tempDir = options.tempDir || process.env.TEMP_DIR || './temp';
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0
    };

    this.validateEnvironment();
    this.initializeClients();
  }

  validateEnvironment() {
    const required = [
      'BITBUCKET_USERNAME',
      'BITBUCKET_APP_PASSWORD', 
      'BITBUCKET_WORKSPACE',
      'GITHUB_TOKEN',
      'GITHUB_USERNAME'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      this.logger.error(`Missing required environment variables: ${missing.join(', ')}`);
      this.logger.info('Please check your .env file and ensure all variables are set.');
      process.exit(1);
    }
  }

  initializeClients() {
    this.bitbucket = new BitbucketAPI(
      process.env.BITBUCKET_USERNAME,
      process.env.BITBUCKET_APP_PASSWORD,
      process.env.BITBUCKET_WORKSPACE
    );

    this.github = new GitHubAPI(
      process.env.GITHUB_TOKEN,
      process.env.GITHUB_USERNAME,
      process.env.GITHUB_ORG
    );

    this.git = new GitManager(this.tempDir);
  }

  async migrateAll() {
    this.logger.info('🚀 Starting Bitbucket to GitHub migration...');
    this.logger.separator();

    if (this.dryRun) {
      this.logger.warning('DRY RUN MODE - No actual changes will be made');
      this.logger.separator();
    }

    const spinner = ora('Fetching repositories from Bitbucket...').start();

    try {
      const repositories = await this.bitbucket.getAllRepositories();
      spinner.succeed(`Found ${repositories.length} repositories in Bitbucket workspace`);

      this.stats.total = repositories.length;

      for (let i = 0; i < repositories.length; i++) {
        const repo = repositories[i];
        this.logger.progress(`[${i + 1}/${repositories.length}] Processing: ${repo.name}`);

        try {
          await this.migrateRepository(repo);
          this.stats.success++;
        } catch (error) {
          this.logger.error(`Failed to migrate ${repo.name}: ${error.message}`);
          this.stats.failed++;
        }

        this.logger.separator();
      }

      await this.git.cleanupTempDir();
      this.logger.summary(this.stats);

    } catch (error) {
      spinner.fail('Failed to fetch repositories from Bitbucket');
      this.logger.error(error.message);
      process.exit(1);
    }
  }

  async migrateRepository(repo) {
    const exists = await this.github.repositoryExists(repo.name);
    
    if (this.skipExisting && exists) {
      this.logger.warning(`Repository ${repo.name} already exists on GitHub - skipping`);
      this.stats.skipped++;
      return;
    }

    if (this.dryRun) {
      this.logger.info(`[DRY RUN] Would migrate: ${repo.name}`);
      this.logger.info(`  - Description: ${repo.description || 'No description'}`);
      this.logger.info(`  - Private: ${repo.isPrivate ? 'Yes' : 'No'}`);
      this.logger.info(`  - Language: ${repo.language}`);
      return;
    }

    let githubRepo;
    
    if (!exists) {
      const repoSpinner = ora(`Creating ${repo.name} on GitHub...`).start();
      try {
        githubRepo = await this.github.createRepository(repo);
        repoSpinner.succeed(`Created repository: ${githubRepo.fullName}`);
      } catch (error) {
        repoSpinner.fail(`Failed to create ${repo.name}`);
        throw error;
      }
    } else {
      this.logger.info(`Repository ${repo.name} already exists, updating content...`);
      githubRepo = await this.github.getRepository(repo.name);
    }

    const cloneSpinner = ora(`Mirroring repository content...`).start();
    
    try {
      await this.git.mirrorRepository(
        repo.cloneUrl,
        githubRepo.cloneUrl,
        repo.name,
        {
          username: process.env.BITBUCKET_USERNAME,
          password: process.env.BITBUCKET_APP_PASSWORD
        },
        {
          username: process.env.GITHUB_USERNAME,
          token: process.env.GITHUB_TOKEN
        }
      );

      cloneSpinner.succeed(`Successfully mirrored: ${repo.name}`);
      this.logger.success(`✅ Migration completed: ${githubRepo.htmlUrl}`);
    } catch (error) {
      cloneSpinner.fail(`Failed to mirror ${repo.name}`);
      throw error;
    }
  }

  async migrateSpecific(repoNames) {
    this.logger.info(`🎯 Migrating specific repositories: ${repoNames.join(', ')}`);
    this.logger.separator();

    if (this.dryRun) {
      this.logger.warning('DRY RUN MODE - No actual changes will be made');
      this.logger.separator();
    }

    this.stats.total = repoNames.length;

    for (const repoName of repoNames) {
      this.logger.progress(`Processing: ${repoName}`);

      try {
        const repo = await this.bitbucket.getRepository(repoName);
        await this.migrateRepository(repo);
        this.stats.success++;
      } catch (error) {
        this.logger.error(`Failed to migrate ${repoName}: ${error.message}`);
        this.stats.failed++;
      }

      this.logger.separator();
    }

    await this.git.cleanupTempDir();
    this.logger.summary(this.stats);
  }

  async listRepositories() {
    this.logger.info('📋 Listing all repositories in Bitbucket workspace...');
    this.logger.separator();

    const spinner = ora('Fetching repositories...').start();

    try {
      const repositories = await this.bitbucket.getAllRepositories();
      spinner.succeed(`Found ${repositories.length} repositories`);

      repositories.forEach((repo, index) => {
        console.log(`${index + 1}. ${chalk.bold(repo.name)}`);
        console.log(`   ${chalk.gray('Description:')} ${repo.description || 'No description'}`);
        console.log(`   ${chalk.gray('Private:')} ${repo.isPrivate ? 'Yes' : 'No'}`);
        console.log(`   ${chalk.gray('Language:')} ${repo.language}`);
        console.log(`   ${chalk.gray('Updated:')} ${new Date(repo.updatedOn).toLocaleDateString()}`);
        console.log();
      });

    } catch (error) {
      spinner.fail('Failed to fetch repositories');
      this.logger.error(error.message);
      process.exit(1);
    }
  }
}

program
  .name('bit-to-hub')
  .description('Migrate repositories from Bitbucket to GitHub')
  .version('1.0.0');

program
  .command('migrate')
  .description('Migrate all repositories from Bitbucket to GitHub')
  .option('--dry-run', 'Show what would be migrated without making changes')
  .option('--no-skip-existing', 'Do not skip repositories that already exist on GitHub')
  .option('--temp-dir <dir>', 'Temporary directory for cloning repositories')
  .action(async (options) => {
    const migrator = new BitToHubMigrator(options);
    await migrator.migrateAll();
  });

program
  .command('migrate-specific <repos...>')
  .description('Migrate specific repositories by name')
  .option('--dry-run', 'Show what would be migrated without making changes')
  .option('--no-skip-existing', 'Do not skip repositories that already exist on GitHub')
  .option('--temp-dir <dir>', 'Temporary directory for cloning repositories')
  .action(async (repos, options) => {
    const migrator = new BitToHubMigrator(options);
    await migrator.migrateSpecific(repos);
  });

program
  .command('list')
  .description('List all repositories in the Bitbucket workspace')
  .action(async () => {
    const migrator = new BitToHubMigrator();
    await migrator.listRepositories();
  });

program.parse();