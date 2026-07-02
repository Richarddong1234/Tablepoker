const socket = io();

const statusBadge = document.getElementById('conn-status');
const chatMessages = document.getElementById('chat-messages');
const playersContainer = document.getElementById('players-container');
const hashDisplay = document.getElementById('hash-display');
const verifySection = document.getElementById('verify-section');
const secretDisplay = document.getElementById('secret-display');
const potDisplay = document.getElementById('pot-display');
const actionBar = document.getElementById('action-bar');
const btnStart = document.getElementById('btn-start');
const btnExtraTime = document.getElementById('btn-extra-time');
const btnReveal = document.getElementById('btn-reveal');

let revealedDeck = null;
let myId = null;
let myState = null;
let currentState = null;
let isDealing = false;
let currentRoom = null;

// --- Sound Engine ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTone(freq, type, duration, vol=0.1) {
    if(!document.getElementById('setting-sound').checked) return;
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
}
const playChipSound = () => { playTone(600, 'sine', 0.1, 0.2); setTimeout(()=>playTone(800, 'sine', 0.1, 0.1), 50); };
const playCardSound = () => playTone(300, 'triangle', 0.1, 0.1);
const playFoldSound = () => playTone(200, 'sawtooth', 0.3, 0.1);


// --- Scaling ---
function resizeTable() {
    const wrapper = document.querySelector('.table-wrapper');
    if (!wrapper) return;
    const scaleX = window.innerWidth / 1000;
    const scaleY = (window.innerHeight - 100) / 700;
    let scale = Math.min(scaleX, scaleY);
    if(scale > 1.2) scale = 1.2;
    wrapper.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', resizeTable);
setTimeout(resizeTable, 500);

window.createGame = function() {
    socket.emit('create_room');
};

window.joinRoom = function() {
    const code = document.getElementById('join-code').value.toUpperCase().trim();
    if(code.length === 4) socket.emit('join_room', code);
};



socket.on('room_joined', (roomCode) => {
    currentRoom = roomCode;
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'block';
    document.getElementById('room-code-display').textContent = `Room: ${roomCode}`;
    document.getElementById('join-modal').classList.add('visible');
    
    // Hide ambient glows from home screen if needed
    document.querySelectorAll('.ambient-glow').forEach(el => el.style.opacity = '0.3');
});

socket.on('room_error', (msg) => {
    alert(msg);
});

let initialBuyIns = {};

const seatPositions = [
    { top: '115%', left: '50%' }, // Me 
    { top: '50%', left: '-5%' },  // P2 
    { top: '5%', left: '15%' },   // P3 
    { top: '5%', left: '85%' },   // P4 
    { top: '50%', left: '105%' }  // P5 
];

function parseCard(cardStr) {
    if(!cardStr) return {v: '', s: ''};
    const v = cardStr[0];
    const s = cardStr[1];
    let suitSymbol = '';
    let colorClass = 'black';
    if (s === 'h') { suitSymbol = '♥'; colorClass = 'red'; }
    if (s === 'd') { suitSymbol = '♦'; colorClass = 'red'; }
    if (s === 'c') { suitSymbol = '♣'; }
    if (s === 's') { suitSymbol = '♠'; }
    return { val: v, sym: suitSymbol, color: colorClass };
}

function createFlyingCard(targetId, cardStr, delayMs, offsetX, rot, shouldFlipDelay = 0) {
    setTimeout(() => {
        const dealerDeck = document.getElementById('dealer-deck');
        const targetContainer = document.getElementById(targetId);
        if(!targetContainer || !dealerDeck) return;

        const cardDOM = document.createElement('div');
        cardDOM.className = 'card';
        const parsed = parseCard(cardStr);
        cardDOM.classList.add(parsed.color);
        cardDOM.innerHTML = `
            <div class="card-inner">
                <div class="card-back"></div>
                <div class="card-front">${parsed.val}<div style="font-size: 1.5em">${parsed.sym}</div></div>
            </div>
        `;
        document.body.appendChild(cardDOM);
        
        const startRect = dealerDeck.getBoundingClientRect();
        cardDOM.style.top = `${startRect.top}px`;
        cardDOM.style.left = `${startRect.left}px`;
        cardDOM.getBoundingClientRect(); 
        
        const endRect = targetContainer.getBoundingClientRect();
        cardDOM.style.top = `${endRect.top}px`;
        cardDOM.style.left = `${endRect.left + offsetX}px`;
        cardDOM.style.transform = `rotate(${rot}deg)`;
        
        if(shouldFlipDelay > 0) {
            setTimeout(() => cardDOM.classList.add('flipped'), 600);
        }
    }, delayMs);
}

socket.on('connect', () => {
    myId = socket.id;
    statusBadge.textContent = 'Connected';
    statusBadge.classList.add('connected');
});

socket.on('player_action', (data) => {
    // If we wanted to play sounds globally based on actions we could,
    // but chat_message is easier to hook into below.
});

socket.on('chat_message', (data) => {
    const chatMsgs = document.getElementById('chat-messages');
    const el = document.createElement('div');
    const txt = data.text;
    const isAction = (txt === 'Folded' || txt === 'Check' || txt.startsWith('Call') || txt.startsWith('Raised') || txt === 'Revealed hand.');
    const isSystem = (data.sender === 'System' || data.sender === 'Dealer' || isAction);
    
    el.className = 'msg ' + (isSystem ? 'system' : '');
    el.innerHTML = `<span class="sender">${data.sender}:</span> ${txt}`;
    chatMsgs.appendChild(el);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;

    if (isAction && typeof currentState !== 'undefined') {
        let pId = null;
        for (let id in currentState.players) {
            if (currentState.players[id].name === data.sender) pId = id;
        }
        if (pId) {
            const bubble = document.getElementById('bubble-' + pId);
            if (bubble) {
                bubble.innerText = txt;
                bubble.classList.add('show');
                if(bubble.hideTimeout) clearTimeout(bubble.hideTimeout);
                bubble.hideTimeout = setTimeout(() => bubble.classList.remove('show'), 2000);
            }
        }
    }
    
    // Play sounds based on text
    if(data.text.includes('Fold')) playFoldSound();
    else if(data.text.includes('Check')) playCheckSound();
    else if(data.text.includes('Call') || data.text.includes('Raise')) playChipSound();
});

socket.on('player_bubble', (data) => {
    const bubble = document.getElementById(`bubble-${data.playerId}`);
    if (bubble) {
        bubble.textContent = data.text;
        bubble.classList.add('show');
        setTimeout(() => bubble.classList.remove('show'), 2500);
    }
});

socket.on('player_win', (data) => {
    playWinSound();
    triggerConfetti();
    const seat = document.getElementById('info-' + data.id);
    const fxContainer = document.getElementById('win-fx-container');
    if(seat && fxContainer) {
        seat.classList.add('player-win-anim');
        
        if (data.amount) {
            const popup = document.createElement('div');
            popup.className = 'win-amount-popup';
            popup.innerText = `+${data.amount}`;
            
            const seatRect = seat.getBoundingClientRect();
            const tableRect = fxContainer.getBoundingClientRect();
            
            popup.style.left = (seatRect.left - tableRect.left + seatRect.width/2) + 'px';
            popup.style.top = (seatRect.top - tableRect.top) + 'px';
            
            fxContainer.appendChild(popup);
            setTimeout(() => popup.remove(), 3000);
        }

        setTimeout(() => seat.classList.remove('player-win-anim'), 3000);
    }
});

let timerInterval = null;
function startVisualTimer(id, ms) {
    clearInterval(timerInterval);
    
    setTimeout(() => {
        document.querySelectorAll('.timer-text').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.timer-rect').forEach(r => {
            r.style.transition = 'none';
            r.style.strokeDashoffset = '100';
            r.style.stroke = '#10b981';
        });
        
        const tText = document.getElementById(`timer-text-${id}`);
        const rect = document.getElementById(`timer-rect-${id}`);
        
        if (tText) {
            tText.style.display = 'none';
            let endTime = Date.now() + ms;
            timerInterval = setInterval(() => {
                let rem = Math.max(0, endTime - Date.now());
                tText.textContent = Math.ceil(rem / 1000);
                if (rem <= 0) clearInterval(timerInterval);
            }, 100);
        }

        if (rect) {
            rect.getBoundingClientRect(); 
            rect.style.transition = `stroke-dashoffset ${ms}ms linear, stroke ${ms}ms linear`;
            rect.style.strokeDashoffset = '0';
            rect.style.stroke = '#ef4444'; 
        }
    }, 50);
}

