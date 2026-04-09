import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, orderBy, serverTimestamp, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, arrayUnion, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, set, onChildAdded, onValue, push, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyDShZqoIBlgUBs-kwS_BoqF6xnnad2dOFU",
    authDomain: "savemessage-d633c.firebaseapp.com",
    projectId: "savemessage-d633c",
    databaseURL: "https://savemessage-d633c-default-rtdb.europe-west1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const auth = getAuth(app);

const el = (id) => document.getElementById(id);
const emojiList = ["👤", "🐱", "🐶", "🦊", "🚀", "🔥", "💎", "🎮", "💻", "👻", "🤖", "👽", "🌈", "🍕", "🧿"];
const IMGBB_API_KEY = "95e763ded833904428150d90c7a12f6b";

let user = null;
let activeChatId = null;
let activeChatMembers = [];
let unsubMsgs = null, unsubStatus = null, unsubTyping = null;
let replyData = null;
let typingTimeout = null;
let uploadProgress = null;
let selectedUserProfile = null;
let activeGroupId = null;
let currentEmojiCategory = 'smileys';
let voiceCallActive = false;
let voiceCallStartTime = null;
let voiceCallTimer = null;
let voiceStream = null;
let screenStream = null;
let screenSharing = false;
let localStream = null;
let peers = {};
let currentCallRoom = null;
let isDarkMode = localStorage.getItem('darkMode') !== 'false';
let newMessagesCount = 0;
let isScrolledToBottom = true;

const getBadge = (v) => v ? `<i class="fa-solid fa-circle-check verified-badge"></i>` : '';

const emojisByCategory = {
    smileys: ['😊', '😂', '❤️', '😍', '🤔', '😎', '🥳', '😢', '😡', '����', '😴', '😷', '🤮', '🤬', '😈'],
    gestures: ['👋', '👍', '👎', '👏', '🙌', '🤝', '👊', '✊', '🤲', '🙏', '💪', '🦾'],
    objects: ['🎮', '🎸', '🎹', '🎯', '🎲', '🎪', '🎭', '🎬', '📷', '📱', '💻', '⌚'],
    nature: ['🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️', '🍀', '🍁', '🍂', '🌸', '🌺'],
    food: ['🍕', '🍔', '🍟', '🌭', '🍿', '🍗', '🍖', '🍝', '🍜', '🍱', '🍣', '🍰'],
    travel: ['✈️', '🚁', '🚂', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚊', '🚝', '🚞']
};

// === THEME ===
function applyTheme() {
    if (!isDarkMode) {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
}

window.toggleDarkMode = () => {
    isDarkMode = !isDarkMode;
    localStorage.setItem('darkMode', isDarkMode);
    applyTheme();
    el('theme-toggle').style.opacity = isDarkMode ? '1' : '0.5';
};

// === NEW MESSAGES ===
function scrollToBottom() {
    const msgBox = el('ui-msgs');
    msgBox.scrollTop = msgBox.scrollHeight;
    hideNewMessagesIndicator();
}

function showNewMessagesIndicator(count) {
    const btn = el('new-messages-btn');
    const countSpan = el('new-msg-count');
    if (count > 0) {
        countSpan.innerText = count;
        btn.style.display = 'flex';
    }
}

function hideNewMessagesIndicator() {
    el('new-messages-btn').style.display = 'none';
    newMessagesCount = 0;
}

el('ui-msgs').addEventListener('scroll', function() {
    const msgBox = el('ui-msgs');
    isScrolledToBottom = msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight < 50;
    if (isScrolledToBottom) {
        hideNewMessagesIndicator();
    }
});

// === ONLINE STATUS ===
async function setOnlineStatus(status) {
    if (user?.uid) {
        try {
            await updateDoc(doc(db, "users", user.uid), {
                isOnline: status,
                lastSeen: serverTimestamp()
            });
        } catch (e) {
            console.error("Error updating online status:", e);
        }
    }
}

async function setupPresence() {
    if (!user?.uid) return;
    await setOnlineStatus(true);
    const userPresenceRef = ref(rtdb, `presence/${user.uid}`);
    await onDisconnect(userPresenceRef).set(false);
    await set(userPresenceRef, true);
}

document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
        await setOnlineStatus(false);
    } else {
        await setOnlineStatus(true);
    }
});

window.addEventListener('beforeunload', () => setOnlineStatus(false));
window.addEventListener('unload', () => setOnlineStatus(false));

