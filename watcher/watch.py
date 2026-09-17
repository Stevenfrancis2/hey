#!/usr/bin/env python3
"""
Camera watcher for Steven's TVT NVR. Runs on his LAN — a Pi, or the PC.

Second Steven lives in Frankfurt and cannot reach 192.168.100.239, so the
direction is fixed by the network: this watches at home and pushes outwards.
Nothing ever dials into the house, no port is forwarded, and if this machine is
off the only thing lost is the alerting.

Sub streams on purpose. Sixteen main streams exceed the NVR's outbound budget —
that is what blanked the cells in NVMS — and a person is perfectly detectable at
sub-stream resolution.

    pip install opencv-python-headless requests numpy
    python watch.py
"""
import base64
import os
import time
from datetime import datetime

import cv2
import numpy as np
import requests

NVR = os.environ.get("NVR_HOST", "192.168.100.239")
USER = os.environ.get("NVR_USER", "admin")
PASS = os.environ["NVR_PASS"]
CHANNELS = [int(c) for c in os.environ.get("CHANNELS", "1,2,3,4,5,6,7,8").split(",")]

ENDPOINT = os.environ.get("ENDPOINT", "https://second-steven.fly.dev/camera/event")
TOKEN = os.environ["CAMERA_TOKEN"]

# How different a frame has to be before it counts as something happening.
# Tuned for a driveway: a swaying tree is under this, a person walking is well over.
MOTION_THRESHOLD = float(os.environ.get("MOTION_THRESHOLD", "0.012"))
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "2"))
# The server also rate limits, but not sending is cheaper than being ignored.
COOLDOWN_SECONDS = 150


def url(channel: int) -> str:
    return f"rtsp://{USER}:{PASS}@{NVR}:554/chID={channel}&streamType=sub"


def grab(channel: int):
    """One frame. Opened and closed each time so a dropped stream cannot wedge us."""
    cap = cv2.VideoCapture(url(channel), cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    try:
        ok, frame = cap.read()
        return frame if ok else None
    finally:
        cap.release()


def changed(prev, cur) -> float:
    """Fraction of the frame that moved. Blurred first so noise and rain do not count."""
    a = cv2.GaussianBlur(cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY), (21, 21), 0)
    b = cv2.GaussianBlur(cv2.cvtColor(cur, cv2.COLOR_BGR2GRAY), (21, 21), 0)
    diff = cv2.absdiff(a, b)
    _, mask = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
    return float(np.count_nonzero(mask)) / mask.size


def send(channel: int, frame, score: float) -> None:
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
    if not ok:
        return
    try:
        r = requests.post(
            ENDPOINT,
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={
                "channel": channel,
                "label": "motion",
                "confidence": round(min(score * 8, 0.99), 3),
                "snapshot": base64.b64encode(buf.tobytes()).decode(),
            },
            timeout=20,
        )
        print(f"{datetime.now():%H:%M:%S} ch{channel} {score:.3f} -> {r.status_code} {r.text[:60]}")
    except Exception as e:
        # A dropped push must never stop the watching.
        print(f"{datetime.now():%H:%M:%S} ch{channel} push failed: {e}")


def main() -> None:
    print(f"watching channels {CHANNELS} on {NVR}, pushing to {ENDPOINT}")
    last_frame: dict[int, np.ndarray] = {}
    last_sent: dict[int, float] = {}

    while True:
        for ch in CHANNELS:
            frame = grab(ch)
            if frame is None:
                continue
            prev = last_frame.get(ch)
            last_frame[ch] = frame
            if prev is None:
                continue

            score = changed(prev, frame)
            if score < MOTION_THRESHOLD:
                continue
            if time.time() - last_sent.get(ch, 0) < COOLDOWN_SECONDS:
                continue

            last_sent[ch] = time.time()
            send(ch, frame, score)

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
