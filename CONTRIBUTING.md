# Contributing to EdgeLab

Thank you for your interest in contributing to EdgeLab! We welcome community contributions, bug fixes, improvements, and ideas.

EdgeLab is licensed under the GNU Affero General Public License v3.0 only
(AGPL-3.0-only). Contributions accepted into the Project may be distributed
under AGPL-3.0-only. Please read the [LICENSE](LICENSE) before contributing.

## Contributor License Agreement (CLA)

Before we can merge your pull requests, you must accept the [EdgeLab Contributor License Agreement](CLA.md). By submitting a pull request, you agree to the terms outlined in the CLA. The CLA preserves your ownership of your contribution while granting the Project Owner rights to maintain and relicense that contribution, subject to all applicable third-party licenses.

Please review [CLA.md](CLA.md) for full details.

---

## Getting Started

### Prerequisites
- **Node.js**: 22.13.0 or later
- **Python**: 3.12 or later
- **Docker & Docker Compose** (optional, for containerized local dev)

### Setting Up Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/SaiDheerajPeketi/EdgeLab.git
   cd EdgeLab
   ```

2. **Install frontend and root dependencies:**
   ```bash
   npm ci
   ```

3. **Set up Python backend virtual environment:**
   ```bash
   python -m venv backend/.venv
   # On Windows:
   .\backend\.venv\Scripts\activate
   # On macOS/Linux:
   source backend/.venv/bin/activate

   pip install -r backend/requirements.txt
   pip install -r backend/requirements-dev.txt
   ```

4. **Environment variables:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

5. **Run the development servers:**
   ```bash
   npm run dev
   ```
   Or use Docker Compose for an isolated local environment:
   ```bash
   docker compose -f docker-compose.local.yml up --build
   ```

---

## Development Workflow

1. **Create a topic branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make focused, clear changes:**
   - Keep commits focused on a single logical change.
   - Write clear, descriptive commit messages.

3. **Run tests before opening a pull request:**
   ```bash
   # Frontend and documentation checks
   npm run check:docs
   npm run build

   # Backend tests
   PYTHONPATH=backend pytest backend/tests

   # Node unit tests
   npm test
   ```

4. **Submit a Pull Request:**
   - Push your branch to your fork on GitHub.
   - Open a pull request against the `main` branch.
   - Describe the changes made, the problem solved, and how to verify it.
