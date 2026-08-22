// ---------- Config ----------
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ---------- Elements ----------
const joinScreen = document.getElementById('join-screen');
const callScreen = document.getElementById('call-screen');
const inputName = document.getElementById('input-name');
const inputRoom = document.getElementById('input-room');
const inputAvatar = document.getElementById('input-avatar');
const avatarPreview = document.getElementById('avatar-preview');
const avatarImg = document.getElementById('avatar-img');
const avatarInitial = document.getElementById('avatar-initial');
const btnJoin = document.getElementById('btn-join');
const joinError = document.getElementById('join-error');

const videoGrid = document.getElementById('video-grid');
const screenStage = document.getElementById('screen-stage');
const roomNameLabel = document.getElementById('room-name-label');
const roomStatus = document.getElementById('room-status');
const participantList = document.getElementById('participant-list');
const btnCopyLink = document.getElementById('btn-copy-link');

const btnMic = document.getElementById('btn-mic');
const btnCam = document.getElementById('btn-cam');
const btnScreen = document.getElementById('btn-screen');
const btnChat = document.getElementById('btn-chat');
const btnLeave = document.getElementById('btn-leave');

const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnChatImage = document.getElementById('btn-chat-image');
const chatImageInput = document.getElementById('chat-image-input');

// ---------- State ----------
let socket = null;
let myId = null;
let myName = '';
let myRoom = '';
let myAvatar = null; // data URL or null
let localStream = null;
let screenStream = null;
let awayTimer = null;
let isAway = false;
const peers = new Map(); // peerId -> { pc, name, videoTrackCount, tileCam, tileScreen, makingOffer, polite, screenSender }
const profiles = new Map(); // id -> { name, avatar }
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const AWAY_AFTER_MS = 5 * 60 * 1000;

// ---------- Profile (name + avatar persisted locally) ----------
function loadSavedProfile() {
  try {
    const raw = localStorage.getItem('hangout-profile');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.name) inputName.value = saved.name;
    if (saved.avatar) setAvatarPreview(saved.avatar);
  } catch { /* ignore corrupt/local-storage-unavailable cases */ }
}
function saveProfile() {
  try {
    localStorage.setItem('hangout-profile', JSON.stringify({ name: myName, avatar: myAvatar }));
  } catch { /* private browsing / storage disabled — not critical */ }
}
function setAvatarPreview(dataUrl) {
  myAvatar = dataUrl;
  avatarImg.src = dataUrl;
  avatarImg.classList.remove('hidden');
  avatarInitial.classList.add('hidden');
}
loadSavedProfile();

inputAvatar.addEventListener('change', async () => {
  const file = inputAvatar.files[0];
  if (!file) return;
  try {
    const resized = await resizeImageToDataUrl(file, 160, 0.85);
    setAvatarPreview(resized);
  } catch {
    joinError.textContent = 'Não consegui usar essa imagem, tenta outra.';
  }
});

inputName.addEventListener('input', () => {
  const letter = inputName.value.trim().charAt(0).toUpperCase();
  avatarInitial.textContent = letter || '+';
});

