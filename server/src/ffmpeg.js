const child_process = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const { createSdpText } = require('./sdp');
const { convertStringToStream } = require('./utils');
const fs = require('fs');

const RECORD_FILE_LOCATION_PATH = process.env.RECORD_FILE_LOCATION_PATH || './files';

module.exports = class FFmpeg {
  constructor (rtpParameters) {
    this._rtpParameters = rtpParameters;
    this._process = undefined;
    this._observer = new EventEmitter();
    this._firstFrameCaptured = false;
    this._lastFrameCaptured = false;
    this._sdpString = createSdpText(this._rtpParameters);
    this._sdpStream = convertStringToStream(this._sdpString);
    this._createProcess();
  }

  _createProcess () {


    console.log('createProcess() [sdpString:%s]', this._sdpString);

    this._process = child_process.spawn('ffmpeg', this._commandArgs);

    if (this._process.stderr) {
      this._process.stderr.setEncoding('utf-8');
      this._process.stderr.on('data', data => console.log('ffmpeg::process::data [data:%o]', data));
    }

    if (this._process.stdout) {
      this._process.stdout.setEncoding('utf-8');
      this._process.stdout.on('data', data => console.log('ffmpeg::process::data [data:%o]', data));
    }

    this._process.on('message', message => console.log('ffmpeg::process::message [message:%o]', message));
    this._process.on('error', error => console.error('ffmpeg::process::error [error:%o]', error));
    this._process.once('close', () => {
      console.log('ffmpeg::process::close');
      this._observer.emit('process-close');
    });

    this._sdpStream.on('error', error => console.error('sdpStream::error [error:%o]', error));

    this._sdpStream.resume();
    this._startFrameCapture();


    this._sdpStream.pipe(this._process.stdin);



  }

  _startFrameCapture() {
    this._captureFrame('00:00:00', `start_frame_${this._rtpParameters.fileName}.jpg`)
        .then(() => {
          this._firstFrameCaptured = true;
          this._checkIfBothFramesCaptured();
        })
        .catch(err => console.error('Error capturing first frame:', err));

    this._observer.once('process-close', async () => {
      await this._captureFrame('00:00:00', `end_frame_${this._rtpParameters.fileName}.jpg`)
          .then(() => {
            this._lastFrameCaptured = true;
            this._checkIfBothFramesCaptured();
          })
          .catch(err => console.error('Error capturing last frame:', err));
    });
  }

  async _captureFrame(time, outputFileName) {
    console.log('captureFrame() [time:%s, outputFileName:%s]', time, outputFileName);

    const outputPath = `${RECORD_FILE_LOCATION_PATH}/${outputFileName}`;
    console.log('Saving frame to:', outputPath);

    return new Promise((resolve, reject) => {
      const args = [
        '-loglevel', 'debug',
        '-protocol_whitelist', 'pipe,udp,rtp',
        '-fflags', '+genpts',
        '-f', 'sdp',
        '-i', 'pipe:0',
        '-ss', time,
        '-frames:v', '1',
        '-q:v', '2',
        outputPath
      ];

      const process = child_process.spawn('ffmpeg', args);


      process.stderr.setEncoding('utf-8');
      process.stderr.on('data', data => console.log('ffmpeg::captureFrame::data [data:%o]', data));

      process.stdout.setEncoding('utf-8');
      process.stdout.on('data', data => console.log('ffmpeg::captureFrame::data [data:%o]', data));

      process.on('error', error => {
        console.error('ffmpeg::captureFrame::error [error:%o]', error);
        reject(error);
      });

      process.once('close', () => {
        console.log('ffmpeg::captureFrame::close');
        resolve();
      });

      this._sdpStream.pipe(process.stdin);
      this._sdpStream.on('error', error => console.error('sdpStream::error [error:%o]', error));

    });
  }

  _checkIfBothFramesCaptured() {
    if (this._firstFrameCaptured && this._lastFrameCaptured) {
      console.log('Both first and last frames captured.');
    }
  }

  kill () {
    console.log('kill() [pid:%d]', this._process.pid);
    this._process.kill('SIGINT');
    this._observer.emit('process-close');
  }

  get _commandArgs () {
    return [
      '-loglevel',
      'debug',
      '-protocol_whitelist',
      'pipe,udp,rtp',
      '-fflags',
      '+genpts',
      '-f',
      'sdp',
      '-i',
      'pipe:0',
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      `${RECORD_FILE_LOCATION_PATH}/${this._rtpParameters.fileName}.webm`
    ];
  }
}