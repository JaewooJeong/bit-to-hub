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
      // git filter-repo를 사용하여 대용량 파일들을 제거
      const filterRepo = spawn('git', [
        'filter-repo',
        '--path-glob',
        `!(${filePaths.join('|')})`,
        '--force'
      ], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';
      filterRepo.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      filterRepo.on('close', (code) => {
        if (code === 0) {
          this.log('Successfully removed large files from repository history');
          resolve(true);
        } else {
          // git filter-repo가 없으면 git filter-branch 사용
          this.removeLargeFilesWithFilterBranch(repoPath, filePaths)
            .then(resolve)
            .catch(reject);
        }
      });

      filterRepo.on('error', (error) => {
        // git filter-repo가 설치되지 않은 경우 filter-branch로 fallback
        this.removeLargeFilesWithFilterBranch(repoPath, filePaths)
          .then(resolve)
          .catch(reject);
      });
    });
  }

  async removeLargeFilesWithFilterBranch(repoPath, filePaths) {
    const git = simpleGit(repoPath);
    
    try {
      this.log('Starting comprehensive large file removal...');
      
      for (const filePath of filePaths) {
        this.log(`Removing ${filePath} from repository history...`);
        
        try {
          // Step 1: git filter-branch로 파일 제거
          await git.raw([
            'filter-branch',
            '--force',
            '--index-filter',
            `git rm --cached --ignore-unmatch "${filePath}"`,
            '--prune-empty',
            '--tag-name-filter',
            'cat',
            '--',
            '--all'
          ]);
          
          // Step 2: 모든 브랜치에서 파일 제거 확인
          const branches = await git.branch(['-a']);
          for (const branch of branches.all) {
            if (branch.startsWith('remotes/') || branch === 'HEAD') continue;
            
            try {
              await git.checkout(branch);
              await git.raw(['rm', '--cached', '--ignore-unmatch', filePath]);
            } catch (e) {
              // 브랜치에 파일이 없을 수 있음
            }
          }
          
          this.log(`Successfully removed ${filePath}`);
        } catch (error) {
          this.logWarning(`Failed to remove ${filePath}: ${error.message}`);
        }
      }
      
      // Step 3: 강력한 정리 작업
      try {
        // 모든 참조 제거
        await git.raw(['for-each-ref', '--format=delete %(refname)', 'refs/original/']);
        
        // reflog 완전 정리
        await git.raw(['reflog', 'expire', '--expire=now', '--all']);
        
        // 가비지 컬렉션 (더 강력하게)
        await git.raw(['gc', '--prune=now', '--aggressive']);
        
        // 압축되지 않은 객체 정리
        await git.raw(['repack', '-ad']);
        
        this.log('Completed comprehensive repository cleanup');
      } catch (cleanupError) {
        this.logWarning(`Cleanup warning: ${cleanupError.message}`);
      }
      
      return true;
    } catch (error) {
      throw new Error(`Failed to remove large files: ${error.message}`);
    }
  }

  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}