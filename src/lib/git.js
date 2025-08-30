import simpleGit from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

export class GitManager {
  constructor(tempDir = './temp', logger = null) {
    this.tempDir = tempDir;
    this.logger = logger;
  }

  log(message) {
    if (this.logger) {
      this.logger.info(message);
    } else {
      console.log(message);
    }
  }

  logWarning(message) {
    if (this.logger) {
      this.logger.warning(message);
    } else {
      console.warn(message);
    }
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
    const authenticatedGithubUrl = this.addAuthToUrl(githubCloneUrl, githubUsername, githubToken);
    
    // 첫 번째 push 시도
    const success = await this.attemptPush(repoPath, authenticatedGithubUrl);
    if (success) {
      return;
    }
    
    // 대용량 파일 문제로 실패한 경우 처리
    this.log('Initial push failed, checking for large files...');
    
    try {
      // 대용량 파일 탐지
      const largeFiles = await this.findLargeFiles(repoPath);
      
      if (largeFiles.length > 0) {
        this.log(`Found ${largeFiles.length} large files:`);
        largeFiles.forEach(file => {
          this.log(`  - ${file.path} (${this.formatFileSize(file.size)})`);
        });
        
        // 대용량 파일 제거
        await this.removeLargeFiles(repoPath, largeFiles);
        
        // Git 정리 작업
        await this.cleanupRepository(repoPath);
        
        // 두 번째 push 시도 (재시도 플래그 전달)
        const retrySuccess = await this.attemptPush(repoPath, authenticatedGithubUrl, true);
        if (retrySuccess) {
          this.log('Successfully pushed after removing large files!');
          return;
        } else {
          throw new Error('Failed to push even after removing large files');
        }
      } else {
        throw new Error('Push failed but no large files found');
      }
    } catch (cleanupError) {
      throw new Error(`Failed to push to GitHub. Cleanup attempt failed: ${cleanupError.message}`);
    }
  }

  async attemptPush(repoPath, authenticatedGithubUrl, isRetry = false) {
    try {
      const git = simpleGit(repoPath);
      
      // GitHub remote 설정
      try {
        await git.removeRemote('github');
      } catch (e) {
        // remote가 없을 수도 있음
      }
      await git.addRemote('github', authenticatedGithubUrl);
      
      // Mirror push
      await git.push('github', '--mirror', ['--force']);
      
      return true;
    } catch (error) {
      const errorMessage = error.message;
      
      // 대용량 파일 에러인지 확인
      if (errorMessage.includes('exceeds GitHub\'s file size limit') || 
          errorMessage.includes('GH001: Large files detected')) {
        
        if (isRetry) {
          // 재시도에서도 실패하면 더 자세한 정보 제공
          this.logWarning('Large file error persists after cleanup. Extracting file names...');
          const fileMatches = errorMessage.match(/File (.+?) is \d+\.\d+ MB/g);
          if (fileMatches) {
            fileMatches.forEach(match => {
              this.logWarning(`Still problematic: ${match}`);
            });
          }
          throw new Error(`Large files still present after cleanup: ${errorMessage}`);
        } else {
          this.log('Detected large file error, attempting to remove large files...');
          return false; // 대용량 파일 문제로 재시도 필요
        }
      }
      
      // 다른 에러는 바로 throw
      throw new Error(`Failed to push to GitHub: ${errorMessage}`);
    }
  }