el('input-msg').addEventListener('input', async () => {
    if (!activeChatId || !user) return;
    await updateDoc(doc(db, "chats", activeChatId), { [`typing.${user.uid}`]: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(async () => {
        await updateDoc(doc(db, "chats", activeChatId), { [`typing.${user.uid}`]: false });
    }, 2000);
});

// === UI FUNCTIONS ===
window.openModal = (id) => el(id).style.display = 'flex';
window.closeAllModals = () => {
    document.querySelectorAll('.modal-overlay').forEach(m => {
        if (m.id !== 'auth-screen' && m.id !== 'modal-incoming-call') m.style.display = 'none';
    });
};

window.deleteMsg = async (mId) => {
    if (!confirm("Удалить это сообщение?")) return;
    try {
        await deleteDoc(doc(db, `chats/${activeChatId}/messages`, mId));
    } catch (e) {
        console.error(e);
    }
};

window.setReply = (mId, text, nick) => {
    replyData = { mId, text: text.substring(0, 50), nick };
    el('reply-nick').innerText = "@" + nick;
    el('reply-text').innerText = text;
    el('reply-bar').style.display = 'flex';
    el('input-msg').focus();
};

window.cancelReply = () => {
    replyData = null;
    el('reply-bar').style.display = 'none';
};

// === AUTHENTICATION ===
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
    if (!email || !pass) return alert("Заполни поля!");

    try {
        if (el('reg-nick').style.display !== "none") {
            if (!nick) return alert("Введите ник");
            const q = query(collection(db, "users"), where("nickname", "==", nick));
            if (!(await getDocs(q)).empty) return alert("Ник занят!");
            const res = await createUserWithEmailAndPassword(auth, email, pass);
            await setDoc(doc(db, "users", res.user.uid), {
                uid: res.user.uid,
                nickname: nick,
                emoji: "👤",
                avatarUrl: null,
                isVerify: false,
                isOnline: true,
                lastSeen: serverTimestamp()
            });
        } else {
            await signInWithEmailAndPassword(auth, email, pass);
        }
    } catch (e) {
        alert(e.message);
    }
};

onAuthStateChanged(auth, async (u) => {
    if (u) {
        const d = await getDoc(doc(db, "users", u.uid));
        user = d.data();
        el('auth-screen').style.display = 'none';
        updateAvatarDisplay();
        setupPresence();
        loadChats();
        listenForIncomingCallsRTDB();
        loadEmojiGrid('smileys');
    } else {
        user = null;
    }
});

window.logoutUser = async () => {
    if (confirm("Вы уверены что хотите выйти?")) {
        try {
            await setOnlineStatus(false);
            await signOut(auth);
            window.location.reload();
        } catch (e) {
            console.error("Logout error:", e);
        }
    }
};

// === UPLOAD PROGRESS ===
function showUploadProgress() {
    const existingProgress = el('upload-progress');
    if (existingProgress) return;

    const progressDiv = document.createElement('div');
    progressDiv.id = 'upload-progress';
    progressDiv.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: var(--bg-sidebar);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 15px;
        min-width: 250px;
        z-index: 5001;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    `;
    progressDiv.innerHTML = `
        <div style="font-weight:600; margin-bottom:8px; font-size:13px;">Загрузка видео...</div>
        <div style="width:100%; height:8px; background:var(--border); border-radius:4px; overflow:hidden;">
            <div id="progress-bar" style="width:0%; height:100%; background:#6366f1; transition:width 0.3s;"></div>
        </div>
        <div id="progress-text" style="font-size:11px; color:var(--text-muted); margin-top:8px; text-align:center;">0%</div>
    `;
    document.body.appendChild(progressDiv);
    uploadProgress = progressDiv;
}

function updateUploadProgress(percent) {
    if (!uploadProgress) showUploadProgress();
    const bar = el('progress-bar');
    const text = el('progress-text');
    if (bar) bar.style.width = percent + '%';
    if (text) text.innerText = percent + '%';
}

function hideUploadProgress() {
    if (uploadProgress) {
        uploadProgress.remove();
        uploadProgress = null;
    }
}

// === FILE UPLOAD ===
el('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !activeChatId) return;

    const fileType = file.type;
    const fileName = file.name;
    const fileSize = file.size;

    if (fileSize > 200 * 1024 * 1024) {
        alert('Файл слишком большой (макс 200MB)');
        return;
    }

    const inputField = el('input-msg');
    const originalPlaceholder = inputField.placeholder;
    inputField.placeholder = `Загрузка ${fileName}...`;
    inputField.disabled = true;

    try {
        let url;
        if (fileType.startsWith('video/')) {
            url = await uploadVideoToCatbox(file);
        } else if (fileType.startsWith('image/')) {
            url = await uploadImageToImgBB(file);
        } else {
            alert('Поддерживаются только видео и изображения');
            return;
        }
        await sendMediaMsg(url, fileType.includes('image') ? 'image' : 'video', fileName);
    } catch (err) {
        alert("Ошибка загрузки: " + err.message);
        console.error(err);
    } finally {
        inputField.placeholder = originalPlaceholder;
        inputField.disabled = false;
        e.target.value = "";
        hideUploadProgress();
    }
});

async function uploadVideoToCatbox(file) {
    return new Promise((resolve, reject) => {
        if (file.size > 200 * 1024 * 1024) {
            reject(new Error("Видео должно быть меньше 200MB"));
            return;
        }

        const formData = new FormData();
        formData.append("reqtype", "fileupload");
        formData.append("fileToUpload", file);

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                updateUploadProgress(Math.round(percentComplete));
            }
        });

        xhr.addEventListener('load', async () => {
            if (xhr.status === 200) {
                const url = xhr.responseText.trim();
                if (url.startsWith("http")) {
                    resolve(url);
                } else {
                    reject(new Error("Ошибка Catbox: " + url));
                }
            } else {
                reject(new Error("Ошибка загрузки на Catbox"));
            }
        });

        xhr.addEventListener('error', () => {
            reject(new Error("Ошибка сети при загрузке видео"));
        });

        xhr.open("POST", "https://catbox.moe/user/api.php");
        xhr.send(formData);
    });
}

async function uploadImageToImgBB(file) {
    const formData = new FormData();
    formData.append("image", file);

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                updateUploadProgress(Math.round(percentComplete));
            }
        });

        xhr.addEventListener('load', async () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                if (data.success) {
                    resolve(data.data.url);
                } else {
                    reject(new Error("Ошибка ImgBB"));
                }
            } else {
                reject(new Error("Ошибка загрузки на ImgBB"));
            }
        });

        xhr.addEventListener('error', () => {
            reject(new Error("Ошибка сети при загрузке из��бражения"));
        });

        xhr.open("POST", `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`);
        xhr.send(formData);
    });
}

async function sendMediaMsg(url, type, fileName = '') {
    const msgObj = {
        text: url,
        type: type,
        fileName: fileName,
        senderId: user.uid,
        senderNick: user.nickname,
        senderVerified: user.isVerify || false,
        createdAt: serverTimestamp()
    };
    if (replyData) {
        msgObj.replyTo = replyData;
        cancelReply();
    }
    await addDoc(collection(db, `chats/${activeChatId}/messages`), msgObj);

    let lastMsg = url;
    if (type === 'video') lastMsg = '🎥 Видео';
    if (type === 'image') lastMsg = '📷 Фото';

    await updateDoc(doc(db, "chats", activeChatId), { lastMessage: lastMsg });
    
    if (!isScrolledToBottom) {
        newMessagesCount++;
        showNewMessagesIndicator(newMessagesCount);
    }
}

// === AVATAR SYSTEM ===
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

// === CHAT LOGIC ===
window.startDM = async () => {
    const nick = el('search-user').value.trim().toLowerCase();
    if (!nick || nick === user.nickname) return;
    const q = query(collection(db, "users"), where("nickname", "==", nick));
    const s = await getDocs(q);
    if (s.empty) return alert("Юзер не найден");
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

window.startDMWithId = async (userId) => {
    const targetDoc = await getDoc(doc(db, "users", userId));
    const target = targetDoc.data();
    const cid = [user.uid, target.uid].sort().join("_");
    await setDoc(doc(db, "chats", cid), {
        id: cid, type: 'dm', members: [user.uid, target.uid],
        nicks: { [user.uid]: user.nickname, [target.uid]: target.nickname },
        emojis: { [user.uid]: user.emoji, [target.uid]: target.emoji },
        avatarUrls: { [user.uid]: user.avatarUrl || null, [target.uid]: target.avatarUrl || null },
        verified: { [user.uid]: user.isVerify || false, [target.uid]: target.isVerify || false },
        lastMessage: "Чат открыт", typing: { [user.uid]: false, [target.uid]: false }
    }, { merge: true });
    closeAllModals();
};

function loadChats() {
    const q = query(collection(db, "chats"), where("members", "array-contains", user.uid));
    onSnapshot(q, (snap) => {
        const list = el('ui-chats');
        list.innerHTML = '';
        snap.forEach(dSnap => {
            const c = dSnap.data();
            let title, avatarHtml, isV = false, otherId = null;
            if (c.type === 'group') {
                title = c.name;
                avatarHtml = c.groupAvatarUrl ? `<img src="${c.groupAvatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : "👥";
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

window.openChat = function(id, name, avatarHtml, isV, chatData) {
    activeChatId = id;
    activeChatMembers = chatData.members;
    let otherId = chatData.type === 'dm' ? chatData.members.find(u => u !== user.uid) : null;

    el('active-name').innerHTML = `${name} ${getBadge(isV)}`;
    el('active-emoji').innerHTML = avatarHtml;
    el('add-member-btn').style.display = chatData.type === 'group' ? 'block' : 'none';
    el('btn-call').style.display = 'block';
    el('btn-voice-call').style.display = 'block';
    el('btn-group-settings').style.display = chatData.type === 'group' ? 'block' : 'none';
    el('app').classList.add('show-chat');
    cancelReply();

    newMessagesCount = 0;
    hideNewMessagesIndicator();
    isScrolledToBottom = true;

    if (unsubMsgs) unsubMsgs();
    if (unsubStatus) unsubStatus();
    if (unsubTyping) unsubTyping();

    if (otherId) {
        unsubStatus = onSnapshot(doc(db, "users", otherId), (uDoc) => {
            el('active-status-dot').className = `status-dot ${uDoc.data()?.isOnline ? 'dot-online' : 'dot-offline'}`;
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
        const box = el('ui-msgs');
        const wasAtBottom = isScrolledToBottom;
        
        box.innerHTML = '';
        let hasNewMessages = false;
        
        snap.forEach(mDoc => {
            const m = mDoc.data();
            const mId = mDoc.id;
            const isMine = m.senderId === user.uid;
            let replyHtml = m.replyTo ? `<div class="reply-quote" onclick="document.getElementById('m-${m.replyTo.mId}').scrollIntoView({behavior:'smooth'})"><b>@${m.replyTo.nick}</b><br>${m.replyTo.text.substring(0, 30)}</div>` : '';

            let content = m.text;
            if (m.type === "image") content = `<img src="${m.text}" style="max-width:100%; border-radius:15px; margin-top:5px; cursor:pointer;" onclick="window.open('${m.text}')">`;
            if (m.type === "video") content = `<video src="${m.text}" controls style="max-width:100%; border-radius:15px; margin-top:5px; background:#000;"></video>`;

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
            
            if (!isMine && !wasAtBottom) {
                hasNewMessages = true;
            }
        });
        
        if (wasAtBottom) {
            box.scrollTop = box.scrollHeight;
            hideNewMessagesIndicator();
        } else if (hasNewMessages) {
            newMessagesCount++;
            showNewMessagesIndicator(newMessagesCount);
        }
    });
};

window.closeChat = () => {
    el('app').classList.remove('show-chat');
    if (unsubMsgs) unsubMsgs();
    activeChatId = null;
    activeChatMembers = [];
};

window.sendMsg = async () => {
    const inp = el('input-msg');
    const txt = inp.value.trim();
    if (!txt || !activeChatId) return;
    inp.value = '';
    await updateDoc(doc(db, "chats", activeChatId), { [`typing.${user.uid}`]: false });

    try {
        const msgObj = { text: txt, senderId: user.uid, senderNick: user.nickname, senderVerified: user.isVerify || false, createdAt: serverTimestamp() };
        if (replyData) {
            msgObj.replyTo = replyData;
            cancelReply();
        }
        await addDoc(collection(db, `chats/${activeChatId}/messages`), msgObj);
        await updateDoc(doc(db, "chats", activeChatId), { lastMessage: txt });
        
        if (!isScrolledToBottom) {
            newMessagesCount++;
            showNewMessagesIndicator(newMessagesCount);
        }
    } catch (e) {
        console.error(e);
    }
};

el('input-msg').onkeydown = (e) => {
    if (e.key === 'Enter') sendMsg();
};

// === WEBRTC VIDEO CALL ===
const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };

window.toggleMic = () => {
    if (localStream) {
        const track = localStream.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            el('btn-mic').innerHTML = track.enabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
            el('btn-mic').style.background = track.enabled ? '#334155' : '#ef4444';
        }
    }
};

window.toggleCam = () => {
    if (localStream) {
        const track = localStream.getVideoTracks()[0];
        if (track) {
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
    } catch (e) {
        alert("Нет доступа к камере/микрофону");
        throw e;
    }
}

window.startCall = async () => {
    if (!activeChatId) return;
    currentCallRoom = activeChatId;

    activeChatMembers.forEach(memberId => {
        if (memberId !== user.uid) {
            set(ref(rtdb, `ringing/${memberId}`), {
                roomId: currentCallRoom,
                callerNick: user.nickname,
                timestamp: Date.now()
            });
        }
    });

    await joinCallRoom(currentCallRoom);
};

function listenForIncomingCallsRTDB() {
    onValue(ref(rtdb, `ringing/${user.uid}`), (snap) => {
        const data = snap.val();
        if (data && (Date.now() - data.timestamp < 30000)) {
            currentCallRoom = data.roomId;
            el('caller-name').innerText = `@${data.callerNick} приглашает в видео-звонок...`;
            el('modal-incoming-call').style.display = 'flex';
        } else {
            el('modal-incoming-call').style.display = 'none';
        }
    });
}

window.answerCall = async () => {
    el('modal-incoming-call').style.display = 'none';
    await remove(ref(rtdb, `ringing/${user.uid}`));
    if (currentCallRoom) await joinCallRoom(currentCallRoom);
};

window.rejectCall = async () => {
    el('modal-incoming-call').style.display = 'none';
    await remove(ref(rtdb, `ringing/${user.uid}`));
};

async function joinCallRoom(roomId) {
    el('call-screen').style.display = 'flex';
    await setupLocalMedia();

    const myPresenceRef = ref(rtdb, `calls/${roomId}/participants/${user.uid}`);
    await set(myPresenceRef, true);
    onDisconnect(myPresenceRef).remove();

    onChildAdded(ref(rtdb, `calls/${roomId}/participants`), (snap) => {
        const peerUid = snap.key;
        if (peerUid !== user.uid) {
            const isInitiator = user.uid > peerUid;
            setupPeerConnection(peerUid, roomId, isInitiator);
        }
    });

    onValue(ref(rtdb, `calls/${roomId}/participants`), (snap) => {
        const activeUsers = snap.val() || {};
        Object.keys(peers).forEach(peerUid => {
            if (!activeUsers[peerUid]) removePeer(peerUid);
        });
    });
}

async function setupPeerConnection(peerUid, roomId, isInitiator) {
    if (peers[peerUid]) return;

    const pc = new RTCPeerConnection(servers);
    peers[peerUid] = pc;

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

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

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            push(ref(rtdb, `calls/${roomId}/signals/${user.uid}_${peerUid}/candidates`), e.candidate.toJSON());
        }
    };

    onChildAdded(ref(rtdb, `calls/${roomId}/signals/${peerUid}_${user.uid}/candidates`), (snap) => {
        if (snap.val()) pc.addIceCandidate(new RTCIceCandidate(snap.val()));
    });

    if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await set(ref(rtdb, `calls/${roomId}/signals/${user.uid}_${peerUid}/offer`), offer);

        onValue(ref(rtdb, `calls/${roomId}/signals/${peerUid}_${user.uid}/answer`), async (snap) => {
            const answer = snap.val();
            if (answer && pc.signalingState !== "closed") {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            }
        });
    } else {
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
        Object.keys(peers).forEach(peerUid => {
            remove(ref(rtdb, `calls/${currentCallRoom}/signals/${user.uid}_${peerUid}`));
        });
    }

    Object.keys(peers).forEach(peerUid => removePeer(peerUid));
    if (localStream) localStream.getTracks().forEach(t => t.stop());

    localStream = null;
    currentCallRoom = null;
    await remove(ref(rtdb, `ringing/${user.uid}`));
};

