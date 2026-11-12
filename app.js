// State Management
let peer = null;
let activeConnection = null;
let aiModel = null;
let localVoiceStream = null;
let isCalling = false;

const AI_THRESHOLD = 0.80; // Minimum confidence to block toxicity (0.0 to 1.0)

// DOM Elements
const usernameInput = document.getElementById("username-input");
const btnCreateRoom = document.getElementById("btn-create-room");
const btnJoinRoom = document.getElementById("btn-join-room");
const joinRoomInput = document.getElementById("join-room-input");
const roomInfoPanel = document.getElementById("room-info");
const displayRoomId = document.getElementById("display-room-id");
const btnCopyLink = document.getElementById("btn-copy-link");
const btnToggleVoice = document.getElementById("btn-toggle-voice");
const remoteAudio = document.getElementById("remote-audio");

const messageFeed = document.getElementById("message-feed");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const modAlert = document.getElementById("mod-alert");

const aiIndicator = document.getElementById("ai-indicator");
const aiStatusText = document.getElementById("ai-status-text");
const p2pIndicator = document.getElementById("p2p-indicator");
const p2pStatusText = document.getElementById("p2p-status-text");

// 1. Initialize On-Device AI Toxicity Model
async function initAI() {
  try {
    aiModel = await toxicity.load(AI_THRESHOLD);
    aiIndicator.classList.add("online");
    aiStatusText.textContent = "AI Guard: Ready & Private";
    chatInput.disabled = false;
    btnSend.disabled = false;
  } catch (err) {
    console.error("AI Model Init Error:", err);
    aiIndicator.classList.add("danger");
    aiStatusText.textContent = "AI Model: Offline";
  }
}
initAI();

// 2. PeerJS & WebRTC Room Setup
function initPeerInstance(customId = null) {
  peer = customId ? new Peer(customId) : new Peer();

  peer.on("open", (id) => {
    displayRoomId.textContent = id;
    roomInfoPanel.style.display = "flex";
    p2pIndicator.classList.add("online");
    p2pStatusText.textContent = `Host Ready: ${id.substring(0, 8)}...`;
  });

  peer.on("connection", (conn) => {
    activeConnection = conn;
    setupConnectionEvents();
  });

  // Handle incoming P2P voice call
  peer.on("call", (call) => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      call.answer(stream);
      localVoiceStream = stream;
      call.on("stream", (remoteStream) => {
        remoteAudio.srcObject = remoteStream;
      });
      btnToggleVoice.textContent = "🔴 End Call";
      isCalling = true;
    });
  });

  peer.on("error", (err) => {
    console.error("PeerJS Error:", err);
    alert(`Connection issue: ${err.type}`);
  });
}

// Create Room Handler
btnCreateRoom.addEventListener("click", () => {
  const generatedId = "priva-" + Math.random().toString(36).substring(2, 9);
  initPeerInstance(generatedId);
  appendSystemMessage("Room initialized. Share the invite code or link with a friend.");
});

// Join Room Handler
btnJoinRoom.addEventListener("click", () => {
  const targetId = joinRoomInput.value.trim();
  if (!targetId) return alert("Please specify a Room ID.");

  initPeerInstance();
  peer.on("open", () => {
    activeConnection = peer.connect(targetId);
    setupConnectionEvents();
  });
});

// Setup Events when connected
function setupConnectionEvents() {
  activeConnection.on("open", () => {
    p2pIndicator.classList.add("online");
    p2pStatusText.textContent = "P2P: Connected (Encrypted)";
    appendSystemMessage("Connected to peer! Direct WebRTC tunnel established.");
  });

  activeConnection.on("data", async (payload) => {
    // Client-side AI check on incoming messages as a double guard
    const isViolation = await evaluateTextSafety(payload.text);
    if (isViolation) {
      appendMessage(payload.author, "[Message hidden by your local AI guard for toxicity]", "in", true);
    } else {
      appendMessage(payload.author, payload.text, "in");
    }
  });

  activeConnection.on("close", () => {
    p2pIndicator.classList.remove("online");
    p2pStatusText.textContent = "P2P: Disconnected";
    appendSystemMessage("Peer has left the conversation.");
  });
}

// 3. AI Moderation Check (Runs inside the browser via WebAssembly)
async function evaluateTextSafety(text) {
  if (!aiModel) return false;
  try {
    const results = await aiModel.classify([text]);
    return results.some(prediction => prediction.results[0].match === true);
  } catch (err) {
    console.warn("Safety check failed, passing gracefully:", err);
    return false;
  }
}

// 4. Send Message Flow
async function handleSend() {
  const text = chatInput.value.trim();
  if (!text) return;

  if (!activeConnection) {
    alert("You must create or join an active room first.");
    return;
  }

  modAlert.style.display = "none";

  // Run On-Device AI Classification
  aiStatusText.textContent = "AI: Analyzing Text...";
  const isViolating = await evaluateTextSafety(text);
  aiStatusText.textContent = "AI Guard: Ready & Private";

  if (isViolating) {
    modAlert.style.display = "block";
    return; // Block offensive content
  }

  const payload = {
    author: usernameInput.value.trim() || "Anonymous",
    text: text
  };

  activeConnection.send(payload);
  appendMessage("You", text, "out");
  chatInput.value = "";
}

btnSend.addEventListener("click", handleSend);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSend();
});

// 5. Message DOM Appenders
function appendMessage(author, text, direction, isFlagged = false) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement("div");
  div.className = `message ${direction}`;
  if (isFlagged) div.style.fontStyle = "italic";

  div.innerHTML = `
    <span class="author">${escapeHtml(author)}</span>
    <span class="text">${escapeHtml(text)}</span>
    <span class="time">${time}</span>
  `;

  messageFeed.appendChild(div);
  messageFeed.scrollTop = messageFeed.scrollHeight;
}

function appendSystemMessage(text) {
  const div = document.createElement("div");
  div.className = "system-bubble";
  div.textContent = text;
  messageFeed.appendChild(div);
  messageFeed.scrollTop = messageFeed.scrollHeight;
}

// Copy Shareable Invite Link
btnCopyLink.addEventListener("click", () => {
  const inviteUrl = `${window.location.origin}${window.location.pathname}#${displayRoomId.textContent}`;
  navigator.clipboard.writeText(inviteUrl);
  btnCopyLink.textContent = "✅ Copied!";
  setTimeout(() => (btnCopyLink.textContent = "📋 Copy Link"), 2000);
});

// Auto-join if Room ID is passed via URL hash (e.g., yoursite.pages.dev/#room-code)
window.addEventListener("DOMContentLoaded", () => {
  const hash = window.location.hash.substring(1);
  if (hash) {
    joinRoomInput.value = hash;
  }
});

// 6. Voice Call Handling (Optional WebRTC Voice)
btnToggleVoice.addEventListener("click", async () => {
  if (!activeConnection) return alert("Connect to a peer first.");

  if (!isCalling) {
    try {
      localVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const call = peer.call(activeConnection.peer, localVoiceStream);
      call.on("stream", (remoteStream) => {
        remoteAudio.srcObject = remoteStream;
      });
      btnToggleVoice.textContent = "🔴 End Call";
      isCalling = true;
    } catch (err) {
      alert("Microphone permission required for voice calls.");
    }
  } else {
    if (localVoiceStream) {
      localVoiceStream.getTracks().forEach(track => track.stop());
    }
    btnToggleVoice.textContent = "🎙️ Start Voice Call";
    isCalling = false;
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}
