/* globals jsmediatags */
/* eslint-env browser */

window.AudioContext = window.AudioContext || window.webkitAudioContext;

function readAsArrayBuffer (file) {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = event => {
      resolve(event.target.result);
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * @returns {Promise<string>}
 */
async function createNewRoom () {
  const response = await fetch('/room/create', { method: 'POST' });
  const json = await response.json();

  return json.roomId;
}

function getMediaTags (file) {
  return new Promise(resolve => {
    // @ts-ignore
    jsmediatags.read(file, {
      onSuccess (response) {
        const tags = response.tags;
        const { artist, title } = tags;
        const image = tags.picture;
        let cover;

        if (image !== undefined) {
          const base64Data = [];

          for (let i = 0; i < image.data.length; i++) {
            base64Data.push(String.fromCharCode(image.data[i]));
          }

          const base64String = btoa(base64Data.join(''));

          cover = `data:${image.format};base64,${base64String}`;
        }

        resolve({
          title,
          artist,
          cover
        });
      },
      onError (error) {
        console.error(':(', error.type, error.info); // eslint-disable-line
        resolve();
      }
    });
  });
}

export default class Station {
  constructor (callback) {
    // Configuraton for peer
    const rtcConfig = {
      iceServers: [
        {
          urls: 'stun:stun.bahnhof.net:3478'
        }
      ]
    };

    const rtcOptionals = {
      optional: [
        {
          RtpDataChannels: true
        }
      ]
    };

    const mediaDescription = {
      title: null,
      artist: null,
      cover: null,
      album: null
    };

    const peers = {};

    let mediaSource;
    let mediaBuffer;
    let remoteDestination;

    this.rtcConfig = rtcConfig;
    this.rtcOptionals = rtcOptionals;
    this._mediaDescription = mediaDescription;
    this._peers = peers;
    this.mediaSource = mediaSource;
    this.mediaBuffer = mediaBuffer;
    this.remoteDestination = remoteDestination;
    this.callback = callback;

    this.events = new EventTarget();

    this.createRoom();
  }

  async createRoom () {
    const roomId = await createNewRoom();

    this.stationId = roomId;

    this.callback({
      name: roomId,
      listenUrl: window.location.protocol + '//' + window.location.host + '/receiver.html?id=' + roomId
    });

    this.registerSSE(roomId);
  }

  start () {
    this.context = new AudioContext();
  }

  addPeer (id, peer) {
    this._peers[id] = peer;

    this.startPlayingIfPossible(peer);
  }

  removePeer (id) {
    if (this._peers[id]) {
      delete this._peers[id];
    }
  }

  get peers () {
    return Object.keys(this._peers).map(key => this._peers[key]);
  }

  emitSSE (type, value) {
    fetch(`/room/${this.stationId}/sse`, {
      method: 'POST',
      body: JSON.stringify({
        type,
        value
      })
    });
  }

  async registerSSE (roomId) {
    this.eventSource = new EventSource(`/room/${roomId}/sse`);

    const id = await new Promise(resolve => this.eventSource.addEventListener('id', e => resolve(JSON.parse(e.data))));

    this.hostPeerId = id;

    this.eventSource.addEventListener('ice-candidate', e => {
      const { to, from, candidate } = JSON.parse(e.data);

      if (to !== this.stationId) {
        return;
      }

      this._peers[from].peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    });

    this.eventSource.addEventListener('audio-answer', e => {
      const { to, from, answer } = JSON.parse(e.data);

      if (to !== this.stationId) {
        return;
      }

      this._peers[from].peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    });

    this.eventSource.addEventListener('logon', e => {
      const data = JSON.parse(e.data);
      const receiverId = data.from;

      const peer = new RTCPeerConnection(this.rtcConfig);
      const metadataDataChannel = peer.createDataChannel('metadata');
      const chatDataChannel = peer.createDataChannel('chat');

      metadataDataChannel.addEventListener('open', () => {
        this.events.addEventListener('metadatachange', () => {
          metadataDataChannel.send(JSON.stringify(this.mediaDescription));
        });
      });

      peer.addEventListener('datachannel', e => {
        if (e.channel.label === 'chat') {
          e.channel.addEventListener('message', e => {
            this.events.dispatchEvent(new CustomEvent('chat', {
              detail: e.data
            }));
          });
        }
      });

      this.events.addEventListener('chat', e => chatDataChannel.send(e.detail));

      peer.addEventListener('negotiationneeded', () => this.receiverOffer(receiver.id));

      peer.addEventListener('icecandidate', event => {
        if (event.candidate) {
          this.emitSSE('ice-candidate', {
            to: receiverId,
            from: this.stationId,
            candidate: event.candidate
          });
        }
      });

      // Add Receiver to object of connected peers
      const receiver = {
        id: receiverId,
        peerConnection: peer,
        chatDataChannel,
        stream: undefined
      };

      this.addPeer(receiverId, receiver);

      console.log(receiverId + ' logged on.');
      console.log('Now broadcasting to ' + Object.keys(this._peers).length + ' listeners.');
    });

    this.eventSource.addEventListener('logoff', e => {
      const data = JSON.parse(e.data);

      delete this._peers[data.from];
    });
  }

  async playAudioFile (file) {
    const songMeta = this.getInfoFromFileName(file.name);
    const newMetadata = await getMediaTags(file);

    this.mediaDescription = {
      title: newMetadata.title || songMeta.title,
      artist: newMetadata.artist || songMeta.artist,
      cover: newMetadata.cover || null
    };

    const arrayBuffer = await readAsArrayBuffer(file);

    this.context.decodeAudioData(arrayBuffer, audioBuffer => {
      // console.debug('[decodeAudioData]');
      if (this.mediaSource) {
        this.mediaSource.stop(0);
      }

      this.mediaBuffer = audioBuffer;
      this.playStream();
    });
  }

  stop () {
    this.stopStream();
  }

  play () {
    this.playStream();
  }

  set mediaDescription (metadata) {
    this._mediaDescription = metadata;

    this.events.dispatchEvent(new CustomEvent('metadatachange', {
      detail: metadata
    }));
  }

  get mediaDescription () {
    return this._mediaDescription;
  }

  getInfoFromFileName (name) {
    name = name === null ? 'Unkown' : name;
    name = name.indexOf('_') !== -1 ? name.replace(/_/g, ' ') : name;

    let artist = 'Unkown';

    if (name.indexOf(' - ') !== -1) {
      name = name.split(' - ');
      artist = name[0];
      name = name[1];
    }

    const titleChunks = name.split('.');

    titleChunks.pop();
    const title = titleChunks.join('.');

    return { artist, title };
  }

  async receiverOffer (receiverId) {
    console.log('receiverOffer', receiverId);
    /** @type {RTCPeerConnection} */
    const peerConnection = this._peers[receiverId].peerConnection;

    const offer = await peerConnection.createOffer();

    await peerConnection.setLocalDescription(offer);

    this.emitSSE('audio-offer', {
      to: receiverId,
      offer
    });
  }

  // checks if media is present and starts streaming media to a connected listener if possible
  startPlayingIfPossible (receiver) {
    if (this.mediaSource && this.remoteDestination) {
      const tracks = this.remoteDestination.stream.getTracks();

      for (const track of tracks) {
        receiver.peerConnection.addTrack(track, this.remoteDestination.stream);
      }

      receiver.stream = this.remoteDestination.stream;
    }
  }

  set detune (value) {
    this.mediaSource.detune.value = value;
  }

  playStream () {
    this.mediaSource = this.context.createBufferSource();
    this.mediaSource.buffer = this.mediaBuffer;
    this.mediaSource.start(0);
    // mediaSource.connect(gainNode);

    // setup remote stream
    this.remoteDestination = this.context.createMediaStreamDestination();
    this.mediaSource.connect(this.remoteDestination);

    // this.remoteDestination.connect(this.context.destination);

    this.peers.forEach(peer => this.startPlayingIfPossible(peer));

    if (this.remoteDestination.stream) {
      document.querySelector('audio').srcObject = this.remoteDestination.stream;
      document.querySelector('audio').play();
    }
  }

  // stops playing the stream and removes the stream from peer connections
  stopStream () {
    this.peers.forEach(peer => {
      if (peer.stream) {
        peer.stream.stop();
        // peer.peerConnection.removeStream(peer.stream);
        // peer.stream = undefined;
      }
    });

    if (this.mediaSource) {
      this.mediaSource.stop(0);
    }
  }
}
