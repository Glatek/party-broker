import Station from './station.js';

import { $ } from './fake-jquery.js';

const b64toBlob = (b64Data, contentType='', sliceSize=512) => {
  const byteCharacters = atob(b64Data);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);

    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  const blob = new Blob(byteArrays, {type: contentType});
  return blob;
}

const station = new Station(data => {
  console.log(data);

  $('#listenUrl').href = data.listenUrl;
});

station.events.addEventListener('metadatachange', e => {
  console.log(e);
  if (!e.detail) return;

  const metadata = e.detail;
  const splitty = metadata.cover.split(';base64,');
  const base64 = splitty[1];
  const contentType = splitty[0].split('data:')[1];
  const blob = b64toBlob(base64, contentType);
  const blobUrl = URL.createObjectURL(blob);

  document.querySelector('#cover').src = blobUrl;
  document.querySelector('#title').src = metadata.title;
  document.querySelector('#artist').src = metadata.artist;

  [...document.querySelectorAll('.background')].forEach(bg => {
    bg.style.backgroundImage = `url(${blobUrl})`;
  });
});

const fileInput = $('#file-input');
const fileEnabled = $('.file-enabled');

fileInput.addEventListener('input', () => fileEnabled.classList.add('allow'));

$('#file-open-button').addEventListener('click', () => fileInput.click());

$('#detune-slider').addEventListener('input', e => {
  station.detune = parseInt(e.target.value, 10);
});

$('#start-button').addEventListener('click', async () => {
  const file = fileInput.files[0];

  station.start();
  station.playAudioFile(file);
});
