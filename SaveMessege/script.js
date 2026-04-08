import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, orderBy, serverTimestamp, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, arrayUnion, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
// ИМПОРТЫ ДЛЯ REALTIME DATABASE (ДЛЯ ЗВОНКОВ)
import { getDatabase, ref, set, onChildAdded, onValue, push, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyDShZqoIBlgUBs-kwS_BoqF6xnnad2dOFU",
    authDomain: "savemessage-d633c.firebaseapp.com",
    projectId: "savemessage-d633c",
    // ВАЖНО: Замени этот URL на реальный URL твоей Realtime Database из консоли Firebase
    databaseURL: "https://savemessage-d633c-default-rtdb.europe-west1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const auth = getAuth(app);

const el = (id) => document.getElementById(id);
const emojiList = ["👤","🐱","🐶","🦊","🚀","🔥","💎","🎮","💻","👻","🤖","👽","🌈","🍕","🧿"];
const IMGBB_API_KEY = "95e763ded833904428150d90c7a12f6b";

let user = null;
let activeChatId = null;
let activeChatMembers = []; // Чтобы знать, кому звонить
let unsubMsgs = null, unsubStatus = null, unsubTyping = null;
let replyData = null;
let typingTimeout = null;

const getBadge = (v) => v ? `<i class="fa-solid fa-circle-check verified-badge"></i>` : '';

// --- ПРИСУТСТВИЕ ---
async function setOnlineStatus(status) {
    if (user?.uid) {
        await updateDoc(doc(db, "users", user.uid), { isOnline: status });
    }
}
window.addEventListener('beforeunload', () => setOnlineStatus(false));

el('input-msg').addEventListener('input', async () => {
    if (!activeChatId || !user) return;
    await updateDoc(doc(db, "chats", activeChatId), { [`typing.${user.uid}`]: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(async () => {
        await updateDoc(doc(db, "chats", activeChatId), { [`typing.${user.uid}`]: false });
    }, 2000);
});

// --- UI ФУНКЦИИ ---
window.openModal = (id) => el(id).style.display = 'flex';
window.closeAllModals = () => {
    document.querySelectorAll('.modal-overlay').forEach(m => { 
        if(m.id !== 'auth-screen' && m.id !== 'modal-incoming-call') m.style.display = 'none'; 
    });
};

window.deleteMsg = async (mId) => {
    if(!confirm("Удалить это сообщение?")) return;
    try { await deleteDoc(doc(db, `chats/${activeChatId}/messages`, mId)); } catch (e) { console.error(e); }
};

window.setReply = (mId, text, nick) => {
    replyData = { mId, text: text.substring(0, 50), nick };
    el('reply-nick').innerText = "@" + nick;
    el('reply-text').innerText = text;
    el('reply-bar').style.display = 'flex';
    el('input-msg').focus();
};
window.cancelReply = () => { replyData = null; el('reply-bar').style.display = 'none'; };

// --- АВТОРИЗАЦИЯ ---
el('auth-toggle').onclick = () => {
    const isReg = el('reg-nick').style.display === "none";
    el('reg-nick').style.display = isReg ? "block" : "none";
    el('auth-title').innerText = isReg ? "Регистрация" : "SafeMessage";
    el('auth-toggle').innerText = isReg ? "Есть аккаунт? Войти" : "Создать аккаунт";
};

el('btn-auth').onclick = async () => {
    const email = el('auth-email').value.trim();
    const pass = el('auth-pass').value.trim();
    const nick = el('reg-nick').value.trim().toLowerCase();
    if(!email || !pass) return alert("Заполни поля!");

    try {
        if (el('reg-nick').style.display !== "none") {
            if(!nick) return alert("Введите ник");
            const q = query(collection(db, "users"), where("nickname", "==", nick));
            if (!(await getDocs(q)).empty) return alert("Ник занят!");
            const res = await createUserWithEmailAndPassword(auth, email, pass);
            await setDoc(doc(db, "users", res.user.uid), { uid: res.user.uid, nickname: nick, emoji: "👤", avatarUrl: null, isVerify: false, isOnline: true });
        } else {
            await signInWithEmailAndPassword(auth, email, pass);
        }
    } catch (e) { alert(e.message); }
};

onAuthStateChanged(auth, async (u) => {
    if (u) {
        const d = await getDoc(doc(db, "users", u.uid));
        user = d.data();
        el('auth-screen').style.display = 'none';
        updateAvatarDisplay();
        setOnlineStatus(true);
        loadChats();
        listenForIncomingCallsRTDB();
    }
});

// --- ЗАГРУЗКА ФАЙЛОВ (ФОТО, GIF, ВИДЕО) ---
el('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !activeChatId) return;
    
    const inputField = el('input-msg');
    inputField.placeholder = "Загрузка файла...";
    inputField.disabled = true;

    try {
        if (file.type.startsWith('video/')) {
            // Загрузка видео через Catbox API (бесплатно, до 200мб)
            const formData = new FormData();
            formData.append("reqtype", "fileupload");
            formData.append("fileToUpload", file);
            const response = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: formData });
            const url = await response.text();
            if (url.startsWith("http")) await sendMediaMsg(url, "video");
            else throw new Error("Ошибка Catbox");
        } else {
            // Загрузка фото/GIF через ImgBB
            const formData = new FormData();
            formData.append("image", file);
            const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData });
            const data = await response.json();
            if (data.success) await sendMediaMsg(data.data.url, "image");
        }
    } catch (err) { alert("Ошибка загрузки файла"); console.error(err); }
    finally {
        inputField.placeholder = "Сообщение...";
        inputField.disabled = false;
        e.target.value = ""; 
    }
});

