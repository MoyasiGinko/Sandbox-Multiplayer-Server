export interface GameMode {
  addPlayer(playerId: string): void;
  removePlayer(playerId: string): void;
}
