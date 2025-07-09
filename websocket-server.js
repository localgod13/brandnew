import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const server = createServer();
const wss = new WebSocketServer({ server });

// Tower costs
const TOWER_COSTS = {
    basic: 100,
    sniper: 200,
    rapid: 150,
    rapidfire: 150,
    cryo: 250,
    tesla: 300
};

// Game state
const rooms = new Map();
const players = new Map();

// Generate room codes
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Create a new room
function createRoom(hostId) {
    const roomCode = generateRoomCode();
    const room = {
        code: roomCode,
        hostId: hostId,
        players: new Map(),
        gameState: {
            currentRound: 0,
            waveInProgress: false,
            enemies: new Map(),
            towers: new Map(),
            baseHealth: 100,
            maxBaseHealth: 100,
            playerGold: new Map(), // Track gold per player
            pathDataReceived: false,
            paused: false
        },
        readyPlayers: new Set(),
        readyForWave: new Set(),
        gameStarted: false,
        voting: null // Add to room state:
        // room.voting = { options: [], votes: {} }
    };
    
    rooms.set(roomCode, room);
    return room;
}

// Find room by code
function findRoom(roomCode) {
    return rooms.get(roomCode);
}

// Find room by player ID
function findRoomByPlayer(playerId) {
    for (const room of rooms.values()) {
        if (room.players.has(playerId)) {
            return room;
        }
    }
    return null;
}

// Broadcast to all players in a room
function broadcastToRoom(room, type, data, excludePlayerId = null) {
    console.log(`🔊 Broadcasting ${type} to ${room.players.size} players in room ${room.code}`);
    room.players.forEach((player, playerId) => {
        if (playerId !== excludePlayerId && player.ws.readyState === 1) {
            console.log(`➡️  Sending ${type} to ${playerId}`);
            player.ws.send(JSON.stringify({
                type: type,
                data: data
            }));
        }
    });
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
    const playerId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const player = {
        id: playerId,
        ws: ws,
        name: null, // Will be set when player creates/joins room
        room: null
    };
    
    players.set(playerId, player);
    
    // Send connection confirmation
    ws.send(JSON.stringify({
        type: 'connected',
        playerId: playerId
    }));
    
    console.log(`Player connected: ${playerId}`);
    
    // Handle messages
    ws.on('message', (message) => {
        console.log('[Server] Raw message received:', message.toString());
        try {
            const data = JSON.parse(message);
            handleMessage(player, data);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    // Handle disconnection
    ws.on('close', () => {
        handlePlayerDisconnect(player);
    });
    
    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        handlePlayerDisconnect(player);
    });
});

// Handle incoming messages
function handleMessage(player, data) {
    const messageType = data.type;
    const payload = data.data || data;
    switch (messageType) {
        case 'create_room':
            handleCreateRoom(player, payload.playerName);
            break;
        case 'join_room':
            handleJoinRoom(player, payload.roomCode, payload.playerName);
            break;
        case 'chat':
            handleChat(player, payload.message);
            break;
        case 'ready':
            handleReady(player, payload.ready);
            break;
        case 'start_game':
            handleStartGame(player);
            break;
        case 'position':
            handlePosition(player, payload.x, payload.y, payload.rotation);
            break;
        case 'place_tower':
            handlePlaceTower(player, payload.x, payload.y, payload.type);
            break;
        case 'ready_round':
            handleReadyRound(player);
            break;
        case 'select_upgrade':
            handleSelectUpgrade(player, payload.upgradeId);
            break;
        case 'add_base_module':
            handleAddBaseModule(player, payload.moduleType);
            break;
        case 'missile_silo_launch':
            handleMissileSiloLaunch(player);
            break;
        case 'missile_silo_target':
            handleMissileSiloTarget(player, payload.targetX, payload.targetZ);
            break;
        case 'path_data':
            handlePathData(player, payload.pathPoints);
            break;
        case 'pause_game':
            handlePauseGame(player, payload.paused);
            break;
        case 'enemy_killed':
            handleEnemyKilled(player, payload.enemyId, payload.goldReward);
            break;
        case 'gold_sync':
            handleGoldSync(player, payload.gold);
            break;
        case 'skip_round':
            handleSkipRound(player);
            break;
        case 'place_bomb':
            handlePlaceBomb(player, payload.x, payload.y, payload.z);
            break;
        case 'detonate_bombs':
            handleDetonateBombs(player);
            break;
        case 'use_freeze':
            handleUseFreeze(player);
            break;
        case 'ship_selected':
            handleShipSelected(player, payload.shipName);
            break;
        case 'vote-submitted':
            handleVoteSubmitted(player, payload);
            break;
        default:
            console.warn('Unknown message type:', messageType);
    }
}

