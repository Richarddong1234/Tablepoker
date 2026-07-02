const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const Hand = require('pokersolver').Hand;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const suits = ['h', 'd', 'c', 's'];
const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

class Room {
    constructor(id) {
        this.id = id;
        this.players = {};
        this.playerIds = [];
        this.deck = [];
        this.serverSecret = "";
        this.deckHash = null;
        this.hostId = null;
        this.isPaused = false;
        
        this.gameState = 'waiting';
        this.communityCards = [];
        this.cardIndex = 0;
        this.roundsPlayed = 0;
        
        this.pot = 0;
        this.currentBet = 0;
        this.activePlayerIndex = -1;
        this.turnTimer = null;
        
        this.BASE_TIME_MS = 45000;
        this.currentTurnEndTime = 0;
        
        this.dealerButtonIndex = -1;
        this.sbAmount = 10;
        this.bbAmount = 20;
        

    }

    generateDeck() {
        let newDeck = [];
        for (let s of suits) {
            for (let v of values) {
                newDeck.push(`${v}${s}`);
            }
        }
        for (let i = newDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
        }
        return newDeck;
    }

    createProvablyFairDeck() {
        this.deck = this.generateDeck();
        this.serverSecret = crypto.randomBytes(16).toString('hex');
        const dataToHash = JSON.stringify(this.deck) + this.serverSecret;
        this.deckHash = crypto.createHash('sha256').update(dataToHash).digest('hex');
        return this.deckHash;
    }

    broadcastState() {
        for (let id of this.playerIds) {
            if (this.players[id].status !== 'folded' && this.players[id].cards && this.players[id].cards.length > 0) {
                let pCards = this.players[id].cards.concat(this.communityCards);
                let solved = Hand.solve(pCards);
                this.players[id].handHint = solved.descr;
            } else {
                this.players[id].handHint = null;
            }
        }
        io.to(this.id).emit('game_state', {
            gameState: this.gameState,
            pot: this.pot,
            currentBet: this.currentBet,
            roundsPlayed: this.roundsPlayed,
            activePlayerId: this.activePlayerIndex >= 0 ? this.playerIds[this.activePlayerIndex] : null,
            communityCards: this.communityCards,
            players: this.players,
            hostId: this.hostId,
            isPaused: this.isPaused
        });
    }

    sendHandHints() {
        // Hand hints are now sent entirely via game_state
    }

    nextTurn() {
        if (this.gameState === 'waiting' || this.gameState === 'showdown') return;
        
        let activePlayers = this.playerIds.filter(id => this.players[id].status === 'active' || this.players[id].status === 'all-in');
        let playersAbleToAct = activePlayers.filter(id => this.players[id].status === 'active');
        
        if (activePlayers.length === 1) {
            this.handleWin(activePlayers[0]);
            return;
        }

        let allMatched = true;
        for (let id of playersAbleToAct) {
            if (this.players[id].bet < this.currentBet || !this.players[id].hasActed) {
                allMatched = false;
                break;
            }
        }

        if (allMatched || playersAbleToAct.length === 0) {
            this.activePlayerIndex = -1;
            this.broadcastState();
            setTimeout(() => {
                this.nextStreet();
            }, 2000);
            return;
        }

        let loops = 0;
        do {
            this.activePlayerIndex = (this.activePlayerIndex + 1) % this.playerIds.length;
            loops++;
        } while (this.players[this.playerIds[this.activePlayerIndex]].status !== 'active' && loops < this.playerIds.length);

        this.broadcastState();
        this.startTurnTimer();
    }

    startTurnTimer() {
        clearTimeout(this.turnTimer);
        let id = this.playerIds[this.activePlayerIndex];
        let time = this.BASE_TIME_MS;
        this.currentTurnEndTime = Date.now() + time;
        
        io.to(this.id).emit('turn_start', { playerId: id, time: time });
        
        this.turnTimer = setTimeout(() => {
            let p = this.players[id];
            if (!p) return; 
            if (p.bet < this.currentBet) this.handleAction(id, 'fold', 0);
            else this.handleAction(id, 'call', 0);
        }, time);
    }