// Clean elegant chip rendering for side player balances
function renderChipStack(amount, isLeft, isMe = false) {
    if (amount <= 0) return '';
    
    const denoms = [
        { val: 1000, color: '#facc15' },
        { val: 500, color: '#a855f7' }, 
        { val: 100, color: '#1f2937' }, 
        { val: 25, color: '#10b981' },   
        { val: 5, color: '#ef4444' }     
    ];

    let remaining = amount;
    let visualChips = [];
    
    for (let d of denoms) {
        if (remaining >= d.val) {
            let actualCount = Math.floor(remaining / d.val);
            let visualCount = actualCount * 6; 
            for(let c = 0; c < visualCount; c++) {
                visualChips.push({ color: d.color });
            }
            remaining %= d.val;
        }
    }
    
    let stacks = [];
    for(let i = 0; i < visualChips.length; i += 15) {
        stacks.push(visualChips.slice(i, i + 15));
    }
    
    stacks = stacks.slice(0, 6);

    let html = '';
    for (let s = 0; s < stacks.length; s++) {
        let stackData = stacks[s];
        let offset = isLeft ? -(s * 28) : (s * 28);
        
        html += `<div class="single-stack" style="left: ${offset}px;">`;
        for (let i = 0; i < stackData.length; i++) {
            let chip = stackData[i];
            html += `<div class="static-chip ${isMe ? 'interactable-chip' : ''}" style="bottom: ${i * 5}px; background: repeating-conic-gradient(${chip.color} 0 36deg, #fff 36deg 72deg);"></div>`;
        }
        html += `</div>`;
    }
    return html;
}