async function sendMediaMsg(url, type) {
    const msgObj = { text: url, type: type, senderId: user.uid, senderNick: user.nickname, senderVerified: user.isVerify || false, createdAt: serverTimestamp() };
    if(replyData) { msgObj.replyTo = replyData; cancelReply(); }
    await addDoc(collection(db, `chats/${activeChatId}/messages`), msgObj);
    await updateDoc(doc(db, "chats", activeChatId), { lastMessage: type === "video" ? "🎥 Видео" : "📷 Фото/GIF" });
}

// --- АВАТАР ПРОФИЛЯ (ФОТО) ---
function updateAvatarDisplay() {
    if (user?.avatarUrl) {
        el('my-avatar').innerHTML = `<img src="${user.avatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    } else {
        el('my-avatar').innerText = user?.emoji || "👤";
    }
}

function getAvatarHtml(user) {
    if (user?.avatarUrl) {
        return `<img src="${user.avatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    }
    return user?.emoji || "👤";
}

window.uploadAvatarPhoto = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const uploadBtn = el('upload-avatar-btn');
        if (uploadBtn) uploadBtn.disabled = true;
        
        try {
            const formData = new FormData();
            formData.append("image", file);
            const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData });
            const data = await response.json();
            
            if (data.success) {
                const avatarUrl = data.data.url;
                await updateDoc(doc(db, "users", user.uid), { avatarUrl: avatarUrl });
                user.avatarUrl = avatarUrl;
                updateAvatarDisplay();
                alert("Аватар обновлен!");
            } else {
                throw new Error("Ошибка загрузки");
            }
        } catch (err) {
            alert("Ошибка загрузки аватара");
            console.error(err);
        } finally {
            if (uploadBtn) uploadBtn.disabled = false;
        }
    };
    input.click();
};

window.removeAvatarPhoto = async () => {
    if (!confirm("Удалить аватар?")) return;
    try {
        await updateDoc(doc(db, "users", user.uid), { avatarUrl: null });
        user.avatarUrl = null;
        updateAvatarDisplay();
    } catch (err) {
        console.error(err);
    }
};

