# Aquascope

## Scope

- **React Native Mobile**: Android mobile application
- **React Website**: https://aquascope.vercel.app

- **DATABASE:SUPABASE**
- **GROQ AI**

## MUST HAVE
- NODEJS
- PYTHON 3.11
- MODEL FOR MOSS CLASSIFICATION (CHECK /MODEL IN ROOT DIRECTORY)

## Installation
### BACKEND SETUP
```bash
python -m venv .venv
```

**Activation:**
- Windows: `.venv/Scripts/Activate`
- Linux: `.venv/bin/activate
```bash
#Inside .venv run this:
pip install -r requirements.txt
```

### FRONTEND SETUP
```bash
#nagivate to /frontend (mobile)
npm install
```
```bash
#naviage to /web-react (website)
npm install
```

## Run Setup
```bash
#/frontend
npx expo start
```
```bash
#/web-react
npm run dev
```
```bash
#/backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```