socket.on('game_state', (state) => {
    currentState = state;
    potDisplay.innerHTML = `<i class="fas fa-coins"></i> Pot: ${state.pot}`;
    
    Object.keys(state.players).forEach(id => {
        if (!initialBuyIns[id]) {
            initialBuyIns[id] = state.players[id].chips;
        }
    });
    
    if (state.gameState === 'waiting' || state.gameState === 'showdown') {
        actionBar.classList.remove('visible');
        btnExtraTime.style.display = 'none';
        
        if (state.gameState === 'showdown') {
            btnReveal.style.display = 'block';
        }
    } else {
        btnReveal.style.display = 'none';
        
        if (state.activePlayerId === myId) {
            btnExtraTime.style.display = 'block';
        } else {
            btnExtraTime.style.display = 'none';
        }
    }

    playersContainer.innerHTML = '';
    const playerIds = Object.keys(state.players);
    let myIndex = playerIds.indexOf(myId);
    if(myIndex === -1) myIndex = 0;

    playerIds.forEach((id, i) => {
        const p = state.players[id];
        let seatIdx = (i - myIndex + playerIds.length) % playerIds.length;
        if(seatIdx >= seatPositions.length) seatIdx = 0;
        
        const pos = seatPositions[seatIdx];
        const isMe = id === myId;
        if (isMe) myState = p;
        const isActiveTurn = id === state.activePlayerId;
        
        const seat = document.createElement('div');
        seat.className = `player-seat`;
        seat.style.top = pos.top;
        seat.style.left = pos.left;
        
        let isLeft = seatIdx === 1 || seatIdx === 2; seat.id = `info-${id}`;
        if (p.status === 'folded') seat.classList.add('player-folded');
        
        let stackClass = isLeft ? 'player-stack-left' : 'player-stack-right';

        // Elegant single-chip display for bets instead of messy stacks
        let betHTML = p.bet > 0 ? `<div class="player-bet-display"><div class="single-bet-chip ${isMe ? 'interactable-chip' : ''}">${p.bet}</div></div>` : '';
        
        seat.innerHTML = `
            ${betHTML}
            <div class="player-info ${isActiveTurn ? 'active' : ''}" id="info-${id}">
                <div class="action-bubble" id="bubble-${id}"></div>
                <svg class="timer-svg">
                    <rect class="timer-rect" id="timer-rect-${id}" x="0" y="0" width="100%" height="100%" pathLength="100"></rect>
                </svg>
                <div class="timer-text" id="timer-text-${id}" style="display: none;"></div>
                
                <div class="player-info-inner">
                    <div>${p.name} ${isMe ? '(You)' : ''} ${p.wins > 0 ? `<span class="win-crown-badge">👑 ${p.wins}</span>` : ''}</div>
                    <div class="player-status-text">${p.status}</div>
                    <div class="player-chips"><i class="fas fa-coins"></i> ${p.chips}</div>
                    ${p.handHint ? `<div class="hand-hint"><i class="fas fa-magic"></i> ${p.handHint}</div>` : ''}
                </div>
                <div class="chip-stack ${stackClass}">${renderChipStack(p.chips, isLeft, isMe)}</div>
            </div>
            <div class="player-cards-container" id="player-cards-${id}"></div>
        `;
        playersContainer.appendChild(seat);
    });

    if (state.activePlayerId === myId) {
        actionBar.classList.add('visible');
        let toCall = state.currentBet - myState.bet;
        document.getElementById('call-amt').textContent = `To Call: ${toCall}`;
        document.getElementById('btn-call').textContent = toCall === 0 ? 'Check' : 'Call';
    } else {
        actionBar.classList.remove('visible');
    }

    if (state.roundsPlayed >= 10 && document.getElementById('btn-change-dealer')) {
        document.getElementById('btn-change-dealer').style.display = 'block';
    } else if (document.getElementById('btn-change-dealer')) {
        document.getElementById('btn-change-dealer').style.display = 'none';
    }

    const btnSitOut = document.getElementById('btn-sit-out');
    const btnLeave = document.getElementById('btn-leave');
    const btnPause = document.getElementById('btn-pause');
    
    if(btnSitOut) btnSitOut.style.display = 'inline-block';
    if(btnLeave) btnLeave.style.display = 'inline-block';
    
    if (state.hostId === myId) {
        if(btnPause) {
            btnPause.style.display = 'inline-block';
            btnPause.innerHTML = state.isPaused ? '<i class="fas fa-play"></i> Resume Auto-Deal' : '<i class="fas fa-pause"></i> Pause Auto-Deal';
        }
        if(btnStart) {
            btnStart.style.display = (state.gameState === 'waiting' || state.gameState === 'showdown') ? 'inline-block' : 'none';
        }
    } else {
        if(btnPause) btnPause.style.display = 'none';
        if(btnStart) btnStart.style.display = 'none';
    }

    // Auto-restore cards if missing (fixes the refresh wiping bug)
    if (state.gameState !== 'waiting' && !isDealing) {
        const existingCards = document.querySelectorAll('body > .card');
        if (existingCards.length === 0) {
            // Restore instantly without dealer animation
            Object.keys(state.players).forEach(id => {
                const p = state.players[id];
                if (id === myId && p.cards) {
                    createFlyingCardInstantly(`player-cards-${id}`, p.cards[0], -10, 10, 1);
                    createFlyingCardInstantly(`player-cards-${id}`, p.cards[1], 10, -10, 1);
                } else if (p.status !== 'folded' && p.status !== 'waiting') {
                    createFlyingCardInstantly(`player-cards-${id}`, null, -10, 10, 0);
                    createFlyingCardInstantly(`player-cards-${id}`, null, 10, -10, 0);
                }
            });
            if (state.communityCards) {
                state.communityCards.forEach((c, idx) => {
                    createFlyingCardInstantly(`slot-${idx}`, c, 0, 0, 1);
                });
            }
        }
    }
});