// === VOICE CALL ===
window.startVoiceCall = async () => {
    if (!activeChatId) return;
    voiceCallActive = true;
    voiceCallStartTime = Date.now();

    try {
        voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        el('voice-call-screen').style.display = 'flex';

        el('voice-caller-name').innerText = '@Voice Call';

        activeChatMembers.forEach(memberId => {
            if (memberId !== user.uid) {
                set(ref(rtdb, `voice_ringing/${memberId}`), {
                    roomId: activeChatId,
                    callerNick: user.nickname,
                    timestamp: Date.now()
                });
            }
        });

        startVoiceCallTimer();
    } catch (e) {
        alert("Нет доступа к микрофону");
        voiceCallActive = false;
    }
};

window.startVoiceCallTimer = () => {
    voiceCallTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - voiceCallStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        el('call-timer').innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }, 1000);
};

window.toggleVoiceMic = () => {
    if (voiceStream) {
        const track = voiceStream.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            el('voice-btn-mic').innerHTML = track.enabled
                ? '<i class="fa-solid fa-microphone"></i>'
                : '<i class="fa-solid fa-microphone-slash"></i>';
            el('voice-btn-mic').style.background = track.enabled ? '#334155' : '#ef4444';
        }
    }
};

window.toggleSpeaker = () => {
    const btn = el('voice-btn-speaker');
    const isOn = btn.style.background === 'rgb(51, 65, 85)';
    btn.style.background = isOn ? '#ef4444' : '#334155';
    btn.innerHTML = isOn
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
};

