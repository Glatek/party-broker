/* eslint-env browser */

export default class Receiver extends EventTarget {
  constructor (roomId) {
    super()

    window.addEventListener('beforeunload', () => {
      this.emitSSE('logoff', {
        from: this.clientId,
        to: this.stationId
      });
    });

    this._mediaDescription = {};

    this.stationId = roomId;
    this.clientId = undefined;

    this.createPeer();
    this.registerSSE();
  }

  set mediaDescription (data) {
    this._mediaDescription = data;
  }

  get stream () {
    return this.streams[0];
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

  async registerSSE () {
    this.eventSource = new EventSource(`/room/${this.stationId}/sse`);

    const id = await new Promise(resolve => this.eventSource.addEventListener('id', e => resolve(JSON.parse(e.data))));

    this.clientId = id;

    this.emitSSE('logon', {
      from: this.clientId,
      to: this.stationId
    });

    this.eventSource.addEventListener('audio-offer', async e => {
      const { to, offer } = JSON.parse(e.data);

      if (to !== this.clientId) {
        return;
      }

      await this.peer.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await this.peer.createAnswer();

      await this.peer.setLocalDescription(answer);

      this.emitSSE('audio-answer', {
        to: this.stationId,
        from: this.clientId,
        answer
      });
    });

    this.eventSource.addEventListener('ice-candidate', e => {
      const { to, candidate } = JSON.parse(e.data);

      if (to === this.clientId) {
        this.peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });
  }

  sendChat (data) {
    this.dispatchEvent(new CustomEvent('chat-send', {
      detail: JSON.stringify(data)
    }));
  }

  createPeer () {
    this.peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        }
      ]
    });

    const chatDataChannel = this.peer.createDataChannel('chat');

    chatDataChannel.addEventListener('open', () => {
      this.addEventListener('chat-send', e => chatDataChannel.send(e.detail));
    });

    this.peer.addEventListener('datachannel', event => {
      console.log(event);

      if (event.channel.label === 'metadata') {
        event.channel.addEventListener('message', event => {
          this.dispatchEvent(new CustomEvent('metadatachange', {
            detail: event.data
          }));
        });
      }

      if (event.channel.label === 'chat') {
        event.channel.addEventListener('message', event => {
          console.log('chatdata', event);
          this.dispatchEvent(new CustomEvent('chat-receive', {
            detail: event.data
          }));
        });
      }
    });

    this.peer.addEventListener('icecandidate', event => {
      const { stationId } = this;

      if (event.candidate) {
        this.emitSSE('ice-candidate', {
          to: stationId,
          from: this.clientId,
          candidate: event.candidate
        });
      }
    });

    this.peer.addEventListener('track', event => {
      this.streams = event.streams;

      document.dispatchEvent(new CustomEvent('receiver:new-song'));
    });
  }

  get mediaDescription () {
    return this._mediaDescription;
  }
}