function createFlyingCardInstantly(targetId, cardStr, offsetX, rot, flipped = 0) {
    const targetContainer = document.getElementById(targetId);
    if(!targetContainer) return;

    const cardDOM = document.createElement('div');
    cardDOM.className = 'card';
    if(flipped) cardDOM.classList.add('flipped');
    
    if (cardStr) {
        const parsed = parseCard(cardStr);
        cardDOM.classList.add(parsed.color);
        cardDOM.innerHTML = `
            <div class="card-inner">
                <div class="card-back"></div>
                <div class="card-front">${parsed.val}<div style="font-size: 1.5em">${parsed.sym}</div></div>
            </div>
        `;
    } else {
        cardDOM.innerHTML = `
            <div class="card-inner">
                <div class="card-back"></div>
                <div class="card-front"></div>
            </div>
        `;
    }

    document.body.appendChild(cardDOM);
    
    setTimeout(() => {
        const endRect = document.getElementById(targetId).getBoundingClientRect();
        cardDOM.style.top = `${endRect.top}px`;
        cardDOM.style.left = `${endRect.left + offsetX}px`;
        cardDOM.style.transform = `rotate(${rot}deg)`;
        cardDOM.style.transition = 'none'; // Instant sync
    }, 50);
}

socket.on('turn_start', (data) => {
    startVisualTimer(data.playerId, data.time);
});