// Handle room creation
function handleCreateRoom(player, playerName) {
    // Validate player name
    if (!playerName || playerName.trim().length === 0) {
        playerName = `Player${Math.floor(Math.random() * 1000)}`;
    }
    
    const room = createRoom(player.id);
    player.room = room;
    room.players.set(player.id, player);
    
    // Initialize player gold
    room.gameState.playerGold.set(player.id, 500);
    
    player.name = playerName.trim();
    
    console.log(`Room created: ${room.code} by ${player.id} (${player.name})`);
    console.log(`Room ${room.code} now has ${room.players.size} players`);
    
    // Send room code to host
    player.ws.send(JSON.stringify({
        type: 'room_created',
        roomCode: room.code
    }));
    
    // Send current player list to host (including themselves)
    player.ws.send(JSON.stringify({
        type: 'player_joined',
        playerId: player.id,
        name: player.name,
        selectedShip: player.selectedShip || 'ship1.glb'
    }));
    
    console.log(`Sent player_joined to host for themselves: ${player.id} (${player.name})`);
}

// Handle joining a room
function handleJoinRoom(player, roomCode, playerName) {
    // Validate player name
    if (!playerName || playerName.trim().length === 0) {
        playerName = `Player${Math.floor(Math.random() * 1000)}`;
    }
    
    const room = findRoom(roomCode);
    
    if (!room) {
        player.ws.send(JSON.stringify({
            type: 'error',
            message: 'Room not found'
        }));
        return;
    }
    
    if (room.players.size >= 3) {
        player.ws.send(JSON.stringify({
            type: 'error',
            message: 'Room is full'
        }));
        return;
    }
    
    if (room.gameStarted) {
        player.ws.send(JSON.stringify({
            type: 'error',
            message: 'Game already in progress'
        }));
        return;
    }
    
    player.room = room;
    room.players.set(player.id, player);
    
    // Initialize player gold
    room.gameState.playerGold.set(player.id, 500);
    
    player.name = playerName.trim();
    
    console.log(`Player ${player.id} (${player.name}) joined room ${roomCode}`);
    console.log(`Room ${roomCode} now has ${room.players.size} players`);
    
    // Send current player list to the joining player
    console.log(`Sending ${room.players.size} existing players to new player ${player.id} (${player.name})`);
    room.players.forEach((existingPlayer, existingPlayerId) => {
        console.log(`Sending player_joined for ${existingPlayerId} (${existingPlayer.name}) to new player ${player.id}`);
        player.ws.send(JSON.stringify({
            type: 'player_joined',
            playerId: existingPlayerId,
            name: existingPlayer.name,
            selectedShip: existingPlayer.selectedShip || 'ship1.glb'
        }));
    });
    
    // Notify all existing players about the new player
    console.log(`Broadcasting new player ${player.id} (${player.name}) to ${room.players.size - 1} existing players`);
    broadcastToRoom(room, 'player_joined', {
        playerId: player.id,
        name: player.name,
        selectedShip: player.selectedShip || 'ship1.glb'
    });
}

// Handle chat messages
function handleChat(player, message) {
    const room = player.room;
    if (!room) return;
    
    console.log(`Chat from ${player.id} (${player.name}): ${message}`);
    
    broadcastToRoom(room, 'chat', {
        playerId: player.id,
        playerName: player.name,
        message: message
    });
    
    console.log(`Broadcasted chat: ${player.name}: ${message}`);
}

// Handle ready status
function handleReady(player, ready) {
    const room = player.room;
    if (!room) return;
    
    if (ready) {
        room.readyPlayers.add(player.id);
    } else {
        room.readyPlayers.delete(player.id);
    }
    
    broadcastToRoom(room, 'player_ready', {
        playerId: player.id,
        ready: ready
    });
}

