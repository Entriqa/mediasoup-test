const { getCodecInfoFromRtpParameters } = require('./utils');

// File to create SDP text from mediasoup RTP Parameters
module.exports.createSdpText = (rtpParameters, videoPortOffset = 0, audioPortOffset = 0) => {
  const { video, audio } = rtpParameters;

  if (!video) {
    throw new Error('Missing video or audio parameters in RTP parameters.');
  }

  // Video codec info
  const videoCodecInfo = getCodecInfoFromRtpParameters('video', video.rtpParameters);
  if (!videoCodecInfo) {
    throw new Error('Invalid video codec info.');
  }

  // Audio codec info
  // const audioCodecInfo = getCodecInfoFromRtpParameters('audio', audio.rtpParameters);
  // if (!audioCodecInfo) {
  //   throw new Error('Invalid audio codec info.');
  // }

  // Adjust ports for multiple processes
  const videoPort = video.remoteRtpPort + videoPortOffset;
  // const audioPort = audio.remoteRtpPort + audioPortOffset;

  return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFmpeg
c=IN IP4 127.0.0.1
t=0 0
m=video ${videoPort} RTP/AVP ${videoCodecInfo.payloadType}
a=rtpmap:${videoCodecInfo.payloadType} ${videoCodecInfo.codecName}/${videoCodecInfo.clockRate}
a=sendonly

`;
};