    handleAction(playerId, action, amount = 0) {
        if (this.playerIds[this.activePlayerIndex] !== playerId) return;
        clearTimeout(this.turnTimer);

        let p = this.players[playerId];
        p.hasActed = true;

        if (action === 'fold') {
            p.status = 'folded';
            io.to(this.id).emit('chat_message', { sender: p.name, text: 'Folded' });
            io.to(this.id).emit('player_bubble', { playerId, text: 'Fold' });
        } 
        else if (action === 'call') {
            let callAmount = this.currentBet - p.bet;
            if (callAmount >= p.chips) {
                callAmount = p.chips;
                p.status = 'all-in';
            }
            p.chips -= callAmount;
            p.bet += callAmount;
            this.pot += callAmount;
            
            let msg = callAmount === 0 ? 'Check' : `Call ${callAmount}`;
            io.to(this.id).emit('chat_message', { sender: p.name, text: msg });
            io.to(this.id).emit('player_bubble', { playerId, text: msg });
            
            if(callAmount > 0) io.to(this.id).emit('chip_anim', { playerId });
        } 
        else if (action === 'raise') {
            let totalBet = this.currentBet + amount;
            let addAmount = totalBet - p.bet;
            
            if (addAmount >= p.chips) {
                addAmount = p.chips;
                p.status = 'all-in';
                totalBet = p.bet + addAmount;
            }
            
            p.chips -= addAmount;
            p.bet += addAmount;
            this.pot += addAmount;
            this.currentBet = totalBet;
            
            for(let id of this.playerIds) {
                if (id !== playerId && this.players[id].status !== 'folded') this.players[id].hasActed = false;
            }
            
            io.to(this.id).emit('chat_message', { sender: p.name, text: `Raised to ${totalBet}` });
            io.to(this.id).emit('player_bubble', { playerId, text: `Raise to ${totalBet}` });
            io.to(this.id).emit('chip_anim', { playerId });
        }

        this.nextTurn();
    }

    nextStreet() {
        this.currentBet = 0;
        for (let id of this.playerIds) {
            this.players[id].bet = 0;
            this.players[id].hasActed = false;
        }

        if (this.gameState === 'pre-flop') {
            this.gameState = 'flop';
            this.cardIndex++; 
            const flop = [this.deck[this.cardIndex++], this.deck[this.cardIndex++], this.deck[this.cardIndex++]];
            this.communityCards.push(...flop);
            io.to(this.id).emit('deal_flop', { cards: flop });
            io.to(this.id).emit('chat_message', { sender: 'Dealer', text: `Flop dealt.` });
            this.activePlayerIndex = -1; 
            this.nextTurn();
        } 
        else if (this.gameState === 'flop') {
            this.gameState = 'turn';
            this.cardIndex++; 
            const turn = [this.deck[this.cardIndex++]];
            this.communityCards.push(...turn);
            io.to(this.id).emit('deal_turn', { cards: turn });
            io.to(this.id).emit('chat_message', { sender: 'Dealer', text: `Turn dealt.` });
            this.activePlayerIndex = -1;
            this.nextTurn();
        } 
        else if (this.gameState === 'turn') {
            this.gameState = 'river';
            this.cardIndex++; 
            const river = [this.deck[this.cardIndex++]];
            this.communityCards.push(...river);
            io.to(this.id).emit('deal_river', { cards: river });
            io.to(this.id).emit('chat_message', { sender: 'Dealer', text: `River dealt.` });
            this.activePlayerIndex = -1;
            this.nextTurn();
        } 
        else if (this.gameState === 'river') {
            this.handleShowdown();
        }
    }

    handleWin(winnerId) {
        this.gameState = 'showdown';
        clearTimeout(this.turnTimer);
        
        this.players[winnerId].chips += this.pot;
        this.players[winnerId].wins = (this.players[winnerId].wins || 0) + 1;
        io.to(this.id).emit('player_win', { id: winnerId, amount: this.pot });
        io.to(this.id).emit('chat_message', { sender: 'Dealer', text: `${this.players[winnerId].name} wins pot of ${this.pot}` });
        this.pot = 0;
        
        this.endHand();
    }

    handleShowdown() {
        this.gameState = 'showdown';
        clearTimeout(this.turnTimer);
        
        let hands = [];
        let activeIds = this.playerIds.filter(id => this.players[id].status !== 'folded');
        
        for (let id of activeIds) {
            let pCards = this.players[id].cards.concat(this.communityCards);
            let solved = Hand.solve(pCards);
            solved.id = id;
            hands.push(solved);
        }
        
        let winners = Hand.winners(hands);
        let winAmount = Math.floor(this.pot / winners.length);
        
        let winnerNames = [];
        for (let w of winners) {
            this.players[w.id].chips += winAmount;
            this.players[w.id].wins = (this.players[w.id].wins || 0) + 1;
            winnerNames.push(this.players[w.id].name);
            io.to(this.id).emit('player_win', { id: w.id, amount: winAmount });
            io.to(this.id).emit('reveal_player_cards', { playerId: w.id, cards: this.players[w.id].cards });
        }
        

        
        io.to(this.id).emit('chat_message', { sender: 'Dealer', text: `Showdown! ${winnerNames.join(' & ')} win with ${winners[0].descr}. Pot: ${this.pot}` });
        this.pot = 0;
        
        this.endHand();
    }

