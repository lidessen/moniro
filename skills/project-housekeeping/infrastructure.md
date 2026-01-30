# Project Infrastructure

Configuration files, build systems, development environments, and tooling setup - the foundation that supports development.

## Table of Contents

- [Configuration Files](#configuration-files)
- [Build System Configuration](#build-system-configuration)
- [CI/CD Configuration](#cicd-configuration)
- [Development Environment](#development-environment)
- [Scripts Organization](#scripts-organization)
- [Tooling Configuration](#tooling-configuration)
- [When to Update vs. Leave Stable](#when-to-update-vs-leave-stable)

## Configuration Files

### Essential Configuration Files

**.gitignore**:
```gitignore
# Dependencies
node_modules/
venv/
target/

# Build outputs
dist/
build/
*.pyc
__pycache__/

# Environment
.env
.env.local

# IDE
.vscode/
.idea/
*.swp

# OS
.DS_Store
Thumbs.db
```

**.editorconfig** (consistent formatting):
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.{js,ts,tsx,json}]
indent_style = space
indent_size = 2

[*.{py,rs}]
indent_style = space
indent_size = 4

[Makefile]
indent_style = tab
```

**.nvmrc** (Node version):
```
18.17.0
```

**pyproject.toml** (Python project metadata):
```toml
[project]
name = "myproject"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.100.0",
]

[tool.black]
line-length = 100

[tool.pytest.ini_options]
testpaths = ["tests"]
```

### Configuration Best Practices

**1. Version control all config** (except secrets)
- `.gitignore` - yes
- `.env.example` - yes
- `.env` - NO (contains secrets)

**2. Provide examples for local config**:
```bash
# .env.example
DATABASE_URL=postgresql://localhost/myapp
API_KEY=your-key-here

# User copies and fills in
cp .env.example .env
```

**3. Document required config** in README

## Build System Configuration

### JavaScript/TypeScript

**package.json scripts**:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "type-check": "tsc --noEmit",
    "format": "prettier --write .",
    "validate": "npm run lint && npm run type-check && npm test"
  }
}
```

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### Python

**setup.py or pyproject.toml**:
```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "myapp"
version = "1.0.0"
dependencies = [
    "fastapi>=0.100.0",
    "uvicorn>=0.23.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "black>=23.0.0",
    "mypy>=1.5.0",
]
```

### Rust

**Cargo.toml**:
```toml
[package]
name = "myapp"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1.32", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }

[dev-dependencies]
criterion = "0.5"

[[bin]]
name = "myapp"
path = "src/main.rs"
```

## CI/CD Configuration

### GitHub Actions

**.github/workflows/ci.yml**:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint
        run: npm run lint
      
      - name: Type check
        run: npm run type-check
      
      - name: Test
        run: npm test
      
      - name: Build
        run: npm run build
```

### GitLab CI

**.gitlab-ci.yml**:
```yaml
stages:
  - lint
  - test
  - build

lint:
  stage: lint
  script:
    - npm ci
    - npm run lint

test:
  stage: test
  script:
    - npm ci
    - npm test

build:
  stage: build
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
```

## Development Environment

### Docker Compose (local development)

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  db:
    image: postgres:14
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      DATABASE_URL: postgresql://user:password@db:5432/myapp
      REDIS_URL: redis://redis:6379
    depends_on:
      - db
      - redis
    command: npm run dev

volumes:
  postgres_data:
```

### Makefile (task runner)

**Makefile**:
```makefile
.PHONY: install dev test build clean

install:
	npm install

dev:
	docker-compose up

test:
	npm test

build:
	npm run build

clean:
	rm -rf dist node_modules

validate: lint type-check test
	@echo "✓ All checks passed"

lint:
	npm run lint

type-check:
	npm run type-check
```

## Scripts Organization

### JavaScript (package.json scripts)

**Organized by category**:
```json
{
  "scripts": {
    "// Development": "",
    "dev": "next dev",
    "dev:debug": "NODE_OPTIONS='--inspect' next dev",
    
    "// Build": "",
    "build": "next build",
    "build:analyze": "ANALYZE=true next build",
    
    "// Test": "",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:e2e": "playwright test",
    
    "// Lint & Format": "",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    
    "// Type Check": "",
    "type-check": "tsc --noEmit",
    
    "// Validation": "",
    "validate": "npm run lint && npm run type-check && npm test",
    
    "// Deploy": "",
    "deploy:staging": "npm run build && deploy-staging.sh",
    "deploy:production": "npm run build && deploy-production.sh"
  }
}
```

### Shell Scripts (scripts/ directory)

**scripts/validate.sh**:
```bash
#!/bin/bash
set -e

echo "Running linter..."
npm run lint

echo "Running type check..."
npm run type-check

echo "Running tests..."
npm test

echo "✓ All checks passed!"
```

**Make executable**:
```bash
chmod +x scripts/validate.sh
```

## Tooling Configuration

### ESLint (JavaScript/TypeScript)

**.eslintrc.js**:
```javascript
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'prettier'  // Disable style rules (Prettier handles)
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'react/react-in-jsx-scope': 'off',  // Next.js doesn't need this
  },
};
```

### Prettier (code formatting)

**.prettierrc**:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

**.prettierignore**:
```
dist
build
node_modules
coverage
```

### TypeScript

**tsconfig.json** (strict):
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### pytest (Python testing)

**pytest.ini**:
```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
addopts = --verbose --cov=src --cov-report=html
```

### Rust (Cargo)

**rust-toolchain.toml**:
```toml
[toolchain]
channel = "1.75.0"
components = ["rustfmt", "clippy"]
```

**. clippy.toml**:
```toml
cognitive-complexity-threshold = 30
```

## When to Update vs. Leave Stable

### Update Immediately

**Security issues**:
- Vulnerabilities in dependencies
- Outdated Node.js/Python/etc. versions with known exploits

**Blocking bugs**:
- Tools don't work
- Configuration breaks builds

### Update Regularly (Monthly/Quarterly)

**Dependencies**:
- CI actions (e.g., actions/checkout)
- Linters (ESLint, Prettier)
- Testing frameworks

**Process**:
- Scheduled dependency updates
- Test in CI before merging

### Leave Stable (If Working)

**Core tooling** that rarely needs updates:
- `.editorconfig` (rarely changes)
- `.gitignore` (add as needed, don't churn)
- Build configs (webpack, vite) if stable

**Principle**: "If it ain't broke, don't fix it"

**But**: Don't let config get too outdated (>1 year without review)

## Best Practices Summary

1. **Version control config** (except secrets)
2. **Provide examples** (.env.example)
3. **Document setup** in README
4. **Organize scripts** logically
5. **Use standard tools** (don't reinvent)
6. **Keep config minimal** (avoid unnecessary complexity)
7. **Test config changes** in CI
8. **Update dependencies** regularly but not compulsively

**Red flags**:
- No `.gitignore` (files committed that shouldn't be)
- No CI configuration (no automated testing)
- Secrets in version control
- Outdated Node/Python versions (>2 years old)
- No documentation for setup process
- Dozens of npm scripts with unclear purpose
