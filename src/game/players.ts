import { EventEmitter } from 'events';

interface Player {
    id: string;
    name: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    health: number;
    isAlive: boolean;
}

class PlayerManager extends EventEmitter {
    private players: Map<string, Player>;

    constructor() {
        super();
        this.players = new Map();
    }

    createPlayer(id: string, name: string): Player {
        const newPlayer: Player = {
            id,
            name,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            health: 100,
            isAlive: true,
        };
        this.players.set(id, newPlayer);
        this.emit('playerCreated', newPlayer);
        return newPlayer;
    }

    getPlayer(id: string): Player | undefined {
        return this.players.get(id);
    }

    updatePlayerPosition(id: string, position: { x: number; y: number; z: number }): void {
        const player = this.players.get(id);
        if (player) {
            player.position = position;
            this.emit('playerUpdated', player);
        }
    }

    playerDied(id: string): void {
        const player = this.players.get(id);
        if (player) {
            player.isAlive = false;
            this.emit('playerDied', player);
        }
    }

    getAllPlayers(): Player[] {
        return Array.from(this.players.values());
    }
}

export { PlayerManager, Player };