'use strict';
// The area comes in the URL as fractions of the screen (#x,y,w,h); the recording state arrives later.
(() => {
  const [x, y, w, h] = location.hash.slice(1).split(',').map(Number);
  const box = document.getElementById('box');
  box.style.left = `${x * 100}%`;
  box.style.top = `${y * 100}%`;
  box.style.width = `${w * 100}%`;
  box.style.height = `${h * 100}%`;
  window.frameApi.onState((state) => { document.body.className = state; });
})();
