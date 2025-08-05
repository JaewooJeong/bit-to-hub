# Bit-to-Hub 🚀

Bitbucket 워크스페이스의 모든 리포지토리를 GitHub로 마이그레이션하는 Node.js 스크립트입니다.

## 주요 기능

- ✅ Bitbucket 워크스페이스의 모든 리포지토리 자동 탐지
- ✅ GitHub에 리포지토리 자동 생성 (개인 계정 또는 조직)
- ✅ 모든 브랜치와 태그를 포함한 완전한 Git 히스토리 마이그레이션
- ✅ 리포지토리 메타데이터 보존 (설명, 프라이빗 설정, 이슈/위키 설정)
- ✅ 중복 처리 (이미 존재하는 리포지토리 건너뛰기)
- ✅ Dry-run 모드 (실제 변경 없이 미리보기)
- ✅ 상세한 로깅 및 진행 상황 표시
- ✅ 특정 리포지토리만 선택적 마이그레이션

## 설치

1. 프로젝트 클론:
```bash
git clone <repository-url>
cd bit-to-hub
```

2. 의존성 설치:
```bash
npm install
```

3. 환경 설정:
```bash
cp .env.example .env
```

## 환경 설정

`.env` 파일에 다음 정보를 입력하세요:

### Bitbucket 설정
```env
BITBUCKET_USERNAME=your-bitbucket-username
BITBUCKET_APP_PASSWORD=your-bitbucket-app-password
BITBUCKET_WORKSPACE=your-workspace-name
```

**Bitbucket App Password 생성 방법:**
1. Bitbucket 설정 → App passwords
2. "Create app password" 클릭
3. 다음 권한 선택:
   - Repositories: Read, Write
   - Account: Read

### GitHub 설정
```env
GITHUB_TOKEN=your-github-personal-access-token
GITHUB_USERNAME=your-github-username

# 조직으로 마이그레이션하는 경우 (선택사항)
GITHUB_ORG=your-github-organization
```

**GitHub Personal Access Token 생성 방법:**
1. GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token" 클릭
3. 다음 권한 선택:
   - `repo` (전체 리포지토리 권한)
   - 조직 사용 시: `admin:org`

### 기타 설정 (선택사항)
```env
DRY_RUN=false          # true로 설정하면 실제 변경 없이 미리보기
SKIP_EXISTING=true     # false로 설정하면 기존 리포지토리도 덮어씀
TEMP_DIR=./temp        # 임시 클론 디렉토리
```

## 사용법

### 1. 리포지토리 목록 확인
```bash
npm run migrate list
```

### 2. 모든 리포지토리 마이그레이션 (Dry-run)
```bash
npm run migrate migrate --dry-run
```

### 3. 모든 리포지토리 마이그레이션
```bash
npm run migrate migrate
```

### 4. 특정 리포지토리만 마이그레이션
```bash
npm run migrate migrate-specific repo1 repo2 repo3
```

## CLI 옵션

### migrate 명령어
- `--dry-run`: 실제 변경 없이 미리보기
- `--no-skip-existing`: 기존 리포지토리도 덮어쓰기
- `--temp-dir <dir>`: 임시 디렉토리 지정

### migrate-specific 명령어
```bash
npm run migrate migrate-specific <repo1> [repo2] [repo3] [...] [options]
```

## 주의사항

⚠️ **마이그레이션 전 확인사항:**

1. **백업**: 중요한 데이터는 사전에 백업하세요
2. **권한**: Bitbucket과 GitHub 모두에 적절한 권한이 있는지 확인하세요
3. **네트워크**: 대용량 리포지토리의 경우 안정적인 네트워크 연결이 필요합니다
4. **API 제한**: GitHub API 제한에 걸릴 수 있으니 너무 많은 리포지토리를 한 번에 마이그레이션하지 마세요

## 트러블슈팅

### 인증 오류
- Bitbucket App Password와 GitHub Token이 올바른지 확인
- 권한 설정이 정확한지 확인

### 네트워크 오류
- 방화벽 설정 확인
- 프록시 환경에서는 추가 설정이 필요할 수 있음

### 리포지토리 크기 문제
- 대용량 리포지토리는 시간이 오래 걸릴 수 있음
- `TEMP_DIR` 경로에 충분한 디스크 공간 확보

## 로그

마이그레이션 로그는 `logs/` 디렉토리에 날짜별로 저장됩니다:
```
logs/migration-2024-01-15.log
```

## 기여

버그 리포트나 기능 제안은 이슈로 등록해 주세요.

## 라이선스

MIT License