// Handle game start
function handleStartGame(player) {
    const room = player.room;
    if (!room || room.hostId !== player.id) return;
    
    // Check if all players are ready
    if (room.readyPlayers.size !== room.players.size) {
        player.ws.send(JSON.stringify({
            type: 'error',
            message: 'All players must be ready to start'
        }));
        return;
    }
    
    room.gameStarted = true;

    // Generate a random seed for environment sync if not already present
    if (!room.environmentSeed) {
        room.environmentSeed = Math.random().toString(36).substr(2, 10);
    }
    
    broadcastToRoom(room, 'game_start', {
        players: Array.from(room.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            selectedShip: p.selectedShip || 'ship1.glb'
        })),
        environmentSeed: room.environmentSeed
    });
    
    console.log(`Game started in room ${room.code} with environmentSeed: ${room.environmentSeed}`);
}

// Handle position updates
function handlePosition(player, x, y, rotation) {
    const room = player.room;
    if (!room || !room.gameStarted) return;
    
    broadcastToRoom(room, 'position', {
        playerId: player.id,
        x: x,
        y: y,
        rotation: rotation,
        selectedShip: player.selectedShip || 'ship1.glb'
    }, player.id);
}

// Handle tower placement
function handlePlaceTower(player, x, y, type) {
    console.log('📥 Server got tower from:', player.id, 'at', x, y, type);
    console.log('Tower type received from client:', type, 'Cost looked up:', TOWER_COSTS[type]);
    
    const room = player.room;
    if (!room || !room.gameStarted) {
        console.log('❌ Tower placement rejected: room not found or game not started');
        return;
    }
    
    // Get player's current gold
    const playerGold = room.gameState.playerGold.get(player.id) || 0;
    const towerCost = TOWER_COSTS[type] || 0;
    
    console.log(`💰 Player ${player.id} has ${playerGold} gold, tower costs ${towerCost}`);
    
    // Check if player has enough gold
    if (playerGold < towerCost) {
        console.log(`❌ Tower placement rejected: insufficient gold (${playerGold} < ${towerCost})`);
        // Send error message to the player
        player.ws.send(JSON.stringify({
            type: 'error',
            message: 'Insufficient gold to place tower'
        }));
        return;
    }
    
    // Deduct gold from player
    room.gameState.playerGold.set(player.id, playerGold - towerCost);
    console.log(`✅ Tower placed successfully. Player ${player.id} now has ${playerGold - towerCost} gold`);

    // Broadcast gold change to all players
    broadcastToRoom(room, 'gold_changed', {
        playerId: player.id,
        gold: playerGold - towerCost
    });
    
    // Broadcast tower placement to all players
    broadcastToRoom(room, 'tower_placed', {
        playerId: player.id,
        x,
        y,
        type
    });
}

// Handle round ready
function handleReadyRound(player) {
    const room = player.room;
    if (!room || !room.gameStarted) return;
    
    console.log(`Server: Player ${player.id} (${player.name}) ready for next round`);
    console.log(`Server: Room state - currentRound: ${room.gameState.currentRound}, waveInProgress: ${room.gameState.waveInProgress}`);
    
    // Track which players are ready for the next wave
    room.readyForWave.add(player.id);
    
    // Check if all players are ready
    if (room.readyForWave.size === room.players.size) {
        console.log(`Server: All players ready, starting wave ${room.gameState.currentRound + 1}`);
        
        // Start the wave for all players
        console.log(`Server: Broadcasting wave_start for round ${room.gameState.currentRound + 1}`);
        broadcastToRoom(room, 'wave_start', {
            round: room.gameState.currentRound + 1
        });
        
        // Test broadcast to see if it's working
        console.log(`Server: Testing broadcast functionality`);
        broadcastToRoom(room, 'test_message', {
            message: 'Test broadcast from server'
        });
        
        room.gameState.currentRound++;
        room.gameState.waveInProgress = true;
        
        // Reset ready status for next wave
        room.readyForWave.clear();
        
        console.log(`Server: About to start enemy spawning for wave ${room.gameState.currentRound}`);
        // Start spawning enemies for this wave
        startEnemySpawning(room);
    } else {
        console.log(`Server: ${room.readyForWave.size}/${room.players.size} players ready for next wave`);
    }
}

