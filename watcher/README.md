# Camera watcher

Runs on the LAN with the NVR. Pushes motion events out to Second Steven.

## Why it runs here and not on the server

Second Steven is a container in Frankfurt. `192.168.100.239` is a private
address on the Batroun LAN — Frankfurt cannot reach it, and making it reachable
would mean forwarding a port to a 16-channel NVR on the open internet. So the
watching happens at home and talks outwards. Nothing dials in.

## Run it

```bash
pip install opencv-python-headless requests numpy

export NVR_PASS='the NVR password'
export CAMERA_TOKEN='the token from Fly secrets'
export CHANNELS=1,2,3,4,5,6,7,8      # start with the ones that matter
python watch.py
```

Channels appear in the console at /cameras the first time each one sees
something. Name them there — alerts then read "Front gate" rather than
"Channel 7".

## Keeping it up (Raspberry Pi)

```ini
# /etc/systemd/system/camwatch.service
[Unit]
Description=Second Steven camera watcher
After=network-online.target

[Service]
Environment=NVR_PASS=...
Environment=CAMERA_TOKEN=...
Environment=CHANNELS=1,2,3,4,5,6,7,8
ExecStart=/usr/bin/python3 /home/pi/camwatch/watch.py
Restart=always
RestartSec=10
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now camwatch
journalctl -u camwatch -f
```

## Tuning

`MOTION_THRESHOLD` is the fraction of the frame that must change. 0.012 suits a
driveway. Raise it if a swaying tree sets it off; lower it if someone walks past
unnoticed. The server rate-limits to one alert per camera per three minutes
regardless, and honours the per-camera quiet hours set in the console.

## Later: person detection instead of motion

Motion is the honest first version — no model, runs on anything. When the Pi is
free, Frigate with a Coral or even CPU YOLO gives `label: "person"` instead of
`label: "motion"`, and the endpoint already accepts it. Point Frigate's webhook
at the same URL with the same bearer token.