  async cleanupRepository(repoPath) {
    try {
      const git = simpleGit(repoPath);
      
      this.log('Cleaning up repository...');
      
      // Git 정리 작업
      await git.raw(['reflog', 'expire', '--expire=now', '--all']);
      await git.raw(['gc', '--prune=now', '--aggressive']);
      
      this.log('Repository cleanup completed');
    } catch (error) {
      this.logWarning(`Git cleanup warning: ${error.message}`);
      // cleanup 실패해도 계속 진행
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

  async findLargeFiles(repoPath, sizeLimit = 100 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const largeFiles = [];
      
      // git rev-list --objects --all로 모든 객체를 가져오고 크기를 확인
      const revList = spawn('git', ['rev-list', '--objects', '--all'], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      revList.stdout.on('data', (data) => {
        output += data.toString();
      });

      revList.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error('Failed to list git objects'));
          return;
        }

        const lines = output.split('\n').filter(line => line.trim());
        const filePromises = [];

        for (const line of lines) {
          const [hash, ...pathParts] = line.split(' ');
          if (pathParts.length === 0) continue;
          
          const filePath = pathParts.join(' ');
          
          filePromises.push(
            this.getObjectSize(repoPath, hash).then(size => {
              if (size >= sizeLimit) {
                return { path: filePath, size: size, hash: hash };
              }
              return null;
            }).catch(() => null)
          );
        }

        try {
          const results = await Promise.all(filePromises);
          const validResults = results.filter(result => result !== null);
          resolve(validResults);
        } catch (error) {
          reject(error);
        }
      });

      revList.on('error', (error) => {
        reject(error);
      });
    });
  }

  async getObjectSize(repoPath, hash) {
    return new Promise((resolve, reject) => {
      const catFile = spawn('git', ['cat-file', '-s', hash], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      catFile.stdout.on('data', (data) => {
        output += data.toString();
      });

      catFile.on('close', (code) => {
        if (code === 0) {
          const size = parseInt(output.trim());
          resolve(isNaN(size) ? 0 : size);
        } else {
          resolve(0);
        }
      });

      catFile.on('error', () => {
        resolve(0);
      });
    });
  }

  async removeLargeFiles(repoPath, largeFiles) {
    if (largeFiles.length === 0) {
      return true;
    }

    this.log(`Removing ${largeFiles.length} large files from repository history...`);
    
    const filePaths = largeFiles.map(file => file.path);
    
    return new Promise((resolve, reject) => {
      const args = [
        'filter-repo',
        '--invert-paths',
        '--force'
      ];
      filePaths.forEach(p => args.push('--path', p));

      const filterRepo = spawn('git', args, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';
      filterRepo.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      filterRepo.on('close', (code) => {
        if (code === 0) {
          this.log('Successfully removed large files using git-filter-repo.');
          resolve(true);
        } else {
          this.logWarning('git-filter-repo failed, falling back to git-filter-branch.');
          this.removeLargeFilesWithFilterBranch(repoPath, filePaths)
            .then(resolve)
            .catch(reject);
        }
      });

      filterRepo.on('error', (error) => {
        this.logWarning('git-filter-repo not found, falling back to git-filter-branch.');
        this.removeLargeFilesWithFilterBranch(repoPath, filePaths)
          .then(resolve)
          .catch(reject);
      });
    });
  }

  async removeLargeFilesWithFilterBranch(repoPath, filePaths) {
    const git = simpleGit(repoPath);
    
    try {
      this.log('Starting large file removal with git-filter-branch...');
      
      const rmCommand = filePaths.map(p => `git rm --cached --ignore-unmatch \"${p}\"`).join(' && ');

      await git.raw([
        'filter-branch',
        '--force',
        '--index-filter',
        rmCommand,
        '--prune-empty',
        '--tag-name-filter',
        'cat',
        '--',
        '--all'
      ]);

      this.log('Finished filter-branch. Now cleaning up refs/original/.');

      // refs/original/ 네임스페이스를 완전히 제거합니다.
      // 이를 통해 미러 푸시 시 오래된 참조로 인한 문제를 방지합니다.
      const forEachRef = await git.raw(['for-each-ref', '--format=%(refname)', 'refs/original/']);
      const originalRefs = forEachRef.split('\n').filter(ref => ref.trim() !== '');

      for (const ref of originalRefs) {
        try {
          await git.raw(['update-ref', '-d', ref]);
        } catch (e) {
          this.logWarning(`Could not delete original ref: ${ref}`);
        }
      }
      
      this.log('Successfully removed large files and original refs.');
      return true;

    } catch (error) {
      throw new Error(`Failed to remove large files with filter-branch: ${error.message}`);
    }
  }

  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}