// Handle skip round
function handleSkipRound(player) {
    const room = player.room;
    if (!room || !room.gameStarted) return;
    
    console.log(`Server: Player ${player.id} (${player.name}) requested to skip round ${room.gameState.currentRound}`);
    
    // Only allow host to skip rounds
    if (player.id !== room.hostId) {
        console.log(`Server: Non-host player ${player.id} attempted to skip round - denied`);
        return;
    }
    
    // Clear all enemies
    room.gameState.enemies.clear();
    
    // End the current wave and start voting
    endWaveForRoom(room);
    
    console.log(`Server: Round ${room.gameState.currentRound} skipped by host`);
}

// Function to get wave configuration
function getWaveConfig(waveNumber) {
    const baseEnemies = 5;
    const enemiesPerWave = baseEnemies + Math.floor(waveNumber / 2);
    
    const enemies = [];
    for (let i = 0; i < enemiesPerWave; i++) {
        let enemyType = 'basic';
        let health = 30;
        let speed = 0.05;
        
        // Boss every 5 waves - spawn as the last enemy
        if (waveNumber % 5 === 0 && i === enemiesPerWave - 1) {
            enemyType = 'boss';
            health = 150;
            speed = 0.02;
        }
        // Mix enemy types for variety
        else if (waveNumber % 3 === 0 && i % 3 === 0) {
            enemyType = 'tank';
            health = 75;
            speed = 0.03;
        }
        else if (waveNumber % 2 === 0 && i % 2 === 0) {
            enemyType = 'fast';
            health = 18;
            speed = 0.08;
        }
        // Add more variety based on wave number
        else if (waveNumber >= 10 && i % 4 === 0) {
            enemyType = 'tank';
            health = 75;
            speed = 0.03;
        }
        else if (waveNumber >= 15 && i % 5 === 0) {
            enemyType = 'fast';
            health = 18;
            speed = 0.08;
        }
        
        enemies.push({
            type: enemyType,
            health: health,
            speed: speed
        });
    }
    
    return {
        enemies: enemies,
        spawnInterval: Math.max(500, 1500 - waveNumber * 50) // Faster spawning as waves progress
    };
}

// Function to spawn enemies for a wave
function startEnemySpawning(room) {
    console.log(`Server: Starting enemy spawning for wave ${room.gameState.currentRound}`);
    console.log(`Server: Room state - players: ${room.players.size}, gameStarted: ${room.gameStarted}, waveInProgress: ${room.gameState.waveInProgress}`);
    
    // Check if path data is available
    if (!room.gameState.pathDataReceived || !room.gameState.pathPoints || room.gameState.pathPoints.length === 0) {
        console.log(`Server: No path data available, waiting 2 seconds before spawning enemies...`);
        setTimeout(() => {
            startEnemySpawning(room);
        }, 2000);
        return;
    }
    
    console.log(`Server: Path data available, proceeding with enemy spawning`);
    
    const waveConfig = getWaveConfig(room.gameState.currentRound);
    console.log(`Server: Wave config:`, waveConfig);
    
    let enemiesSpawned = 0;
    const totalEnemies = waveConfig.enemies.length;
    
    const spawnInterval = setInterval(() => {
        if (enemiesSpawned >= totalEnemies) {
            console.log(`Server: Finished spawning ${totalEnemies} enemies for wave ${room.gameState.currentRound}`);
            clearInterval(spawnInterval);
            return;
        }
        
        // Check room state before spawning
        if (!room || !room.gameStarted) {
            console.log(`Server: Room state invalid during enemy spawn - room: ${!!room}, gameStarted: ${room ? room.gameStarted : 'N/A'}`);
            clearInterval(spawnInterval);
            return;
        }
        
        // Check if game is paused
        if (room.gameState.paused) {
            console.log(`Server: Game is paused, skipping enemy spawn`);
            return;
        }
        
        const enemyConfig = waveConfig.enemies[enemiesSpawned];
        
        // Spawn enemy at the start of the path (first waypoint)
        let spawnX = -50; // Default fallback
        let spawnY = 0;   // Default fallback
        
        if (room.gameState.pathPoints && room.gameState.pathPoints.length > 0) {
            const firstWaypoint = room.gameState.pathPoints[0];
            spawnX = firstWaypoint.x;
            spawnY = firstWaypoint.z; // Note: path uses z for Y coordinate
            console.log(`Server: Using path waypoint for spawn: (${spawnX}, ${spawnY})`);
        } else {
            console.log(`Server: No path data available, using default spawn: (${spawnX}, ${spawnY})`);
        }
        
        const enemy = {
            id: `enemy_${Date.now()}_${enemiesSpawned}`,
            type: enemyConfig.type,
            health: enemyConfig.health,
            maxHealth: enemyConfig.health,
            speed: enemyConfig.speed,
            x: spawnX,
            y: spawnY,
            z: 0,
            targetX: 50,
            targetY: 0,
            targetZ: 0
        };
        
        console.log(`Server: Spawning enemy ${enemy.id} at position (${enemy.x}, ${enemy.y}, ${enemy.z})`);
        console.log(`Server: Enemy config:`, enemyConfig);
        
        // Add to room's enemy list
        room.gameState.enemies.set(enemy.id, enemy);
        
        // Broadcast to all players in the room
        console.log(`Server: About to broadcast enemy_spawn for ${enemy.id} to ${room.players.size} players`);
        broadcastToRoom(room, 'enemy_spawn', enemy);
        console.log(`Server: Enemy spawn broadcast completed for ${enemy.id}`);
        
        enemiesSpawned++;
    }, waveConfig.spawnInterval);
}

