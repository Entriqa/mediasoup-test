const child_process = require('child_process');
const { EventEmitter } = require('events');
const { createSdpText } = require('./sdp');
const { convertStringToStream } = require('./utils');
const fs = require('fs');
const { Transform } = require('stream');
const sharp = require('sharp');

const RECORD_FILE_LOCATION_PATH = process.env.RECORD_FILE_LOCATION_PATH || './files';

module.exports = class FFmpeg {
  constructor(rtpParameters) {
    this._rtpParameters = rtpParameters;
    this._videoProcess = undefined;
    this._observer = new EventEmitter();
    this._firstFrameCaptured = false;
    this._lastFrameCaptured = false;
    this._sdpString = createSdpText(this._rtpParameters);
    this._sdpStream = convertStringToStream(this._sdpString);
    this._start();
  }

  async _start() {
    try {
      await this._startVideoRecordingAndFrameDecoding();
      await this._waitForProcessClose();
    } catch (error) {
      console.error('Error during FFmpeg process:', error);
    }
  }

  async _startVideoRecordingAndFrameDecoding() {
    console.log('Starting video recording and frame decoding');
    console.log('FFmpeg arguments:', this._commandArgs);

    return new Promise((resolve, reject) => {
      this._videoProcess = child_process.spawn('ffmpeg', this._commandArgs);

      let stderr = '';
      this._videoProcess.stderr.setEncoding('utf-8');
      this._videoProcess.stderr.on('data', data => {
        stderr += data;
        console.log('ffmpeg::process::data [data:%o]', data);
      });

      const width = 640;
      const height = 480;
      const frameSize = width * height * 3;

      class FrameProcessor extends Transform {
        constructor(rtpParameters, options) {
          super(options);
          this.remainingBuffer = Buffer.alloc(0);
          this.rtpParameters = rtpParameters;
          this.firstFrameCaptured = false;
        }

        async _transform(chunk, encoding, callback) {
          this.remainingBuffer = Buffer.concat([this.remainingBuffer, chunk]);

          while (this.remainingBuffer.length >= frameSize) {
            const frameBuffer = this.remainingBuffer.slice(0, frameSize);
            this.remainingBuffer = this.remainingBuffer.slice(frameSize);

            try {

              if (!this.firstFrameCaptured) {
                await sharp(frameBuffer, { raw: { width, height, channels: 3 } })
                    .jpeg()
                    .toFile(`${RECORD_FILE_LOCATION_PATH}/start_frame_${this.rtpParameters.fileName}.jpg`);
                this.firstFrameCaptured = true;
              }

              await sharp(frameBuffer, { raw: { width, height, channels: 3 } })
                  .jpeg()
                  .toFile(`${RECORD_FILE_LOCATION_PATH}/end_frame_${this.rtpParameters.fileName}.jpg`);
            } catch (err) {
              console.error('Error processing frame:', err);
            }
          }

          callback();
        }
      }

      const frameProcessor = new FrameProcessor(this._rtpParameters);

      this._videoProcess.stdout.pipe(frameProcessor);

      this._videoProcess.on('error', error => {
        console.error('ffmpeg::process::error [error:%o]', error);
        reject(error);
      });

      this._videoProcess.once('close', (code) => {
        console.log('ffmpeg::process::close [code:%o]', code);
        if (code === 0) {
          this._observer.emit('process-close');
          resolve();
        } else {
          console.error('FFmpeg stderr output:', stderr);
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });

      this._sdpStream.pipe(this._videoProcess.stdin);
    });
  }

  _waitForProcessClose() {
    return new Promise((resolve) => {
      this._observer.once('process-close', resolve);
    });
  }

  kill() {
    console.log('kill() [pid:%d]', this._videoProcess?.pid);
    if (this._videoProcess) this._videoProcess.kill('SIGINT');
    this._observer.emit('process-close');
  }

  get _commandArgs() {
    const uniquePort = 5004;
    return [
      '-loglevel', 'debug',
      '-protocol_whitelist', 'pipe,udp,rtp',
      '-fflags', '+genpts',
      '-f', 'sdp',
      '-i', 'pipe:0',
      '-map', '0:v:0',
      '-c:v', 'copy',
      `${RECORD_FILE_LOCATION_PATH}/${this._rtpParameters.fileName}.webm`,
      '-vf', 'fps=1',
      '-f', 'image2pipe',
      '-vcodec', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
      '-rtpflags', `localport=${uniquePort}`
    ];
  }
};
