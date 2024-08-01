const child_process = require('child_process');
const { EventEmitter } = require('events');
const { createSdpText } = require('./sdp');
const { convertStringToStream } = require('./utils');
const fs = require('fs');

const RECORD_FILE_LOCATION_PATH = process.env.RECORD_FILE_LOCATION_PATH || './files';

module.exports = class FFmpeg {
  constructor(rtpParameters) {
    this._rtpParameters = rtpParameters;
    this._videoProcess = undefined;
    this._frameProcess = undefined;
    this._observer = new EventEmitter();
    this._firstFrameCaptured = false;
    this._lastFrameCaptured = false;
    this._sdpString = createSdpText(this._rtpParameters);
    this._sdpStream = convertStringToStream(this._sdpString);
    this._start();
  }

  async _start() {
    try {
      await this._captureFirstFrame();
      await this._startVideoRecording();
      await this._waitForProcessClose();
      await this._captureLastFrame();
    } catch (error) {
      console.error('Error during FFmpeg process:', error);
    }
  }

  async _startVideoRecording() {
    console.log('Starting video recording');
    console.log('FFmpeg arguments:', this._commandArgs);

    return new Promise((resolve, reject) => {
      this._videoProcess = child_process.spawn('ffmpeg', this._commandArgs);

      let stderr = '';
      if (this._videoProcess.stderr) {
        this._videoProcess.stderr.setEncoding('utf-8');
        this._videoProcess.stderr.on('data', data => {
          stderr += data;
          console.log('ffmpeg::process::data [data:%o]', data);
        });
      }

      if (this._videoProcess.stdout) {
        this._videoProcess.stdout.setEncoding('utf-8');
        this._videoProcess.stdout.on('data', data => console.log('ffmpeg::process::data [data:%o]', data));
      }

      this._videoProcess.on('message', message => console.log('ffmpeg::process::message [message:%o]', message));
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

      this._sdpStream.on('error', error => console.error('sdpStream::error [error:%o]', error));

      this._sdpStream.resume();
      this._sdpStream.pipe(this._videoProcess.stdin);
    });
  }

  async _waitForProcessClose() {
    return new Promise((resolve) => {
      this._observer.once('process-close', resolve);
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

      this._frameProcess = child_process.spawn('ffmpeg', args);

      let stderr = '';
      this._frameProcess.stderr.setEncoding('utf-8');
      this._frameProcess.stderr.on('data', data => {
        stderr += data;
        console.log('ffmpeg::captureFrame::data [data:%o]', data);
      });

      this._frameProcess.stdout.setEncoding('utf-8');
      this._frameProcess.stdout.on('data', data => console.log('ffmpeg::captureFrame::data [data:%o]', data));

      this._frameProcess.on('error', error => {
        console.error('ffmpeg::captureFrame::error [error:%o]', error);
        reject(error);
      });

      this._frameProcess.once('close', (code) => {
        console.log('ffmpeg::captureFrame::close [code:%o]', code);
        if (code === 0) {
          resolve();
        } else {
          console.error('FFmpeg captureFrame stderr output:', stderr);
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });

      const sdpStreamCopy = convertStringToStream(this._sdpString);
      sdpStreamCopy.pipe(this._frameProcess.stdin);
      sdpStreamCopy.on('error', error => console.error('sdpStream::error [error:%o]', error));
    });
  }

  async _captureFirstFrame() {
    await this._captureFrame('00:00:00', `start_frame_${this._rtpParameters.fileName}.jpg`)
        .then(() => {
          this._firstFrameCaptured = true;
          this._checkIfBothFramesCaptured();
        })
        .catch(err => console.error('Error capturing first frame:', err));
  }

  async _captureLastFrame() {
    await this._captureFrame('00:00:00', `end_frame_${this._rtpParameters.fileName}.jpg`)
        .then(() => {
          this._lastFrameCaptured = true;
          this._checkIfBothFramesCaptured();
        })
        .catch(err => console.error('Error capturing last frame:', err));
  }

  _checkIfBothFramesCaptured() {
    if (this._firstFrameCaptured && this._lastFrameCaptured) {
      console.log('Both first and last frames captured.');
    }
  }

  kill() {
    console.log('kill() [pid:%d]', this._videoProcess.pid);
    this._videoProcess.kill('SIGINT');
    if (this._frameProcess) {
      console.log('kill() frame process [pid:%d]', this._frameProcess.pid);
      this._frameProcess.kill('SIGINT');
    }
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
