# Screen Companion

# Screen Guide

A little "Siri on a call" style assistant: it watches your screen (a screenshot every ~2

seconds), sends what changed to Claude along with your stated goal, and speaks short live

guidance out loud through a floating pulsing orb on your screen.

## 1. Install Python

If you don't already have it: get Python 3.10+ from https://www.python.org/downloads/

During install, check **"Add Python to PATH"**.

## 2. Get an Anthropic API key

This is different from your claude.ai login.

1. Go to https://console.anthropic.com and sign in / sign up.

2. Add a small amount of credit (a few dollars covers a lot of screenshots — each call is

   small and cheap).

3. Go to **API Keys** → **Create Key**, and copy it somewhere safe. It looks like

   `sk-ant-...`. You'll paste this into the app when it starts — it's never saved to disk.

## 3. Install dependencies

Open a terminal (Command Prompt or PowerShell) in this folder and run:

```

pip install -r requirements.txt

```

## 4. Run it

```

python app.py

```

- It'll ask for your API key, then what you want guidance on (e.g. "help me install Docker

  Desktop").

- A small glowing orb appears in the bottom-right corner of your screen:

  - **Slow blue/purple pulse** = idle, watching

  - **Faster purple/pink pulse** = thinking about what it just saw

  - **Cyan/purple energetic pulse** = speaking to you

- Drag the orb anywhere with left-click. **Right-click it to quit.**

## Notes / things you can tune

- `SCREENSHOT_INTERVAL_SEC` in `app.py` — how often it checks your screen (default 2s).

- `CHANGE_THRESHOLD` — how much the screen needs to change before it bothers asking Claude

  again (keeps costs down and avoids rambling commentary on a static screen).

- `MODEL` — which Claude model to use.

- Voice comes from Windows' built-in text-to-speech (via `pyttsx3`), so no extra API or cost

  for the speaking part — only the vision calls to Claude use your API credit.

## Cost estimate

Each screenshot call is a small image + a short reply — typically a fraction of a cent per

call. Since it skips sending when nothing on screen changed, an average session should cost

well under a dollar unless you're staring at something constantly changing (like a video).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/708b8c27-b3ff-4c6f-8700-8c9aae80c749).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
