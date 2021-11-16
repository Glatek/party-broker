/* eslint-env browser */

import Receiver from './receiver.js';
import { $, $$ } from './fake-jquery.js';

import 'https://cdn.skypack.dev/audio-visualiser';

window.AudioContext = window.AudioContext || window.webkitAudioContext;

let receiver;

function getStation () {
  const params = new URLSearchParams(document.location.search);

  return params.get('id');
}

function renderMetadata (metadata) {
  $('#title').innerHTML = metadata.title;
  $('#artist').innerHTML = metadata.artist;

  if (metadata.cover) {
    $('#cover').src = metadata.cover;
  }

  const backgrounds = $$('.background');

  for (let i = 0; i < backgrounds.length; i++) {
    const bg = backgrounds[i];

    bg.style.backgroundImage = 'url("' + metadata.cover + '")';
  }

  // $('#station-name').innerHTML = 'Station: ' + getStation();
}

function handleChatMessage (msg) {
  const data = JSON.parse(msg);
  const message = document.createElement('div');

  message.classList.add('message');
  const fromSpan = document.createElement('span');

  fromSpan.innerHTML = data.from;
  fromSpan.classList.add('from');

  message.appendChild(fromSpan);

  const paragraph = document.createElement('p');

  paragraph.innerHTML = data.message;
  message.appendChild(paragraph);
  $('#messages').appendChild(message);
}

window.onload = function () {
  const station = getStation();

  const audioElement = $('audio');
  const audioVisualiser = $('audio-visualiser');

  const playPlay = $('#playplay');

  playPlay.addEventListener('click', () => {
    audioElement.play();
  });

  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();

  analyser.fftSize = 256;

  audioVisualiser.analyser = analyser;

  if (station) {
    receiver = new Receiver(station);

    receiver.addEventListener('metadatachange', event => {
      if (event instanceof CustomEvent) {
        renderMetadata(JSON.parse(event.detail));
      }
    });

    receiver.addEventListener('chat-receive', event => {
      if (event instanceof CustomEvent) {
        handleChatMessage(event.detail);
      }
    });

    document.addEventListener('receiver:new-song', event => {
      if (event instanceof CustomEvent) {
        const { stream } = receiver;

        audioElement.srcObject = stream;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const dest = audioContext.createMediaStreamDestination();
        analyser.connect(dest);

        audioVisualiser.start();
      }
    });

    audioElement.addEventListener('play', () => audioVisualiser.start());
    audioElement.addEventListener('pause', () => audioVisualiser.stop());

    $('#chat-form').addEventListener('submit', e => {
      e.preventDefault();

      receiver.sendChat({
        from: 'User',
        message: $('#message').value
      });

      $('#message').value = '';

      return false;
    });
  } else {
    console.error('No station entered');
  }
};
