import * as ws from './ws.mjs';
import * as kb from './kb.mjs';
import * as mouse from './mouse.mjs';

new Vue({
  el: '#app',
  data: {
    // serviceHost: '10.0.0.235',
    serviceHost: location.hostname,
    streamSrc: '',
    $channel: null,
    isKeyCaptureActive: false,
    isPointorLocked: false,
    mouseMoveSlice: [0, 0],
    mouseAbsPos: [0, 0],
    mouseAbsChanged: false,
    activeDialog: '',
    pasteContent: '',
    screenWidth: 0,
    screenHeight: 0,
    keyAltPressed: false,
    keyCtrlPressed: false,
    toolbarVisible: true,
  },
  mounted() {
    this.init();
  },
  methods: {
    async init() {
      try {
        const config = await this.fetchConfig();
        document.title = config.app_title;

        const streamOk = await this.pingStream(config.video.stream_port);
        if (!streamOk) {
          throw new Error(
            'Video stream is not ready, please check mjpeg process'
          );
        }
        this.$channel = await ws.init(
          `ws://${this.serviceHost}:${config.listen_port}/websocket`
        );
        this.bindKeyHandler();
        this.bindMouseHandler();

        this.streamSrc = `http://${this.serviceHost}:${config.video.stream_port}/?action=stream`;
        const res = config.video.res // string like '1280x720'
        this.screenWidth = parseInt(res.split('x')[0])
        this.screenHeight = parseInt(res.split('x')[1])
      } catch (e) {
        alert(e.toString());
      }
    },
    async pingStream(port) {
      try {
        const pingRes = await fetch(`http://${this.serviceHost}:${port}/?action=snapshot`);
        return pingRes.status === 200;
      } catch (e) {
        return false;
      }
    },
    async fetchConfig() {
      try {
        const res = await fetch('/api/config');
        return res.json();
      } catch (e) {
        return null;
      }
    },
    bindKeyHandler() {
      document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Control') {
          this.keyCtrlPressed = true;
        }
        if (evt.key === 'Alt') {
          this.keyAltPressed = true;
        }
        if (!this.isKeyCaptureActive) {
          if (evt.key === 'Enter' && !this.activeDialog) {
            this.setScreenFocus(true);
          }
          return;
        }

        evt.preventDefault();

        if (evt.repeat) {
          return;
        }

        if (evt.key === 'Escape' && evt.shiftKey) {
          this.setScreenFocus(false);
          return;
        }
        kb.sendEvent(this.$channel, evt.key, 'keydown');
      });

      document.addEventListener('keyup', (evt) => {
        if (evt.key === 'Control') {
          this.keyCtrlPressed = false;
        }
        if (evt.key === 'Alt') {
          this.keyAltPressed = false;
        }
        if (!this.isKeyCaptureActive) {
          return;
        }
        kb.sendEvent(this.$channel, evt.key, 'keyup');
      });
    },
    bindMouseHandler() {
      const mouseMoveSlice = this.mouseMoveSlice;


      document.addEventListener('pointerlockchange', (evt) => {
        this.isPointorLocked =
          document.pointerLockElement &&
          document.pointerLockElement.classList.contains('screen');
        mouse.sendEvent(this.$channel, '', 'reset');
      });

      window.setInterval(() => {
        if (mouseMoveSlice[0] !== 0 || mouseMoveSlice[1] !== 0) {
          mouse.sendEvent(this.$channel, mouseMoveSlice, 'move');
          mouseMoveSlice[0] = 0;
          mouseMoveSlice[1] = 0;
        }
        if (this.mouseAbsChanged) {
          mouse.sendEvent(this.$channel, this.mouseAbsPos, 'abs');
          this.mouseAbsChanged = false;
        }
      }, 60);

      mouse.sendEvent(this.$channel, 1, 'config-move-factor');
    },
    onScreenBlur() {
      this.isKeyCaptureActive = false;
      if (this.isPointorLocked) {
        this.setPointerLock(false);
      }
      kb.sendEvent(this.$channel, '', 'reset');
      this.toolbarVisible = true;
    },
    onScreenFocus() {
      this.setDialog();
      this.isKeyCaptureActive = true;
      kb.sendEvent(this.$channel, '', 'reset');
      setTimeout(() => {
        if (this.isKeyCaptureActive) {
          this.toolbarVisible = false;
        }
      }, 2000);
    },
    setScreenFocus(bool) {
      const screen = document.querySelector('.screen');
      screen[bool ? 'focus' : 'blur']();
      // if (bool) {
      //   setTimeout(() => {
      //     this.toolbarVisible = false;
      //   }, 1000);
      // }else{
      //   this.toolbarVisible = true;
      // }
    },
    setPointerLock(bool) {
      const screen = document.querySelector('.screen');
      if (bool) {
        try {
          this.setDialog();
          screen.requestPointerLock();
        } catch (e) { }
      } else {
        document.exitPointerLock();
      }
    },
    onScreenMouseMove(evt) {
      if (!this.isKeyCaptureActive) {
        return;
      }
      // get absolute position
      this.mouseAbsPos[0] = evt.clientX;
      this.mouseAbsPos[1] = evt.clientY;
      // get window size
      const winWidth = window.innerWidth;
      const winHeight = window.innerHeight;
      // notice: screen is in the top of window
      const screenRatio = this.screenWidth / this.screenHeight;
      const winRatio = winWidth / winHeight;
      // calc Y
      if (winHeight > this.screenHeight) {
        // black border on bottom
        this.mouseAbsPos[1] = Math.floor(this.mouseAbsPos[1] / this.screenHeight * 0x7fff)
        if (this.mouseAbsPos[1] > 0x7fff) {
          this.mouseAbsPos[1] = 0x7fff
        }
      } else if (winRatio < screenRatio) {
        // black border on bottom
        const blackHeight = winHeight - winWidth / screenRatio
        if (this.mouseAbsPos[1] > winHeight - blackHeight) {
          this.mouseAbsPos[1] = winHeight - blackHeight
        }
        this.mouseAbsPos[1] = Math.floor((this.mouseAbsPos[1]) / (winHeight - blackHeight) * 0x7fff)
      } else {
        this.mouseAbsPos[1] = Math.floor((this.mouseAbsPos[1]) / (winHeight) * 0x7fff)
      }
      // calc X
      if (winRatio > screenRatio) {
        var blackWidth = 0
        if (winHeight > this.screenHeight) {
          blackWidth = winWidth - this.screenHeight * screenRatio
        }
        else {
          blackWidth = winWidth - winHeight * screenRatio
        }
        this.mouseAbsPos[0] -= blackWidth / 2
        if (this.mouseAbsPos[0] < 0) {
          this.mouseAbsPos[0] = 0
        }
        this.mouseAbsPos[0] = Math.floor((this.mouseAbsPos[0]) / (winWidth - blackWidth) * 0x7fff)
        if (this.mouseAbsPos[0] > 0x7fff) {
          this.mouseAbsPos[0] = 0x7fff
        }
      } else {
        this.mouseAbsPos[0] = Math.floor((this.mouseAbsPos[0]) / (winWidth) * 0x7fff)
      }

      if (!this.isPointorLocked) {
        this.mouseAbsChanged = true;
        return;
      }
      this.mouseMoveSlice[0] += evt.movementX;
      this.mouseMoveSlice[1] += evt.movementY;
    },
    onScreenMouseDown(evt) {
      if (!this.isKeyCaptureActive) {
        this.setScreenFocus(true);
        return;
      }
      evt.preventDefault();
      if (!this.isPointorLocked && this.keyCtrlPressed && this.keyAltPressed) {
        if (evt.button === 0) {
          this.setPointerLock(true);
        }
        return;
      }
      mouse.sendEvent(this.$channel, evt.button, 'mousedown');
    },
    onScreenMouseUp(evt) {
      if (!this.isKeyCaptureActive) {
        return;
      }
      evt.preventDefault();
      mouse.sendEvent(this.$channel, evt.button, 'mouseup');
    },
    onScreenMouseWheel(evt) {
      if (!this.isKeyCaptureActive) {
        return;
      }
      evt.preventDefault();
      mouse.sendEvent(this.$channel, evt.wheelDeltaY, 'wheel');
    },
    doRemotePaste() {
      kb.sendSequence(this.$channel, this.pasteContent);
      this.pasteContent = '';
    },
    setDialog(name) {
      if (name) {
        this.setPointerLock(false);
        this.setScreenFocus(false);
        this.activeDialog = name;
      } else {
        this.activeDialog = '';
      }
    },
  },
});