window.endVoiceCall = async () => {
    voiceCallActive = false;
    if (voiceCallTimer) clearInterval(voiceCallTimer);
    if (voiceStream) voiceStream.getTracks().forEach(t => t.stop());

    el('voice-call-screen').style.display = 'none';

    activeChatMembers.forEach(memberId => {
        if (memberId !== user.uid) {
            remove(ref(rtdb, `voice_ringing/${memberId}`));
        }
    });
};

// === SCREEN SHARE ===
window.toggleScreenShare = async () => {
    if (screenSharing) {
        stopScreenShare();
    } else {
        await startScreenShare();
    }
};

window.startScreenShare = async () => {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                displaySurface: "monitor"
            },
            audio: false
        });

        const videoElement = el('screen-video');
        videoElement.srcObject = screenStream;
        el('screen-share-preview').style.display = 'block';

        const btn = el('btn-screen-share');
        btn.style.background = '#22c55e';
        btn.innerHTML = '<i class="fa-solid fa-display"></i>';

        screenSharing = true;

        if (localStream && currentCallRoom) {
            const screenTrack = screenStream.getVideoTracks()[0];
            Object.keys(peers).forEach(peerUid => {
                const sender = peers[peerUid].getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                }
            });
        }

        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };
    } catch (err) {
        console.error("Error sharing screen:", err);
        if (err.name !== "NotAllowedError") {
            alert("Ошибка при запросе экрана");
        }
    }
};

