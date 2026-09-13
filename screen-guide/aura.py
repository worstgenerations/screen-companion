"""
Aura Screen Guide - a local screen-watching voice assistant.

Watches your screen, sends changed frames to Google Gemini along with your
goal, and speaks short live guidance out loud through a floating pulsing orb.

Run:  python aura.py
Needs: GEMINI_API_KEY environment variable (get one at https://aistudio.google.com/apikey)
"""

import base64
import io
import math
import os
import queue
import threading
import time
import tkinter as tk

import mss
import pyttsx3
import requests
from PIL import Image

MODEL = "gemini-2.5-flash"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
INTERVAL = 2.0            # seconds between screenshots
CHANGE_THRESHOLD = 2.0    # average pixel difference needed to send a new frame
MAX_WIDTH = 1024          # downscale before sending, keeps cost + latency low

API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()


# ---------------------------------------------------------------- screen ----

def grab_screen():
    with mss.mss() as sct:
        shot = sct.grab(sct.monitors[1])
        img = Image.frombytes("RGB", shot.size, shot.rgb)
    if img.width > MAX_WIDTH:
        ratio = MAX_WIDTH / img.width
        img = img.resize((MAX_WIDTH, int(img.height * ratio)))
    return img


def difference(a, b):
    """Average per-pixel difference between two small grayscale thumbnails."""
    if a is None or b is None:
        return 999.0
    sa = a.convert("L").resize((64, 64))
    sb = b.convert("L").resize((64, 64))
    pa, pb = sa.getdata(), sb.getdata()
    total = sum(abs(x - y) for x, y in zip(pa, pb))
    return total / (64 * 64)


def to_base64_jpeg(img):
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ------------------------------------------------------------------ model ----

SYSTEM = (
    "You are Aura, a live screen guide. You see a screenshot of the user's screen "
    "and their stated goal. Reply with ONE short spoken instruction (max 25 words) "
    "telling them the single next thing to do. No preamble, no markdown, no lists. "
    "If the goal looks complete, say so in a few words. If nothing useful changed, "
    "reply with exactly: SKIP"
)


def ask_gemini(img, goal, last_advice):
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": f"Goal: {goal}\nYour last tip was: {last_advice or 'none'}"},
                    {"inline_data": {"mime_type": "image/jpeg", "data": to_base64_jpeg(img)}},
                ],
            }
        ],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 120},
    }
    r = requests.post(
        API_URL,
        params={"key": API_KEY},
        json=body,
        timeout=60,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Gemini {r.status_code}: {r.text[:300]}")
    data = r.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError):
        return ""


# ------------------------------------------------------------------ voice ----

class Voice:
    def __init__(self):
        self.q = queue.Queue()
        self.speaking = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    def say(self, text):
        self.q.put(text)

    def _loop(self):
        engine = pyttsx3.init()
        engine.setProperty("rate", 180)
        while True:
            text = self.q.get()
            self.speaking.set()
            try:
                engine.say(text)
                engine.runAndWait()
            except Exception:
                pass
            self.speaking.clear()


# -------------------------------------------------------------------- orb ----

class Orb:
    """Frameless always-on-top pulsing circle you can drag around."""

    SIZE = 120

    def __init__(self, root):
        self.root = root
        root.overrideredirect(True)
        root.attributes("-topmost", True)
        root.attributes("-alpha", 0.92)
        root.geometry(f"{self.SIZE}x{self.SIZE}+80+80")
        try:
            root.wm_attributes("-transparentcolor", "black")
        except tk.TclError:
            pass

        self.canvas = tk.Canvas(root, width=self.SIZE, height=self.SIZE,
                                bg="black", highlightthickness=0)
        self.canvas.pack()
        self.phase = 0.0
        self.state = "idle"   # idle | thinking | speaking
        self.tip = ""

        self.canvas.bind("<Button-1>", self._press)
        self.canvas.bind("<B1-Motion>", self._drag)
        self.canvas.bind("<Button-3>", lambda e: root.destroy())
        self._animate()

    def _press(self, e):
        self._dx, self._dy = e.x, e.y

    def _drag(self, e):
        self.root.geometry(f"+{e.x_root - self._dx}+{e.y_root - self._dy}")

    def _color(self):
        return {"idle": "#4c6ef5", "thinking": "#f59f00", "speaking": "#12b886"}[self.state]

    def _animate(self):
        self.phase += 0.12
        self.canvas.delete("all")
        c = self.SIZE / 2
        base = 26 + math.sin(self.phase) * 5
        color = self._color()
        for i, mult in enumerate((2.0, 1.5, 1.0)):
            r = base * mult
            shade = ("#1b2540", "#2b3c6b", color)[i]
            self.canvas.create_oval(c - r, c - r, c + r, c + r, fill=shade, outline="")
        self.root.after(40, self._animate)


# ------------------------------------------------------------------- main ----

def watcher(orb, voice, goal, stop):
    last_img = None
    last_advice = ""
    while not stop.is_set():
        time.sleep(INTERVAL)
        try:
            img = grab_screen()
            if difference(last_img, img) < CHANGE_THRESHOLD:
                continue
            last_img = img
            orb.state = "thinking"
            advice = ask_gemini(img, goal, last_advice)
            orb.state = "idle"
            if not advice or advice.upper().startswith("SKIP"):
                continue
            if advice == last_advice:
                continue
            last_advice = advice
            print(">>", advice)
            orb.state = "speaking"
            voice.say(advice)
            while voice.speaking.is_set() or not voice.q.empty():
                time.sleep(0.1)
            orb.state = "idle"
        except Exception as err:  # keep the loop alive
            orb.state = "idle"
            print("error:", err)
            time.sleep(2)


def main():
    if not API_KEY:
        print("Set GEMINI_API_KEY first. Get a key at https://aistudio.google.com/apikey")
        return
    goal = input("What do you want help with? ").strip() or "Help me with whatever is on screen."

    root = tk.Tk()
    orb = Orb(root)
    voice = Voice()
    voice.say("Aura is watching. I'll guide you.")

    stop = threading.Event()
    threading.Thread(target=watcher, args=(orb, voice, goal, stop), daemon=True).start()
    try:
        root.mainloop()
    finally:
        stop.set()


if __name__ == "__main__":
    main()
