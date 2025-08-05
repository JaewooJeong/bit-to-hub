import simpleGit from 'simple-git';
import fs from 'fs/promises';
import path from 'path';

export class GitManager {
  constructor(tempDir = './temp') {
    this.tempDir = tempDir;
  }

  async ensureTempDir() {
    try {
      await fs.access(this.tempDir);
    } catch (error) {
      await fs.mkdir(this.tempDir, { recursive: true });
    }
  }

  async cloneRepository(cloneUrl, repoName, username, appPassword) {
    await this.ensureTempDir();
    
    const repoPath = path.join(this.tempDir, repoName);
    
    try {
      await fs.access(repoPath);
      await fs.rm(repoPath, { recursive: true, force: true });
    } catch (error) {
      // Directory doesn't exist, which is fine
    }

    const authenticatedUrl = this.addAuthToUrl(cloneUrl, username, appPassword);
    
    try {
      const git = simpleGit();
      await git.clone(authenticatedUrl, repoPath, ['--bare']);
      return repoPath;
    } catch (error) {
      throw new Error(`Failed to clone repository ${repoName}: ${error.message}`);
    }
  }

  async pushToGitHub(repoPath, githubCloneUrl, githubToken, githubUsername) {
    try {
      const git = simpleGit(repoPath);
      
      const authenticatedGithubUrl = this.addAuthToUrl(githubCloneUrl, githubUsername, githubToken);
      
      await git.addRemote('github', authenticatedGithubUrl);
      
      // Use mirror push for bare repositories
      await git.push('github', '--mirror', ['--force']);
      
    } catch (error) {
      throw new Error(`Failed to push to GitHub: ${error.message}`);
    }
  }

  async mirrorRepository(bitbucketCloneUrl, githubCloneUrl, repoName, bitbucketAuth, githubAuth) {
    let repoPath;
    
    try {
      repoPath = await this.cloneRepository(
        bitbucketCloneUrl, 
        repoName, 
        bitbucketAuth.username, 
        bitbucketAuth.password
      );

      await this.pushToGitHub(
        repoPath, 
        githubCloneUrl, 
        githubAuth.token, 
        githubAuth.username
      );

      return true;
    } catch (error) {
      throw error;
    } finally {
      if (repoPath) {
        try {
          await fs.rm(repoPath, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn(`Warning: Failed to cleanup temp directory ${repoPath}: ${cleanupError.message}`);
        }
      }
    }
  }

  addAuthToUrl(url, username, password) {
    try {
      const urlObj = new URL(url);
      urlObj.username = encodeURIComponent(username);
      urlObj.password = encodeURIComponent(password);
      return urlObj.toString();
    } catch (error) {
      throw new Error(`Invalid URL format: ${url}`);
    }
  }

  async cleanupTempDir() {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Warning: Failed to cleanup temp directory: ${error.message}`);
    }
  }

  async validateRepository(repoPath) {
    try {
      const git = simpleGit(repoPath);
      await git.status();
      return true;
    } catch (error) {
      return false;
    }
  }

  async getRepositoryInfo(repoPath) {
    try {
      const git = simpleGit(repoPath);
      const status = await git.status();
      const branches = await git.branch(['--all']);
      const tags = await git.tag(['--list']);
      
      return {
        isValid: true,
        branches: branches.all,
        tags: tags.split('\n').filter(tag => tag.trim()),
        status: status
      };
    } catch (error) {
      return {
        isValid: false,
        error: error.message
      };
    }
  }
}