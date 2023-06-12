import argparse
import importlib
import threading as th
import time

import pip


def import_package(package, pip_name=None):
    try:
        importlib.import_module(package)
    except ImportError:
        print(f"Package {package} not found, installing...")
        if pip_name is None:
            pip.main(["install", package])
        else:
            pip.main(["install", pip_name])
        print(f"Package {package} installed, retrying...")
        import_package(package)


import_package("cv2", "opencv-python")
import_package("numpy")
import_package("flask", "Flask")
import_package("flask_cors", "flask-cors")
import_package("gevent.pywsgi", "gevent")
import cv2
import numpy as np
from flask import Flask, Response, request
from flask_cors import CORS
from gevent.pywsgi import WSGIServer

parser = argparse.ArgumentParser(description="Video Server")
parser.add_argument("-p", "--port", type=int, default=10120, help="Running on the given port")
parser.add_argument("-d", "--device", type=int, default=-1, help="Camera device(-1 for auto)")
parser.add_argument("-r", "--res", type=str, default="1280x720", help="Camera resolution")
parser.add_argument("-f", "--fps", type=int, default=30, help="Camera FPS")
parser.add_argument("-q", "--quality", type=int, default=80, help="JPEG quality")
args = parser.parse_args()
video_device = args.device
video_width = int(args.res.split("x")[0])
video_height = int(args.res.split("x")[1])
video_fps = args.fps
quality = args.quality
running = True

if video_device < 0:
    cap = cv2.VideoCapture()
    for i in range(10):
        cap.open(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            video_device = i
            break
else:
    cap = cv2.VideoCapture(int(video_device), cv2.CAP_DSHOW)
if not cap.isOpened():
    print("Cannot open camera, streamer exit")
    exit()
cap.set(cv2.CAP_PROP_FRAME_WIDTH, video_width)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, video_height)
cap.set(cv2.CAP_PROP_FPS, video_fps)
true_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
true_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
true_fps = int(cap.get(cv2.CAP_PROP_FPS))
print(f"Opend camera-{video_device}: {true_width}x{true_height}@{true_fps}fps")

image = np.zeros((true_height, true_width, 3), np.uint8)
image_event = th.Event()


app = Flask(__name__)
CORS(app, supports_credentials=True, allow_headers="*")


def stream_worker():
    global image
    while running:
        status, frame = cap.read()
        if not status:
            continue
        image = frame
        image_event.set()


th.Thread(target=stream_worker, daemon=True).start()


def get_stream():
    while running:
        image_event.wait()
        image_event.clear()
        frame = image.copy()
        data = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])[1]
        yield (b"Content-Type: data/jpeg\r\n\r\n" + data.tobytes() + b"\r\n\r\n--frame\r\n")


def get_snapshot():
    image_event.wait()
    image_event.clear()
    frame = image.copy()
    data = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])[1]
    return data.tobytes()


@app.route("/")
def index():
    action = request.args.get("action", None)
    if action == "stream":
        return Response(get_stream(), mimetype="multipart/x-mixed-replace; boundary=frame")
    elif action == "snapshot":
        return Response(get_snapshot(), mimetype="image/jpeg")
    return Response("Server online", status=200)


@app.route("/stream")
def http_stream():
    return Response(get_stream(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/snapshot")
def http_snapshot():
    return Response(get_snapshot(), mimetype="image/jpeg")


@app.route("/config")
def http_config():
    res = request.args.get("res", None)
    fps = request.args.get("fps", None)
    quality = request.args.get("quality", None)
    if not any([res, fps, quality]):
        return Response("No config provided, available: res, fps, quality", status=400)
    if res is not None:
        global video_width, video_height
        video_width = int(res.split("x")[0])
        video_height = int(res.split("x")[1])
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, video_width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, video_height)
    if fps is not None:
        global video_fps
        video_fps = int(fps)
        cap.set(cv2.CAP_PROP_FPS, video_fps)
    global true_height, true_width, true_fps
    true_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    true_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    true_fps = int(cap.get(cv2.CAP_PROP_FPS))
    if quality is not None:
        global video_quality
        video_quality = int(quality)
    text = f"New config: {true_width}x{true_height}@{true_fps}fps, quality={video_quality}"
    print(text)
    return Response(text, status=200)


print(f"Running streamer on port {args.port}")
# server = WSGIServer(("0.0.0.0", args.port), app)
# server.serve_forever()
app.run(host="0.0.0.0", port=args.port, debug=False, threaded=True)
cap.release()
running = False