// Handle upgrade selection
function handleSelectUpgrade(player, upgradeId) {
    const room = player.room;
    if (!room) return;
    
    console.log(`Player ${player.id} selected upgrade: ${upgradeId}`);
    
    // Broadcast upgrade selection to all players in the room
    broadcastToRoom(room, 'upgrade_selected', {
        playerId: player.id,
        upgradeId: upgradeId
    });
}

// Handle enemy killed
function handleEnemyKilled(player, enemyId, goldReward) {
    const room = player.room;
    if (!room || !room.gameStarted) return;
    
    console.log(`Server: Enemy ${enemyId} killed by player ${player.id} (${player.name})`);
    
    // Add gold to the player who killed the enemy
    const currentGold = room.gameState.playerGold.get(player.id) || 0;
    room.gameState.playerGold.set(player.id, currentGold + goldReward);
    console.log(`💰 Player ${player.id} gained ${goldReward} gold (now has ${currentGold + goldReward})`);
    
    // Remove enemy from room's enemy list
    if (room.gameState && room.gameState.enemies) {
        room.gameState.enemies.delete(enemyId);
    }
    
    // Broadcast enemy death to all players
    broadcastToRoom(room, 'enemy_killed', {
        enemyId: enemyId,
        goldReward: goldReward,
        playerId: player.id
    });
    
    console.log(`Server: Broadcasted enemy_killed for ${enemyId} to ${room.players.size} players`);

    // If all enemies are dead, end the wave
    if (room.gameState.enemies.size === 0) {
        endWaveForRoom(room);
    }
}

// Handle player disconnection
function handlePlayerDisconnect(player) {
    const room = player.room;
    
    if (room) {
        room.players.delete(player.id);
        room.readyPlayers.delete(player.id);
        
        // Notify other players
        broadcastToRoom(room, 'player_left', {
            playerId: player.id
        });
        
        // If room is empty, delete it
        if (room.players.size === 0) {
            rooms.delete(room.code);
            console.log(`Room ${room.code} deleted (empty)`);
        }
        // If host left, assign new host
        else if (room.hostId === player.id) {
            const newHost = room.players.values().next().value;
            room.hostId = newHost.id;
            console.log(`New host assigned: ${newHost.id}`);
        }
    }
    
    players.delete(player.id);
    console.log(`Player disconnected: ${player.id}`);
}