socket.on('turn_extended', (data) => {
    startVisualTimer(data.playerId, data.time);
});

socket.on('chip_anim', (data) => {
    const pSeat = document.getElementById(`info-${data.playerId}`);
    const pot = document.getElementById('pot-display');
    if(!pSeat || !pot) return;

    const chip = document.createElement('div');
    chip.className = 'anim-chip';
    document.body.appendChild(chip);

    const start = pSeat.getBoundingClientRect();
    chip.style.top = `${start.top + 20}px`;
    chip.style.left = `${start.left + 50}px`;
    chip.style.transform = `scale(1) rotate(0deg)`;

    chip.getBoundingClientRect(); 

    const end = pot.getBoundingClientRect();
    chip.style.top = `${end.top + 10}px`;
    chip.style.left = `${end.left + 30}px`;
    chip.style.transform = `scale(0.8) rotate(${Math.random() * 720}deg)`;

    setTimeout(() => chip.remove(), 650);
});

socket.on('game_hash', (data) => {
    isDealing = true;
    setTimeout(() => { isDealing = false; }, 3000);
    hashDisplay.value = data.hash;
    verifySection.style.display = 'none';
    document.getElementById('verify-result').textContent = '';
    revealedDeck = null;
    document.querySelectorAll('body > .card').forEach(c => c.remove());
});

let dealDelay = 0;
socket.on('deal_hole_cards', (data) => {
    const isMe = data.targetId === myId;
    createFlyingCard(`player-cards-${data.targetId}`, data.cards[0], dealDelay, 0, isMe ? -10 : 10, isMe ? 1 : 0);
    createFlyingCard(`player-cards-${data.targetId}`, data.cards[1], dealDelay + 200, 40, isMe ? 10 : -10, isMe ? 1 : 0);
    dealDelay += 400;
    setTimeout(() => { dealDelay = 0; }, 1000); 
});

socket.on('deal_hole_cards_hidden', (data) => {
    if (data.excludeId === myId) return;
    createFlyingCard(`player-cards-${data.targetId}`, null, dealDelay, 0, 10, 0);
    createFlyingCard(`player-cards-${data.targetId}`, null, dealDelay + 200, 40, -10, 0);
    dealDelay += 400;
    setTimeout(() => { dealDelay = 0; }, 1000);
});

socket.on('deal_flop', (data) => {
    createFlyingCard('slot-0', data.cards[0], 0, 0, 0, 1);
    createFlyingCard('slot-1', data.cards[1], 200, 0, 0, 1);
    createFlyingCard('slot-2', data.cards[2], 400, 0, 0, 1);
    data.cards.forEach((c, i) => {
        const container = `slot-${i}`;
        createFlyingCardInstantly(container, c, true);
    });
    if(data.cards.length > 0) playCardSound();
});

socket.on('deal_turn', (data) => {
    createFlyingCard('slot-3', data.cards[0], 0, 0, 0, 1);
});

socket.on('deal_river', (data) => {
    createFlyingCard('slot-4', data.cards[0], 0, 0, 0, 1);
});

socket.on('reveal_player_cards', (data) => {
    const container = document.getElementById(`player-cards-${data.playerId}`);
    if (container) {
        const domCards = container.querySelectorAll('.card');
        if (domCards.length >= 2) {
            const p1 = parseCard(data.cards[0]);
            domCards[0].className = `card ${p1.color} flipped`;
            domCards[0].innerHTML = `<div class="card-inner"><div class="card-back"></div><div class="card-front">${p1.val}<div style="font-size: 1.5em">${p1.sym}</div></div></div>`;
            
            const p2 = parseCard(data.cards[1]);
            domCards[1].className = `card ${p2.color} flipped`;
            domCards[1].innerHTML = `<div class="card-inner"><div class="card-back"></div><div class="card-front">${p2.val}<div style="font-size: 1.5em">${p2.sym}</div></div></div>`;
        }
    }
});