window.stopScreenShare = async () => {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    el('screen-share-preview').style.display = 'none';

    const btn = el('btn-screen-share');
    btn.style.background = '#334155';
    btn.innerHTML = '<i class="fa-solid fa-display"></i>';

    screenSharing = false;

    if (localStream && currentCallRoom) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            Object.keys(peers).forEach(peerUid => {
                const sender = peers[peerUid].getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });
        }
    }
};

// === PROFILE ===
window.openProfile = () => {
    openModal('modal-profile');
    el('profile-nick').innerText = "@" + user.nickname;

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

// === USER PROFILE ===
window.openUserProfile = async (userId) => {
    try {
        const userDoc = await getDoc(doc(db, "users", userId));
        const userData = userDoc.data();

        selectedUserProfile = {
            uid: userId,
            ...userData
        };

        el('profile-user-nick').innerText = "@" + userData.nickname;
        el('profile-status-text').innerText = userData.isOnline ? "В сети" : "Не в сети";
        el('profile-user-status').querySelector('.status-dot').className =
            `status-dot ${userData.isOnline ? 'dot-online' : 'dot-offline'}`;

        const avatarDiv = el('user-profile-content').querySelector('.user-avatar-large');
        if (userData.avatarUrl) {
            avatarDiv.innerHTML = `<img src="${userData.avatarUrl}">`;
        } else {
            avatarDiv.innerText = userData.emoji || "👤";
        }

        openModal('modal-user-profile');
    } catch (e) {
        console.error("Error loading profile:", e);
    }
};

window.startDMWithNick = async () => {
    if (!selectedUserProfile) return;
    const cid = [user.uid, selectedUserProfile.uid].sort().join("_");
    await setDoc(doc(db, "chats", cid), {
        id: cid,
        type: 'dm',
        members: [user.uid, selectedUserProfile.uid],
        nicks: { [user.uid]: user.nickname, [selectedUserProfile.uid]: selectedUserProfile.nickname },
        emojis: { [user.uid]: user.emoji, [selectedUserProfile.uid]: selectedUserProfile.emoji },
        avatarUrls: { [user.uid]: user.avatarUrl || null, [selectedUserProfile.uid]: selectedUserProfile.avatarUrl || null },
        verified: { [user.uid]: user.isVerify || false, [selectedUserProfile.uid]: selectedUserProfile.isVerify || false },
        lastMessage: "Чат открыт",
        typing: { [user.uid]: false, [selectedUserProfile.uid]: false }
    }, { merge: true });
    closeAllModals();
};

window.startCallWithNick = async () => {
    if (!selectedUserProfile) return;
    const cid = [user.uid, selectedUserProfile.uid].sort().join("_");
    activeChatId = cid;
    activeChatMembers = [user.uid, selectedUserProfile.uid];
    closeAllModals();
    await startCall();
};

window.startCallWithId = async (userId) => {
    const cid = [user.uid, userId].sort().join("_");
    activeChatId = cid;
    activeChatMembers = [user.uid, userId];
    closeAllModals();
    await startCall();
};

// === CONTACTS ===
window.loadContacts = async () => {
    const q = query(collection(db, "chats"), where("members", "array-contains", user.uid));
    const snap = await getDocs(q);
    const contactsContainer = el('contacts-list');
    contactsContainer.innerHTML = '';

    const contacts = new Map();
    snap.forEach(doc => {
        const chat = doc.data();
        if (chat.type === 'dm') {
            const otherId = chat.members.find(id => id !== user.uid);
            if (otherId && !contacts.has(otherId)) {
                contacts.set(otherId, {
                    nick: chat.nicks[otherId],
                    emoji: chat.emojis[otherId],
                    avatar: chat.avatarUrls?.[otherId],
                    id: otherId
                });
            }
        }
    });

    if (contacts.size === 0) {
        contactsContainer.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Нет контактов</div>';
        return;
    }

    contacts.forEach(contact => {
        const div = document.createElement('div');
        div.className = 'contact-item';
        const avatar = contact.avatar
            ? `<img src="${contact.avatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`
            : contact.emoji;

        div.innerHTML = `
            <div class="contact-info">
                <div class="contact-avatar">${avatar}</div>
                <span style="font-weight:500;">@${contact.nick}</span>
            </div>
            <div class="contact-action">
                <button onclick="startDMWithId('${contact.id}')" title="Сообщение">
                    <i class="fa-solid fa-comment"></i>
                </button>
                <button onclick="startCallWithId('${contact.id}')" title="Звонок">
                    <i class="fa-solid fa-phone"></i>
                </button>
            </div>
        `;
        contactsContainer.appendChild(div);
    });
};

// === SETTINGS ===
window.toggleNotifications = () => {
    const enabled = localStorage.getItem('notifications') !== 'false';
    localStorage.setItem('notifications', !enabled);
    el('notif-toggle').style.opacity = enabled ? '0.5' : '1';
};

window.clearCache = () => {
    if (confirm('Очистить весь кэш?')) {
        localStorage.clear();
        alert('Кэш очищен!');
    }
};

// === GROUPS ===
window.confirmCreateGroup = async () => {
    const name = el('new-group-name').value.trim();
    if (!name) return;
    await addDoc(collection(db, "chats"), { name, type: 'group', members: [user.uid], lastMessage: "Группа создана", typing: {}, emoji: "👥" });
    el('new-group-name').value = '';
    closeAllModals();
};

window.confirmAddMember = async () => {
    const nick = el('member-nick').value.trim().toLowerCase();
    const q = query(collection(db, "users"), where("nickname", "==", nick));
    const s = await getDocs(q);
    if (s.empty) return alert("Не найден");
    await updateDoc(doc(db, "chats", activeChatId), { members: arrayUnion(s.docs[0].data().uid) });

    if (!activeChatMembers.includes(s.docs[0].data().uid)) activeChatMembers.push(s.docs[0].data().uid);

    el('member-nick').value = '';
    closeAllModals();
};

window.openGroupSettingsBtn = () => {
    openGroupSettings(activeChatId);
};

window.openGroupSettings = async (groupId) => {
    activeGroupId = groupId;
    try {
        const groupDoc = await getDoc(doc(db, "chats", groupId));
        const group = groupDoc.data();

        el('group-name-input').value = group.name || '';
        el('group-avatar').innerText = group.emoji || '👥';

        const membersList = el('members-list');
        membersList.innerHTML = '';

        for (let memberId of group.members) {
            const userDoc = await getDoc(doc(db, "users", memberId));
            const userData = userDoc.data();

            const div = document.createElement('div');
            div.className = 'member-item';

            const avatar = userData.avatarUrl
                ? `<img src="${userData.avatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`
                : userData.emoji;

            const isAdmin = memberId === group.members[0];

            div.innerHTML = `
                <div class="member-info">
                    <div class="member-avatar">${avatar}</div>
                    <div>
                        <div style="font-weight:500;">@${userData.nickname}</div>
                        <div class="member-role">${isAdmin ? 'Администратор' : 'Участник'}</div>
                    </div>
                </div>
                <div class="member-actions">
                    ${memberId !== user.uid ? `<button onclick="removeMember('${memberId}')"><i class="fa-solid fa-trash"></i></button>` : ''}
                </div>
            `;
            membersList.appendChild(div);
        }

        openModal('modal-group-settings');
    } catch (e) {
        console.error("Error loading group settings:", e);
    }
};

window.updateGroupName = async () => {
    const name = el('group-name-input').value.trim();
    if (!name || !activeGroupId) return alert('Введите название');

    try {
        await updateDoc(doc(db, "chats", activeGroupId), { name });
        alert('Название обновлено!');
    } catch (e) {
        console.error(e);
    }
};

window.uploadGroupAvatar = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file || !activeGroupId) return;

        try {
            const formData = new FormData();
            formData.append("image", file);
            const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
                { method: "POST", body: formData });
            const data = await response.json();

            if (data.success) {
                await updateDoc(doc(db, "chats", activeGroupId), {
                    groupAvatarUrl: data.data.url
                });
                el('group-avatar').innerHTML = `<img src="${data.data.url}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;">`;
                alert('Аватар обновлен!');
            }
        } catch (err) {
            console.error(err);
            alert('Ошибка загрузки');
        }
    };
    input.click();
};

