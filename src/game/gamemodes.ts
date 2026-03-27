import { GameMode } from './gamemodeInterface';

export class Deathmatch implements GameMode {
    private players: Set<string> = new Set();
    private scores: Map<string, number> = new Map();

    public addPlayer(playerId: string): void {
        this.players.add(playerId);
        this.scores.set(playerId, 0);
    }

    public removePlayer(playerId: string): void {
        this.players.delete(playerId);
        this.scores.delete(playerId);
    }

    public recordKill(killerId: string, victimId: string): void {
        if (this.players.has(killerId) && this.players.has(victimId)) {
            this.scores.set(killerId, (this.scores.get(killerId) || 0) + 1);
        }
    }

    public getScores(): Map<string, number> {
        return this.scores;
    }
}

export class CaptureTheFlag implements GameMode {
    private players: Set<string> = new Set();
    private flags: Map<string, boolean> = new Map();
    private scores: Map<string, number> = new Map();

    public addPlayer(playerId: string): void {
        this.players.add(playerId);
        this.scores.set(playerId, 0);
        this.flags.set(playerId, false); // Each player has a flag status
    }

    public removePlayer(playerId: string): void {
        this.players.delete(playerId);
        this.scores.delete(playerId);
        this.flags.delete(playerId);
    }

    public captureFlag(playerId: string): void {
        if (this.players.has(playerId)) {
            this.scores.set(playerId, (this.scores.get(playerId) || 0) + 1);
            this.flags.set(playerId, true); // Player has captured the flag
        }
    }

    public getScores(): Map<string, number> {
        return this.scores;
    }
}

// Additional game modes can be defined similarly