    endHand() {
        this.roundsPlayed++;
        io.to(this.id).emit('verify_deck', { deck: this.deck, secret: this.serverSecret });
        io.to(this.id).emit('chat_message', { sender: 'System', text: 'Verification unlocked.'});
        this.broadcastState();
        
        setTimeout(() => {
            if (this.gameState === 'showdown' && !this.isPaused) {
                io.to(this.id).emit('auto_start_next_hand');
            }
        }, 7000);
    }
}

const rooms = {};

io.on('connection', (socket) => {
    
    socket.on('create_room', () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let code = '';
        do {
            code = '';
            for(let i=0; i<4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        } while(rooms[code]);
        
        rooms[code] = new Room(code);
        rooms[code].hostId = socket.id;
        socket.join(code);
        socket.emit('room_joined', code);
    });

    socket.on('join_room', (code) => {
        if (rooms[code]) {
            socket.join(code);
            socket.emit('room_joined', code);
        } else {
            socket.emit('room_error', 'Room not found.');
        }
    });

    socket.on('join_game', (data) => {
        const room = rooms[data.room];
        if (!room) return;
        
        room.players[socket.id] = {
            id: socket.id,
            name: (data.name || `Player_${socket.id.substring(0,4)}`).substring(0, 15),
            chips: parseInt(data.buyIn) || 5000,
            cards: [],
            bet: 0,
            status: 'waiting', 
            hasActed: false,
            wins: 0
        };
        room.playerIds = Object.keys(room.players);
        room.broadcastState();
    });



    socket.on('change_blinds', (data) => {
        const room = rooms[data.room];
        if(room) {
            const parts = data.val.split('/');
            room.sbAmount = parseInt(parts[0]);
            room.bbAmount = parseInt(parts[1]);
            io.to(room.id).emit('chat_message', { sender: 'System', text: `Blinds changed to ${data.val}`});
        }
    });

    socket.on('start_game', (roomCode) => {
        // If client doesn't send roomCode, we try to find it
        if (!roomCode) {
            for(const rc in rooms) {
                if (rooms[rc].players[socket.id]) roomCode = rc;
            }
        }
        const room = rooms[roomCode];
        if (!room) return;
        if (room.playerIds.length < 2 || room.gameState !== 'waiting' && room.gameState !== 'showdown') return;
        
        room.gameState = 'pre-flop';
        room.communityCards = [];
        room.cardIndex = 0;
        room.pot = 0;
        room.currentBet = 0;
        room.activePlayerIndex = -1;
        
        room.createProvablyFairDeck();
        
        io.to(room.id).emit('game_hash', { hash: room.deckHash });
        io.to(room.id).emit('chat_message', { sender: 'Dealer', text: `Hand started. Hash: ${room.deckHash.substring(0,10)}...`});

        for(let id of room.playerIds) {
            room.players[id].cards = [];
            room.players[id].bet = 0;
            room.players[id].hasActed = false;
            room.players[id].status = (room.players[id].chips > 0 && !room.players[id].isSittingOut) ? 'active' : (room.players[id].isSittingOut ? 'sitting_out' : 'waiting');
        }
        
        let activeIds = room.playerIds.filter(id => room.players[id].status === 'active');
        if (activeIds.length < 2) return;
        
        room.dealerButtonIndex = (room.dealerButtonIndex + 1) % activeIds.length;
        let sbId = activeIds[(room.dealerButtonIndex + 1) % activeIds.length];
        let bbId = activeIds[(room.dealerButtonIndex + 2) % activeIds.length];
        
        room.players[sbId].chips = Math.max(0, room.players[sbId].chips - room.sbAmount);
        room.players[sbId].bet = room.sbAmount;
        room.players[bbId].chips = Math.max(0, room.players[bbId].chips - room.bbAmount);
        room.players[bbId].bet = room.bbAmount;
        
        room.pot = room.sbAmount + room.bbAmount;
        room.currentBet = room.bbAmount;
        room.activePlayerIndex = room.playerIds.indexOf(bbId); // nextTurn() will move this to UTG

        for(let id of room.playerIds) {
            if(room.players[id].status === 'active') {
                room.players[id].cards.push(room.deck[room.cardIndex++]);
                room.players[id].cards.push(room.deck[room.cardIndex++]);
            }
        }
        
        for(let id of room.playerIds) {
            if(room.players[id].status === 'active') {
                io.to(id).emit('deal_hole_cards', { cards: room.players[id].cards, targetId: id });
                io.to(room.id).emit('deal_hole_cards_hidden', { targetId: id, excludeId: id });
            }
        }
        
        room.broadcastState();
        setTimeout(() => room.nextTurn(), 1000); 
    });

    socket.on('player_action', (data) => {
        for(const rc in rooms) {
            if (rooms[rc].players[socket.id]) {
                rooms[rc].handleAction(socket.id, data.action, data.amount);
                break;
            }
        }
    });

    socket.on('extra_time', () => {
        for(const rc in rooms) {
            const room = rooms[rc];
            if (room.players[socket.id] && room.playerIds[room.activePlayerIndex] === socket.id) {
                clearTimeout(room.turnTimer);
                let remaining = Math.max(0, room.currentTurnEndTime - Date.now());
                let newTime = remaining + 20000;
                room.currentTurnEndTime = Date.now() + newTime;
                
                io.to(room.id).emit('turn_extended', { playerId: socket.id, time: newTime });
                io.to(room.id).emit('chat_message', { sender: 'Dealer', text: `${room.players[socket.id].name} uses Time Bank (+20s).` });
                
                room.turnTimer = setTimeout(() => {
                    let p = room.players[socket.id];
                    if (!p) return; 
                    if (p.bet < room.currentBet) room.handleAction(socket.id, 'fold', 0);
                    else room.handleAction(socket.id, 'call', 0);
                }, newTime);
                break;
            }
        }
    });

    socket.on('reveal_cards', () => {
        for(const rc in rooms) {
            const room = rooms[rc];
            let p = room.players[socket.id];
            if (p && p.cards.length > 0 && room.gameState === 'showdown') {
                io.to(room.id).emit('reveal_player_cards', { playerId: socket.id, cards: p.cards });
                io.to(room.id).emit('chat_message', { sender: p.name, text: 'Revealed hand.' });
                break;
            }
        }
    });

    socket.on('send_chat', (data) => {
        const room = Object.values(rooms).find(r => r.players[socket.id]);
        if (room && room.players[socket.id] && data.text) {
            const p = room.players[socket.id];
            io.to(room.id).emit('chat_message', { sender: p.name, text: data.text });
        }
    });

    socket.on('toggle_sit_out', (data) => {
        const room = Object.values(rooms).find(r => r.players[socket.id]);
        if (room && room.players[socket.id]) {
            room.players[socket.id].isSittingOut = data.state;
            room.players[socket.id].status = data.state ? 'sitting_out' : (room.players[socket.id].chips > 0 ? 'waiting' : 'waiting');
            io.to(room.id).emit('chat_message', { sender: 'System', text: `${room.players[socket.id].name} is ${data.state ? 'sitting out' : 'back'}.`});
            room.broadcastState();
        }
    });

    socket.on('toggle_pause', () => {
        const room = Object.values(rooms).find(r => r.hostId === socket.id);
        if (room) {
            room.isPaused = !room.isPaused;
            io.to(room.id).emit('chat_message', { sender: 'System', text: `Auto-deal is now ${room.isPaused ? 'Paused' : 'Active'}.`});
            room.broadcastState();
        }
    });

    socket.on('leave_seat', () => {
        const room = Object.values(rooms).find(r => r.players[socket.id]);
        if (room && room.players[socket.id]) {
            io.to(room.id).emit('chat_message', { sender: 'System', text: `${room.players[socket.id].name} left the table.`});
            delete room.players[socket.id];
            room.playerIds = room.playerIds.filter(id => id !== socket.id);
            room.broadcastState();
        }
    });

    socket.on('disconnect', () => {
        for(const rc in rooms) {
            const room = rooms[rc];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                room.playerIds = Object.keys(room.players);
                if (room.activePlayerIndex >= 0 && room.playerIds[room.activePlayerIndex] === socket.id) {
                    room.handleAction(socket.id, 'fold');
                }
                room.broadcastState();
                
                // Cleanup empty rooms
                if (room.playerIds.length === 0) {
                    delete rooms[rc];
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Fair Poker Server running on http://localhost:${PORT}`);
});
