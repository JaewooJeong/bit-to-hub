import axios from 'axios';

export class BitbucketAPI {
  constructor(username, appPassword, workspace) {
    this.username = username;
    this.appPassword = appPassword;
    this.workspace = workspace;
    this.baseURL = 'https://api.bitbucket.org/2.0';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      auth: {
        username: this.username,
        password: this.appPassword
      },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  async getAllRepositories() {
    const repositories = [];
    let url = `/repositories/${this.workspace}?pagelen=100`;
    
    try {
      while (url) {
        const response = await this.client.get(url);
        const data = response.data;
        
        repositories.push(...data.values);
        
        url = data.next ? new URL(data.next).pathname + new URL(data.next).search : null;
      }
      
      return repositories.map(repo => ({
        name: repo.name,
        slug: repo.slug,
        fullName: repo.full_name,
        description: repo.description || '',
        isPrivate: repo.is_private,
        cloneUrl: repo.links.clone.find(link => link.name === 'https').href,
        language: repo.language || 'Unknown',
        size: repo.size || 0,
        updatedOn: repo.updated_on,
        hasIssues: repo.has_issues,
        hasWiki: repo.has_wiki
      }));
    } catch (error) {
      throw new Error(`Failed to fetch repositories from Bitbucket: ${error.message}`);
    }
  }

  async getRepository(repoName) {
    try {
      const response = await this.client.get(`/repositories/${this.workspace}/${repoName}`);
      const repo = response.data;
      
      return {
        name: repo.name,
        slug: repo.slug,
        fullName: repo.full_name,
        description: repo.description || '',
        isPrivate: repo.is_private,
        cloneUrl: repo.links.clone.find(link => link.name === 'https').href,
        language: repo.language || 'Unknown',
        size: repo.size || 0,
        updatedOn: repo.updated_on,
        hasIssues: repo.has_issues,
        hasWiki: repo.has_wiki
      };
    } catch (error) {
      throw new Error(`Failed to fetch repository ${repoName}: ${error.message}`);
    }
  }

  async getRepositoryBranches(repoName) {
    try {
      const response = await this.client.get(`/repositories/${this.workspace}/${repoName}/refs/branches`);
      return response.data.values.map(branch => ({
        name: branch.name,
        isDefault: branch.name === 'main' || branch.name === 'master'
      }));
    } catch (error) {
      console.warn(`Failed to fetch branches for ${repoName}: ${error.message}`);
      return [{ name: 'main', isDefault: true }];
    }
  }
}