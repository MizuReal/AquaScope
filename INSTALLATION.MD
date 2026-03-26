# Aquascope

## Overview

Aquascope is a multi-platform application for aquatic data analysis and visualization, featuring:

- **React Native Mobile App**: Android application
- **React Web App**: [https://aquascope.vercel.app](https://aquascope.vercel.app)
- **Backend**: FastAPI (Python)
- **Database**: Supabase
- **AI Integration**: GROQ AI

---

## Prerequisites

Ensure the following are installed on your system:

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [Python 3.11](https://www.python.org/downloads/release/python-3110/)
- [Git](https://git-scm.com/)
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (`npm install -g expo-cli`)
- **Moss Classification Model** (see `/model` directory in project root)

---

## Installation

### 1. Clone the Repository

```bash
git clone <REPO_URL>
cd aquascope
```

---

### 2. Backend Setup

#### Create and Activate Virtual Environment

```bash
python -m venv .venv
```

- **Windows:**  
    ```bash
    .venv\Scripts\activate
    ```
- **Linux/macOS:**  
    ```bash
    source .venv/bin/activate
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
    Place the moss classification model files in the `/model` directory as required.

---

For troubleshooting or further documentation, refer to the `README.md` or contact the maintainers.