// Resizes/compresses an image file client-side so avatars/photos stay small
// enough to travel over the socket connection comfortably.
function resizeImageToDataUrl(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Prefill room from URL (?room=xxx)
const params = new URLSearchParams(location.search);
if (params.get('room')) inputRoom.value = params.get('room');

// ---------- Join flow ----------
btnJoin.addEventListener('click', joinRoom);
inputRoom.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
inputName.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

async function joinRoom() {
  const name = inputName.value.trim() || 'Anônimo';
  const room = inputRoom.value.trim().toLowerCase();
  if (!room) {
    joinError.textContent = 'Escreve um código de sala pra continuar.';
    return;
  }
  joinError.textContent = '';
  myName = name;
  myRoom = room;
  saveProfile();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (err) {
    joinError.textContent = 'Não consegui acessar sua câmera/microfone. Verifica as permissões do navegador.';
    return;
  }

  history.replaceState(null, '', `?room=${encodeURIComponent(room)}`);
  joinScreen.classList.add('hidden');
  callScreen.classList.remove('hidden');
  roomNameLabel.textContent = room;
  roomStatus.textContent = 'conectando…';

  renderLocalTile();
  setupIdleTracking();
  connectSocket();
}

function setupIdleTracking() {
  const resetTimer = () => {
    if (isAway) {
      isAway = false;
      socket?.emit('status-change', { status: 'online' });
    }
    clearTimeout(awayTimer);
    awayTimer = setTimeout(() => {
      isAway = true;
      socket?.emit('status-change', { status: 'away' });
    }, AWAY_AFTER_MS);
  };
  ['mousemove', 'keydown', 'click', 'touchstart'].forEach((evt) =>
    window.addEventListener(evt, resetTimer)
  );
  resetTimer();
}

function connectSocket() {
  socket = io();

  socket.on('connect', () => {
    myId = socket.id;
    roomStatus.textContent = 'conectado';
    socket.emit('join-room', { roomId: myRoom, name: myName, avatar: myAvatar });
  });

  socket.on('existing-users', (users) => {
    users.forEach(({ id, name, avatar, status }) => {
      profiles.set(id, { name, avatar });
      createPeerConnection(id, name);
      addParticipant(id, name, avatar, status);
    });
  });

  socket.on('user-joined', ({ id, name, avatar, status }) => {
    profiles.set(id, { name, avatar });
    createPeerConnection(id, name);
    addParticipant(id, name, avatar, status);
    pushSystemMessage(`${name} entrou na sala`);
  });

  socket.on('status-change', ({ id, status }) => {
    updateParticipantStatus(id, status);
  });

  socket.on('user-left', ({ id }) => {
    const peer = peers.get(id);
    if (peer) {
      pushSystemMessage(`${peer.name} saiu da sala`);
      peer.pc.close();
      removeTile(id, 'cam');
      removeTile(id, 'screen');
      peers.delete(id);
    }
    profiles.delete(id);
    removeParticipant(id);
  });

  socket.on('signal', async ({ from, data }) => {
    const peer = peers.get(from);
    if (!peer) return;
    await handleSignal(peer, data);
  });

  socket.on('chat-history', (messages) => {
    messages.forEach((m) => pushChatMessage(m.name, m.message, m.id === myId, m.type, m.id));
    if (messages.length) pushSystemMessage('Início do histórico ↑');
  });

  socket.on('chat-message', ({ name, message, id, type }) => {
    pushChatMessage(name, message, id === myId, type, id);
  });

  socket.on('disconnect', () => {
    roomStatus.textContent = 'desconectado';
  });
}

// ---------- WebRTC ----------
function createPeerConnection(peerId, name) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const peer = {
    pc, name,
    videoTrackCount: 0,
    tileCam: null,
    tileScreen: null,
    makingOffer: false,
    ignoreOffer: false,
    polite: myId < peerId,
    screenSender: null,
  };
  peers.set(peerId, peer);

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  if (screenStream) {
    peer.screenSender = pc.addTrack(screenStream.getVideoTracks()[0], screenStream);
  }

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      socket.emit('signal', { to: peerId, data: { description: pc.localDescription } });
    } catch (err) {
      console.error('negotiation error', err);
    } finally {
      peer.makingOffer = false;
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('signal', { to: peerId, data: { candidate } });
  };

  pc.ontrack = (event) => {
    const track = event.track;
    const stream = event.streams[0] || new MediaStream([track]);
    if (track.kind === 'video') {
      peer.videoTrackCount++;
      if (peer.videoTrackCount === 1) {
        peer.tileCam = renderRemoteTile(peerId, peer.name, stream, 'cam');
      } else {
        peer.tileScreen = renderRemoteTile(peerId, peer.name, stream, 'screen');
        track.addEventListener('ended', () => {
          removeTile(peerId, 'screen');
          peer.videoTrackCount = 1;
        });
      }
    } else {
      watchAudioLevel(stream, () => peer.tileCam);
      // attach audio for playback (bound to the camera tile's video element already
      // handles video+audio together when srcObject is the same combined stream;
      // if audio arrives on its own stream, play it via a hidden audio element)
      if (!peer.tileCam || peer.tileCam.querySelector('video').srcObject !== stream) {
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = stream;
        audioEl.dataset.peer = peerId;
        document.body.appendChild(audioEl);
      }
    }
  };

  return peer;
}

