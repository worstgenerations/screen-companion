navigator.mediaDevices.getUserMedia({ audio: true })
  .then((s) => { s.getTracks().forEach((t) => t.stop()); document.getElementById("m").textContent = "Microphone allowed. You can close this tab and press Talk in Melo."; })
  .catch(() => { document.getElementById("m").textContent = "Microphone was blocked. Allow it from the icon in the address bar and reload."; });
