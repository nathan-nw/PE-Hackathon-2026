# 🥉 Bronze Tier Verification: CI Automation

**Objective:** Set up GitHub Actions (or similar CI) to run the `pytest` test suite automatically on every single commit.

### Automated Defense Mechanism
To strictly enforce code quality and prevent regressions, we fully automated our testing suite using GitHub Actions. Whenever a commit is pushed or a Pull Request is opened, the CI pipeline is triggered instantly in the cloud. 

The pipeline spins up an isolated testing environment, safely installs all project dependencies (using our lightning-fast `uv` lockfiles), and executes the entire `pytest` directory block by block. If any isolated unit test fails, the CI action flags the commit with a red "X"—acting as an ironclad barrier preventing broken code from ever inadvertently merging or shipping to production. 

### GitHub Action Configurations
The exact automation blueprints are located within the repository's `.github/workflows/` directory:
- **`tests.yml`**: The core workflow that provisions the isolated environment and explicitly runs the `pytest` suite on every commit.
- **`ci.yml`**: Handles broader continuous integration verification tasks (linting, integration steps) upon pushes.

### Pipeline Verification
Below is a visual verification from our repository showing the GitHub Action executing successfully, confirming that our automated defense barrier works and successfully ran the tests.