// --- ЛОГИКА ЧАТОВ ---
window.startDM = async () => {
    const nick = el('search-user').value.trim().toLowerCase();
    if(!nick || nick === user.nickname) return;
    const q = query(collection(db, "users"), where("nickname", "==", nick));
    const s = await getDocs(q);
    if(s.empty) return alert("Юзер не найден");
    const target = s.docs[0].data();
    const cid = [user.uid, target.uid].sort().join("_");
    await setDoc(doc(db, "chats", cid), {
        id: cid, type: 'dm', members: [user.uid, target.uid],
        nicks: { [user.uid]: user.nickname, [target.uid]: target.nickname },
        emojis: { [user.uid]: user.emoji, [target.uid]: target.emoji },
        avatarUrls: { [user.uid]: user.avatarUrl || null, [target.uid]: target.avatarUrl || null },
        verified: { [user.uid]: user.isVerify || false, [target.uid]: target.isVerify || false },
        lastMessage: "Чат открыт", typing: { [user.uid]: false, [target.uid]: false }
    }, { merge: true });
    el('search-user').value = '';
};

function loadChats() {
    const q = query(collection(db, "chats"), where("members", "array-contains", user.uid));
    onSnapshot(q, (snap) => {
        const list = el('ui-chats'); list.innerHTML = '';
        snap.forEach(dSnap => {
            const c = dSnap.data();
            let title, avatarHtml, isV = false, otherId = null;
            if(c.type === 'group') {
                title = c.name; avatarHtml = "👥";
            } else {
                otherId = c.members.find(id => id !== user.uid);
                title = c.nicks?.[otherId] || "User";
                const otherUser = c.avatarUrls?.[otherId];
                if (otherUser) {
                    avatarHtml = `<img src="${otherUser}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                } else {
                    avatarHtml = c.emojis?.[otherId] || "👤";
                }
                isV = c.verified?.[otherId] || false;
            }

            const div = document.createElement('div');
            div.className = 'chat-item';
            div.innerHTML = `
                <div class="avatar-wrap">
                    <div class="avatar">${avatarHtml}</div>
                    <div id="status-${otherId || dSnap.id}" class="status-dot dot-offline"></div>
                </div>
                <div style="margin-left:15px; flex:1; overflow:hidden;">
                    <div style="font-weight:600; display:flex; align-items:center; gap:5px;">${title} ${getBadge(isV)}</div>
                    <div style="font-size:12px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.lastMessage || ""}</div>
                </div>
            `;
            if (otherId) {
                onSnapshot(doc(db, "users", otherId), (uDoc) => {
                    const dot = div.querySelector(`#status-${otherId}`);
                    if (dot) dot.className = `status-dot ${uDoc.data()?.isOnline ? 'dot-online' : 'dot-offline'}`;
                    // Update avatar if changed
                    const avatarDiv = div.querySelector('.avatar');
                    const userData = uDoc.data();
                    if (userData?.avatarUrl) {
                        avatarDiv.innerHTML = `<img src="${userData.avatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                    }
                });
            }
            div.onclick = () => openChat(dSnap.id, title, avatarHtml, isV, c);
            list.appendChild(div);
        });
    });
}

window.openChat = (id, name, avatarHtml, isV, chatData) => {
    activeChatId = id;
    activeChatMembers = chatData.members; // Запоминаем всех участников
    let otherId = chatData.type === 'dm' ? chatData.members.find(u => u !== user.uid) : null;
    
    el('active-name').innerHTML = `${name} ${getBadge(isV)}`;
    el('active-emoji').innerHTML = avatarHtml;
    el('add-member-btn').style.display = chatData.type === 'group' ? 'block' : 'none';
    el('btn-call').style.display = 'block'; // Звонки теперь доступны и в группах
    el('app').classList.add('show-chat');
    cancelReply();
    
    if(unsubMsgs) unsubMsgs(); if(unsubStatus) unsubStatus(); if(unsubTyping) unsubTyping();

    if (otherId) {
        unsubStatus = onSnapshot(doc(db, "users", otherId), (uDoc) => {
            el('active-status-dot').className = `status-dot ${uDoc.data()?.isOnline ? 'dot-online' : 'dot-offline'}`;
            // Update avatar if changed
            const userData = uDoc.data();
            if (userData?.avatarUrl) {
                el('active-emoji').innerHTML = `<img src="${userData.avatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
            }
        });
    }

    unsubTyping = onSnapshot(doc(db, "chats", id), (cDoc) => {
        const data = cDoc.data();
        const typingUsers = Object.keys(data?.typing || {}).filter(k => k !== user.uid && data.typing[k]);
        el('typing-indicator').style.display = typingUsers.length > 0 ? 'block' : 'none';
    });

    const q = query(collection(db, `chats/${id}/messages`), orderBy("createdAt", "asc"), limit(100));
    unsubMsgs = onSnapshot(q, (snap) => {
        const box = el('ui-msgs'); box.innerHTML = '';
        snap.forEach(mDoc => {
            const m = mDoc.data(); const mId = mDoc.id; const isMine = m.senderId === user.uid;
            let replyHtml = m.replyTo ? `<div class="reply-quote" onclick="document.getElementById('m-${m.replyTo.mId}').scrollIntoView({behavior:'smooth'})"><b>@${m.replyTo.nick}</b><br>${m.replyTo.text}</div>` : '';
            
            let content = m.text;
            if(m.type === "image") content = `<img src="${m.text}" style="max-width:100%; border-radius:15px; margin-top:5px; cursor:pointer;" onclick="window.open('${m.text}')">`;
            if(m.type === "video") content = `<video src="${m.text}" controls style="max-width:100%; border-radius:15px; margin-top:5px;"></video>`;

            const actions = `<i class="fa-solid fa-reply msg-action" onclick="setReply('${mId}', '${m.type ? 'Медиа' : m.text.replace(/'/g, "\\'")}', '${m.senderNick}')"></i>${isMine ? `<i class="fa-solid fa-trash msg-action" onclick="deleteMsg('${mId}')"></i>` : ''}`;

            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${isMine ? 'sent' : 'received'}`;
            msgDiv.id = `m-${mId}`;
            msgDiv.innerHTML = `<div class="msg-info">@${m.senderNick} ${getBadge(m.senderVerified)} ${actions}</div><div class="bubble">${replyHtml}${content}</div>`;

            let startX = 0;
            msgDiv.ontouchstart = (e) => startX = e.touches[0].clientX;
            msgDiv.ontouchmove = (e) => {
                let diff = e.touches[0].clientX - startX;
                if (diff > 0 && diff < 80) msgDiv.style.transform = `translateX(${diff}px)`;
            };
            msgDiv.ontouchend = (e) => {
                let diff = e.changedTouches[0].clientX - startX;
                if (diff > 50) setReply(mId, m.type ? 'Медиа' : m.text, m.senderNick);
                msgDiv.style.transform = `translateX(0)`;
            };
            box.appendChild(msgDiv);
        });
        box.scrollTop = box.scrollHeight;
    });
};

window.closeChat = () => {
    el('app').classList.remove('show-chat');
    if(unsubMsgs) unsubMsgs(); activeChatId = null; activeChatMembers = [];
};

window.sendMsg = async () => {
    const inp = el('input-msg'); const txt = inp.value.trim();
    if(!txt || !activeChatId) return;
    inp.value = '';
    await updateDoc(doc(db, "chats", activeChatId), { [`typing.${user.uid}`]: false });

    try {
        const msgObj = { text: txt, senderId: user.uid, senderNick: user.nickname, senderVerified: user.isVerify || false, createdAt: serverTimestamp() };
        if(replyData) { msgObj.replyTo = replyData; cancelReply(); }
        await addDoc(collection(db, `chats/${activeChatId}/messages`), msgObj);
        await updateDoc(doc(db, "chats", activeChatId), { lastMessage: txt });
    } catch (e) { console.error(e); }
};
el('input-msg').onkeydown = (e) => { if(e.key === 'Enter') sendMsg(); };

// --- ГРУППОВЫЕ ЗВОНКИ WEBRTC ПО СЕТИ MESH (REALTIME DATABASE) ---
const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };
let localStream = null;
let peers = {}; // Объект для хранения RTCPeerConnection: { uid: pc }
let currentCallRoom = null;

window.toggleMic = () => {
    if(localStream) {
        const track = localStream.getAudioTracks()[0];
        if(track) {
            track.enabled = !track.enabled;
            el('btn-mic').innerHTML = track.enabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
            el('btn-mic').style.background = track.enabled ? '#334155' : '#ef4444';
        }
    }
};

window.toggleCam = () => {
    if(localStream) {
        const track = localStream.getVideoTracks()[0];
        if(track) {
            track.enabled = !track.enabled;
            el('btn-cam').innerHTML = track.enabled ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-video-slash"></i>';
            el('btn-cam').style.background = track.enabled ? '#334155' : '#ef4444';
        }
    }
};

async function setupLocalMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        el('local-video').srcObject = localStream;
    } catch(e) { alert("Нет доступа к камере/микрофону"); throw e; }
}

// 1. Инициатор звонка нажимает кнопку
window.startCall = async () => {
    if (!activeChatId) return;
    currentCallRoom = activeChatId;
    
    // Рассылаем уведомления о звонке всем участникам чата (кроме себя)
    activeChatMembers.forEach(memberId => {
        if(memberId !== user.uid) {
            set(ref(rtdb, `ringing/${memberId}`), {
                roomId: currentCallRoom,
                callerNick: user.nickname,
                timestamp: Date.now()
            });
        }
    });

    await joinCallRoom(currentCallRoom);
};

// 2. Слушаем входящие вызовы
function listenForIncomingCallsRTDB() {
    onValue(ref(rtdb, `ringing/${user.uid}`), (snap) => {
        const data = snap.val();
        if (data && (Date.now() - data.timestamp < 30000)) { // Звонок активен 30 секунд
            currentCallRoom = data.roomId;
            el('caller-name').innerText = `@${data.callerNick} приглашает в звонок...`;
            el('modal-incoming-call').style.display = 'flex';
        } else {
            el('modal-incoming-call').style.display = 'none';
        }
    });
}

// 3. Ответ и отбой
window.answerCall = async () => {
    el('modal-incoming-call').style.display = 'none';
    await remove(ref(rtdb, `ringing/${user.uid}`)); // Удаляем уведомление
    if(currentCallRoom) await joinCallRoom(currentCallRoom);
};

window.rejectCall = async () => {
    el('modal-incoming-call').style.display = 'none';
    await remove(ref(rtdb, `ringing/${user.uid}`));
};

// 4. Вход в комнату звонка (MESH логика)
async function joinCallRoom(roomId) {
    el('call-screen').style.display = 'flex';
    await setupLocalMedia();

    const myPresenceRef = ref(rtdb, `calls/${roomId}/participants/${user.uid}`);
    await set(myPresenceRef, true);
    onDisconnect(myPresenceRef).remove(); // Если интернет отпал - выходим

    // Слушаем кто еще в комнате
    onChildAdded(ref(rtdb, `calls/${roomId}/participants`), (snap) => {
        const peerUid = snap.key;
        if (peerUid !== user.uid) {
            // В MESH сети оффер создает тот, чей UID "больше" (чтобы избежать двойных офферов)
            const isInitiator = user.uid > peerUid; 
            setupPeerConnection(peerUid, roomId, isInitiator);
        }
    });

    // Слушаем удаление участников (кто-то вышел)
    onValue(ref(rtdb, `calls/${roomId}/participants`), (snap) => {
        const activeUsers = snap.val() || {};
        Object.keys(peers).forEach(peerUid => {
            if (!activeUsers[peerUid]) removePeer(peerUid);
        });
    });
}

// 5. Настройка соединения с конкретным участником
async function setupPeerConnection(peerUid, roomId, isInitiator) {
    if (peers[peerUid]) return; // Уже соединились

    const pc = new RTCPeerConnection(servers);
    peers[peerUid] = pc;

    // Добавляем свои треки
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    // Принимаем чужие треки
    pc.ontrack = (e) => {
        let vid = el(`vid-${peerUid}`);
        if (!vid) {
            vid = document.createElement('video');
            vid.id = `vid-${peerUid}`;
            vid.autoplay = true;
            vid.playsInline = true;
            el('video-grid').insertBefore(vid, el('local-video'));
        }
        vid.srcObject = e.streams[0];
    };

    // Обмен ICE кандидатами
    pc.onicecandidate = (e) => {
        if (e.candidate) {
            push(ref(rtdb, `calls/${roomId}/signals/${user.uid}_${peerUid}/candidates`), e.candidate.toJSON());
        }
    };

    // Слушаем ICE кандидатов от собеседника
    onChildAdded(ref(rtdb, `calls/${roomId}/signals/${peerUid}_${user.uid}/candidates`), (snap) => {
        if(snap.val()) pc.addIceCandidate(new RTCIceCandidate(snap.val()));
    });

    if (isInitiator) {
        // Создаем Offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await set(ref(rtdb, `calls/${roomId}/signals/${user.uid}_${peerUid}/offer`), offer);

        // Ждем Answer
        onValue(ref(rtdb, `calls/${roomId}/signals/${peerUid}_${user.uid}/answer`), async (snap) => {
            const answer = snap.val();
            if (answer && pc.signalingState !== "closed") {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            }
        });
    } else {
        // Ждем Offer, создаем Answer
        onValue(ref(rtdb, `calls/${roomId}/signals/${peerUid}_${user.uid}/offer`), async (snap) => {
            const offer = snap.val();
            if (offer && pc.signalingState !== "closed") {
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await set(ref(rtdb, `calls/${roomId}/signals/${user.uid}_${peerUid}/answer`), answer);
            }
        });
    }
}

function removePeer(peerUid) {
    if (peers[peerUid]) {
        peers[peerUid].close();
        delete peers[peerUid];
    }
    const vid = el(`vid-${peerUid}`);
    if (vid) vid.remove();
}

window.endCall = async () => {
    el('call-screen').style.display = 'none';
    
    if (currentCallRoom) {
        await remove(ref(rtdb, `calls/${currentCallRoom}/participants/${user.uid}`));
        // Очищаем свои сигналы, чтобы не мусорить в БД
        Object.keys(peers).forEach(peerUid => {
            remove(ref(rtdb, `calls/${currentCallRoom}/signals/${user.uid}_${peerUid}`));
        });
    }

    Object.keys(peers).forEach(peerUid => removePeer(peerUid));
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    
    localStream = null;
    currentCallRoom = null;
    await remove(ref(rtdb, `ringing/${user.uid}`)); // На всякий случай
};

// --- ПРОФИЛЬ И ГРУППЫ ---
window.openProfile = () => {
    openModal('modal-profile');
    el('profile-nick').innerText = "@" + user.nickname;
    
    // Display avatar (photo or emoji)
    const avatarContainer = el('profile-avatar-view');
    if (user?.avatarUrl) {
        avatarContainer.innerHTML = `<img src="${user.avatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    } else {
        avatarContainer.innerText = user?.emoji || "👤";
    }
    
    const grid = el('profile-emojis'); 
    if (grid) {
        grid.innerHTML = '';
        emojiList.forEach(e => {
            const s = document.createElement('span'); 
            s.className = 'emoji-item'; 
            s.innerText = e;
            s.onclick = async () => {
                await updateDoc(doc(db, "users", user.uid), { emoji: e });
                user.emoji = e; 
                el('profile-avatar-view').innerText = e;
                updateAvatarDisplay();
            };
            grid.appendChild(s);
        });
    }
};

window.confirmCreateGroup = async () => {
    const name = el('new-group-name').value.trim();
    if(!name) return;
    await addDoc(collection(db, "chats"), { name, type: 'group', members: [user.uid], lastMessage: "Группа создана", typing: {} });
    el('new-group-name').value = ''; closeAllModals();
};

window.confirmAddMember = async () => {
    const nick = el('member-nick').value.trim().toLowerCase();
    const q = query(collection(db, "users"), where("nickname", "==", nick));
    const s = await getDocs(q);
    if(s.empty) return alert("Не найден");
    await updateDoc(doc(db, "chats", activeChatId), { members: arrayUnion(s.docs[0].data().uid) });
    
    // Обновляем локальный массив для звонков
    if(!activeChatMembers.includes(s.docs[0].data().uid)) activeChatMembers.push(s.docs[0].data().uid);
    
    closeAllModals();
};