socket.on('verify_deck', (data) => {
    verifySection.style.display = 'block';
    secretDisplay.value = data.secret;
    revealedDeck = data.deck;
});

    const startBtn = document.getElementById('btn-start');
    if(startBtn) startBtn.addEventListener('click', () => socket.emit('start_game'));

window.sendAction = function(action) {
    let amount = 0;
    if (action === 'raise') {
        amount = parseInt(document.getElementById('raise-input').value);
    }
    socket.emit('player_action', { action, amount });
};

btnExtraTime.addEventListener('click', () => {
    socket.emit('extra_time');
    btnExtraTime.style.display = 'none';
});

btnReveal.addEventListener('click', () => {
    socket.emit('reveal_cards');
    btnReveal.style.display = 'none';
});

document.getElementById('btn-run-verify').addEventListener('click', () => {
    if (!revealedDeck) return;
    const secret = secretDisplay.value;
    const dataToHash = JSON.stringify(revealedDeck) + secret;
    const localHash = CryptoJS.SHA256(dataToHash).toString(CryptoJS.enc.Hex);
    
    if (localHash === hashDisplay.value) {
        document.getElementById('verify-result').style.color = '#10b981';
        document.getElementById('verify-result').innerHTML = '✅ SUCCESS: Hash matches! Deck was NOT altered.';
    } else {
        document.getElementById('verify-result').style.color = '#ef4444';
        document.getElementById('verify-result').innerHTML = '❌ FAILED: Hash mismatch! Deck was tampered with.';
    }
});

/* Modal Logic */
window.openSettings = () => {
    document.getElementById('settings-modal').classList.add('visible');
};

