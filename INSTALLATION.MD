# Aquascope

## Overview

Aquascope is a multi-platform application for aquatic data analysis and visualization, featuring:

- **React Native Mobile App**: Android application
- **React Web App**: [aquascope.vercel.app](https://aquascope.vercel.app)
- **Backend**: FastAPI (Python)
- **Database**: Supabase
- **AI Integration**: GROQ AI

---

## Prerequisites

Ensure the following are installed:

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [Python 3.11.11](https://www.python.org/downloads/release/python-3111/)
- [Git](https://git-scm.com/)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)  
    _Install via:_ `npm install -g expo-cli`
- **Moss Classification Model**  
    _(see `/model` directory in project root)_

---

## ⚠️ Important: Python 3.11.11 Required

The backend requires **Python 3.11.11**.  
Some distributions (e.g., Linux Mint) may have Python 3.12 preinstalled.

### Installing Python 3.11.11 on Debian-based Linux
1. **Install build dependencies:**

    ```sh
    sudo apt update
    sudo apt install -y build-essential zlib1g-dev libncurses5-dev libgdbm-dev \
    libnss3-dev libssl-dev libreadline-dev libffi-dev libsqlite3-dev wget
    ```

2. **Download Python 3.11.11 source:**

    ```sh
    wget https://www.python.org/ftp/python/3.11.11/Python-3.11.11.tgz
    ```

3. **Extract and build:**

    ```sh
    tar -xf Python-3.11.11.tgz
    cd Python-3.11.11
    ./configure --enable-optimizations
    make -j$(nproc)
    sudo make altinstall
    ```

4. **Verify installation:**

    ```sh
    python3.11 --version
    ```

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/MizuReal/AquaScope.git
cd AquaScope
```

---

### 2. Backend Setup

#### Create Virtual Environment

- **Linux/macOS:**
    ```bash
    python3.11 -m venv .venv
    ```
- **Windows:**
    ```bash
    python -m venv .venv
    ```

#### Activate Virtual Environment

- **Linux/macOS:**
    ```bash
    source .venv/bin/activate
    ```
- **Windows:**
    ```bash
    .venv\Scripts\activate
    ```

#### Install Python Dependencies

```bash
pip install -r requirements.txt
```

---

### 3. Frontend Setup

#### Mobile App (`/frontend`)

```bash
cd frontend
npm install
```

#### Web App (`/web-react`)

```bash
cd ../web-react
npm install
```
## NOTE: LINUX MINT HAS A PREINSTALLED PYTHON 3.12 .venv should be running as 3.11
# RUN THIS COMMAND
```bash
#To make sure that you're running in 3.11. Do python --version, if not run this:
deactivate
rm -rf .venv
python3.11 -m venv .venv
source .venv/bin/activate
python --version
```
---

## Running the Applications

### 1. Start the Backend

```bash
cd ../backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 2. Start the Mobile App

```bash
cd ../frontend
npx expo start
```

### 3. Start the Web App

```bash
cd ../web-react
npm run dev
```

---

## Additional Notes

- **Environment Variables:**  
    Copy `.env.example` to `.env` in each relevant directory and update values as needed.
- **Database Setup:**  
    Ensure Supabase is configured and credentials are set in the backend `.env` file.
- **Model Files:**  
    Place the moss classification model files in the `/moss_model` directory as required.

---

For troubleshooting or further documentation, refer to the `README.md` or contact the maintainers.