window.removeMember = async (memberId) => {
    if (!confirm('Удалить участника?') || !activeGroupId) return;
    try {
        const groupDoc = await getDoc(doc(db, "chats", activeGroupId));
        const members = groupDoc.data().members.filter(id => id !== memberId);
        await updateDoc(doc(db, "chats", activeGroupId), { members });
        openGroupSettings(activeGroupId);
    } catch (e) {
        console.error(e);
    }
};

window.deleteGroup = async () => {
    if (!confirm('Удалить группу? Это необратимо!') || !activeGroupId) return;
    try {
        await deleteDoc(doc(db, "chats", activeGroupId));
        closeAllModals();
        alert('Группа удалена!');
    } catch (e) {
        console.error(e);
    }
};

// === EMOJI PICKER ===
window.filterEmojis = (category) => {
    currentEmojiCategory = category;
    document.querySelectorAll('.emoji-cat-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === category);
    });
    loadEmojiGrid(category);
};

window.loadEmojiGrid = (category) => {
    const grid = el('emoji-picker-grid');
    grid.innerHTML = '';

    emojisByCategory[category].forEach(emoji => {
        const span = document.createElement('span');
        span.className = 'emoji-picker-item';
        span.innerText = emoji;
        span.onclick = () => insertEmoji(emoji);
        grid.appendChild(span);
    });
};

window.insertEmoji = (emoji) => {
    const input = el('input-msg');
    input.value += emoji;
    input.focus();
    closeAllModals();
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    el('theme-toggle').style.opacity = isDarkMode ? '1' : '0.5';
    loadEmojiGrid('smileys');

    const contactsModal = el('modal-contacts');
    if (contactsModal) {
        const observer = new MutationObserver(() => {
            if (contactsModal.style.display === 'flex') {
                loadContacts();
            }
        });
        observer.observe(contactsModal, { attributes: true, attributeFilter: ['style'] });
    }
});