// Handle base module installation
function handleAddBaseModule(player, moduleType) {
    const room = player.room;
    if (!room) return;
    
    console.log(`Server: Player ${player.id} (${player.name}) added base module: ${moduleType}`);
    console.log(`Server: Broadcasting to ${room.players.size} players in room ${room.code}`);
    
    // Broadcast base module installation to all players in the room
    broadcastToRoom(room, 'base_module_added', {
        playerId: player.id,
        moduleType: moduleType
    });
    
    console.log(`Server: Broadcasted base_module_added for ${moduleType} to all players`);
}

// Handle missile silo launch
function handleMissileSiloLaunch(player) {
    const room = player.room;
    if (!room) return;
    
    console.log(`Server: Player ${player.id} (${player.name}) launched missile silo`);
    
    // Broadcast to all other players in the room
    broadcastToRoom(room, 'missile_silo_launch', {
        playerId: player.id
    }, player.id);
}

// Handle missile silo target
function handleMissileSiloTarget(player, targetX, targetZ) {
    const room = player.room;
    if (!room) return;
    
    console.log(`Server: Player ${player.id} (${player.name}) targeted missile silo at (${targetX}, ${targetZ})`);
    
    // Broadcast to all other players in the room
    broadcastToRoom(room, 'missile_silo_target', {
        playerId: player.id,
        targetX: targetX,
        targetZ: targetZ
    }, player.id);
}

// Handle path data
function handlePathData(player, pathPoints) {
    const room = player.room;
    if (!room) return;
    
    console.log(`Server: Received path data from player ${player.id} (${player.name})`);
    console.log(`Server: Path has ${pathPoints.length} waypoints`);
    
    // Log the first few waypoints for debugging
    if (pathPoints.length > 0) {
        console.log(`Server: First waypoint: (${pathPoints[0].x}, ${pathPoints[0].z})`);
        if (pathPoints.length > 1) {
            console.log(`Server: Second waypoint: (${pathPoints[1].x}, ${pathPoints[1].z})`);
        }
        if (pathPoints.length > 2) {
            console.log(`Server: Third waypoint: (${pathPoints[2].x}, ${pathPoints[2].z})`);
        }
    }
    
    // Store path data in room's game state
    room.gameState.pathPoints = pathPoints;
    room.gameState.pathDataReceived = true;
    
    console.log(`Server: Path data stored for room ${room.code}`);
    
    // If wave is already in progress, restart enemy spawning with new path data
    if (room.gameState.waveInProgress) {
        console.log(`Server: Wave in progress, restarting enemy spawning with new path data`);
        startEnemySpawning(room);
    }
}

// Handle pause game
function handlePauseGame(player, paused) {
    const room = player.room;
    if (!room) return;
    
    console.log(`Server: Player ${player.id} (${player.name}) ${paused ? 'paused' : 'unpaused'} the game`);
    
    // Store pause state in room
    room.gameState.paused = paused;
    
    // Broadcast pause state to all players in the room
    broadcastToRoom(room, 'pause_game', {
        paused: paused,
        playerId: player.id
    });
    
    console.log(`Server: Broadcasted pause_game (${paused}) to all players in room ${room.code}`);
}

// Utility to pick 3 random upgrades
function pickRandomUpgrades() {
    // These should match the upgrade IDs in UpgradeManager.js
    const allUpgrades = [
        'damage_boost',
        'range_boost',
        'fire_rate_boost',
        'gold_bonus',
        'extra_lives',
        'tower_discount',
        'critical_chance',
        'splash_damage',
        'piercing_shots',
        'life_steal'
    ];
    const selected = [];
    const pool = allUpgrades.slice();
    while (selected.length < 3 && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        selected.push(pool.splice(idx, 1)[0]);
    }
    return selected;
}

// At the end of a wave, after all enemies are dead and before allowing the next round:
function endWaveForRoom(room) {
    // Prevent multiple wave endings
    if (!room.gameState.waveInProgress) {
        console.log(`Server: Wave already ended for room ${room.code}, skipping duplicate endWaveForRoom call`);
        return;
    }
    
    // Pick upgrades for this round
    const upgrades = pickRandomUpgrades();
    
    // Initialize voting state
    room.voting = {
        options: upgrades,
        votes: {}
    };
    
    // Broadcast round end to all players (this triggers handleRoundEnd on client)
    broadcastToRoom(room, 'round_end', {
        round: room.gameState.currentRound,
        upgrades: upgrades
    });
    
    // Broadcast start-voting to initiate voting phase
    broadcastToRoom(room, 'start-voting', {
        options: upgrades
    });
    
    // Reset ready state for next wave
    room.readyForWave.clear();
    room.gameState.waveInProgress = false;
    
    console.log(`Server: Sent round_end and start-voting with upgrades:`, upgrades);
}

