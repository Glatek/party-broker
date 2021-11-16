/* eslint-env browser */

export default class ReceiverChat {
  constructor (stationId, clientId, eventSource) {
    this.clientId = clientId;
    this.stationId = stationId;
    this.eventSource = eventSource;
  }

  sendMessage (message) {
    fetch(`/room/${this.stationId}/sse`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'chat',
        data: {
          message,
          from: this.clientId
        }
      })
    });
  }

  onMessage (messageCallback) {
    this.eventSource.addEventListener('chat', e => {
      messageCallback(JSON.parse(e.data));
    });
  }
}
