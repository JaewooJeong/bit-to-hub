import axios from 'axios';

export class GitHubAPI {
  constructor(token, username, organization = null) {
    this.token = token;
    this.username = username;
    this.organization = organization;
    this.baseURL = 'https://api.github.com';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    });
  }

  async createRepository(repoData) {
    const owner = this.organization || this.username;
    const url = this.organization ? `/orgs/${this.organization}/repos` : '/user/repos';
    
    const payload = {
      name: repoData.name,
      description: repoData.description || '',
      private: repoData.isPrivate,
      has_issues: repoData.hasIssues,
      has_wiki: repoData.hasWiki,
      auto_init: false
    };

    try {
      const response = await this.client.post(url, payload);
      return {
        name: response.data.name,
        fullName: response.data.full_name,
        cloneUrl: response.data.clone_url,
        sshUrl: response.data.ssh_url,
        htmlUrl: response.data.html_url,
        isPrivate: response.data.private
      };
    } catch (error) {
      if (error.response?.status === 422 && error.response?.data?.errors?.[0]?.message?.includes('already exists')) {
        throw new Error(`Repository ${repoData.name} already exists on GitHub`);
      }
      console.error('GitHub API Error Details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        url: url,
        payload: payload
      });
      throw new Error(`Failed to create repository ${repoData.name}: ${error.response?.status} ${error.response?.statusText || error.message}`);
    }
  }

  async repositoryExists(repoName) {
    const owner = this.organization || this.username;
    
    try {
      await this.client.get(`/repos/${owner}/${repoName}`);
      return true;
    } catch (error) {
      if (error.response?.status === 404) {
        return false;
      }
      throw new Error(`Failed to check if repository exists: ${error.message}`);
    }
  }

  async getRepository(repoName) {
    const owner = this.organization || this.username;
    
    try {
      const response = await this.client.get(`/repos/${owner}/${repoName}`);
      return {
        name: response.data.name,
        fullName: response.data.full_name,
        description: response.data.description,
        isPrivate: response.data.private,
        cloneUrl: response.data.clone_url,
        sshUrl: response.data.ssh_url,
        htmlUrl: response.data.html_url
      };
    } catch (error) {
      throw new Error(`Failed to get repository ${repoName}: ${error.message}`);
    }
  }

  async deleteRepository(repoName) {
    const owner = this.organization || this.username;
    
    try {
      await this.client.delete(`/repos/${owner}/${repoName}`);
      return true;
    } catch (error) {
      throw new Error(`Failed to delete repository ${repoName}: ${error.message}`);
    }
  }

  async updateRepository(repoName, updates) {
    const owner = this.organization || this.username;
    
    try {
      const response = await this.client.patch(`/repos/${owner}/${repoName}`, updates);
      return {
        name: response.data.name,
        fullName: response.data.full_name,
        description: response.data.description,
        isPrivate: response.data.private
      };
    } catch (error) {
      throw new Error(`Failed to update repository ${repoName}: ${error.message}`);
    }
  }

  async getAllRepositories() {
    const repositories = [];
    const owner = this.organization || this.username;
    const url = this.organization ? `/orgs/${owner}/repos` : '/user/repos';
    let page = 1;
    
    try {
      while (true) {
        const response = await this.client.get(`${url}?per_page=100&page=${page}`);
        
        if (response.data.length === 0) break;
        
        repositories.push(...response.data.map(repo => ({
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description || '',
          isPrivate: repo.private,
          cloneUrl: repo.clone_url,
          sshUrl: repo.ssh_url,
          htmlUrl: repo.html_url
        })));
        
        page++;
      }
      
      return repositories;
    } catch (error) {
      throw new Error(`Failed to fetch GitHub repositories: ${error.message}`);
    }
  }
}