// Handle vote-submitted
function handleVoteSubmitted(player, payload) {
    const room = player.room;
    if (!room || !room.voting) {
        console.log('[Server] handleVoteSubmitted: No room or voting state:', { hasRoom: !!room, hasVoting: !!(room && room.voting) });
        return;
    }
    const { playerId, upgradeId } = payload;
    console.log('[Server] handleVoteSubmitted:', { playerId, upgradeId, roomCode: room.code });
    room.voting.votes[playerId] = upgradeId;
    console.log('[Server] Current votes:', room.voting.votes);
    // Broadcast vote-update to all
    console.log('[Server] Broadcasting vote-update to', room.players.size, 'players');
    broadcastToRoom(room, 'vote-update', { playerId, upgradeId });
    // If both players have voted, resolve
    if (Object.keys(room.voting.votes).length >= 2) {
        console.log('[Server] Both players voted, resolving...');
        const votes = Object.values(room.voting.votes);
        let selectedUpgrade;
        if (votes[0] === votes[1]) {
            selectedUpgrade = votes[0];
        } else {
            selectedUpgrade = votes[Math.floor(Math.random() * 2)];
        }
        console.log('[Server] Selected upgrade:', selectedUpgrade);
        broadcastToRoom(room, 'voting-complete', { selectedUpgrade });
        // Clear voting state
        room.voting = null;
        console.log('[Server] Voting completed, waiting for players to be ready for next round');
    }
}

// Handle gold synchronization from client
function handleGoldSync(player, gold) {
    const room = player.room;
    if (!room || !room.gameStarted) return;
    
    console.log(`💰 Gold sync from player ${player.id}: ${gold}`);
    
    // Update player's gold on server
    room.gameState.playerGold.set(player.id, gold);
    
    // Broadcast gold change to all players in the room
    broadcastToRoom(room, 'gold_changed', {
        playerId: player.id,
        gold: gold
    });
    
    console.log(`💰 Broadcasted gold change for player ${player.id}: ${gold}`);
}

// Handle bomb placement
function handlePlaceBomb(player, x, y, z) {
    const room = player.room;
    if (!room) return;
    
    console.log(`💣 Player ${player.id} (${player.name}) placed bomb at (${x}, ${y}, ${z})`);
    
    // Broadcast bomb placement to all other players in the room
    broadcastToRoom(room, 'bomb_placed', {
        playerId: player.id,
        x: x,
        y: y,
        z: z
    }, player.id);
}

// Handle bomb detonation
function handleDetonateBombs(player) {
    const room = player.room;
    if (!room) return;
    
    console.log(`💥 Player ${player.id} (${player.name}) detonated bombs`);
    
    // Broadcast bomb detonation to all other players in the room
    broadcastToRoom(room, 'bombs_detonated', {
        playerId: player.id
    }, player.id);
}

// Handle freeze ability usage
function handleUseFreeze(player) {
    const room = player.room;
    if (!room) return;
    
    console.log(`❄️ Player ${player.id} (${player.name}) used freeze ability`);
    
    // Broadcast freeze ability usage to all other players in the room
    broadcastToRoom(room, 'freeze_used', {
        playerId: player.id
    }, player.id);
}

// Handle ship selection
function handleShipSelected(player, shipName) {
    const room = player.room;
    if (!room) return;
    
    console.log(`🚀 Player ${player.id} (${player.name}) selected ship: ${shipName}`);
    
    // Store the selected ship for this player
    player.selectedShip = shipName;
    
    // Broadcast ship selection to all players in the room (including the sender)
    broadcastToRoom(room, 'ship_selected', {
        playerId: player.id,
        shipName: shipName
    });
    
    console.log(`🚀 Broadcasted ship selection for player ${player.id}: ${shipName}`);
}

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`WebSocket server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    wss.close(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
}); 