async function handleSignal(peer, data) {
  const pc = peer.pc;
  try {
    if (data.description) {
      const isOffer = data.description.type === 'offer';
      const collision = isOffer && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(data.description);
      if (isOffer) {
        await pc.setLocalDescription();
        socket.emit('signal', { to: findPeerId(peer), data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        if (!peer.ignoreOffer) console.error('ICE error', err);
      }
    }
  } catch (err) {
    console.error('signal error', err);
  }
}

function findPeerId(peerObj) {
  for (const [id, p] of peers.entries()) if (p === peerObj) return id;
  return null;
}

// ---------- Tiles ----------
function renderLocalTile() {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.id = 'tile-local-cam';
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = localStream;
  const label = document.createElement('div');
  label.className = 'tile-label';
  label.textContent = `${myName} (você)`;
  tile.appendChild(video);
  tile.appendChild(label);
  enableFullscreenToggle(tile);
  enableFocusToggle(tile);
  videoGrid.appendChild(tile);
  watchAudioLevel(localStream, () => tile);
}

function isScreenKind(kind) {
  return kind === 'screen' || kind === 'screen-local';
}

function renderRemoteTile(peerId, name, stream, kind) {
  const existingId = `tile-${peerId}-${kind}`;
  let tile = document.getElementById(existingId);
  if (tile) {
    tile.querySelector('video').srcObject = stream;
    updateStageLayout();
    return tile;
  }
  tile = document.createElement('div');
  tile.className = isScreenKind(kind) ? 'tile screen' : 'tile';
  tile.id = existingId;
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  const label = document.createElement('div');
  label.className = 'tile-label';
  label.textContent = isScreenKind(kind) ? `Tela de ${name}` : name;
  tile.appendChild(video);
  tile.appendChild(label);
  enableFullscreenToggle(tile);
  enableFocusToggle(tile);

  if (isScreenKind(kind)) {
    screenStage.appendChild(tile);
  } else {
    videoGrid.appendChild(tile);
  }
  updateStageLayout();
  return tile;
}

function removeTile(peerId, kind) {
  const el = document.getElementById(`tile-${peerId}-${kind}`);
  if (el) el.remove();
  document.querySelectorAll(`audio[data-peer="${peerId}"]`).forEach((a) => a.remove());
  updateStageLayout();
}

// Puts the featured screen-share area on top and shrinks the camera grid
// into a thumbnail strip whenever at least one screen is being shared.
function updateStageLayout() {
  const hasScreen = screenStage.children.length > 0;
  screenStage.classList.toggle('hidden', !hasScreen);
  videoGrid.classList.toggle('thumbs-row', hasScreen);
}

// Double-click any tile to view it fullscreen (tap-and-hold friendly on touch too).
function enableFullscreenToggle(tile) {
  tile.addEventListener('dblclick', () => {
    if (document.fullscreenElement === tile) {
      document.exitFullscreen();
    } else {
      tile.requestFullscreen?.().catch(() => {});
    }
  });
}

// Single click on a thumbnail promotes it to the big featured area (same
// spot screen-shares use); clicking it again while it's big sends it back
// to the grid. A hover overlay (see CSS .tile-hint) signals it's clickable.
function enableFocusToggle(tile) {
  const hint = document.createElement('div');
  hint.className = 'tile-hint';
  hint.innerHTML =
    '<svg class="icon-expand" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>' +
    '<svg class="icon-shrink" viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></svg>';
  tile.appendChild(hint);

  tile.addEventListener('click', () => {
    if (tile.parentElement === screenStage) {
      videoGrid.appendChild(tile);
    } else {
      screenStage.appendChild(tile);
    }
    updateStageLayout();
  });
}

// ---------- Speaking indicator ----------
function watchAudioLevel(stream, getTile) {
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) return;
  try {
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const tile = getTile();
      if (tile) tile.classList.toggle('speaking', avg > 18);
      requestAnimationFrame(tick);
    }
    tick();
  } catch (err) {
    // Safari/edge cases where the stream isn't ready yet — safe to ignore
  }
}

