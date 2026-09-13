# Aura Screen Guide (runs on your own computer)

A floating pulsing orb that watches your screen and talks you through what to do next.
It uses **Google Gemini** (generous free tier) — no Claude key needed.

## 1. Install Python

Python 3.10+ from https://www.python.org/downloads/ — tick **"Add Python to PATH"**.

## 2. Get a free Gemini API key

Go to https://aistudio.google.com/apikey, sign in with Google, click **Create API key**, copy it.

## 3. Install the bits

Open a terminal in this folder and run:

```
pip install -r requirements.txt
```

## 4. Add your key

Windows (PowerShell):

```
setx GEMINI_API_KEY "your-key-here"
```

Then close and reopen the terminal.

Mac/Linux:

```
export GEMINI_API_KEY="your-key-here"
```

## 5. Run it

```
python aura.py
```

Type what you're trying to do, press Enter. The orb appears — drag it anywhere,
right-click it to quit.

## How it behaves

- Takes a screenshot every ~2 seconds and only sends it when the screen actually changed.
- Speaks one short next step at a time using your system's built-in voice (free).
- Orb colour: blue = watching, amber = thinking, green = speaking.

## Cost

Gemini Flash has a free daily quota that covers normal sessions. Speech is local and free.

## Privacy

Screenshots go only to Google's Gemini API and are never saved to disk.