window.openLedger = () => {
    const tbody = document.getElementById('ledger-body');
    tbody.innerHTML = '';
    
    if (currentState) {
        Object.keys(currentState.players).forEach(id => {
            const p = currentState.players[id];
            const start = initialBuyIns[id] || 5000;
            const net = p.chips - start;
            
            let netClass = '';
            let netStr = net.toString();
            if (net > 0) { netClass = 'net-pos'; netStr = '+' + net; }
            if (net < 0) { netClass = 'net-neg'; }
            if (net === 0) { netStr = 'Even'; }
            
            tbody.innerHTML += `
                <tr>
                    <td>${p.name} ${id === myId ? '(You)' : ''}</td>
                    <td>${start}</td>
                    <td>${p.chips}</td>
                    <td class="${netClass}">${netStr}</td>
                </tr>
            `;
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="4">No game active.</td></tr>';
    }
    
    document.getElementById('ledger-modal').classList.add('visible');
};

window.closeModal = (id) => {
    document.getElementById(id).classList.remove('visible');
};

window.downloadLedger = () => {
    if (!currentState) return;
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Player,Buy-In,Current,Net\n";
    
    Object.keys(currentState.players).forEach(id => {
        const p = currentState.players[id];
        const start = initialBuyIns[id] || 5000;
        const net = p.chips - start;
        csvContent += `"${p.name}",${start},${p.chips},${net}\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `fair_poker_ledger_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.joinGame = function() {
    const name = document.getElementById('join-name').value || 'Player';
    const buyIn = document.getElementById('join-buyin').value || 5000;
    socket.emit('join_game', { room: currentRoom, name, buyIn });
    document.getElementById('join-modal').classList.remove('visible');
};

const dealers = ['dealer.jpg', 'dealer2.jpg', 'dealer3.jpg'];
window.changeDealer = function() {
    const img = document.querySelector('.dealer-img');
    let randomDealer;
    do {
        randomDealer = dealers[Math.floor(Math.random() * dealers.length)];
    } while(img.src.includes(randomDealer));
    img.src = randomDealer;
};

window.changeBlinds = function() {
    const val = document.getElementById('blind-select').value;
    if (currentRoom) socket.emit('change_blinds', { room: currentRoom, val });
};

let isSittingOut = false;
window.toggleSitOut = function() {
    isSittingOut = !isSittingOut;
    socket.emit('toggle_sit_out', { state: isSittingOut });
    document.getElementById('btn-sit-out').innerHTML = isSittingOut ? '<i class="fas fa-chair"></i> Return' : '<i class="fas fa-chair"></i> Sit Out';
};

window.leaveSeat = function() {
    if(confirm("Are you sure you want to leave the table?")) {
        socket.emit('leave_seat');
        window.location.reload();
    }
};

window.startGame = function() {
    socket.emit('start_game');
};

window.togglePause = function() {
    socket.emit('toggle_pause');
};

socket.on('auto_start_next_hand', () => {
    if (currentState && currentState.hostId === myId) {
        socket.emit('start_game');
    }
});

window.toggleSidebar = function() {
    const val = document.getElementById('sidebar-select').value;
    const mc = document.querySelector('.main-content');
    if (val === 'right') {
        mc.classList.add('sidebar-right');
    } else {
        mc.classList.remove('sidebar-right');
    }
};

window.sendChat = function() {
    const input = document.getElementById('chat-input');
    if(input && input.value.trim() !== '') {
        socket.emit('send_chat', { text: input.value.trim() });
        input.value = '';
    }
};

function triggerConfetti() {
    const colors = ['#f59e0b', '#fbbf24', '#ef4444', '#3b82f6', '#10b981', '#a855f7'];
    for (let i = 0; i < 150; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
        confetti.style.animationDelay = (Math.random() * 0.5) + 's';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        
        // Randomize shape (some circles, some rectangles)
        if (Math.random() > 0.5) {
            confetti.style.borderRadius = '50%';
            confetti.style.width = '12px';
            confetti.style.height = '12px';
        } else {
            confetti.style.width = '10px';
            confetti.style.height = '18px';
        }
        
        document.body.appendChild(confetti);
        
        // Cleanup after animation finishes
        setTimeout(() => confetti.remove(), 4000);
    }
}

let draggedChip = null;
let dragStartX = 0;
let dragStartY = 0;
let chipVelX = 0;
let chipVelY = 0;
let lastMouseX = 0;
let lastMouseY = 0;

document.addEventListener('mousedown', (e) => {
    const chip = e.target.closest('.interactable-chip');
    if (chip) {
        draggedChip = chip;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        chip.style.transition = 'none';
        chip.style.zIndex = '999';
        playChipInteractSound();
    }
});

document.addEventListener('mousemove', (e) => {
    if (draggedChip) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        draggedChip.style.transform = `translate(${dx}px, ${dy}px) scale(1.1)`;
        chipVelX = e.clientX - lastMouseX;
        chipVelY = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});

document.addEventListener('mouseup', (e) => {
    if (draggedChip) {
        const chip = draggedChip;
        draggedChip = null;
        let currentX = e.clientX - dragStartX;
        let currentY = e.clientY - dragStartY;
        
        let velX = chipVelX * 2;
        let velY = chipVelY * 2;
        const friction = 0.92;
        
        function throwPhysics() {
            if (Math.abs(velX) > 0.5 || Math.abs(velY) > 0.5) {
                currentX += velX;
                currentY += velY;
                velX *= friction;
                velY *= friction;
                chip.style.transform = `translate(${currentX}px, ${currentY}px) scale(1.1) rotate(${currentX}deg)`;
                requestAnimationFrame(throwPhysics);
            } else {
                setTimeout(() => {
                    chip.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
                    chip.style.transform = '';
                    setTimeout(() => {
                        chip.style.zIndex = '';
                        chip.style.transition = '';
                    }, 600);
                }, 1000);
            }
        }
        requestAnimationFrame(throwPhysics);
    }
});

function playChipInteractSound() {
    const snd = document.getElementById('setting-sound');
    if(snd && !snd.checked) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.08);
        
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2000;
        
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    } catch(e) {}
}

function playCheckSound() {
    const snd = document.getElementById('setting-sound');
    if(snd && !snd.checked) return;
    try {
        for (let i = 0; i < 2; i++) {
            setTimeout(() => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(150, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.1);
            }, i * 150);
        }
    } catch(e) {}
}

function playWinSound() {
    const snd = document.getElementById('setting-sound');
    if(snd && !snd.checked) return;
    try {
        const notes = [440, 554, 659, 880]; // A Major arpeggio
        notes.forEach((freq, i) => {
            setTimeout(() => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
                gain.gain.setValueAtTime(0, audioCtx.currentTime);
                gain.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.6);
            }, i * 100);
        });
        
        // Satisfying sweeping chord at the end
        setTimeout(() => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(880, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 0.8);
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.8);
        }, 400);
    } catch(e) {}
}