// ---------- Participants list ----------
function avatarHtml(name, avatar, extraClass = '') {
  if (avatar) {
    return `<img class="avatar-circle ${extraClass}" src="${avatar}" alt="" />`;
  }
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="avatar-circle avatar-fallback ${extraClass}">${escapeHtml(letter)}</span>`;
}

function addParticipant(id, name, avatar, status) {
  const li = document.createElement('li');
  li.id = `participant-${id}`;
  li.innerHTML = `
    <span class="avatar-wrap">
      ${avatarHtml(name, avatar)}
      <span class="status-dot ${status === 'away' ? 'away' : ''}" id="status-${id}"></span>
    </span>
    <span>${escapeHtml(name)}</span>`;
  participantList.appendChild(li);
}
function removeParticipant(id) {
  const li = document.getElementById(`participant-${id}`);
  if (li) li.remove();
}
function updateParticipantStatus(id, status) {
  const dot = document.getElementById(`status-${id}`);
  if (dot) dot.classList.toggle('away', status === 'away');
}

// ---------- Controls ----------
btnMic.addEventListener('click', () => {
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  btnMic.dataset.on = track.enabled;
});

btnCam.addEventListener('click', () => {
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  btnCam.dataset.on = track.enabled;
});

btnScreen.addEventListener('click', () => {
  if (screenStream) stopScreenShare();
  else startScreenShare();
});

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (err) {
    return; // user cancelled the picker
  }
  const track = screenStream.getVideoTracks()[0];

  peers.forEach((peer) => {
    peer.screenSender = peer.pc.addTrack(track, screenStream);
  });

  renderRemoteTile('local', `${myName} (você)`, screenStream, 'screen-local');
  const localScreenTile = document.getElementById('tile-local-screen-local');
  if (localScreenTile) localScreenTile.querySelector('video').muted = true;

  btnScreen.dataset.on = 'true';
  track.addEventListener('ended', stopScreenShare);
}

function stopScreenShare() {
  if (!screenStream) return;
  peers.forEach((peer) => {
    if (peer.screenSender) {
      peer.pc.removeTrack(peer.screenSender);
      peer.screenSender = null;
    }
  });
  screenStream.getTracks().forEach((t) => t.stop());
  screenStream = null;
  const localScreenTile = document.getElementById('tile-local-screen-local');
  if (localScreenTile) localScreenTile.remove();
  btnScreen.dataset.on = 'false';
  updateStageLayout();
}

btnChat.addEventListener('click', () => {
  const open = !chatPanel.classList.contains('hidden');
  chatPanel.classList.toggle('hidden', open);
  btnChat.dataset.on = String(!open);
});

btnLeave.addEventListener('click', () => {
  window.location.href = window.location.pathname;
});

btnCopyLink.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(myRoom)}`;
  try {
    await navigator.clipboard.writeText(url);
    btnCopyLink.textContent = 'Link copiado!';
    setTimeout(() => (btnCopyLink.textContent = 'Copiar link do convite'), 1800);
  } catch {
    prompt('Copia o link da sala:', url);
  }
});

// ---------- Chat ----------
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('chat-message', { message: msg, type: 'text' });
  chatInput.value = '';
});

btnChatImage.addEventListener('click', () => chatImageInput.click());
chatImageInput.addEventListener('change', async () => {
  const file = chatImageInput.files[0];
  chatImageInput.value = '';
  if (!file) return;
  try {
    const resized = await resizeImageToDataUrl(file, 1000, 0.6);
    socket.emit('chat-message', { message: resized, type: 'image' });
  } catch {
    pushSystemMessage('Não consegui enviar essa imagem.');
  }
});

function pushChatMessage(name, message, isMe, type, senderId) {
  const profile = senderId ? profiles.get(senderId) : null;
  const avatar = isMe ? myAvatar : profile?.avatar;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const body = type === 'image'
    ? `<img class="chat-image" src="${message}" alt="imagem enviada no chat" />`
    : `<div class="text">${escapeHtml(message)}</div>`;
  div.innerHTML = `
    <div class="chat-msg-row">
      ${avatarHtml(name, avatar, 'chat-avatar')}
      <div class="chat-msg-body">
        <div class="who">${escapeHtml(isMe ? 'você' : name)}</div>
        ${body}
      </div>
    </div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
chatMessages.addEventListener('click', (e) => {
  if (e.target.classList.contains('chat-image')) {
    window.open(e.target.src, '_blank');
  }
});

function pushSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.innerHTML = `<div class="text">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

window.addEventListener('beforeunload', () => {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
});
